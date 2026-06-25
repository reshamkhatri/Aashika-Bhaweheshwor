const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const PRODUCT_CATALOG = require('./data.js');

// Minimal .env loader (no dependency). Hosts like Render inject env vars
// directly, so this is only used for local development convenience.
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
            if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        });
    }
} catch (e) {}

// ============================================================
// CONFIG
// ============================================================
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DB_PATH = path.join(__dirname, 'db.json');
const MONGODB_URI = process.env.MONGODB_URI || '';   // if set -> use MongoDB Atlas
const MONGODB_DB = process.env.MONGODB_DB || 'stockflow';
const USE_MONGO = !!MONGODB_URI;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;          // 7 days

const MIME_TYPES = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Default users seeded on first run (passwords are hashed before storage)
const DEFAULT_USERS = [
    { username: 'admin', password: 'admin123', role: 'admin', displayName: 'Admin' },
    { username: 'aashika', password: 'aashika123', role: 'staff', displayName: 'Aashika' },
    { username: 'bhaweheshwor', password: 'bhaweheshwor123', role: 'staff', displayName: 'Bhaweheshwor' },
    { username: 'nishan', password: 'nishan123', role: 'staff', displayName: 'Nishan' },
];

// Which transaction types remove stock vs add it
const DEDUCT_TYPES = ['dispatch', 'leakage', 'breakage', 'retail-takeout'];
const ADD_TYPES = ['restock', 'retail-return'];
const ALL_TYPES = [...DEDUCT_TYPES, ...ADD_TYPES];

// ============================================================
// PASSWORD HASHING  (Node built-in crypto — no extra dependency)
// ============================================================
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `${salt}:${hash}`;
}
function isHashed(stored) {
    return typeof stored === 'string' && /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(stored);
}
function verifyPassword(password, stored) {
    if (!isHashed(stored)) return String(password) === String(stored); // legacy plaintext
    const [salt, hash] = stored.split(':');
    const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
    } catch (e) { return false; }
}

// ============================================================
// SESSION TOKENS  (stateless, HMAC-signed — survive restarts)
// ============================================================
let SESSION_SECRET = process.env.SESSION_SECRET || '';

function b64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signToken(user) {
    const payload = { u: user.username, r: user.role, n: user.displayName, exp: Date.now() + TOKEN_TTL_MS };
    const body = b64url(JSON.stringify(payload));
    const sig = b64url(crypto.createHmac('sha256', SESSION_SECRET).update(body).digest());
    return `${body}.${sig}`;
}
function verifyToken(token) {
    if (!token || token.indexOf('.') < 0) return null;
    const [body, sig] = token.split('.');
    const expected = b64url(crypto.createHmac('sha256', SESSION_SECRET).update(body).digest());
    try {
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    } catch (e) { return null; }
    let payload;
    try { payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); }
    catch (e) { return null; }
    if (!payload || payload.exp < Date.now()) return null;
    return payload;
}

// ============================================================
// PERSISTENCE  (MongoDB if MONGODB_URI is set, otherwise db.json)
// ============================================================
let mongoCol = null;
let memoryDb = null; // authoritative in-memory copy

async function connectMongo() {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        appName: 'aashika-bhaweheshwor-stock-manager',
    });

    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await client.connect();
            mongoCol = client.db(MONGODB_DB).collection('appdata');
            console.log('  Storage: MongoDB Atlas connected');
            return;
        } catch (e) {
            if (attempt === maxAttempts) throw e;
            const waitMs = 1000 * attempt;
            console.warn(`  MongoDB connection failed (attempt ${attempt}/${maxAttempts}). Retrying in ${waitMs}ms: ${e.message}`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }
}

