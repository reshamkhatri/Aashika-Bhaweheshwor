const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DB_PATH = path.join(__dirname, 'db.json');

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// --- Default Users (seeded on first run) ---
const DEFAULT_USERS = [
    { username: 'admin', password: 'admin123', role: 'admin', displayName: 'Admin' },
    { username: 'aashika', password: 'aashika123', role: 'staff', displayName: 'Aashika' },
    { username: 'bhaweheshwor', password: 'bhaweheshwor123', role: 'staff', displayName: 'Bhaweheshwor' },
    { username: 'nishan', password: 'nishan123', role: 'staff', displayName: 'Nishan' },
];

// --- Body parser helper ---
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

// --- DB helpers ---
function loadDB() {
    try {
        if (fs.existsSync(DB_PATH)) {
            return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        }
    } catch (e) {
        console.error('Failed to load db.json:', e.message);
    }
    return null;
}

function saveDB(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (e) {
        console.error('Failed to save db.json:', e.message);
        return false;
    }
}

function getUsers() {
    const db = loadDB();
    if (db && db.users && db.users.length > 0) {
        return db.users;
    }
    return [...DEFAULT_USERS];
}

function saveUsers(users) {
    const db = loadDB() || {};
    db.users = users;
    return saveDB(db);
}

// Ensure users are seeded into db.json on first run
function ensureUsersSeeded() {
    const db = loadDB();
    if (!db || !db.users) {
        const data = db || {};
        data.users = [...DEFAULT_USERS];
        saveDB(data);
    }
}

ensureUsersSeeded();

// --- Server ---
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // CORS headers for API
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // --- API: Login ---
    if (pathname === '/api/login' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const users = getUsers();
            const user = users.find(u => u.username === body.username && u.password === body.password);
            if (user) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, user: { username: user.username, role: user.role, displayName: user.displayName } }));
            } else {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid username or password' }));
            }
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Bad request' }));
        }
        return;
    }

    // --- API: Get Users (returns list without passwords) ---
    if (pathname === '/api/users' && req.method === 'GET') {
        const users = getUsers();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(users.map(u => ({ username: u.username, role: u.role, displayName: u.displayName }))));
        return;
    }

    // --- API: Add User ---
    if (pathname === '/api/users/add' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { username, password, displayName, role } = body;

            if (!username || !password || !displayName) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Username, password, and display name are required' }));
                return;
            }

            const users = getUsers();
            const exists = users.find(u => u.username.toLowerCase() === username.toLowerCase());
            if (exists) {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Username already exists' }));
                return;
            }

            users.push({
                username: username.toLowerCase().trim(),
                password: password,
                displayName: displayName.trim(),
                role: role === 'admin' ? 'admin' : 'staff'
            });

            if (saveUsers(users)) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Failed to save' }));
            }
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Bad request' }));
        }
        return;
    }

    // --- API: Remove User ---
    if (pathname === '/api/users/remove' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { username } = body;

            if (!username) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Username is required' }));
                return;
            }

            // Prevent removing the last admin
            const users = getUsers();
            const userToRemove = users.find(u => u.username === username);
            if (!userToRemove) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'User not found' }));
                return;
            }

            if (userToRemove.role === 'admin') {
                const adminCount = users.filter(u => u.role === 'admin').length;
                if (adminCount <= 1) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Cannot remove the last admin user' }));
                    return;
                }
            }

            const filtered = users.filter(u => u.username !== username);
            if (saveUsers(filtered)) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Failed to save' }));
            }
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Bad request' }));
        }
        return;
    }

    // --- API: Change Password ---
    if (pathname === '/api/users/change-password' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { username, newPassword } = body;

            if (!username || !newPassword) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Username and new password are required' }));
                return;
            }

            if (newPassword.length < 4) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Password must be at least 4 characters' }));
                return;
            }

            const users = getUsers();
            const user = users.find(u => u.username === username);
            if (!user) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'User not found' }));
                return;
            }

            user.password = newPassword;
            if (saveUsers(users)) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Failed to save' }));
            }
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Bad request' }));
        }
        return;
    }

    // --- API: Get State ---
    if (pathname === '/api/state' && req.method === 'GET') {
        const data = loadDB();
        if (data) {
            // Return state without users (users are managed separately)
            const { users, ...stateData } = data;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(stateData));
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(null));
        }
        return;
    }

    // --- API: Save State ---
    if (pathname === '/api/state' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            // Preserve users when saving state
            const db = loadDB() || {};
            const users = db.users || [...DEFAULT_USERS];
            const newDb = { ...body, users };
            if (saveDB(newDb)) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Failed to save' }));
            }
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Bad request' }));
        }
        return;
    }

    // --- Static file serving ---
    let filePath = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    filePath = path.join(ROOT, filePath);

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`\n  🚀 Aashika-Bhaweneshwor Stock Manager`);
    console.log(`  ────────────────────────────────────`);
    console.log(`  Server running at: http://localhost:${PORT}`);
    console.log(`  Press Ctrl+C to stop\n`);
});
