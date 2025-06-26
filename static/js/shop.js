// --- START OF FILE static/js/shop.js ---

// --- App Initialization Logic ---
let isDomReady = false;
let isFirebaseReady = false;
let allCrawlers = []; // Cache for crawler list

function tryToStartApp() {
    if (isDomReady && isFirebaseReady) {
        initializeShopPage();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    isDomReady = true;
    tryToStartApp();
});

document.addEventListener('firebase-ready', () => {
    isFirebaseReady = true;
    tryToStartApp();
});


function initializeShopPage() {
    const ui = {
        walletCcBalance: document.getElementById('wallet-cc-balance'),
        walletSpBalance: document.getElementById('wallet-sp-balance'),
        productsContainer: document.getElementById('products-container'),
        spinProductsContainer: document.getElementById('spin-products-container'),
        pointsProductsContainer: document.getElementById('points-products-container'),
    };

    let db;
    let currentUserId;
    let currentWallet = { cc: 0, sp: 0 };

    async function initializeApp() {
        console.log("Shop page initialization started (triggered by event).");
        try {
            db = firebase.database();
            const token = sessionStorage.getItem('firebaseToken');

            if (token) {
                await firebase.auth().signInWithCustomToken(token).then(cred => {
                    currentUserId = cred.user.uid;
                });
            } else {
                throw new Error('توكن المصادقة مفقود.');
            }
            // Fetch crawlers once
            const crawlersSnapshot = await db.ref('users').orderByChild('name').get();
            if (crawlersSnapshot.exists()) {
                // *** THE FIX IS HERE ***
                // We use Object.entries to get [key, value] pairs and ensure the name is always set from the key.
                const usersData = crawlersSnapshot.val();
                allCrawlers = Object.entries(usersData).map(([key, value]) => ({ ...value, name: key }));
            }

            setupDataListeners();
        } catch (e) {
            handleAuthError(e);
        }
    }

    function handleAuthError(e) {
        console.error("CRITICAL INITIALIZATION ERROR:", e);
        Swal.fire({
            title: 'انتهت صلاحية الجلسة', text: 'الرجاء تسجيل الدخول مرة أخرى للاستمرار.',
            icon: 'error', confirmButtonText: 'تسجيل الدخول', allowOutsideClick: false, allowEscapeKey: false
        }).then(() => {
            sessionStorage.removeItem('firebaseToken');
            window.location.href = '/login';
        });
    }

    function setupDataListeners() {
        const handleFirebaseError = (error, path) => console.error(`Firebase Read Error at ${path}:`, error.code, error.message);

        if (currentUserId) {
            db.ref(`wallets/${currentUserId}`).on('value', (s) => renderWallet(s.val()), (e) => handleFirebaseError(e, 'wallet'));
        }

        db.ref('site_settings/shop_products').on('value', (s) => { renderProducts(s.val()); }, (e) => handleFirebaseError(e, 'shop_products'));
        db.ref('site_settings/shop_products_spins').on('value', (s) => { renderSpinProducts(s.val()); }, (e) => handleFirebaseError(e, 'shop_products_spins'));
        db.ref('site_settings/shop_products_points').on('value', (s) => { renderPointsProducts(s.val()); }, (e) => handleFirebaseError(e, 'shop_products_points'));
    }

    const formatNumber = (num) => new Intl.NumberFormat('en-US').format(Math.round(num || 0));

    function renderWallet(wallet) {
        currentWallet = wallet || { cc: 0, sp: 0 };
        if (ui.walletCcBalance) ui.walletCcBalance.textContent = formatNumber(currentWallet.cc);
        if (ui.walletSpBalance) ui.walletSpBalance.textContent = formatNumber(currentWallet.sp);
    }

    function renderProducts(productsData) {
        if (!ui.productsContainer) return;
        const products = productsData ? Object.entries(productsData) : [];

        if (products.length === 0) {
            ui.productsContainer.innerHTML = `<div class="col-12 text-center py-5"><p class="text-muted">لا توجد منتجات متاحة في المتجر حالياً.</p></div>`;
            return;
        }

        ui.productsContainer.innerHTML = products.map(([productId, product]) => {
            return `
                <div class="col-md-6 col-lg-4">
                    <div class="card product-card text-center h-100">
                        <div class="card-body d-flex flex-column">
                            <img src="data:image/png;base64,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" class="product-icon" alt="SP Icon">
                            <h4 class="product-sp">${formatNumber(product.sp_amount)} SP</h4>
                            <div class="mt-auto">
                                <p class="mb-2">السعر:</p>
                                <h5 class="product-price-cc">
                                    ${formatNumber(product.cc_price)} CC 
                                    <img src="data:image/png;base64,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" alt="CC Icon">
                                </h5>
                                <div class="d-grid">
                                    <button class="btn btn-success buy-sp-btn" data-product-id="${productId}" data-sp-amount="${product.sp_amount}" data-cc-price="${product.cc_price}">
                                        <i class="bi bi-cart-plus-fill me-2"></i>شراء
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        document.querySelectorAll('.buy-sp-btn').forEach(btn => {
            btn.addEventListener('click', handleProductPurchase);
        });
    }

    function renderSpinProducts(productsData) {
        if (!ui.spinProductsContainer) return;
        const products = productsData ? Object.entries(productsData) : [];

        if (products.length === 0) {
            ui.spinProductsContainer.innerHTML = `<div class="col-12 text-center py-5"><p class="text-muted">لا توجد منتجات محاولات متاحة حالياً.</p></div>`;
            return;
        }

        ui.spinProductsContainer.innerHTML = products.map(([productId, product]) => {
            return `
                <div class="col-md-6 col-lg-4">
                    <div class="card product-card text-center h-100">
                        <div class="card-body d-flex flex-column">
                            <i class="bi bi-arrow-repeat product-icon" style="font-size: 5rem; color: var(--bs-info); margin: auto;"></i>
                            <h4 class="product-attempts">${formatNumber(product.attempts_amount)} محاولات</h4>
                            <div class="mt-auto">
                                <p class="mb-2">السعر:</p>
                                <h5 class="product-price-sp">
                                    ${formatNumber(product.sp_price)} SP 
                                    <img src="data:image/png;base64,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" alt="SP Icon">
                                </h5>
                                <div class="d-grid">
                                    <button class="btn btn-info buy-spin-btn" data-product-id="${productId}" data-attempts-amount="${product.attempts_amount}" data-sp-price="${product.sp_price}">
                                        <i class="bi bi-cart-plus-fill me-2"></i>شراء
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        document.querySelectorAll('.buy-spin-btn').forEach(btn => {
            btn.addEventListener('click', handleSpinPurchase);
        });
    }

    function renderPointsProducts(productsData) {
        if (!ui.pointsProductsContainer) return;
        const products = productsData ? Object.entries(productsData) : [];

        if (products.length === 0) {
            ui.pointsProductsContainer.innerHTML = `<div class="col-12 text-center py-5"><p class="text-muted">لا توجد منتجات لتعديل الأسهم حالياً.</p></div>`;
            return;
        }

        ui.pointsProductsContainer.innerHTML = products.map(([productId, product]) => {
            const isRaise = product.type === 'raise';
            const iconClass = isRaise ? 'bi-arrow-up-circle-fill text-success' : 'bi-arrow-down-circle-fill text-danger';
            const title = isRaise ? 'رفع أسهم' : 'إسقاط أسهم';
            const pointsText = isRaise ? `+${formatNumber(product.points_amount)}` : `-${formatNumber(product.points_amount)}`;

            return `
                <div class="col-md-6 col-lg-4">
                    <div class="card product-card text-center h-100">
                        <div class="card-body d-flex flex-column">
                            <i class="bi ${iconClass} product-points-icon"></i>
                            <h5>${title}</h5>
                            <h4 class="fw-bold">${pointsText} نقطة</h4>
                            <div class="mt-auto">
                                <p class="mb-2">السعر:</p>
                                <h5 class="product-price-sp">
                                    ${formatNumber(product.sp_price)} SP 
                                    <img src="data:image/png;base64,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" alt="SP Icon">
                                </h5>
                                <div class="d-grid">
                                    <button class="btn btn-info buy-points-product-btn" 
                                            data-product-id="${productId}" 
                                            data-sp-price="${product.sp_price}"
                                            data-title="${title}"
                                            data-daily-limit="${product.daily_limit}">
                                        <i class="bi bi-cart-plus-fill me-2"></i>شراء
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        document.querySelectorAll('.buy-points-product-btn').forEach(btn => {
            btn.addEventListener('click', handlePointsProductPurchase);
        });
    }

    async function apiCall(endpoint, options) {
        const response = await fetch(endpoint, options);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'خطأ في الخادم');
        return data;
    }

    function handleProductPurchase(e) {
        const btn = e.currentTarget;
        const productId = btn.dataset.productId;
        const spAmount = parseFloat(btn.dataset.spAmount);
        const ccPrice = parseFloat(btn.dataset.ccPrice);

        if (currentWallet.cc < ccPrice) {
            Swal.fire('فشل!', 'رصيدك من CC غير كافٍ لإتمام هذه العملية.', 'error');
            return;
        }

        Swal.fire({
            title: 'تأكيد عملية الشراء',
            html: `هل أنت متأكد من شراء <b>${formatNumber(spAmount)} SP</b> مقابل <b>${formatNumber(ccPrice)} CC</b>؟`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#28a745',
            cancelButtonColor: '#d33',
            confirmButtonText: 'نعم، قم بالشراء!',
            cancelButtonText: 'إلغاء'
        }).then(async (result) => {
            if (result.isConfirmed) {
                const originalText = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
                try {
                    const data = await apiCall('/api/shop/buy_product', {
                        method: 'POST',
                        body: new URLSearchParams({ product_id: productId })
                    });
                    Swal.fire('تمت العملية!', data.message, 'success');
                } catch (error) {
                    Swal.fire('فشل!', error.message, 'error');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            }
        });
    }

    function handleSpinPurchase(e) {
        const btn = e.currentTarget;
        const productId = btn.dataset.productId;
        const attemptsAmount = parseInt(btn.dataset.attemptsAmount);
        const spPrice = parseFloat(btn.dataset.spPrice);

        if (currentWallet.sp < spPrice) {
            Swal.fire('فشل!', 'رصيدك من SP غير كافٍ لإتمام هذه العملية.', 'error');
            return;
        }

        Swal.fire({
            title: 'تأكيد عملية الشراء',
            html: `هل أنت متأكد من شراء <b>${attemptsAmount} محاولات</b> مقابل <b>${formatNumber(spPrice)} SP</b>؟`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#17a2b8',
            cancelButtonColor: '#d33',
            confirmButtonText: 'نعم، قم بالشراء!',
            cancelButtonText: 'إلغاء'
        }).then(async (result) => {
            if (result.isConfirmed) {
                const originalText = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
                try {
                    const data = await apiCall('/api/shop/buy_spin_attempt', {
                        method: 'POST',
                        body: new URLSearchParams({ product_id: productId })
                    });
                    Swal.fire('تمت العملية!', data.message, 'success');
                } catch (error) {
                    Swal.fire('فشل!', error.message, 'error');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            }
        });
    }

    async function handlePointsProductPurchase(e) {
        const btn = e.currentTarget;
        const { productId, spPrice, title } = btn.dataset;

        if (currentWallet.sp < parseFloat(spPrice)) {
            Swal.fire('فشل!', 'رصيدك من SP غير كافٍ لإتمام هذه العملية.', 'error');
            return;
        }

        if (allCrawlers.length === 0) {
            Swal.fire('خطأ!', 'لا يوجد زواحف في القائمة حالياً لاستهدافهم.', 'info');
            return;
        }

        const crawlerOptions = allCrawlers.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

        const { value: selectedCrawler } = await Swal.fire({
            title: `تأكيد شراء: ${title}`,
            html: `
                <p>اختر الزاحف الذي تريد تطبيق هذا التأثير عليه. التكلفة: <b>${formatNumber(spPrice)} SP</b>.</p>
                <select id="crawler-select" class="swal2-select">${crawlerOptions}</select>`,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'تأكيد الشراء',
            cancelButtonText: 'إلغاء',
            preConfirm: () => {
                return document.getElementById('crawler-select').value;
            }
        });

        if (selectedCrawler) {
            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
            try {
                const data = await apiCall('/api/shop/buy_points_product', {
                    method: 'POST',
                    body: new URLSearchParams({
                        product_id: productId,
                        target_crawler: selectedCrawler
                    })
                });
                Swal.fire('تمت العملية!', data.message, 'success');
            } catch (error) {
                Swal.fire('فشل!', error.message, 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        }
    }


    initializeApp();
}