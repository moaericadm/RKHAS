// --- START OF FILE static/js/shop.js (WITH CC ICON FIX) ---

let isDomReady = false;
let isFirebaseReady = false;
let allCrawlers = [];
let allRegisteredUsers = [];
let ownedAvatars = new Set();
// *** بداية الإضافة: متغير لتخزين النكزات المملوكة ***
let ownedNudges = new Set();
// *** نهاية الإضافة ***

function tryToStartApp() {
    if (isDomReady && isFirebaseReady) {
        initializeShopPage();
    }
}

document.addEventListener('DOMContentLoaded', () => { isDomReady = true; tryToStartApp(); });
document.addEventListener('firebase-ready', () => { isFirebaseReady = true; tryToStartApp(); });

function initializeShopPage() {
    const ui = {
        walletCcBalance: document.getElementById('wallet-cc-balance'),
        walletSpBalance: document.getElementById('wallet-sp-balance'),
        productsContainer: document.getElementById('products-container'),
        spinProductsContainer: document.getElementById('spin-products-container'),
        pointsProductsContainer: document.getElementById('points-products-container'),
        avatarProductsContainer: document.getElementById('avatar-products-container'),
        // *** بداية الإضافة: تعريف حاوية النكزات ***
        nudgeProductsContainer: document.getElementById('nudge-products-container'),
        // *** نهاية الإضافة ***
    };

    let db;
    let currentUserId;
    let currentWallet = { cc: 0, sp: 0 };

    async function initializeApp() {
        console.log("Shop page initialization started.");
        try {
            db = firebase.database();
            const token = sessionStorage.getItem('firebaseToken');
            if (!token) throw new Error('توكن المصادقة مفقود. لا يمكن تحميل بيانات المتجر.');

            await firebase.auth().signInWithCustomToken(token);
            currentUserId = firebase.auth().currentUser.uid;

            if (currentUserId) {
                const crawlersSnapshot = await db.ref('users').orderByChild('name').get();
                if (crawlersSnapshot.exists()) {
                    const crawlersData = crawlersSnapshot.val();
                    allCrawlers = Object.keys(crawlersData)
                        .map(key => ({ name: key, ...crawlersData[key] }))
                        .filter(c => c && c.name);
                }
                const registeredUsersSnapshot = await db.ref('registered_users').orderByChild('name').get();
                if (registeredUsersSnapshot.exists()) {
                    const usersData = registeredUsersSnapshot.val();
                    allRegisteredUsers = Object.values(usersData).filter(u => u && u.name && u.uid !== currentUserId);
                }

                setupDataListeners();
            } else {
                handleAuthError(new Error("لا يمكن تحديد هوية المستخدم."));
            }
        } catch (e) {
            handleAuthError(e);
        }
    }

    function handleAuthError(e) {
        console.error("CRITICAL SHOP PAGE ERROR:", e.message);
        const errorHtml = `<p class="text-danger w-100 text-center py-5">فشل تحميل بيانات المتجر.<br>${e.message}</p>`;
        document.querySelectorAll('.row.g-4').forEach(container => container.innerHTML = `<div class="col-12">${errorHtml}</div>`);
    }

    function setupDataListeners() {
        const handleFirebaseError = (error, path) => console.error(`Firebase Read Error at ${path}:`, error.code, error.message);

        if (currentUserId) {
            db.ref(`wallets/${currentUserId}`).on('value', (s) => renderWallet(s.val()), (e) => handleFirebaseError(e, 'wallet'));

            db.ref('site_settings').on('value', (s) => {
                const settings = s.val() || {};

                // Fetch owned items in parallel
                Promise.all([
                    db.ref(`user_avatars/${currentUserId}/owned`).once('value'),
                    db.ref(`user_nudges/${currentUserId}/owned`).once('value') // Fetch owned nudges
                ]).then(([avatarsSnap, nudgesSnap]) => {
                    ownedAvatars = new Set(Object.keys(avatarsSnap.val() || {}));
                    ownedNudges = new Set(Object.keys(nudgesSnap.val() || {})); // Store owned nudges
                    renderAllProducts(settings);
                });

            }, (e) => handleFirebaseError(e, 'site_settings'));
        }
    }

    function renderAllProducts(settings) {
        // *** بداية التعديل: استدعاء دالة عرض النكزات ***
        renderNudgeProducts(settings.shop_products_nudges || {});
        // *** نهاية التعديل ***
        renderAvatarProducts(settings.shop_avatars || {});
        renderPointsProducts(settings.shop_products_points || {});
        renderProducts(settings.shop_products || {});
        renderSpinProducts(settings.shop_products_spins || {});
    }

    const formatNumber = (num) => new Intl.NumberFormat('en-US').format(Math.round(num || 0));

    function renderWallet(wallet) {
        currentWallet = wallet || { cc: 0, sp: 0 };
        if (ui.walletCcBalance) ui.walletCcBalance.textContent = formatNumber(currentWallet.cc);
        if (ui.walletSpBalance) ui.walletSpBalance.textContent = formatNumber(currentWallet.sp);
    }

    // *** بداية الإضافة: دالة عرض منتجات النكزات ***
    function renderNudgeProducts(nudgesData) {
        if (!ui.nudgeProductsContainer) return;
        const products = Object.entries(nudgesData);
        ui.nudgeProductsContainer.innerHTML = products.length > 0 ? products.map(([id, p]) => `
            <div class="col-lg-3 col-md-4 col-sm-6">
                <div class="card product-card">
                    <div class="card-body">
                        <div class="product-content">
                            <i class="bi bi-chat-right-quote-fill nudge-product-icon"></i>
                            <p class="nudge-text my-3">"${p.text}"</p>
                            <div class="product-price price-sp">${formatNumber(p.sp_price)} SP</div>
                        </div>
                        <div class="product-footer d-grid gap-2">
                            <button class="btn btn-sm btn-warning buy-nudge-btn" data-nudge-id="${id}" data-nudge-text="${p.text}" data-sp-price="${p.sp_price || 0}" ${ownedNudges.has(id) ? 'disabled' : ''}>
                                ${ownedNudges.has(id) ? 'تم الشراء' : `شراء`}
                            </button>
                        </div>
                    </div>
                </div>
            </div>`).join('') : '<div class="col-12"><p class="text-muted w-100 text-center p-4">لا توجد نكزات متاحة حالياً.</p></div>';

        ui.nudgeProductsContainer.querySelectorAll('.buy-nudge-btn').forEach(b => b.addEventListener('click', handleNudgePurchase));
    }
    // *** نهاية الإضافة ***

    function renderAvatarProducts(avatarsData) {
        if (!ui.avatarProductsContainer) return;
        const products = Object.entries(avatarsData);
        ui.avatarProductsContainer.innerHTML = products.length > 0 ? products.map(([id, p]) => `
            <div class="col-lg-3 col-md-4 col-sm-6">
                <div class="card product-card">
                    <div class="card-body">
                        <div class="product-content">
                            <img src="${p.image_url}" class="avatar-product-icon" alt="${p.name}">
                            <h5 class="avatar-name">${p.name}</h5>
                        </div>
                        <div class="product-footer d-grid gap-2">
                            <button class="btn btn-sm btn-primary buy-avatar-btn" data-avatar-id="${id}" data-avatar-name="${p.name}" data-sp-price="${p.price_sp_personal || 0}" ${ownedAvatars.has(id) ? 'disabled' : ''}>
                                ${ownedAvatars.has(id) ? 'تم الشراء' : `شراء (${formatNumber(p.price_sp_personal || 0)} SP)`}
                            </button>
                            <button class="btn btn-sm btn-success gift-avatar-btn" data-avatar-id="${id}" data-avatar-name="${p.name}" data-sp-price="${p.price_sp_gift || 0}">
                                إهداء (${formatNumber(p.price_sp_gift || 0)} SP)
                            </button>
                        </div>
                    </div>
                </div>
            </div>`).join('') : '<div class="col-12"><p class="text-muted w-100 text-center p-4">لا توجد أفتارات متاحة حالياً.</p></div>';

        ui.avatarProductsContainer.querySelectorAll('.buy-avatar-btn').forEach(b => b.addEventListener('click', handleAvatarPurchase));
        ui.avatarProductsContainer.querySelectorAll('.gift-avatar-btn').forEach(b => b.addEventListener('click', handleAvatarGiftRequest));
    }

    function renderPointsProducts(productsData) {
        if (!ui.pointsProductsContainer) return;
        const products = Object.entries(productsData);
        ui.pointsProductsContainer.innerHTML = products.length > 0 ? products.map(([id, p]) => {
            const isRaise = p.type === 'raise';
            return `
            <div class="col-lg-3 col-md-4 col-sm-6">
                <div class="card product-card">
                    <div class="card-body">
                        <div class="product-content">
                            <i class="bi ${isRaise ? 'bi-arrow-up-circle-fill text-success' : 'bi-arrow-down-circle-fill text-danger'} product-value-points-icon"></i>
                            <h5 class="points-amount-text">${isRaise ? 'رفع' : 'إسقاط'} ${formatNumber(p.points_amount)} نقطة</h5>
                            <div class="product-price price-sp">${formatNumber(p.sp_price)} SP</div>
                        </div>
                        <div class="product-footer">
                           <button class="btn btn-info w-100 buy-points-product-btn" data-product-id="${id}" data-sp-price="${p.sp_price}" data-title="${isRaise ? 'رفع أسهم' : 'إسقاط أسهم'}">استخدام</button>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('') : '<div class="col-12"><p class="text-muted w-100 text-center p-4">لا توجد منتجات لتعديل الأسهم حالياً.</p></div>';

        ui.pointsProductsContainer.querySelectorAll('.buy-points-product-btn').forEach(b => b.addEventListener('click', handlePointsProductPurchase));
    }

    function renderProducts(productsData) {
        if (!ui.productsContainer) return;
        const products = Object.entries(productsData);
        ui.productsContainer.innerHTML = products.length > 0 ? products.map(([id, p]) => `
            <div class="col-lg-3 col-md-4 col-sm-6">
                <div class="card product-card">
                    <div class="card-body">
                        <div class="product-content">
                            <div class="product-value-sp">${formatNumber(p.sp_amount)} <small>SP</small></div>
                            <div class="product-value-arrow"><i class="bi bi-arrow-down-circle"></i></div>
                            <div class="product-price price-cc">
                                ${formatNumber(p.cc_price)} <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAdNSURBVHhe7Vv/SxxVGP/Z2a6p8S/6I2pqK2lT02hbXGqbaJsaW1JjY5M4kZJlFMGGCQ4pDiI4pDiI4BBiEFEgEBEFEgUHMUEUgyAGQzD4B/Mffs/vPTNv5733Zmd2Z3dX5wOf3DuzO/M9v3neO/N9M00X+I9F/hOq2xP4R6juT+Afobr9xPd/j0fW8dF14tE1R/kP+x+JjI/wz9/jP5g/0D/Z/8i3S3781R8j/5F/jP+y/wz/Cf/D/+V/7N/tP4G//l3/E//z/+a//P/+n/p3++/+W/3P/Xf4//tf/fT8h/8P/6z8+gE/wP/sP/sf+4/wz/sP8fT8l/2//sf/M/zT/+f/3/wz/3H9M9eW/w39M/d3/1f81/7L/uv9k/2L/U//9/jn+i//X/9v/5/8M/7z/jv+f//l//H/9L/+P//l/8z/3H+Xf4d/wP/sP8o/7D/Dv8f/63/8P8f/8D/6j/+H/+x//D/Hf8X/8H/5v/6f+v/p/+u/7n/xv8Xf9+/2X/df8J/rP/gf+r/77/Xf8n/6f+c/9x/kn+Uf5h/hn+Gf7T/mP8s/7T/DP8c//J/oP8U/7T/GP8E/6z/GP/E/wH+/P+L//x/+H/9v/zP/Uf4B/hn+Wf7Z/ln+2f5h/gn+Kf6J/kH+If5B/kH+Gf7p/qP8g/yT/BP8k/yT/OP8k/yT/OP8A/yz/BP8k/zz/TP88/wT/NP8E/zz/OP/E/zj/PP/E/wH+Qf6J/gn+Sf5Z/lH+Qf4J/on+Wf5x/kn+ef4p/in+Kf5J/nn+Wf7J/vM5APz7+Qf45/nH+If5B/nH+Sf4p/kn+Sf4p/kn+Sf5J/kn+Sf5J/mn+Wf5p/kn+cf4h/kH+cf55/ln+Sf5p/in+Sf5p/in+Wf5J/mn+Sf55/nn+Sf5p/kn+Wf5Z/nngD/Av9Nf4r/fP/9/lf/bf99/y3/Lf99/5X+a/57/jv+W/57/sv+e/7L/Xv+1/7H/rv+2/w7/Df9d/w3/bf8d/13/Hf8N/x3/Hf8t/x3/Lf8t/23/bf9t/03/Pf9d/23/bf9d/z0A8j/+z/77/kv/bf8t/x3/Tf/R/yL/Mf8t/03/Lf9N/z3/ff/Nf73/rv/G/5b/x/+a/wb/Bf/d/xb/lf9W/43/Df8t/w3/rf+e/2b/ef9N/13/Lf/N/wT/9P8B/jH/Mf/E/zD/xP84/+T/Of8c/yz/Zf9h/rH+y/6r/rv+2/w7/lv+G/1b/pv9G/5b/Jv+N/1b/pv/2/+p//T/+n/5v/x//X/89/3X/5f7r/uv+2/w7/hv+W/x7/lv8e/6b/lv9m/43/lv8m/43/t/+2/3YAXgB/0//G/wT/bf8t/w3/nf+G/yb/Nf+d/xb/Bf8V//X/X/9v/+X+K/6L/5P8m/yT/BP8A/wT/Bv/p/23/V/99/3X/9T9D/2j/Bv9t/w3/Tf81/+X+G/3n/Df7L/nP+K/4T/rv+c/1L/ef+p/yL/JP9B/tE0v+hT8R69x/f49b5H72n8XvN3mrzX5v81R7T9P3mLzX5D1u+4xYfFvnPmrwH9bhmT4aT4bI1R7R9I/msuW6h5Y/a/EcD/JvmaS1+L7r8R+2uFf9n9h+3/Eftyv5L8S+m/E/8j+E/2H9P8T/1/8D+c/3n/L/zL+Y/5X/J/2H9P/pP57+J/+D/Of7L+5/tP6n+U/sP6X+v/sf7H+P/tf6L+P/kP5j+Y/oP6L+A/jP5T+A/lP4j+A/nP5D/4H/lP/gP/kP/gf+4/wz/sP8I/zz/Bv/c/1V/Nf8l/zX/Rf8V/+n+2/xb/tv9t/03/df/N/23/bf/d/3X/df/tf+L//X+4/yr/df/F/1X/5f57/sv+e/6L/ov+i/zH+5f7L/sv+y/5T/cv9h/sv9B/pv7j/sv9l/2X+Y/5b/sv+y/33/df89/71vW1X+K+t+u+F3mv/l4H/Vfxf5r8d+B+r4H8F/L+t+/z7/3mP/A+H/i97v+F/qfLfx+8P/5+D/V+H9R/e+W/x+F/uP1fzf4vyr/1uP/R+Nf1uFfVvx+Jfx+lf+j8f9V+P+u/H8H+a8q/9H4vxT83yn8XxP8vx78X5n+d83+q+J/Vfl/GvzXB/ivVv6vUf2vDv/XFf5vFv8Xxf6b1f9bxb6LzF+D838v/NfMfi9D/6v9fzb5ryr/1uK/S+W/m/7/y38v+/83uL/SvVfrv5f3f+j8H/E7xf4vxP8XvNf4v0X0f77+l+o/pfK+1H+79D/a/Nfs/3fLfz/S/7v1P+rwn9L5X8o//+a/H+G/p/L//fiv7/4/lH5/r9D/4/Q/yv7/+j+n8X/1/y/tfs/rvyfq/4/s/q/q/p/L/z/K/n/rfs/k/yflf9T+/80+P9J+H/5/2f1/9XzH8f/J+V/OPzflv5vyv+J+/+j87+w/c/mf6P8L8L9L/B+5/y/EftLjf5Xzf6r2v4Xzv/H+p+k+L/F+H+K8n/B+V/yfj/lft/hPqfq/6v6v+rzP6r83/F+l/8/tfyvxf+v8z+d4r/N5n/D8b/I+V/W/zXkv4/3v+D/R89/8+F/1/c/2Pzv2T8nxH+/zn/n+R/8/l/+f/n/P8H/b/wfqfsvyr9/z+f/+/q/+H5D/5/r/7fxf/X+H/Vv5f+v/d+Nf2/6r5L+T9j+J/l/c/lvY/lvU/qf0/+l+m/B/3/yr4/+T/v+L/m/K/Wfs/avq/m/Nfrv5fq/N/n/t/r/2fzfZPuv9v6X7L9d+j/2/d/r/2/Zfyfp/q/K/2/S/9/kvY/hv8/gPxf6/+P8n95/h/xf5P/f/qf6n+h/h/7/+L9T9L/5/F/U/W/lfL/1Pyf+v9T/l/+f/n/5//P/1/f/7D+H9v/F+x+t+o/1/3fyn7/6j+X8r9V+B/xfl/kvJ/nPsf9X+X8//X/x/5f5P/H9L97/B/Z/xfkf7H/7/A/1/A/j/4f4f/H/b/2/x39L6X7z/a/F+h+i/x3wz/h/lf2f9H//83r49fP8p4b+N3m/5vxX8nxH8Xzf7D1vyP5H/v9z8T/N3if5H/T+t/oP/39f9n/j+u+z+K/X/v/2/3f9j9P9b/Z/H/+f0f0v6v+L+N+L+b+j/+/vfqP3P+r9T+b/F/X/3/Sff/+P5/6v8X/T/J+H+p/m/9f//+n+x+n/P/4/X/2/1/wP/f/J+P8C/H/k/D+C/2/2/+n9v/p/H/3/9/sP9/9x/sP9v/T/d/f/+/xvXwA7gC2ADzD8D/f/8v5/+n+R8P8X+D+N/t+q/4P6/5L+/4j/Z/d/2Py3y/6vyf7v2/8v979v/b+b/x/t/0/zfw3936D9r8P81wH++wL/XwL/XwL/f2P83zr8XwH/tw7/bxf/71z+38D+Nwr/Dwb/2/H+D2P/lwr+fwP/31/8P937f1V/N+n+78P931v9v3f/f7H5r0b/r1H+rzP7b7v8P879f538fyf5vyr53yz832z+n8r/37T+79L9P07/HwT+vwT/3xb+b/D/N+t/wP2fB/8fF/1/iv4/+L+h/7f7P6Xy/wr9X8n+L17+byb/3xb+T1D+jyr/p1L+T+l//vxf6L4f8n9d+D+b8H+1/p/2/2/8X8H/79n/h/u/k/Xfl/1/zfrvwH//xn8n/D/d4b/n+B/qfy/yfq/w/w/+f+3//8j/l/+fyn7/+T/5f4f8X9J/9f0v8D+h/m/V/9P6/9p/b/z/yP+P/z/D/3//P+H/T+R/f/J/M/j/pfx/T/+fyv8H/T/u/c/5v73/B/u/9/y/gP1/wP9P9/9p/j/S/D9p/f/8f+L/3yQAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjQtMDUtMjhUMjA6NTU6MDQrMDA6MDBLd47CAAAAJXRFWHRkYXRlOm9vZGlmeQAyMDI0LTA1LTI4VDIwOjU1OjA0KzAwOjAwgW54WAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNC0wNS0yOFQyMDo1NTowNCswMDowMF/dCekAAAAASUVORK5CYII=" class="icon-img" alt="CC Icon"><small>cc</small>
                            </div>
                        </div>
                        <div class="product-footer">
                            <button class="btn btn-sm btn-success w-100 buy-sp-btn" data-product-id="${id}" data-sp-amount="${p.sp_amount}" data-cc-price="${p.cc_price}">شراء</button>
                        </div>
                    </div>
                </div>
            </div>
        `).join('') : '<div class="col-12"><p class="text-muted w-100 text-center p-4">لا توجد حزم SP متاحة حالياً.</p></div>';

        ui.productsContainer.querySelectorAll('.buy-sp-btn').forEach(b => b.addEventListener('click', handleProductPurchase));
    }

    function renderSpinProducts(productsData) {
        if (!ui.spinProductsContainer) return;
        const products = Object.entries(productsData);
        ui.spinProductsContainer.innerHTML = products.length > 0 ? products.map(([id, p]) => `
             <div class="col-lg-3 col-md-4 col-sm-6">
                <div class="card product-card">
                    <div class="card-body">
                         <div class="product-content">
                            <div class="product-value-attempts">${formatNumber(p.attempts_amount)}</div>
                            <div class="product-label-small">محاولات</div>
                            <div class="product-price price-sp mt-2">${formatNumber(p.sp_price)} SP</div>
                        </div>
                        <div class="product-footer">
                            <button class="btn btn-info w-100 buy-spin-btn" data-product-id="${id}" data-attempts-amount="${p.attempts_amount}" data-sp-price="${p.sp_price}">شراء</button>
                        </div>
                    </div>
                </div>
            </div>
        `).join('') : '<div class="col-12"><p class="text-muted w-100 text-center p-4">لا توجد حزم محاولات متاحة حالياً.</p></div>';

        ui.spinProductsContainer.querySelectorAll('.buy-spin-btn').forEach(b => b.addEventListener('click', handleSpinPurchase));
    }

    async function apiCall(url, options) {
        try {
            const response = await fetch(url, options);
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'حدث خطأ غير معروف');
            }
            return data;
        } catch (error) {
            console.error('API call failed:', error);
            throw error;
        }
    }

    async function showSearchableUserSelection(title, html, userList) {
        return Swal.fire({
            title: title,
            html: `
                <input type="search" id="swal-search-input" class="swal2-input" placeholder="ابحث عن اسم...">
                <div id="swal-user-list-container" style="max-height: 200px; overflow-y: auto; border: 1px solid #ccc; padding: 10px; text-align: right;">
                    ${html}
                </div>
            `,
            showConfirmButton: true,
            confirmButtonText: 'اختيار',
            showCancelButton: true,
            cancelButtonText: 'إلغاء',
            didOpen: () => {
                const searchInput = document.getElementById('swal-search-input');
                const container = document.getElementById('swal-user-list-container');
                const radios = container.querySelectorAll('input[type="radio"]');

                searchInput.addEventListener('input', (e) => {
                    const searchTerm = e.target.value.toLowerCase();
                    radios.forEach(radio => {
                        const label = radio.parentElement;
                        label.style.display = radio.value.toLowerCase().includes(searchTerm) ? '' : 'none';
                    });
                });
            },
            preConfirm: () => {
                const selected = document.querySelector('input[name="swal_user_select"]:checked');
                if (!selected) {
                    Swal.showValidationMessage('الرجاء اختيار مستخدم');
                    return false;
                }
                return selected.value;
            }
        });
    }

    async function handleProductPurchase(e) {
        const btn = e.target.closest('button');
        const { productId, spAmount, ccPrice } = btn.dataset;

        const result = await Swal.fire({
            title: `تأكيد شراء ${formatNumber(spAmount)} SP`,
            text: `هل تريد بالتأكيد إنفاق ${formatNumber(ccPrice)} CC لشراء نقاط الدعم هذه؟`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'نعم، شراء!',
            cancelButtonText: 'إلغاء'
        });

        if (result.isConfirmed) {
            try {
                await apiCall('/api/shop/buy_product', {
                    method: 'POST',
                    body: new URLSearchParams({ product_id: productId })
                });
                Swal.fire('تم بنجاح!', `لقد اشتريت ${formatNumber(spAmount)} SP.`, 'success');
            } catch (error) {
                Swal.fire('فشل!', error.message, 'error');
            }
        }
    }

    async function handleSpinPurchase(e) {
        const btn = e.target.closest('button');
        const { productId, attemptsAmount, spPrice } = btn.dataset;

        const result = await Swal.fire({
            title: `تأكيد شراء ${formatNumber(attemptsAmount)} محاولة`,
            text: `هل تريد بالتأكيد إنفاق ${formatNumber(spPrice)} SP لشراء هذه المحاولات؟`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'نعم، شراء!',
            cancelButtonText: 'إلغاء'
        });

        if (result.isConfirmed) {
            try {
                await apiCall('/api/shop/buy_spin_attempt', {
                    method: 'POST',
                    body: new URLSearchParams({ product_id: productId })
                });
                Swal.fire('تم بنجاح!', `لقد اشتريت ${formatNumber(attemptsAmount)} محاولة.`, 'success');
            } catch (error) {
                Swal.fire('فشل!', error.message, 'error');
            }
        }
    }

    // ### بداية التعديل: استبدال دالة handlePointsProductPurchase ###
    async function handlePointsProductPurchase(e) {
        const btn = e.target.closest('button');
        const { productId, spPrice, title } = btn.dataset;

        if (allCrawlers.length === 0) {
            return Swal.fire('لا يوجد زواحف', 'لا يوجد زواحف في القائمة حالياً لاستهدافهم.', 'info');
        }

        const listHtml = allCrawlers.map(user =>
            `<div class="form-check"><input class="form-check-input" type="radio" name="swal_user_select" value="${user.name}" id="user_${user.name}"><label class="form-check-label" for="user_${user.name}">${user.name}</label></div>`
        ).join('');

        const selectionResult = await showSearchableUserSelection(`اختر الزاحف لتطبيق تأثير "${title}"`, listHtml, allCrawlers);
        if (!selectionResult.isConfirmed || !selectionResult.value) return;

        const targetCrawler = selectionResult.value;

        // تغيير نص التأكيد ليصبح أكثر عمومية
        const confirmResult = await Swal.fire({
            title: `تأكيد استخدام المنتج`,
            html: `هل أنت متأكد أنك تريد إنفاق <strong>${formatNumber(spPrice)} SP</strong> لتطبيق تأثير "${title}" على <strong>${targetCrawler}</strong>؟<br><small class="text-muted">سيقوم النظام بحساب عدد النقاط المضافة بذكاء لضمان عدم تجاوز المنافس التالي.</small>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'نعم، تأكيد!',
            cancelButtonText: 'إلغاء'
        });

        if (confirmResult.isConfirmed) {
            try {
                // سنستقبل الرسالة الديناميكية من الخادم
                const data = await apiCall('/api/shop/buy_points_product', {
                    method: 'POST',
                    body: new URLSearchParams({ product_id: productId, target_crawler: targetCrawler })
                });
                // عرض الرسالة التي جاءت من الخادم
                Swal.fire('تم بنجاح!', data.message, 'success');
            } catch (error) {
                Swal.fire('فشل!', error.message, 'error');
            }
        }
    }
    // ### نهاية التعديل ###

    async function handleAvatarPurchase(e) {
        const btn = e.target.closest('button');
        const { avatarId, avatarName, spPrice } = btn.dataset;

        const result = await Swal.fire({
            title: `شراء أفتار: ${avatarName}`,
            text: `هل تريد بالتأكيد إنفاق ${formatNumber(spPrice)} SP لشراء هذا الأفتار لنفسك؟`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'شراء لنفسي',
            cancelButtonText: 'إلغاء'
        });

        if (result.isConfirmed) {
            try {
                const data = await apiCall('/api/shop/buy_avatar', {
                    method: 'POST',
                    body: new URLSearchParams({ avatar_id: avatarId })
                });
                Swal.fire('تم!', data.message, 'success');
            } catch (error) {
                Swal.fire('فشل!', error.message, 'error');
            }
        }
    }

    // *** بداية الإضافة: دالة التعامل مع شراء النكزات ***
    async function handleNudgePurchase(e) {
        const btn = e.target.closest('button');
        const { nudgeId, nudgeText, spPrice } = btn.dataset;

        const result = await Swal.fire({
            title: `شراء نكزة`,
            html: `هل تريد بالتأكيد إنفاق <strong>${formatNumber(spPrice)} SP</strong> لشراء النكزة: <br><i>"${nudgeText}"</i>`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'نعم، شراء!',
            cancelButtonText: 'إلغاء'
        });

        if (result.isConfirmed) {
            try {
                await apiCall('/api/shop/buy_nudge', {
                    method: 'POST',
                    body: new URLSearchParams({ nudge_id: nudgeId })
                });
                Swal.fire('تم بنجاح!', `لقد اشتريت النكزة.`, 'success');
            } catch (error) {
                Swal.fire('فشل!', error.message, 'error');
            }
        }
    }
    // *** نهاية الإضافة ***

    async function handleAvatarGiftRequest(e) {
        const btn = e.target.closest('button');
        const { avatarId, avatarName, spPrice } = btn.dataset;

        if (allCrawlers.length === 0) {
            return Swal.fire('لا يوجد', 'لا يوجد زواحف حالياً لإهدائهم.', 'info');
        }

        const listHtml = allCrawlers.map(user =>
            `<div class="form-check"><input class="form-check-input" type="radio" name="swal_user_select" value="${user.name}" id="user_gift_${user.name}"><label class="form-check-label" for="user_gift_${user.name}">${user.name}</label></div>`
        ).join('');

        const selectionResult = await showSearchableUserSelection(`اختر الزاحف الذي تريد إهدائه "${avatarName}"`, listHtml, allCrawlers);

        if (!selectionResult.isConfirmed || !selectionResult.value) return;

        const targetCrawler = selectionResult.value;

        const confirmResult = await Swal.fire({
            title: 'تأكيد الهدية',
            html: `هل تريد بالتأكيد إرسال طلب إهداء زاحف أفتار <strong>${avatarName}</strong> إلى <strong>${targetCrawler}</strong> مقابل <strong>${formatNumber(spPrice)} SP</strong>؟<br><small class="text-muted">سيتم إرسال طلب للإدارة للموافقة.</small>`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'نعم، إرسال الطلب',
            cancelButtonText: 'إلغاء'
        });

        if (confirmResult.isConfirmed) {
            try {
                const data = await apiCall('/api/gift_request', {
                    method: 'POST',
                    body: new URLSearchParams({ avatar_id: avatarId, target_crawler: targetCrawler })
                });
                Swal.fire('تم إرسال الطلب!', data.message, 'success');
            } catch (error) {
                Swal.fire('فشل!', error.message, 'error');
            }
        }
    }

    initializeApp();
}