async function readRaw() {
    if (USE_MONGO) {
        const doc = await mongoCol.findOne({ _id: 'main' });
        return doc ? doc.data : null;
    }
    try {
        if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    } catch (e) { console.error('Failed to load db.json:', e.message); }
    return null;
}
async function writeRaw(data) {
    if (USE_MONGO) {
        await mongoCol.updateOne({ _id: 'main' }, { $set: { data } }, { upsert: true });
        return;
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// Persist the in-memory authoritative copy
async function persist() { await writeRaw(memoryDb); }

// ============================================================
// IN-PROCESS WRITE LOCK  (serializes stock mutations -> no clobbering)
// ============================================================
let lock = Promise.resolve();
function withLock(fn) {
    const run = lock.then(fn, fn);
    lock = run.then(() => {}, () => {});
    return run;
}

// ============================================================
// BOOTSTRAP / MIGRATION
// ============================================================
async function bootstrap() {
    if (USE_MONGO) await connectMongo();

    let db = await readRaw();
    let dirty = false;

    if (!db) {
        db = { users: [], stock: {}, dispatches: [], initialized: false, settings: {} };
        dirty = true;
    }
    db.settings = db.settings || {};
    db.users = db.users || [];
    db.stock = db.stock || {};
    db.dispatches = db.dispatches || [];

    // Session secret: env wins; otherwise generate once and persist
    if (SESSION_SECRET) {
        // env provided
    } else if (db.settings.sessionSecret) {
        SESSION_SECRET = db.settings.sessionSecret;
    } else {
        SESSION_SECRET = crypto.randomBytes(32).toString('hex');
        db.settings.sessionSecret = SESSION_SECRET;
        dirty = true;
    }

    // Seed default users on first run
    if (!db.users.length) {
        db.users = DEFAULT_USERS.map(u => ({ ...u, password: hashPassword(u.password) }));
        dirty = true;
    }

    // Migrate any legacy plaintext passwords -> hashed
    db.users.forEach(u => {
        if (!isHashed(u.password)) { u.password = hashPassword(u.password); dirty = true; }
    });

    // Seed initial stock on first run
    if (!db.initialized) {
        db.stock = {};
        PRODUCT_CATALOG.forEach(p => {
            db.stock[p.id] = { cases: p.initialStockCases, pieces: p.initialStockPieces };
        });
        db.dispatches = [];
        db.initialized = true;
        dirty = true;
    }

    memoryDb = db;
    if (dirty) await persist();
}

// ============================================================
// STOCK HELPERS (server-authoritative)
// ============================================================
function getProduct(id) { return PRODUCT_CATALOG.find(p => p.id === id); }
function totalPieces(stock, product) { return stock.cases * product.piecesPerCase + stock.pieces; }
function normalize(total, product) {
    return { cases: Math.floor(total / product.piecesPerCase), pieces: total % product.piecesPerCase };
}

// Apply a transaction's effect to stock. direction: +1 apply, -1 reverse
function applyEffect(txn, direction) {
    const product = getProduct(txn.productId);
    if (!product) return;
    const stock = memoryDb.stock[txn.productId] || { cases: 0, pieces: 0 };
    let total = totalPieces(stock, product);
    const isDeduct = DEDUCT_TYPES.includes(txn.type);
    const delta = txn.totalPieces * direction * (isDeduct ? -1 : 1);
    total = Math.max(0, total + delta);
    memoryDb.stock[txn.productId] = normalize(total, product);
}

// ============================================================
// HTTP HELPERS
// ============================================================
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
        req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
        req.on('error', reject);
    });
}
function sendJson(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}
function getAuth(req) {
    const h = req.headers['authorization'] || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? verifyToken(m[1]) : null;
}
function publicUser(u) { return { username: u.username, role: u.role, displayName: u.displayName }; }

