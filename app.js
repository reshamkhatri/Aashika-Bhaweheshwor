/* ============================================
   AASHIKA-BHAWENESHWOR STOCK MANAGER
   Application Logic
   ============================================ */

(function () {
    'use strict';

    // ==========================================
    // STATE MANAGEMENT
    // ==========================================
    const STORAGE_KEY = 'aashika_stock_manager';
    const LOW_STOCK_THRESHOLD = 3; // cases

    let state = {
        stock: {},       // productId -> { cases, pieces }
        dispatches: [],  // { id, productId, cases, pieces, totalPieces, notes, timestamp, type, user }
        initialized: false
    };

    // ==========================================
    // AUTH MANAGEMENT
    // ==========================================
    let currentUser = null; // { username, role, displayName }
    let authToken = null;   // session token sent on every API call

    function isLoggedIn() {
        return currentUser !== null;
    }

    function getSessionToken() {
        try { return sessionStorage.getItem('aashika_token'); } catch (e) { return null; }
    }
    function setSessionToken(token) {
        try {
            if (token) sessionStorage.setItem('aashika_token', token);
            else sessionStorage.removeItem('aashika_token');
        } catch (e) {}
    }

    // Central fetch wrapper that attaches the auth token and handles expiry
    async function apiFetch(path, options = {}) {
        const opts = { ...options, headers: { ...(options.headers || {}) } };
        if (authToken) opts.headers['Authorization'] = 'Bearer ' + authToken;
        const res = await fetch(path, opts);
        if (res.status === 401 && isLoggedIn()) {
            showToast('Session expired. Please log in again.', 'warning');
            logout();
        }
        return res;
    }

    // Escape user-supplied text before inserting into HTML (prevents XSS)
    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    // Safe JS string literal for use inside an HTML attribute (e.g. onclick="fn(...)").
    // JSON.stringify quotes/escapes the value; esc() makes it attribute-safe.
    function jsArg(str) {
        return esc(JSON.stringify(String(str == null ? '' : str)));
    }

    function isAdmin() {
        return currentUser && currentUser.role === 'admin';
    }

    function getSessionUser() {
        try {
            const saved = sessionStorage.getItem('aashika_current_user');
            if (saved) return JSON.parse(saved);
        } catch (e) {}
        return null;
    }

    function setSessionUser(user) {
        try {
            if (user) {
                sessionStorage.setItem('aashika_current_user', JSON.stringify(user));
            } else {
                sessionStorage.removeItem('aashika_current_user');
            }
        } catch (e) {}
    }

    async function attemptLogin(username, password) {
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (data.success) {
                currentUser = data.user;
                authToken = data.token;
                setSessionUser(currentUser);
                setSessionToken(authToken);
                return { success: true };
            } else {
                return { success: false, error: data.error || 'Invalid credentials' };
            }
        } catch (e) {
            return { success: false, error: 'Server error. Please try again.' };
        }
    }

    function logout() {
        currentUser = null;
        authToken = null;
        setSessionUser(null);
        setSessionToken(null);
        showLoginScreen();
    }

    function showLoginScreen() {
        document.getElementById('login-overlay').classList.add('active');
        document.getElementById('login-username').value = '';
        document.getElementById('login-password').value = '';
        document.getElementById('login-error').style.display = 'none';
        document.getElementById('login-username').focus();
    }

    function hideLoginScreen() {
        document.getElementById('login-overlay').classList.remove('active');
    }

    function updateUIForUser() {
        if (!currentUser) return;

        // Update sidebar user indicator
        const userEl = document.getElementById('sidebar-user');
        userEl.style.display = 'flex';
        document.getElementById('sidebar-user-avatar').textContent = currentUser.displayName.charAt(0);
        document.getElementById('sidebar-user-name').textContent = currentUser.displayName;
        document.getElementById('sidebar-user-role').textContent = currentUser.role === 'admin' ? 'Administrator' : 'Staff';

        // Show/hide admin nav
        const adminNav = document.getElementById('nav-admin');
        adminNav.style.display = isAdmin() ? 'flex' : 'none';

        // Full data export is admin-only.
        document.getElementById('btn-export-data').style.display = isAdmin() ? 'flex' : 'none';

        // Show logout button
        document.getElementById('btn-logout').style.display = 'flex';
    }

    // ==========================================
    // DATA HELPERS
    // ==========================================
    function getProduct(id) {
        return PRODUCT_CATALOG.find(p => p.id === id);
    }

    function getStock(id) {
        return state.stock[id] || { cases: 0, pieces: 0 };
    }

    function getTotalPieces(id) {
        const s = getStock(id);
        const p = getProduct(id);
        return (s.cases * p.piecesPerCase) + s.pieces;
    }

    function getStockStatus(id) {
        const total = getTotalPieces(id);
        const p = getProduct(id);
        if (total === 0) return 'out-of-stock';
        // Low stock = total remaining is below LOW_STOCK_THRESHOLD cases' worth
        // (counts loose pieces too, not just full cases)
        if (total < LOW_STOCK_THRESHOLD * p.piecesPerCase) return 'low-stock';
        return 'in-stock';
    }

    function getStatusLabel(status) {
        switch (status) {
            case 'in-stock': return 'In Stock';
            case 'low-stock': return 'Low Stock';
            case 'out-of-stock': return 'Out of Stock';
            default: return '';
        }
    }

    function getBrands() {
        const brands = new Set();
        PRODUCT_CATALOG.forEach(p => brands.add(getBrandName(p)));
        return Array.from(brands).sort();
    }

    function getBrandName(product) {
        const knownBrands = [
            'Badam Juice', 'Himalayan Dragon', 'Rara Blues', 'Red Bull',
            'Seoul Soju', 'Seto Bagh'
        ];
        const name = String(product.name || '').trim();
        return knownBrands.find(brand => name === brand || name.startsWith(brand + ' ')) || name.split(/\s+/)[0] || name;
    }

    function formatDate(dateStr) {
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-US', {
                timeZone: 'Asia/Kathmandu',
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch (e) {
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
        }
    }

    function formatTime(dateStr) {
        try {
            const d = new Date(dateStr);
            return d.toLocaleTimeString('en-US', {
                timeZone: 'Asia/Kathmandu',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            const d = new Date(dateStr);
            return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        }
    }

    // Local calendar date (YYYY-MM-DD) in Nepal timezone (Asia/Kathmandu).
    // Nepal is UTC+5:45.
    function localDate(ts) {
        try {
            return new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Kathmandu' });
        } catch (e) {
            const d = new Date(ts);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }
    }

    function getToday() {
        try {
            return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kathmandu' });
        } catch (e) {
            return localDate(new Date());
        }
    }

    function generateId() {
        return 'txn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }

    // ==========================================
    // PERSISTENCE (Server-side via API)
    // ==========================================
    // The SERVER is now the single source of truth for stock & transactions.
    // The client never overwrites the whole database anymore — every change
    // goes through a dedicated transaction endpoint, so concurrent users can't
    // clobber each other's data. We just keep a local mirror for rendering.
    async function loadStateFromServer() {
        try {
            const res = await apiFetch('/api/state');
            if (!res.ok) return false;
            const data = await res.json();
            if (data && data.initialized) {
                state = { stock: data.stock || {}, dispatches: data.dispatches || [], initialized: true };
                return true;
            }
        } catch (e) {
            console.error('Failed to load state from server:', e);
        }
        return false;
    }

    async function initializeState() {
        const ok = await loadStateFromServer();
        if (!ok) {
            showToast('Could not load data from the server.', 'error');
            state = { stock: {}, dispatches: [], initialized: false };
        }
    }

    // Record any stock movement through the server (server validates & updates stock).
    // Returns true on success. type is one of:
    // dispatch | restock | retail-takeout | retail-return | leakage | breakage
    async function recordTransaction({ type, productId, cases, pieces, notes }) {
        try {
            const res = await apiFetch('/api/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, productId, cases, pieces, notes })
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.error || 'Action failed', 'error');
                return false;
            }
            // Update local mirror from the authoritative server response
            state.stock[productId] = data.stock;
            state.dispatches.push(data.transaction);
            return true;
        } catch (e) {
            showToast('Server error. Please try again.', 'error');
            return false;
        }
    }

    // Undo / delete a transaction (reverses its stock effect on the server).
    async function undoTransaction(id) {
        const confirmed = await showConfirm('Undo this transaction?', 'This reverses its effect on stock and removes it from the records. This cannot be undone.');
        if (!confirmed) return;
        try {
            const res = await apiFetch('/api/transactions', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            const data = await res.json();
            if (!data.success) { showToast(data.error || 'Failed to undo', 'error'); return; }
            // Re-sync local mirror from server
            await loadStateFromServer();
            showToast('Transaction undone', 'info');
            renderCurrentView();
            renderStats();
        } catch (e) {
            showToast('Server error. Please try again.', 'error');
        }
    }

    // ==========================================
    // NAVIGATION
    // ==========================================
    const views = {
        dashboard: { title: 'Dashboard', el: 'view-dashboard' },
        inventory: { title: 'Full Inventory', el: 'view-inventory' },
        dispatch: { title: 'Dispatch', el: 'view-dispatch' },
        history: { title: 'Dispatch History', el: 'view-history' },
        restock: { title: 'Restock', el: 'view-restock' },
        retailing: { title: 'Daily Retailing', el: 'view-retailing' },
        leakage: { title: 'Leakage & Breakage', el: 'view-leakage' },
        admin: { title: 'Admin Panel', el: 'view-admin' }
    };

    let currentView = 'dashboard';

    function switchView(viewName) {
        if (!views[viewName]) return;
        // Block non-admin from admin view
        if (viewName === 'admin' && !isAdmin()) return;

        currentView = viewName;

        // Update nav
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewName);
        });

        // Update views
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(views[viewName].el).classList.add('active');

        // Update title
        document.getElementById('page-title').textContent = views[viewName].title;

        // Close sidebar on mobile
        document.getElementById('sidebar').classList.remove('open');

        // Render the view
        renderCurrentView();
    }

    function renderCurrentView() {
        switch (currentView) {
            case 'dashboard': renderDashboard(); break;
            case 'inventory': renderInventory(); break;
            case 'dispatch': renderDispatch(); break;
            case 'history': renderHistory(); break;
            case 'restock': renderRestock(); break;
            case 'retailing': renderRetailing(); break;
            case 'leakage': renderLeakage(); break;
            case 'admin': renderAdmin(); break;
        }
    }

    // ==========================================
    // SEARCH & FILTER
    // ==========================================
    let searchQuery = '';

    function filterProducts(products, options = {}) {
        let filtered = [...products];

        // Search
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(p =>
                p.name.toLowerCase().includes(q) ||
                p.volume.toLowerCase().includes(q) ||
                (p.name + ' ' + p.volume).toLowerCase().includes(q)
            );
        }

        // Brand filter
        if (options.brand && options.brand !== 'all') {
            filtered = filtered.filter(p => getBrandName(p) === options.brand);
        }

        // Status filter
        if (options.status && options.status !== 'all') {
            filtered = filtered.filter(p => getStockStatus(p.id) === options.status);
        }

        // Sort
        if (options.sort) {
            switch (options.sort) {
                case 'name-asc': filtered.sort((a, b) => (a.name + a.volume).localeCompare(b.name + b.volume)); break;
                case 'name-desc': filtered.sort((a, b) => (b.name + b.volume).localeCompare(a.name + a.volume)); break;
                case 'stock-asc': filtered.sort((a, b) => getTotalPieces(a.id) - getTotalPieces(b.id)); break;
                case 'stock-desc': filtered.sort((a, b) => getTotalPieces(b.id) - getTotalPieces(a.id)); break;
            }
        }

        return filtered;
    }

    // ==========================================
    // RENDER: DASHBOARD
    // ==========================================
    function renderDashboard() {
        renderStats();
        renderDashboardGrid();
    }

    function renderStats() {
        const totalProducts = PRODUCT_CATALOG.length;
        let totalCases = 0;
        let lowStockCount = 0;

        PRODUCT_CATALOG.forEach(p => {
            const s = getStock(p.id);
            totalCases += s.cases;
            const status = getStockStatus(p.id);
            if (status === 'low-stock' || status === 'out-of-stock') lowStockCount++;
        });

        const today = getToday();
        const todayDispatches = state.dispatches.filter(d =>
            d.type === 'dispatch' && localDate(d.timestamp) === today
        ).length;

        const leakageBreakageCount = state.dispatches.filter(d =>
            (d.type === 'leakage' || d.type === 'breakage') && localDate(d.timestamp) === today
        ).length;

        animateCounter('stat-total-products', totalProducts);
        animateCounter('stat-total-cases', totalCases);
        animateCounter('stat-today-dispatches', todayDispatches);
        animateCounter('stat-low-stock', lowStockCount);
        animateCounter('stat-leakage-count', leakageBreakageCount);
    }

    function animateCounter(elId, target) {
        const el = document.getElementById(elId);
        const current = parseInt(el.textContent) || 0;
        if (current === target) { el.textContent = target; return; }

        const duration = 500;
        const steps = 30;
        const increment = (target - current) / steps;
        let step = 0;

        const timer = setInterval(() => {
            step++;
            if (step >= steps) {
                el.textContent = target;
                clearInterval(timer);
            } else {
                el.textContent = Math.round(current + increment * step);
            }
        }, duration / steps);
    }

    function renderDashboardGrid() {
        const brand = document.getElementById('dashboard-filter-brand').value;
        const status = document.getElementById('dashboard-filter-status').value;

        const products = filterProducts(PRODUCT_CATALOG, { brand, status, sort: 'name-asc' });
        const grid = document.getElementById('dashboard-grid');

        if (products.length === 0) {
            grid.innerHTML = '<div class="empty-state"><p>No products match your filters</p></div>';
            return;
        }

        grid.innerHTML = products.map(p => {
            const s = getStock(p.id);
            const stockStatus = getStockStatus(p.id);
            const badgeClass = `badge-${stockStatus}`;
            return `
                <div class="product-card" data-product-id="${p.id}" onclick="window.app.showProductModal('${p.id}')">
                    <div class="product-card-image">
                        <img src="${encodeURIComponent(p.image)}" alt="${p.name} ${p.volume}" loading="lazy">
                    </div>
                    <div class="product-card-name" title="${p.name} ${p.volume}">${p.name} ${p.volume}</div>
                    <div class="product-card-volume">${p.piecesPerCase} pcs/case</div>
                    <div class="product-card-stock">
                        <span class="stock-count">${s.cases}c ${s.pieces}p</span>
                        <span class="stock-badge ${badgeClass}">${getStatusLabel(stockStatus)}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ==========================================
    // RENDER: INVENTORY TABLE
    // ==========================================
    function renderInventory() {
        const brand = document.getElementById('inventory-filter-brand').value;
        const sort = document.getElementById('inventory-sort').value;

        const products = filterProducts(PRODUCT_CATALOG, { brand, sort });
        const tbody = document.getElementById('inventory-tbody');

        if (products.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>No products match</p></td></tr>';
            return;
        }

        tbody.innerHTML = products.map(p => {
            const s = getStock(p.id);
            const total = getTotalPieces(p.id);
            const status = getStockStatus(p.id);
            const badgeClass = `badge-${status}`;
            return `
                <tr>
                    <td data-label="Product">
                        <div class="table-product">
                            <div class="table-product-img">
                                <img src="${encodeURIComponent(p.image)}" alt="${p.name}" loading="lazy">
                            </div>
                            <span class="table-product-name">${p.name} ${p.volume}</span>
                        </div>
                    </td>
                    <td data-label="Volume">${p.volume}</td>
                    <td data-label="Pcs/Case">${p.piecesPerCase}</td>
                    <td data-label="Cases"><strong>${s.cases}</strong></td>
                    <td data-label="Loose Pcs">${s.pieces}</td>
                    <td data-label="Total Pcs">${total}</td>
                    <td data-label="Status"><span class="stock-badge ${badgeClass}">${getStatusLabel(status)}</span></td>
                    <td data-label="Actions">
                        <div class="table-actions">
                            <button class="btn-table btn-table-dispatch" onclick="window.app.quickDispatch('${p.id}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                                Dispatch
                            </button>
                            <button class="btn-table btn-table-restock" onclick="window.app.quickRestock('${p.id}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                                Restock
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // ==========================================
    // RENDER: DISPATCH
    // ==========================================
    function renderDispatch() {
        populateProductSelect('dispatch-product');
        renderTodayDispatches();
    }

    function populateProductSelect(selectId) {
        const select = document.getElementById(selectId);
        const currentVal = select.value;
        const optionsHtml = PRODUCT_CATALOG.map(p => {
            const s = getStock(p.id);
            return `<option value="${p.id}">${p.name} ${p.volume} (${s.cases}c ${s.pieces}p)</option>`;
        }).join('');
        select.innerHTML = '<option value="">Select a product...</option>' + optionsHtml;
        if (currentVal) select.value = currentVal;
    }

    function renderTodayDispatches() {
        const today = getToday();
        document.getElementById('today-dispatch-date').textContent = formatDate(new Date().toISOString());

        const todayDispatches = state.dispatches
            .filter(d => d.type === 'dispatch' && localDate(d.timestamp) === today)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const list = document.getElementById('dispatch-today-list');
        const summary = document.getElementById('dispatch-today-summary');

        if (todayDispatches.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                    <p>No dispatches recorded today</p>
                </div>`;
            summary.style.display = 'none';
            return;
        }

        let totalItems = 0;
        const productsDispatched = new Set();

        list.innerHTML = todayDispatches.map(d => {
            const p = getProduct(d.productId);
            totalItems += d.totalPieces;
            productsDispatched.add(d.productId);
            const qtyText = [];
            if (d.cases > 0) qtyText.push(`${d.cases}c`);
            if (d.pieces > 0) qtyText.push(`${d.pieces}p`);
            const userTag = d.user ? ` · by ${esc(d.user)}` : '';
            return `
                <div class="dispatch-entry">
                    <div class="dispatch-entry-img">
                        <img src="${encodeURIComponent(p.image)}" alt="${p.name}">
                    </div>
                    <div class="dispatch-entry-info">
                        <div class="dispatch-entry-name">${p.name} ${p.volume}</div>
                        <div class="dispatch-entry-detail">${esc(d.notes) || 'No notes'}${userTag}</div>
                    </div>
                    <span class="dispatch-entry-qty">${qtyText.join(' ')}</span>
                    <span class="dispatch-entry-time">${formatTime(d.timestamp)}</span>
                </div>`;
        }).join('');

        summary.style.display = 'flex';
        document.getElementById('summary-total-items').textContent = totalItems + ' pcs';
        document.getElementById('summary-products-count').textContent = productsDispatched.size;
    }

    // ==========================================
    // RENDER: HISTORY
    // ==========================================
    function renderHistory() {
        populateProductSelect('history-product-filter');
        const dateFilter = document.getElementById('history-date-filter').value;
        const productFilter = document.getElementById('history-product-filter').value;

        let filtered = [...state.dispatches].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (dateFilter) {
            filtered = filtered.filter(d => localDate(d.timestamp) === dateFilter);
        }

        if (productFilter && productFilter !== 'all') {
            filtered = filtered.filter(d => d.productId === productFilter);
        }

        const timeline = document.getElementById('history-timeline');

        if (filtered.length === 0) {
            timeline.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <p>No dispatch history found</p>
                </div>`;
            return;
        }

        // Group by date
        const groups = {};
        filtered.forEach(d => {
            const date = localDate(d.timestamp);
            if (!groups[date]) groups[date] = [];
            groups[date].push(d);
        });

        timeline.innerHTML = Object.entries(groups).map(([date, entries]) => {
            const entriesHtml = entries.map(d => {
                const p = getProduct(d.productId);
                const isDispatch = d.type === 'dispatch';
                const isLeakage = d.type === 'leakage' || d.type === 'breakage';
                const isRetailTakeout = d.type === 'retail-takeout';
                const isRetailReturn = d.type === 'retail-return';
                const isDeduction = isDispatch || isLeakage || isRetailTakeout;
                const iconClass = isLeakage ? 'leakage-icon' : (isRetailTakeout ? 'retail-takeout-icon' : (isRetailReturn ? 'retail-return-icon' : (isDispatch ? 'dispatch-icon' : 'restock-icon')));
                const qtyClass = isLeakage ? 'leakage-text' : (isRetailTakeout ? 'retail-takeout-text' : (isRetailReturn ? 'retail-return-text' : (isDispatch ? 'dispatch-text' : 'restock-text')));
                const qtyParts = [];
                if (d.cases > 0) qtyParts.push(`${d.cases} case${d.cases > 1 ? 's' : ''}`);
                if (d.pieces > 0) qtyParts.push(`${d.pieces} pc${d.pieces > 1 ? 's' : ''}`);
                const prefix = isDeduction ? '−' : '+';
                const iconSvg = isLeakage
                    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></svg>'
                    : (isRetailTakeout || isRetailReturn)
                    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>'
                    : isDispatch
                    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>'
                    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>';

                const userTag = d.user ? ` · by ${esc(d.user)}` : '';

                // Show an undo button to admins (any txn) or the user who made it
                const canUndo = isAdmin() || (currentUser && d.user === currentUser.username);
                const undoBtn = canUndo
                    ? `<button class="btn-undo-txn" title="Undo this transaction" onclick="window.app.undoTransaction(${jsArg(d.id)})">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
                       </button>`
                    : '';

                return `
                    <div class="history-entry">
                        <div class="history-entry-icon ${iconClass}">${iconSvg}</div>
                        <div class="history-entry-info">
                            <div class="history-entry-title">${p.name} ${p.volume}</div>
                            <div class="history-entry-meta">${formatTime(d.timestamp)}${d.notes ? ' · ' + esc(d.notes) : ''}${userTag}${isLeakage ? ' <span class="leakage-type-tag tag-' + d.type + '">' + d.type + '</span>' : ''}</div>
                        </div>
                        <span class="history-entry-qty ${qtyClass}">${prefix} ${qtyParts.join(', ')}</span>
                        ${undoBtn}
                    </div>`;
            }).join('');

            return `
                <div class="history-day-group">
                    <div class="history-day-header">
                        <span class="history-day-date">${formatDate(date + 'T00:00:00')}</span>
                        <span class="history-day-count">${entries.length} transaction${entries.length > 1 ? 's' : ''}</span>
                    </div>
                    <div class="history-day-entries">${entriesHtml}</div>
                </div>`;
        }).join('');
    }

    // ==========================================
    // RENDER: RESTOCK
    // ==========================================
    function renderRestock() {
        populateProductSelect('restock-product');
        renderRecentRestocks();
    }

    function renderRecentRestocks() {
        const restocks = state.dispatches
            .filter(d => d.type === 'restock')
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 20);

        const list = document.getElementById('restock-recent-list');

        if (restocks.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 5v14M5 12h14"/></svg>
                    <p>No recent restocks</p>
                </div>`;
            return;
        }

        list.innerHTML = restocks.map(d => {
            const p = getProduct(d.productId);
            const qtyParts = [];
            if (d.cases > 0) qtyParts.push(`${d.cases}c`);
            if (d.pieces > 0) qtyParts.push(`${d.pieces}p`);
            const userTag = d.user ? ` · by ${esc(d.user)}` : '';
            return `
                <div class="dispatch-entry">
                    <div class="dispatch-entry-img">
                        <img src="${encodeURIComponent(p.image)}" alt="${p.name}">
                    </div>
                    <div class="dispatch-entry-info">
                        <div class="dispatch-entry-name">${p.name} ${p.volume}</div>
                        <div class="dispatch-entry-detail">${esc(d.notes) || 'No notes'} · ${formatDate(d.timestamp)}${userTag}</div>
                    </div>
                    <span class="dispatch-entry-qty restock-qty">+${qtyParts.join(' ')}</span>
                    <span class="dispatch-entry-time">${formatTime(d.timestamp)}</span>
                </div>`;
        }).join('');
    }

    // ==========================================
    // RENDER: LEAKAGE & BREAKAGE
    // ==========================================
    function renderLeakage() {
        populateProductSelect('leakage-product');
        renderRecentLeakage();
    }

    function renderRecentLeakage() {
        const records = state.dispatches
            .filter(d => d.type === 'leakage' || d.type === 'breakage')
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 30);

        const list = document.getElementById('leakage-recent-list');
        const summary = document.getElementById('leakage-summary');

        if (records.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></svg>
                    <p>No leakage or breakage recorded</p>
                </div>`;
            summary.style.display = 'none';
            return;
        }

        let totalLeakagePcs = 0;
        let totalBreakagePcs = 0;

        list.innerHTML = records.map(d => {
            const p = getProduct(d.productId);
            if (d.type === 'leakage') totalLeakagePcs += d.totalPieces;
            if (d.type === 'breakage') totalBreakagePcs += d.totalPieces;
            const qtyParts = [];
            if (d.cases > 0) qtyParts.push(`${d.cases}c`);
            if (d.pieces > 0) qtyParts.push(`${d.pieces}p`);
            const typeTag = `<span class="leakage-type-tag tag-${d.type}">${d.type}</span>`;
            const userTag = d.user ? ` · by ${esc(d.user)}` : '';
            return `
                <div class="dispatch-entry">
                    <div class="dispatch-entry-img">
                        <img src="${encodeURIComponent(p.image)}" alt="${p.name}">
                    </div>
                    <div class="dispatch-entry-info">
                        <div class="dispatch-entry-name">${p.name} ${p.volume} ${typeTag}</div>
                        <div class="dispatch-entry-detail">${esc(d.notes) || 'No notes'} · ${formatDate(d.timestamp)}${userTag}</div>
                    </div>
                    <span class="dispatch-entry-qty leakage-qty">−${qtyParts.join(' ')}</span>
                    <span class="dispatch-entry-time">${formatTime(d.timestamp)}</span>
                </div>`;
        }).join('');

        // Show all-time summary
        summary.style.display = 'flex';
        document.getElementById('summary-leakage-total').textContent = totalLeakagePcs + ' pcs';
        document.getElementById('summary-breakage-total').textContent = totalBreakagePcs + ' pcs';
    }

    // ==========================================
    // RENDER: DAILY RETAILING
    // ==========================================
    function renderRetailing() {
        populateProductSelect('retail-takeout-product');
        populateProductSelect('retail-return-product');
        // Set date filter to today if empty
        const dateFilter = document.getElementById('retail-summary-date-filter');
        if (!dateFilter.value) {
            dateFilter.value = getToday();
        }
        document.getElementById('retail-summary-date').textContent = formatDate(new Date().toISOString());
        renderRetailSummary();
        renderRetailRecentList();
    }

    function renderRetailSummary() {
        const selectedDate = document.getElementById('retail-summary-date-filter').value || getToday();

        // Get all retail-takeout and retail-return for this date
        const takeouts = state.dispatches.filter(d => d.type === 'retail-takeout' && localDate(d.timestamp) === selectedDate);
        const returns = state.dispatches.filter(d => d.type === 'retail-return' && localDate(d.timestamp) === selectedDate);

        let totalTaken = 0;
        let totalReturned = 0;

        // Product-wise aggregation
        const productMap = {}; // productId -> { taken, returned, product }

        takeouts.forEach(d => {
            totalTaken += d.totalPieces;
            if (!productMap[d.productId]) {
                productMap[d.productId] = { taken: 0, returned: 0, product: getProduct(d.productId) };
            }
            productMap[d.productId].taken += d.totalPieces;
        });

        returns.forEach(d => {
            totalReturned += d.totalPieces;
            if (!productMap[d.productId]) {
                productMap[d.productId] = { taken: 0, returned: 0, product: getProduct(d.productId) };
            }
            productMap[d.productId].returned += d.totalPieces;
        });

        const totalSold = totalTaken - totalReturned;

        // Update stat cards
        document.getElementById('retail-stat-taken').textContent = totalTaken + ' pcs';
        document.getElementById('retail-stat-returned').textContent = totalReturned + ' pcs';
        document.getElementById('retail-stat-sold').textContent = (totalSold >= 0 ? totalSold : 0) + ' pcs';

        // Render product breakdown
        const breakdownList = document.getElementById('retail-breakdown-list');
        const productIds = Object.keys(productMap);

        if (productIds.length === 0) {
            breakdownList.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
                    <p>No retailing activity for this date</p>
                </div>`;
            return;
        }

        breakdownList.innerHTML = productIds.map(pid => {
            const data = productMap[pid];
            const p = data.product;
            const sold = data.taken - data.returned;
            const soldPct = data.taken > 0 ? Math.round((sold / data.taken) * 100) : 0;
            return `
                <div class="retail-breakdown-item">
                    <div class="retail-breakdown-product">
                        <div class="dispatch-entry-img">
                            <img src="${encodeURIComponent(p.image)}" alt="${p.name}">
                        </div>
                        <div class="retail-breakdown-product-info">
                            <span class="retail-breakdown-product-name">${p.name} ${p.volume}</span>
                            <span class="retail-breakdown-product-meta">${p.piecesPerCase} pcs/case</span>
                        </div>
                    </div>
                    <div class="retail-breakdown-numbers">
                        <div class="retail-breakdown-num">
                            <span class="retail-num-label">Taken</span>
                            <span class="retail-num-value retail-num-taken">${data.taken}</span>
                        </div>
                        <div class="retail-breakdown-num">
                            <span class="retail-num-label">Returned</span>
                            <span class="retail-num-value retail-num-returned">${data.returned}</span>
                        </div>
                        <div class="retail-breakdown-num">
                            <span class="retail-num-label">Sold</span>
                            <span class="retail-num-value retail-num-sold">${sold >= 0 ? sold : 0}</span>
                        </div>
                    </div>
                    <div class="retail-breakdown-bar">
                        <div class="retail-bar-fill retail-bar-sold" style="width:${soldPct}%"></div>
                        <div class="retail-bar-fill retail-bar-returned" style="width:${100 - soldPct}%"></div>
                    </div>
                </div>`;
        }).join('');
    }

    function renderRetailRecentList() {
        const records = state.dispatches
            .filter(d => d.type === 'retail-takeout' || d.type === 'retail-return')
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 25);

        const list = document.getElementById('retail-recent-list');

        if (records.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
                    <p>No retailing transactions yet</p>
                </div>`;
            return;
        }

        list.innerHTML = records.map(d => {
            const p = getProduct(d.productId);
            const isTakeout = d.type === 'retail-takeout';
            const qtyParts = [];
            if (d.cases > 0) qtyParts.push(`${d.cases}c`);
            if (d.pieces > 0) qtyParts.push(`${d.pieces}p`);
            const prefix = isTakeout ? '−' : '+';
            const qtyClass = isTakeout ? 'takeout-qty' : 'restock-qty';
            const typeTag = isTakeout
                ? '<span class="retail-type-tag tag-takeout">TAKEN</span>'
                : '<span class="retail-type-tag tag-return">RETURNED</span>';
            const userTag = d.user ? ` · by ${esc(d.user)}` : '';
            return `
                <div class="dispatch-entry">
                    <div class="dispatch-entry-img">
                        <img src="${encodeURIComponent(p.image)}" alt="${p.name}">
                    </div>
                    <div class="dispatch-entry-info">
                        <div class="dispatch-entry-name">${p.name} ${p.volume} ${typeTag}</div>
                        <div class="dispatch-entry-detail">${esc(d.notes) || 'No notes'} · ${formatDate(d.timestamp)}${userTag}</div>
                    </div>
                    <span class="dispatch-entry-qty ${qtyClass}">${prefix}${qtyParts.join(' ')}</span>
                    <span class="dispatch-entry-time">${formatTime(d.timestamp)}</span>
                </div>`;
        }).join('');
    }

    // ==========================================
    // RENDER: ADMIN PANEL
    // ==========================================
    async function renderAdmin() {
        if (!isAdmin()) return;

        const today = getToday();

        // Fetch users list
        let users = [];
        try {
            const res = await apiFetch('/api/users');
            users = await res.json();
        } catch (e) {
            users = [];
        }

        // Stats
        document.getElementById('admin-stat-users').textContent = users.length;
        document.getElementById('admin-stat-total-txns').textContent = state.dispatches.length;
        document.getElementById('admin-stat-today-txns').textContent = state.dispatches.filter(d => localDate(d.timestamp) === today).length;

        // User Activity Grid
        const userGrid = document.getElementById('admin-user-grid');
        const userCounts = {};
        users.forEach(u => { userCounts[u.username] = 0; });
        state.dispatches.forEach(d => {
            if (d.user && userCounts[d.user] !== undefined) {
                userCounts[d.user]++;
            } else if (d.user) {
                userCounts[d.user] = (userCounts[d.user] || 0) + 1;
            }
        });

        userGrid.innerHTML = users.map(u => {
            const count = userCounts[u.username] || 0;
            const avatarClass = u.role === 'admin' ? 'role-admin' : '';
            return `
                <div class="admin-user-card">
                    <div class="admin-user-card-avatar ${avatarClass}">${esc(u.displayName.charAt(0))}</div>
                    <div class="admin-user-card-info">
                        <div class="admin-user-card-name">${esc(u.displayName)}</div>
                        <div class="admin-user-card-role">${esc(u.role)}</div>
                    </div>
                    <div style="text-align:right;">
                        <div class="admin-user-card-count">${count}</div>
                        <div class="admin-user-card-count-label">changes</div>
                    </div>
                </div>`;
        }).join('');

        // Populate user filter
        const userFilter = document.getElementById('admin-filter-user');
        const currentFilterVal = userFilter.value;
        userFilter.innerHTML = '<option value="all">All Users</option>' + users.map(u =>
            `<option value="${esc(u.username)}">${esc(u.displayName)}</option>`
        ).join('');
        userFilter.value = currentFilterVal || 'all';

        // Render activity log
        renderAdminActivityLog();

        // Render user management list
        renderAdminUsersList(users);
    }

    function renderAdminActivityLog() {
        const userFilter = document.getElementById('admin-filter-user').value;
        const typeFilter = document.getElementById('admin-filter-type').value;
        const dateFilter = document.getElementById('admin-filter-date').value;

        let filtered = [...state.dispatches].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (userFilter && userFilter !== 'all') {
            filtered = filtered.filter(d => d.user === userFilter);
        }

        if (typeFilter && typeFilter !== 'all') {
            filtered = filtered.filter(d => d.type === typeFilter);
        }

        if (dateFilter) {
            filtered = filtered.filter(d => localDate(d.timestamp) === dateFilter);
        }

        // Limit to 100 entries
        filtered = filtered.slice(0, 100);

        const logEl = document.getElementById('admin-activity-log');

        if (filtered.length === 0) {
            logEl.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                    <p>No activity found for these filters</p>
                </div>`;
            return;
        }

        logEl.innerHTML = filtered.map(d => {
            const p = getProduct(d.productId);
            const username = d.user || 'Unknown';
            const initial = username.charAt(0).toUpperCase();
            const badgeClass = username === 'admin' ? 'user-admin' : 'user-staff';
            const actionLabel = d.type.replace('-', ' ');
            const tagClass = `tag-${d.type}`;

            const qtyParts = [];
            if (d.cases > 0) qtyParts.push(`${d.cases}c`);
            if (d.pieces > 0) qtyParts.push(`${d.pieces}p`);

            const isDeduction = ['dispatch', 'leakage', 'breakage', 'retail-takeout'].includes(d.type);
            const prefix = isDeduction ? '−' : '+';
            const qtyColor = isDeduction ? 'var(--accent-danger)' : 'var(--accent-success)';

            return `
                <div class="admin-log-entry">
                    <div class="admin-log-user-badge ${badgeClass}">${initial}</div>
                    <div class="admin-log-info">
                        <div class="admin-log-title">
                            <span class="log-username">${esc(username)}</span>
                            <span class="log-action-tag ${tagClass}">${actionLabel}</span>
                            ${p.name} ${p.volume}
                        </div>
                        <div class="admin-log-meta">${esc(d.notes) || '—'} · ${formatDate(d.timestamp)}</div>
                    </div>
                    <span class="admin-log-qty" style="color:${qtyColor}">${prefix}${qtyParts.join(' ')}</span>
                    <span class="admin-log-time">${formatTime(d.timestamp)}</span>
                </div>`;
        }).join('');
    }

    // ==========================================
    // USER MANAGEMENT (Admin)
    // ==========================================
    function renderAdminUsersList(users) {
        const listEl = document.getElementById('admin-users-list');
        if (!users || users.length === 0) {
            listEl.innerHTML = '<div class="empty-state"><p>No users found</p></div>';
            return;
        }

        listEl.innerHTML = users.map(u => {
            const isAdm = u.role === 'admin';
            const avatarClass = isAdm ? 'is-admin' : '';
            const roleBadgeClass = isAdm ? 'badge-admin' : 'badge-staff';
            // Cannot remove if this is the currently logged in user
            const isSelf = currentUser && currentUser.username === u.username;
            const removeDisabled = isSelf ? 'disabled title="Cannot remove yourself"' : '';
            return `
                <div class="admin-user-row" id="user-row-${esc(u.username)}">
                    <div class="admin-user-row-avatar ${avatarClass}">${esc(u.displayName.charAt(0))}</div>
                    <div class="admin-user-row-info">
                        <div class="admin-user-row-name">${esc(u.displayName)}</div>
                        <div class="admin-user-row-meta">
                            <span class="admin-user-row-username">@${esc(u.username)}</span>
                            <span class="admin-user-role-badge ${roleBadgeClass}">${esc(u.role)}</span>
                        </div>
                    </div>
                    <div class="admin-user-row-actions">
                        <button class="btn-user-action btn-user-change-pw"
                            onclick="window.app.openChangePwDialog(${jsArg(u.username)}, ${jsArg(u.displayName)})"
                            title="Change password">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                <path d="M7 11V7a5 5 0 0110 0v4"/>
                            </svg>
                        </button>
                        <button class="btn-user-action btn-user-remove" ${removeDisabled}
                            onclick="window.app.removeUser(${jsArg(u.username)}, ${jsArg(u.displayName)})"
                            title="Remove user">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                                <path d="M10 11v6M14 11v6"/>
                                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                            </svg>
                        </button>
                    </div>
                </div>`;
        }).join('');
    }

    function openChangePwDialog(username, displayName) {
        document.getElementById('admin-change-pw-username').textContent = username;
        document.getElementById('admin-change-pw-input').value = '';
        document.getElementById('admin-change-pw-overlay').style.display = 'flex';
        setTimeout(() => document.getElementById('admin-change-pw-input').focus(), 100);
    }

    async function addUser(username, displayName, password, role) {
        try {
            const res = await apiFetch('/api/users/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, displayName, password, role })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`User "${displayName}" added successfully`, 'success');
                // Clear form
                document.getElementById('admin-new-username').value = '';
                document.getElementById('admin-new-displayname').value = '';
                document.getElementById('admin-new-password').value = '';
                document.getElementById('admin-new-role').value = 'staff';
                // Refresh admin view
                await renderAdmin();
            } else {
                showToast(data.error || 'Failed to add user', 'error');
            }
        } catch (e) {
            showToast('Server error. Please try again.', 'error');
        }
    }

    async function removeUser(username, displayName) {
        const confirmed = await showConfirm(
            `Remove "${displayName}"?`,
            `This will permanently remove the user @${username}. Their transaction history will remain in the logs.`
        );
        if (!confirmed) return;

        try {
            const res = await apiFetch('/api/users/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`User "${displayName}" removed`, 'info');
                await renderAdmin();
            } else {
                showToast(data.error || 'Failed to remove user', 'error');
            }
        } catch (e) {
            showToast('Server error. Please try again.', 'error');
        }
    }

    async function changeUserPassword(username, newPassword) {
        try {
            const res = await apiFetch('/api/users/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, newPassword })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Password for @${username} changed successfully`, 'success');
                document.getElementById('admin-change-pw-overlay').style.display = 'none';
                document.getElementById('admin-change-pw-input').value = '';
            } else {
                showToast(data.error || 'Failed to change password', 'error');
            }
        } catch (e) {
            showToast('Server error. Please try again.', 'error');
        }
    }

    // ==========================================
    // ACTIONS: DISPATCH & RESTOCK
    // ==========================================
    // These now validate client-side for fast feedback, then let the SERVER
    // perform the authoritative stock change via recordTransaction().
    function validateQty(cases, pieces) {
        if (cases < 0 || pieces < 0) { showToast('Quantities cannot be negative', 'warning'); return false; }
        if ((cases * 1) + (pieces * 1) <= 0 && !(cases > 0 || pieces > 0)) { showToast('Please enter a valid quantity', 'warning'); return false; }
        return true;
    }

    async function performDispatch(productId, cases, pieces, notes) {
        const product = getProduct(productId);
        if (!validateQty(cases, pieces)) return false;
        if ((cases * product.piecesPerCase + pieces) <= 0) { showToast('Please enter a valid quantity', 'warning'); return false; }
        const ok = await recordTransaction({ type: 'dispatch', productId, cases, pieces, notes: notes || '' });
        if (ok) showToast(`Dispatched ${cases}c ${pieces}p of ${product.name} ${product.volume}`, 'success');
        return ok;
    }

    async function performRestock(productId, cases, pieces, notes) {
        const product = getProduct(productId);
        if (!validateQty(cases, pieces)) return false;
        if (cases <= 0 && pieces <= 0) { showToast('Please enter a valid quantity', 'warning'); return false; }
        const ok = await recordTransaction({ type: 'restock', productId, cases, pieces, notes: notes || '' });
        if (ok) showToast(`Restocked ${cases}c ${pieces}p of ${product.name} ${product.volume}`, 'success');
        return ok;
    }

    async function performLeakage(productId, cases, pieces, type, party, notes) {
        const product = getProduct(productId);
        if (!validateQty(cases, pieces)) return false;
        if ((cases * product.piecesPerCase + pieces) <= 0) { showToast('Please enter a valid quantity', 'warning'); return false; }
        const fullNote = party + (notes ? ' — ' + notes : '');
        const ok = await recordTransaction({ type, productId, cases, pieces, notes: fullNote });
        if (ok) {
            const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
            showToast(`${typeLabel}: ${cases}c ${pieces}p of ${product.name} ${product.volume} replaced (from ${party})`, 'warning');
        }
        return ok;
    }

    async function performRetailTakeout(productId, cases, pieces, notes) {
        const product = getProduct(productId);
        if (!validateQty(cases, pieces)) return false;
        if ((cases * product.piecesPerCase + pieces) <= 0) { showToast('Please enter a valid quantity', 'warning'); return false; }
        const ok = await recordTransaction({ type: 'retail-takeout', productId, cases, pieces, notes: notes || '' });
        if (ok) showToast(`Taken out ${cases}c ${pieces}p of ${product.name} ${product.volume} for retail`, 'success');
        return ok;
    }

    async function performRetailReturn(productId, cases, pieces, notes) {
        const product = getProduct(productId);
        if (!validateQty(cases, pieces)) return false;
        if (cases <= 0 && pieces <= 0) { showToast('Please enter a valid quantity', 'warning'); return false; }
        const ok = await recordTransaction({ type: 'retail-return', productId, cases, pieces, notes: notes || '' });
        if (ok) showToast(`Returned ${cases}c ${pieces}p of ${product.name} ${product.volume} to inventory`, 'success');
        return ok;
    }

    // ==========================================
    // PRODUCT DETAIL MODAL
    // ==========================================
    function showProductModal(productId) {
        const p = getProduct(productId);
        const s = getStock(productId);
        const total = getTotalPieces(productId);
        const status = getStockStatus(productId);
        const badgeClass = `badge-${status}`;

        // Recent dispatches for this product
        const recentTxns = state.dispatches
            .filter(d => d.productId === productId)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 5);

        let recentHtml = '';
        if (recentTxns.length > 0) {
            recentHtml = `
                <h3 style="font-size:0.9rem; font-weight:600; margin:16px 0 10px; color:var(--text-secondary)">Recent Activity</h3>
                ${recentTxns.map(d => {
                    const isDispatch = d.type === 'dispatch';
                    const isLeakage = d.type === 'leakage' || d.type === 'breakage';
                    const prefix = isDispatch || isLeakage ? '−' : '+';
                    const color = isLeakage ? 'var(--accent-leakage)' : (isDispatch ? 'var(--accent-dispatch)' : 'var(--accent-success)');
                    const qtyParts = [];
                    if (d.cases > 0) qtyParts.push(`${d.cases}c`);
                    if (d.pieces > 0) qtyParts.push(`${d.pieces}p`);
                    const userTag = d.user ? ` (${esc(d.user)})` : '';
                    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:0.85rem;">
                        <span style="color:var(--text-muted)">${formatDate(d.timestamp)} ${formatTime(d.timestamp)}${userTag}</span>
                        <span style="font-weight:700;color:${color}">${prefix}${qtyParts.join(' ')}</span>
                    </div>`;
                }).join('')}`;
        }

        document.getElementById('modal-body').innerHTML = `
            <div class="modal-product-header">
                <div class="modal-product-img">
                    <img src="${encodeURIComponent(p.image)}" alt="${p.name} ${p.volume}">
                </div>
                <div>
                    <div class="modal-product-name">${p.name}</div>
                    <div class="modal-product-volume">${p.volume} · ${p.piecesPerCase} pcs/case</div>
                    <span class="stock-badge ${badgeClass}" style="margin-top:6px;display:inline-block">${getStatusLabel(status)}</span>
                </div>
            </div>
            <div class="modal-stats">
                <div class="modal-stat">
                    <span class="modal-stat-value">${s.cases}</span>
                    <span class="modal-stat-label">Cases</span>
                </div>
                <div class="modal-stat">
                    <span class="modal-stat-value">${s.pieces}</span>
                    <span class="modal-stat-label">Pieces</span>
                </div>
                <div class="modal-stat">
                    <span class="modal-stat-value">${total}</span>
                    <span class="modal-stat-label">Total Pcs</span>
                </div>
            </div>
            <div style="display:flex;gap:10px;margin-bottom:8px;">
                <button class="btn btn-dispatch" style="flex:1" onclick="window.app.quickDispatch('${p.id}'); window.app.closeModal();">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    Dispatch
                </button>
                <button class="btn btn-restock" style="flex:1" onclick="window.app.quickRestock('${p.id}'); window.app.closeModal();">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                    Restock
                </button>
            </div>
            ${recentHtml}
        `;

        document.getElementById('modal-overlay').classList.add('active');
    }

    function closeModal() {
        document.getElementById('modal-overlay').classList.remove('active');
    }

    // ==========================================
    // QUICK DISPATCH/RESTOCK (from inventory table)
    // ==========================================
    function quickDispatch(productId) {
        switchView('dispatch');
        document.getElementById('dispatch-product').value = productId;
        handleDispatchProductChange();
        document.getElementById('dispatch-cases').focus();
    }

    function quickRestock(productId) {
        switchView('restock');
        document.getElementById('restock-product').value = productId;
        handleRestockProductChange();
        document.getElementById('restock-cases').focus();
    }

    function quickLeakage(productId) {
        switchView('leakage');
        document.getElementById('leakage-product').value = productId;
        handleLeakageProductChange();
        document.getElementById('leakage-cases').focus();
    }

    // ==========================================
    // PRODUCT PREVIEW IN DISPATCH/RESTOCK FORMS
    // ==========================================
    function handleDispatchProductChange() {
        const productId = document.getElementById('dispatch-product').value;
        const preview = document.getElementById('dispatch-product-preview');
        if (!productId) { preview.style.display = 'none'; return; }

        const p = getProduct(productId);
        const s = getStock(productId);
        preview.style.display = 'flex';
        document.getElementById('dispatch-preview-img').src = encodeURIComponent(p.image);
        document.getElementById('dispatch-preview-name').textContent = `${p.name} ${p.volume}`;
        document.getElementById('dispatch-preview-stock').textContent = `In stock: ${s.cases} cases, ${s.pieces} pieces (${getTotalPieces(productId)} total pcs)`;
    }

    function handleRestockProductChange() {
        const productId = document.getElementById('restock-product').value;
        const preview = document.getElementById('restock-product-preview');
        if (!productId) { preview.style.display = 'none'; return; }

        const p = getProduct(productId);
        const s = getStock(productId);
        preview.style.display = 'flex';
        document.getElementById('restock-preview-img').src = encodeURIComponent(p.image);
        document.getElementById('restock-preview-name').textContent = `${p.name} ${p.volume}`;
        document.getElementById('restock-preview-stock').textContent = `In stock: ${s.cases} cases, ${s.pieces} pieces (${getTotalPieces(productId)} total pcs)`;
    }

    function handleLeakageProductChange() {
        const productId = document.getElementById('leakage-product').value;
        const preview = document.getElementById('leakage-product-preview');
        if (!productId) { preview.style.display = 'none'; return; }

        const p = getProduct(productId);
        const s = getStock(productId);
        preview.style.display = 'flex';
        document.getElementById('leakage-preview-img').src = encodeURIComponent(p.image);
        document.getElementById('leakage-preview-name').textContent = `${p.name} ${p.volume}`;
        document.getElementById('leakage-preview-stock').textContent = `In stock: ${s.cases} cases, ${s.pieces} pieces (${getTotalPieces(productId)} total pcs)`;
    }

    function handleRetailTakeoutProductChange() {
        const productId = document.getElementById('retail-takeout-product').value;
        const preview = document.getElementById('retail-takeout-preview');
        if (!productId) { preview.style.display = 'none'; return; }

        const p = getProduct(productId);
        const s = getStock(productId);
        preview.style.display = 'flex';
        document.getElementById('retail-takeout-preview-img').src = encodeURIComponent(p.image);
        document.getElementById('retail-takeout-preview-name').textContent = `${p.name} ${p.volume}`;
        document.getElementById('retail-takeout-preview-stock').textContent = `In stock: ${s.cases} cases, ${s.pieces} pieces (${getTotalPieces(productId)} total pcs)`;
    }

    function handleRetailReturnProductChange() {
        const productId = document.getElementById('retail-return-product').value;
        const preview = document.getElementById('retail-return-preview');
        if (!productId) { preview.style.display = 'none'; return; }

        const p = getProduct(productId);
        const s = getStock(productId);
        preview.style.display = 'flex';
        document.getElementById('retail-return-preview-img').src = encodeURIComponent(p.image);
        document.getElementById('retail-return-preview-name').textContent = `${p.name} ${p.volume}`;
        document.getElementById('retail-return-preview-stock').textContent = `In stock: ${s.cases} cases, ${s.pieces} pieces (${getTotalPieces(productId)} total pcs)`;
    }

    // ==========================================
    // TOAST NOTIFICATIONS
    // ==========================================
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icons = {
            success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
        };

        toast.innerHTML = `
            <div class="toast-icon">${icons[type] || icons.info}</div>
            <span class="toast-message">${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // ==========================================
    // CONFIRM DIALOG
    // ==========================================
    function showConfirm(title, message) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'confirm-dialog-overlay';
            overlay.innerHTML = `
                <div class="confirm-dialog">
                    <h3>${title}</h3>
                    <p>${message}</p>
                    <div class="confirm-dialog-actions">
                        <button class="btn btn-confirm-cancel" id="confirm-cancel">Cancel</button>
                        <button class="btn btn-confirm-ok" id="confirm-ok">Confirm</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            overlay.querySelector('#confirm-ok').onclick = () => { overlay.remove(); resolve(true); };
            overlay.querySelector('#confirm-cancel').onclick = () => { overlay.remove(); resolve(false); };
        });
    }

    // ==========================================
    // EXPORT DATA
    // ==========================================
    function exportData() {
        if (!isAdmin()) {
            showToast('Only administrators can export all data', 'error');
            return;
        }

        const data = {
            exportedAt: new Date().toISOString(),
            products: PRODUCT_CATALOG.map(p => ({
                ...p,
                currentStock: getStock(p.id),
                totalPieces: getTotalPieces(p.id),
                status: getStockStatus(p.id)
            })),
            dispatches: state.dispatches
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stock-export-${getToday()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Data exported successfully!', 'success');
    }

    // Download a server-generated Excel (.xlsx) report.
    // kind = inventory | history | retailing | leakage
    async function downloadExcel(kind) {
        try {
            showToast('Preparing Excel file...', 'info');
            const res = await apiFetch(`/api/export/${kind}.xlsx`);
            if (!res.ok) { showToast('Failed to generate Excel', 'error'); return; }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${kind}-${getToday()}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Excel downloaded', 'success');
        } catch (e) {
            showToast('Server error. Please try again.', 'error');
        }
    }

    // ==========================================
    // RESET DATA (Admin Only)
    // ==========================================
    async function resetData() {
        if (!isAdmin()) {
            showToast('Only administrators can reset data', 'error');
            return;
        }
        const confirmed = await showConfirm('Reset All Data?', 'This will reset all stock levels to initial values and clear all dispatch history. This action cannot be undone.');
        if (!confirmed) return;

        try {
            const res = await apiFetch('/api/reset', { method: 'POST' });
            const data = await res.json();
            if (!data.success) { showToast(data.error || 'Failed to reset', 'error'); return; }
            await loadStateFromServer();
            renderCurrentView();
            showToast('All data has been reset', 'info');
        } catch (e) {
            showToast('Server error. Please try again.', 'error');
        }
    }

    // ==========================================
    // POPULATE BRAND FILTERS
    // ==========================================
    function populateBrandFilters() {
        const brands = getBrands();
        const optionsHtml = brands.map(b => `<option value="${b}">${b}</option>`).join('');

        ['dashboard-filter-brand', 'inventory-filter-brand'].forEach(id => {
            const el = document.getElementById(id);
            el.innerHTML = '<option value="all">All Brands</option>' + optionsHtml;
        });
    }

    // ==========================================
    // EVENT BINDINGS
    // ==========================================
    function bindEvents() {
        // Login form
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('login-username').value.trim().toLowerCase();
            const password = document.getElementById('login-password').value;
            const errorEl = document.getElementById('login-error');
            const btn = document.getElementById('login-submit-btn');

            btn.disabled = true;
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10"/></svg> Signing in...';

            const result = await attemptLogin(username, password);

            if (result.success) {
                errorEl.style.display = 'none';
                hideLoginScreen();
                updateUIForUser();
                await initializeState();
                populateBrandFilters();
                switchView('dashboard');
    async function init() {
        // Set date in header
        document.getElementById('header-date').textContent = formatDate(new Date().toISOString());

        bindEvents();

        // Check for existing session (need both the user and a valid token)
        const savedUser = getSessionUser();
        const savedToken = getSessionToken();
        if (savedUser && savedToken) {
            currentUser = savedUser;
            authToken = savedToken;
            // Verify the token is still valid before showing the app
            try {
                const res = await apiFetch('/api/me');
                if (!res.ok) throw new Error('invalid');
            } catch (e) {
                logout();
                return;
            }
            hideLoginScreen();
            updateUIForUser();
            await initializeState();
            populateBrandFilters();
            switchView('dashboard');
        } else {
            // Show login screen
            showLoginScreen();
        }
    }

    // Expose API for inline onclick handlers
    window.app = {
        showProductModal,
        closeModal,
        quickDispatch,
        quickRestock,
        quickLeakage,
        openChangePwDialog,
        removeUser,
        undoTransaction,
        downloadExcel
    };

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