// ============================================================
// EXCEL EXPORT
// ============================================================
function fmtQty(d) {
    const parts = [];
    if (d.cases > 0) parts.push(`${d.cases}c`);
    if (d.pieces > 0) parts.push(`${d.pieces}p`);
    return parts.join(' ') || '0';
}
function buildWorkbook(kind) {
    const wb = XLSX.utils.book_new();
    if (kind === 'inventory') {
        const rows = PRODUCT_CATALOG.map(p => {
            const s = memoryDb.stock[p.id] || { cases: 0, pieces: 0 };
            const total = totalPieces(s, p);
            return {
                Product: p.name, Volume: p.volume, 'Pcs/Case': p.piecesPerCase,
                Cases: s.cases, 'Loose Pcs': s.pieces, 'Total Pcs': total,
                Status: total === 0 ? 'Out of Stock' : (s.cases < 3 && total < p.piecesPerCase * 3 ? 'Low Stock' : 'In Stock'),
            };
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Inventory');
    } else {
        const filter = {
            history: () => memoryDb.dispatches,
            retailing: () => memoryDb.dispatches.filter(d => d.type === 'retail-takeout' || d.type === 'retail-return'),
            leakage: () => memoryDb.dispatches.filter(d => d.type === 'leakage' || d.type === 'breakage'),
        }[kind];
        const list = (filter ? filter() : memoryDb.dispatches)
            .slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const rows = list.map(d => {
            const p = getProduct(d.productId) || { name: d.productId, volume: '' };
            return {
                Date: new Date(d.timestamp).toLocaleString(),
                Type: d.type, Product: p.name, Volume: p.volume,
                Cases: d.cases, Pieces: d.pieces, 'Total Pcs': d.totalPieces,
                User: d.user || '', Notes: d.notes || '',
            };
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), kind);
    }
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ============================================================
// SERVER
// ============================================================
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    try {
        // ---------- LOGIN ----------
        if (pathname === '/api/login' && req.method === 'POST') {
            const body = await parseBody(req);
            const user = memoryDb.users.find(u => u.username === String(body.username || '').toLowerCase().trim());
            if (user && verifyPassword(body.password, user.password)) {
                return sendJson(res, 200, { success: true, token: signToken(user), user: publicUser(user) });
            }
            return sendJson(res, 401, { success: false, error: 'Invalid username or password' });
        }

        // ---------- everything below requires a valid token ----------
        const auth = getAuth(req);
        if (pathname.startsWith('/api/')) {
            if (!auth) return sendJson(res, 401, { success: false, error: 'Not authorized. Please log in again.' });
        }

        // ---------- WHO AM I ----------
        if (pathname === '/api/me' && req.method === 'GET') {
            return sendJson(res, 200, { success: true, user: { username: auth.u, role: auth.r, displayName: auth.n } });
        }

        // ---------- USERS (admin only) ----------
        if (pathname === '/api/users' && req.method === 'GET') {
            if (auth.r !== 'admin') return sendJson(res, 403, { success: false, error: 'Admin only' });
            return sendJson(res, 200, memoryDb.users.map(publicUser));
        }

        if (pathname === '/api/users/add' && req.method === 'POST') {
            if (auth.r !== 'admin') return sendJson(res, 403, { success: false, error: 'Admin only' });
            const { username, password, displayName, role } = await parseBody(req);
            if (!username || !password || !displayName) return sendJson(res, 400, { success: false, error: 'Username, password, and display name are required' });
            if (String(password).length < 4) return sendJson(res, 400, { success: false, error: 'Password must be at least 4 characters' });
            const uname = String(username).toLowerCase().trim();
            if (memoryDb.users.some(u => u.username === uname)) return sendJson(res, 409, { success: false, error: 'Username already exists' });
            await withLock(async () => {
                memoryDb.users.push({ username: uname, password: hashPassword(password), displayName: String(displayName).trim(), role: role === 'admin' ? 'admin' : 'staff' });
                await persist();
            });
            return sendJson(res, 200, { success: true });
        }

        if (pathname === '/api/users/remove' && req.method === 'POST') {
            if (auth.r !== 'admin') return sendJson(res, 403, { success: false, error: 'Admin only' });
            const { username } = await parseBody(req);
            const target = memoryDb.users.find(u => u.username === username);
            if (!target) return sendJson(res, 404, { success: false, error: 'User not found' });
            if (username === auth.u) return sendJson(res, 400, { success: false, error: 'You cannot remove yourself' });
            if (target.role === 'admin' && memoryDb.users.filter(u => u.role === 'admin').length <= 1)
                return sendJson(res, 400, { success: false, error: 'Cannot remove the last admin user' });
            await withLock(async () => {
                memoryDb.users = memoryDb.users.filter(u => u.username !== username);
                await persist();
            });
            return sendJson(res, 200, { success: true });
        }

        if (pathname === '/api/users/change-password' && req.method === 'POST') {
            const { username, newPassword } = await parseBody(req);
            // Admin can change anyone; a user may change their own
            if (auth.r !== 'admin' && username !== auth.u) return sendJson(res, 403, { success: false, error: 'Not allowed' });
            if (!username || !newPassword) return sendJson(res, 400, { success: false, error: 'Username and new password are required' });
            if (String(newPassword).length < 4) return sendJson(res, 400, { success: false, error: 'Password must be at least 4 characters' });
            const user = memoryDb.users.find(u => u.username === username);
            if (!user) return sendJson(res, 404, { success: false, error: 'User not found' });
            await withLock(async () => { user.password = hashPassword(newPassword); await persist(); });
            return sendJson(res, 200, { success: true });
        }

        // ---------- STATE (stock + transactions) ----------
        if (pathname === '/api/state' && req.method === 'GET') {
            return sendJson(res, 200, { stock: memoryDb.stock, dispatches: memoryDb.dispatches, initialized: true });
        }

        // ---------- ADD TRANSACTION (server computes stock) ----------
        if (pathname === '/api/transactions' && req.method === 'POST') {
            const body = await parseBody(req);
            const product = getProduct(body.productId);
            const cases = parseInt(body.cases) || 0;
            const pieces = parseInt(body.pieces) || 0;
            const type = body.type;
            if (!product) return sendJson(res, 400, { success: false, error: 'Unknown product' });
            if (!ALL_TYPES.includes(type)) return sendJson(res, 400, { success: false, error: 'Invalid transaction type' });
            if (cases < 0 || pieces < 0) return sendJson(res, 400, { success: false, error: 'Quantities cannot be negative' });
            const requested = cases * product.piecesPerCase + pieces;
            if (requested <= 0) return sendJson(res, 400, { success: false, error: 'Please enter a valid quantity' });

            const result = await withLock(async () => {
                const stock = memoryDb.stock[product.id] || { cases: 0, pieces: 0 };
                if (DEDUCT_TYPES.includes(type) && requested > totalPieces(stock, product)) {
                    return { error: `Insufficient stock! Available: ${stock.cases} cases, ${stock.pieces} pieces` };
                }
                const txn = {
                    id: 'txn_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
                    productId: product.id, cases, pieces, totalPieces: requested,
                    notes: String(body.notes || ''), timestamp: new Date().toISOString(),
                    type, user: auth.u,
                };
                applyEffect(txn, 1);
                memoryDb.dispatches.push(txn);
                await persist();
                return { txn, stock: memoryDb.stock[product.id] };
            });
            if (result.error) return sendJson(res, 400, { success: false, error: result.error });
            return sendJson(res, 200, { success: true, transaction: result.txn, stock: result.stock });
        }

        // ---------- UNDO / DELETE TRANSACTION ----------
        if (pathname === '/api/transactions' && req.method === 'DELETE') {
            const body = await parseBody(req);
            const result = await withLock(async () => {
                const idx = memoryDb.dispatches.findIndex(d => d.id === body.id);
                if (idx < 0) return { error: 'Transaction not found' };
                const txn = memoryDb.dispatches[idx];
                if (auth.r !== 'admin' && txn.user !== auth.u) return { error: 'You can only undo your own transactions' };
                applyEffect(txn, -1); // reverse its stock effect
                memoryDb.dispatches.splice(idx, 1);
                await persist();
                return { stock: memoryDb.stock };
            });
            if (result.error) return sendJson(res, 400, { success: false, error: result.error });
            return sendJson(res, 200, { success: true, stock: memoryDb.stock });
        }

        // ---------- RESET (admin only) ----------
        if (pathname === '/api/reset' && req.method === 'POST') {
            if (auth.r !== 'admin') return sendJson(res, 403, { success: false, error: 'Admin only' });
            await withLock(async () => {
                memoryDb.stock = {};
                PRODUCT_CATALOG.forEach(p => { memoryDb.stock[p.id] = { cases: p.initialStockCases, pieces: p.initialStockPieces }; });
                memoryDb.dispatches = [];
                await persist();
            });
            return sendJson(res, 200, { success: true });
        }

        // ---------- EXCEL EXPORT ----------
        const exp = pathname.match(/^\/api\/export\/(inventory|history|retailing|leakage)\.xlsx$/);
        if (exp && req.method === 'GET') {
            const buf = buildWorkbook(exp[1]);
            res.writeHead(200, {
                'Content-Type': MIME_TYPES['.xlsx'],
                'Content-Disposition': `attachment; filename="${exp[1]}-${new Date().toISOString().split('T')[0]}.xlsx"`,
            });
            return res.end(buf);
        }

        if (pathname.startsWith('/api/')) return sendJson(res, 404, { success: false, error: 'Unknown endpoint' });

        // ---------- STATIC FILES (with path-traversal protection) ----------
        let rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
        const filePath = path.normalize(path.join(ROOT, rel));
        if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('403 Forbidden'); }
        const ext = path.extname(filePath).toLowerCase();
        fs.readFile(filePath, (err, data) => {
            if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404 Not Found'); }
            res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
            res.end(data);
        });
    } catch (e) {
        console.error('Request error:', e);
        if (pathname.startsWith('/api/')) return sendJson(res, 500, { success: false, error: 'Server error' });
        res.writeHead(500); res.end('Server error');
    }
});

bootstrap().then(() => {
    server.listen(PORT, () => {
        console.log(`\n  Aashika-Bhaweneshwor Stock Manager`);
        console.log(`  ----------------------------------`);
        console.log(`  Storage: ${USE_MONGO ? 'MongoDB Atlas' : 'db.json (local file)'}`);
        console.log(`  Server running at: http://localhost:${PORT}\n`);
    });
}).catch(e => { console.error('Failed to start:', e); process.exit(1); });
