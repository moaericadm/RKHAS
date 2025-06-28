// --- START OF FILE static/js/admin.js ---

let isDomReady = false;
let isFirebaseReady = false;

function tryToStartApp() {
    if (isDomReady && isFirebaseReady) {
        initializeAdminPanel();
    }
}

document.addEventListener('DOMContentLoaded', () => { isDomReady = true; tryToStartApp(); });
document.addEventListener('firebase-ready', () => { isFirebaseReady = true; tryToStartApp(); });

const ui = {};
let db;
let usersCache = {};
let candidatesData = {};

// Helper function to format numbers, defined globally for this script
const formatNumber = (num) => new Intl.NumberFormat('en-US').format(parseInt(num || 0));

// Helper function for API calls
const apiCall = async (url, options = {}, successMsg) => {
    try {
        const response = await fetch(url, options);
        const data = await response.json();
        if (response.ok) {
            if (successMsg) Swal.fire({ icon: 'success', title: 'تم!', text: successMsg, timer: 1500, showConfirmButton: false });
            return data;
        } else {
            throw new Error(data.message || "An unknown error occurred");
        }
    } catch (err) {
        Swal.fire('خطأ!', err.message, 'error');
        throw err;
    }
};


function initializeAdminPanel() {
    console.log("Admin panel initialization started.");
    Object.assign(ui, {
        userForm: document.getElementById('userForm'), nameInput: document.getElementById('nameInput'),
        pointsInput: document.getElementById('pointsInput'), originalNameInput: document.getElementById('originalNameInput'),
        saveUserBtn: document.getElementById('saveUserBtn'), clearFormBtn: document.getElementById('clearFormBtn'),
        formTitle: document.getElementById('form-title'), tableBody: document.getElementById('admin-table-body'),
        addCandidateBtn: document.getElementById('add-candidate-btn'), pendingUsersTable: document.getElementById('pending-users-table-body'),
        pendingCountBadge: document.getElementById('pending-count'),
        approvedUsersTable: document.getElementById('approved-users-table-body'), announcementForm: document.getElementById('announcementForm'),
        announcementsList: document.getElementById('announcements-list'), honorRollForm: document.getElementById('honorRollForm'),
        honorRollList: document.getElementById('honorRollList'), spinWheelSettingsForm: document.getElementById('spin-wheel-settings-form'),
        spinWheelEnabledToggle: document.getElementById('spin-wheel-enabled-toggle'), spinCooldownHours: document.getElementById('spin-cooldown-hours'),
        spinMaxAttempts: document.getElementById('spin-max-attempts'), spinMaxAccumulation: document.getElementById('spin-max-accumulation'),
        spinPurchaseLimit: document.getElementById('spin-purchase-limit'), prizesContainer: document.getElementById('prizes-container'),
        addPrizeBtn: document.getElementById('add-prize-btn'), addProductForm: document.getElementById('add-product-form'),
        productSpAmountInput: document.getElementById('product-sp-amount'), productCcPriceInput: document.getElementById('product-cc-price'),
        shopProductsList: document.getElementById('shop-products-list'), addSpinProductForm: document.getElementById('add-spin-product-form'),
        spinProductAttemptsInput: document.getElementById('spin-product-attempts'), spinProductSpPriceInput: document.getElementById('spin-product-sp-price'),
        shopSpinProductsList: document.getElementById('shop-spin-products-list'),
        resetAllSpinsBtn: document.getElementById('resetAllSpinsBtn'),
        addPointsProductForm: document.getElementById('add-points-product-form'),
        pointsProductType: document.getElementById('points-product-type'),
        pointsProductAmount: document.getElementById('points-product-amount'),
        pointsProductSpPrice: document.getElementById('points-product-sp-price'),
        pointsProductDailyLimit: document.getElementById('points-product-daily-limit'),
        shopPointsProductsList: document.getElementById('shop-points-products-list'),
        activityLogList: document.getElementById('activityLogList'),
        investmentLogList: document.getElementById('investment-log-list'),
        activeUsersList: document.getElementById('active-users-list'),
    });

    try {
        db = firebase.database();
        const token = sessionStorage.getItem('firebaseToken');
        // *** התיקון כאן | THE FIX IS HERE ***
        // التحقق من وجود التوكن قبل محاولة استخدامه
        if (!token) throw new Error("Authentication token not found.");

        firebase.auth().signInWithCustomToken(token).then(() => {
            console.log("Admin authenticated successfully.");
            initializeDataListeners();
            setupEventListeners();
        }).catch(e => {
            console.error("Firebase Auth Error:", e);
            Swal.fire({ title: 'Authentication Error', text: e.message, icon: 'error' }).then(() => window.location.href = '/auth/login');
        });
    } catch (e) {
        console.error("Initialization Error:", e);
        Swal.fire('Critical Error', `Failed to initialize admin panel: ${e.message}`, 'error');
    }
}

function initializeDataListeners() {
    const handleFirebaseError = (error, path) => console.error(`Firebase read error at ${path}:`, error.code, error.message);
    db.ref('users').on('value', s => { usersCache = s.val() || {}; renderUserTable(); }, e => handleFirebaseError(e, 'users'));
    db.ref('candidates').on('value', s => { candidatesData = s.val() || {}; renderUserTable(); }, e => handleFirebaseError(e, 'candidates'));
    db.ref('site_settings/announcements').on('value', s => renderAnnouncements(s.val()), e => handleFirebaseError(e, 'announcements'));
    db.ref('site_settings/honor_roll').on('value', s => renderHonorRoll(s.val()), e => handleFirebaseError(e, 'honor_roll'));
    db.ref('site_settings/spin_wheel_settings').on('value', s => loadSpinWheelSettings(s.val()), e => handleFirebaseError(e, 'spin_wheel_settings'));
    db.ref('site_settings/shop_products').on('value', s => renderShopProducts(s.val()), e => handleFirebaseError(e, 'shop_products'));
    db.ref('site_settings/shop_products_spins').on('value', s => renderShopSpinProducts(s.val()), e => handleFirebaseError(e, 'shop_products_spins'));
    db.ref('site_settings/shop_products_points').on('value', s => renderShopPointsProducts(s.val()), e => handleFirebaseError(e, 'shop_products_points'));

    initializeApprovalPanel();
    initializeActivityPanels();
    initializeApprovedUsersPanel();
}

const emptyStateMessages = {
    activeUsers: '<li id="empty-active-users" class="list-group-item text-muted text-center">لا يوجد مستخدمون متصلون حالياً.</li>',
    generalActivity: '<li class="list-group-item text-muted text-center">لا يوجد نشاط عام مسجل.</li>',
    investmentLog: '<li class="list-group-item text-muted text-center">لا يوجد نشاط استثماري مسجل.</li>',
};

function renderActiveUser(uid, userData) {
    if (typeof userData.online_since !== 'number') {
        return '';
    }
    const since = new Date(userData.online_since).toLocaleString('ar-EG');
    return `
        <li class="list-group-item" id="active-user-${uid}">
            <i class="bi bi-person-check-fill text-success me-2"></i>
            <strong>${userData.name || 'مستخدم مجهول'}</strong>
            <small class="text-muted d-block mt-1">متصل منذ: ${since}</small>
        </li>`;
}

function initializeActivityPanels() {
    const handleFirebaseError = (error, path) => console.error(`Firebase read error at ${path}:`, error.code, error.message);

    db.ref('activity_log').orderByChild('timestamp').limitToLast(50).on('value', s => renderGeneralActivityLog(s.val()), e => handleFirebaseError(e, 'activity_log'));
    db.ref('investment_log').orderByChild('timestamp').limitToLast(100).on('value', s => renderInvestmentLog(s.val()), e => handleFirebaseError(e, 'investment_log'));

    const onlineVisitorsRef = db.ref('online_visitors');
    onlineVisitorsRef.on('value', (snapshot) => {
        if (!ui.activeUsersList) return;
        const usersData = snapshot.val();
        if (!usersData) {
            ui.activeUsersList.innerHTML = emptyStateMessages.activeUsers;
            return;
        }
        const activeUsers = Object.entries(usersData)
            .filter(([uid, data]) => typeof data.online_since === 'number')
            .sort(([, a], [, b]) => b.online_since - a.online_since);

        if (activeUsers.length === 0) {
            ui.activeUsersList.innerHTML = emptyStateMessages.activeUsers;
        } else {
            ui.activeUsersList.innerHTML = activeUsers.map(([uid, data]) => renderActiveUser(uid, data)).join('');
        }
    }, e => handleFirebaseError(e, 'online_visitors'));
}


function renderUserTable() {
    if (!ui.tableBody) return;
    const usersArray = Object.entries(usersCache).map(([key, value]) => ({ ...value, name: key })).sort((a, b) => (b.points || 0) - (a.points || 0));
    ui.tableBody.innerHTML = usersArray.length === 0 ? '<tr><td colspan="5" class="text-center py-4">لا يوجد زواحف.</td></tr>'
        : usersArray.map((user, index) => {
            const displayName = user.name;
            const isCandidate = candidatesData.hasOwnProperty(displayName);
            return `<tr id="user-row-${displayName}" data-username="${displayName}" data-points="${user.points || 0}"><th class="align-middle rank">#${index + 1}</th><td class="align-middle fw-bold">${displayName}</td><td class="text-center align-middle">${formatNumber(user.points)}</td><td class="text-center align-middle"><i class="bi bi-heart-fill text-danger"></i> ${formatNumber(user.likes)}</td><td class="text-center align-middle"><button class="btn btn-info btn-sm" onclick="window.adminActions.editUser('${displayName}')"><i class="bi bi-pencil-fill"></i></button><button class="btn ${isCandidate ? 'btn-warning' : 'btn-outline-success'} btn-sm ms-2" onclick="window.adminActions.toggleCandidate('${displayName}', ${isCandidate})"><i class="bi ${isCandidate ? 'bi-person-x-fill' : 'bi-person-check-fill'}"></i></button><button class="btn btn-danger btn-sm ms-2" onclick="window.adminActions.confirmDelete('${displayName}')"><i class="bi bi-trash-fill"></i></button></td></tr>`;
        }).join('');
}

function renderShopProducts(productsData) {
    if (!ui.shopProductsList) return;
    const products = productsData ? Object.entries(productsData) : [];
    if (products.length === 0) {
        ui.shopProductsList.innerHTML = `<li class="list-group-item text-muted text-center">لا توجد حزم SP مضافة حالياً.</li>`;
        return;
    }
    ui.shopProductsList.innerHTML = products.sort((a, b) => (a[1].cc_price || 0) - (b[1].cc_price || 0)).map(([id, product]) => `
        <li class="list-group-item d-flex justify-content-between align-items-center">
            <span><strong>${formatNumber(product.sp_amount)} SP</strong> بسعر <span class="text-warning">${formatNumber(product.cc_price)} CC</span></span>
            <button class="btn btn-sm btn-outline-danger" onclick="window.adminActions.deleteShopProduct('${id}')"><i class="bi bi-trash-fill"></i></button>
        </li>`).join('');
}

function renderShopSpinProducts(productsData) {
    if (!ui.shopSpinProductsList) return;
    const products = productsData ? Object.entries(productsData) : [];
    if (products.length === 0) {
        ui.shopSpinProductsList.innerHTML = `<li class="list-group-item text-muted text-center">لا توجد حزم محاولات مضافة حالياً.</li>`;
        return;
    }
    ui.shopSpinProductsList.innerHTML = products.sort((a, b) => (a[1].sp_price || 0) - (b[1].sp_price || 0)).map(([id, product]) => `
        <li class="list-group-item d-flex justify-content-between align-items-center">
            <span><strong>${product.attempts_amount} محاولات</strong> بسعر <span class="text-success">${formatNumber(product.sp_price)} SP</span></span>
            <button class="btn btn-sm btn-outline-danger" onclick="window.adminActions.deleteShopSpinProduct('${id}')"><i class="bi bi-trash-fill"></i></button>
        </li>`).join('');
}

function renderShopPointsProducts(productsData) {
    if (!ui.shopPointsProductsList) return;
    const products = productsData ? Object.entries(productsData) : [];
    if (products.length === 0) {
        ui.shopPointsProductsList.innerHTML = `<li class="list-group-item text-muted text-center">لا توجد منتجات لتعديل الأسهم حالياً.</li>`;
        return;
    }
    ui.shopPointsProductsList.innerHTML = products.sort((a, b) => (a[1].sp_price || 0) - (b[1].sp_price || 0)).map(([id, product]) => {
        const typeText = product.type === 'raise' ? 'رفع أسهم' : 'إسقاط أسهم';
        const typeClass = product.type === 'raise' ? 'text-success' : 'text-danger';
        return `
        <li class="list-group-item d-flex justify-content-between align-items-center">
            <div>
                <strong class="${typeClass}">${typeText}</strong>:
                <span>${formatNumber(product.points_amount)} نقطة,</span>
                <span>بسعر <span class="text-success">${formatNumber(product.sp_price)} SP</span>,</span>
                <span>الحد اليومي: ${product.daily_limit}</span>
            </div>
            <button class="btn btn-sm btn-outline-danger" onclick="window.adminActions.deleteShopPointsProduct('${id}')"><i class="bi bi-trash-fill"></i></button>
        </li>`;
    }).join('');
}

function initializeApprovalPanel() {
    db.ref('registered_users').orderByChild('status').equalTo('pending').on('value', (snapshot) => {
        if (!ui.pendingUsersTable) return;
        const data = snapshot.val() || {};
        const count = Object.keys(data).length;
        ui.pendingCountBadge.textContent = count;
        ui.pendingCountBadge.style.display = count > 0 ? 'inline' : 'none';
        ui.pendingUsersTable.innerHTML = count === 0 ? '<tr><td colspan="3" class="text-center py-4">لا توجد طلبات تسجيل جديدة.</td></tr>' : Object.entries(data).map(([userId, userData]) => `<tr>
                <td>${userData.name}</td>
                <td>${userData.email}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-success" onclick="window.adminActions.manageUser('${userId}', 'approve', this)">قبول</button>
                    <button class="btn btn-sm btn-danger ms-2" onclick="window.adminActions.manageUser('${userId}', 'reject', this)">رفض</button>
                </td>
            </tr>`).join('')
    });
}

function initializeApprovedUsersPanel() {
    db.ref('registered_users').orderByChild('status').equalTo('approved').on('value', (snapshot) => {
        if (!ui.approvedUsersTable) return;
        const approvedUsers = snapshot.val() || {};
        const sortedUsers = Object.values(approvedUsers).sort((a, b) => (b.registered_at || 0) - (a.registered_at || 0));

        if (sortedUsers.length === 0) {
            ui.approvedUsersTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">لا توجد حسابات مقبولة حالياً.</td></tr>';
            return;
        }

        ui.approvedUsersTable.innerHTML = sortedUsers.map(user => {
            const regDate = new Date((user.registered_at || 0) * 1000).toLocaleDateString('ar-EG');
            const roleBadge = user.role === 'admin' ? '<span class="badge bg-danger">أدمن</span>' : '<span class="badge bg-secondary">مستخدم</span>';

            return `<tr>
                <td>${user.name}</td>
                <td>${user.email}</td>
                <td class="text-center">${roleBadge}</td>
                <td class="text-center">${regDate}</td>
                <td class="text-center d-flex justify-content-center gap-2">
                    <!-- *** התיקון כאן | THE FIX IS HERE *** -->
                    <button class="btn btn-outline-success btn-sm" onclick="window.adminActions.editUserWallet('${user.uid}','${user.name}')" title="تعديل محفظة المستخدم">
                        <i class="bi bi-wallet2-fill"></i>
                    </button>
                    <button class="btn btn-outline-primary btn-sm" onclick="window.adminActions.resetFreeSpinsForUser('${user.uid}','${user.name}')" title="منح المحاولات المجانية لهذا المستخدم">
                        <i class="bi bi-gift-fill"></i>
                    </button>
                    <button class="btn btn-outline-warning btn-sm" onclick="window.adminActions.editPurchasedAttempts('${user.uid}','${user.name}')" title="تعديل المحاولات المشتراة">
                        <i class="bi bi-gem"></i>
                    </button>
                    <button class="btn btn-outline-danger btn-sm" onclick="window.adminActions.confirmBanUser('${user.uid}','${user.name}')" title="حظر المستخدم">
                        <i class="bi bi-slash-circle-fill"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');
    });
}

function renderGeneralActivityLog(data) {
    if (!ui.activityLogList) return;
    const sortedActivities = data ? Object.values(data).sort((a, b) => b.timestamp - a.timestamp) : [];

    ui.activityLogList.innerHTML = sortedActivities.length === 0
        ? emptyStateMessages.generalActivity
        : sortedActivities.map(log => {
            const logDate = new Date(log.timestamp * 1000).toLocaleString('ar-EG');
            const logIcon = { 'like': 'bi-heart-fill text-danger', 'gift': 'bi-gift-fill text-warning', 'nomination': 'bi-person-up text-info', 'report': 'bi-exclamation-triangle-fill text-danger' }[log.type] || 'bi-info-circle-fill text-secondary';
            let userActions = (log.user_id && log.user_name) ? `<div class="ms-auto ps-3 d-flex gap-2">
                <button class="btn btn-outline-info btn-sm" onclick="window.adminActions.sendUserMessage('${log.user_id}','${log.user_name}')" title="إرسال رسالة"><i class="bi bi-chat-dots-fill"></i></button>
                <button class="btn btn-outline-danger btn-sm" onclick="window.adminActions.confirmBanUser('${log.user_id}','${log.user_name}')" title="حظر المستخدم"><i class="bi bi-slash-circle-fill"></i></button>
            </div>` : '';
            return `<li class="list-group-item d-flex justify-content-between align-items-center">
                <div><i class="bi ${logIcon} me-2"></i><span>${log.text}</span><small class="text-muted d-block mt-1">${logDate}</small></div>${userActions}
            </li>`;
        }).join('');
}

function renderInvestmentLog(data) {
    if (!ui.investmentLogList) return;
    const sortedLogs = data ? Object.values(data).sort((a, b) => b.timestamp - a.timestamp) : [];
    ui.investmentLogList.innerHTML = sortedLogs.length === 0
        ? emptyStateMessages.investmentLog
        : sortedLogs.map(log => {
            const date = new Date(log.timestamp * 1000).toLocaleString('ar-EG');
            const isInvest = log.action === 'invest';
            const icon = isInvest ? 'bi-graph-up text-success' : 'bi-graph-down text-danger';
            const actionText = isInvest ? 'استثمر في' : 'باع من';
            return `<li class="list-group-item">
                <i class="bi ${icon} me-2"></i> 
                <strong>${log.investor_name || 'مجهول'}</strong> ${actionText} <strong>${log.target_name || 'مجهول'}</strong>
                بمبلغ <span class="fw-bold text-success">${formatNumber(log.sp_amount)} SP</span>.
                <small class="text-muted d-block mt-1">${date}</small>
            </li>`;
        }).join('');
}

function renderAnnouncements(data) {
    if (!ui.announcementsList) return;
    ui.announcementsList.innerHTML = Object.entries(data || {}).length === 0
        ? '<li class="list-group-item text-muted text-center">لا توجد إعلانات.</li>'
        : Object.entries(data).map(([id, ann]) => `<li class="list-group-item d-flex justify-content-between"><span>${ann.text}</span> <button class="btn btn-sm btn-outline-danger" onclick="window.adminActions.deleteAnnouncement('${id}')"><i class="bi bi-trash-fill"></i></button></li>`).join('');
}

function renderHonorRoll(data) {
    if (!ui.honorRollList) return;
    ui.honorRollList.innerHTML = Object.entries(data || {}).length === 0
        ? '<li class="list-group-item text-muted text-center">القائمة فارغة.</li>'
        : Object.entries(data).map(([id, item]) => `<li class="list-group-item d-flex justify-content-between"><span>${item.name}</span> <button class="btn btn-sm btn-outline-danger" onclick="window.adminActions.deleteFromHonorRoll('${id}')"><i class="bi bi-trash-fill"></i></button></li>`).join('');
}

function addPrizeInput(prize = { value: '', weight: '' }) {
    if (!ui.prizesContainer) return;
    const div = document.createElement('div');
    div.className = 'input-group prize-entry mb-2';
    div.innerHTML = `<span class="input-group-text">الجائزة</span><input type="number" class="form-control prize-value" placeholder="قيمة النقاط" value="${prize.value}" required><span class="input-group-text">الوزن</span><input type="number" class="form-control prize-weight" placeholder="فرصة الربح" value="${prize.weight}" required><button type="button" class="btn btn-outline-danger" onclick="this.closest('.prize-entry').remove()"><i class="bi bi-trash"></i></button>`;
    ui.prizesContainer.appendChild(div);
}

function loadSpinWheelSettings(settings) {
    if (!ui.spinWheelEnabledToggle) return;
    settings = settings || { enabled: false, cooldownHours: 24, maxAttempts: 1, maxAccumulation: 10, purchaseLimit: 20, prizes: [] };
    ui.spinWheelEnabledToggle.checked = settings.enabled || false;
    ui.spinCooldownHours.value = settings.cooldownHours || 24;
    ui.spinMaxAttempts.value = settings.maxAttempts || 1;
    ui.spinMaxAccumulation.value = settings.maxAccumulation || 10;
    ui.spinPurchaseLimit.value = settings.purchaseLimit || 20;
    ui.prizesContainer.innerHTML = '';
    if (settings.prizes && settings.prizes.length > 0) {
        settings.prizes.forEach(prize => addPrizeInput(prize));
    } else {
        addPrizeInput({ value: 100, weight: 50 });
        addPrizeInput({ value: 500, weight: 25 });
    }
}

function setupEventListeners() {
    if (ui.userForm) ui.userForm.addEventListener('submit', handleUserFormSubmit);
    if (ui.clearFormBtn) ui.clearFormBtn.addEventListener('click', resetUserForm);
    if (ui.addCandidateBtn) ui.addCandidateBtn.addEventListener('click', () => window.adminActions.addCandidate());
    if (ui.announcementForm) ui.announcementForm.addEventListener('submit', (e) => { e.preventDefault(); apiCall('/api/admin/announcements/add', { method: 'POST', body: new FormData(e.target) }, 'تم إضافة الإعلان بنجاح!'); e.target.reset(); });
    if (ui.honorRollForm) ui.honorRollForm.addEventListener('submit', (e) => { e.preventDefault(); apiCall('/api/admin/honor_roll/add', { method: 'POST', body: new FormData(e.target) }, 'تمت الإضافة بنجاح!'); e.target.reset(); });
    if (ui.addPrizeBtn) ui.addPrizeBtn.addEventListener('click', () => addPrizeInput());
    if (ui.spinWheelSettingsForm) ui.spinWheelSettingsForm.addEventListener('submit', handleSpinWheelSettingsSubmit);
    if (ui.addProductForm) ui.addProductForm.addEventListener('submit', handleAddProductSubmit);
    if (ui.addSpinProductForm) ui.addSpinProductForm.addEventListener('submit', handleAddSpinProductSubmit);
    if (ui.resetAllSpinsBtn) ui.resetAllSpinsBtn.addEventListener('click', window.adminActions.resetAllFreeSpins);
    if (ui.addPointsProductForm) ui.addPointsProductForm.addEventListener('submit', handleAddPointsProductSubmit);
}


function resetUserForm() {
    if (!ui.userForm) return;
    ui.userForm.reset();
    ui.originalNameInput.value = '';
    ui.formTitle.innerText = 'إضافة/تعديل زاحف';
    ui.saveUserBtn.innerText = 'إضافة';
    ui.saveUserBtn.classList.replace('btn-warning', 'btn-primary');
    ui.clearFormBtn.style.display = 'none';
}

async function handleUserFormSubmit(e) {
    e.preventDefault();
    const btn = ui.saveUserBtn;
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> جارِ الحفظ...`;
    try {
        await apiCall('/api/admin/add_user', { method: 'POST', body: new FormData(ui.userForm) }, 'تم حفظ البيانات بنجاح.');
        resetUserForm();
    } catch (err) {
        // Error is already shown by apiCall
    } finally {
        btn.disabled = false;
        btn.innerHTML = ui.originalNameInput.value ? 'حفظ التعديل' : originalHTML;
    }
}

function handleAddProductSubmit(e) {
    e.preventDefault();
    const spAmount = ui.productSpAmountInput.value;
    const ccPrice = ui.productCcPriceInput.value;
    if (!spAmount || !ccPrice || spAmount <= 0 || ccPrice <= 0) {
        Swal.fire('خطأ', 'الرجاء إدخال قيم صحيحة للمنتج.', 'error');
        return;
    }
    const newProductRef = db.ref('site_settings/shop_products').push();
    newProductRef.set({ sp_amount: parseInt(spAmount), cc_price: parseInt(ccPrice) })
        .then(() => {
            Swal.fire('تم!', 'تمت إضافة حزمة SP بنجاح.', 'success');
            ui.addProductForm.reset();
        })
        .catch(err => Swal.fire('خطأ!', `فشلت الإضافة: ${err.message}`, 'error'));
}

function handleAddSpinProductSubmit(e) {
    e.preventDefault();
    const attempts = ui.spinProductAttemptsInput.value;
    const spPrice = ui.spinProductSpPriceInput.value;
    if (!attempts || !spPrice || attempts <= 0 || spPrice <= 0) {
        Swal.fire('خطأ', 'الرجاء إدخال قيم صحيحة للمنتج.', 'error');
        return;
    }
    const newProductRef = db.ref('site_settings/shop_products_spins').push();
    newProductRef.set({ attempts_amount: parseInt(attempts), sp_price: parseInt(spPrice) })
        .then(() => {
            Swal.fire('تم!', 'تمت إضافة حزمة المحاولات بنجاح.', 'success');
            ui.addSpinProductForm.reset();
        })
        .catch(err => Swal.fire('خطأ!', `فشلت الإضافة: ${err.message}`, 'error'));
}

function handleAddPointsProductSubmit(e) {
    e.preventDefault();
    const payload = {
        type: ui.pointsProductType.value,
        points_amount: ui.pointsProductAmount.value,
        sp_price: ui.pointsProductSpPrice.value,
        daily_limit: ui.pointsProductDailyLimit.value,
    };
    if (Object.values(payload).some(v => !v || v <= 0)) {
        Swal.fire('خطأ', 'الرجاء تعبئة جميع الحقول بقيم صحيحة وموجبة.', 'error');
        return;
    }
    apiCall('/api/admin/shop/add_points_product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }, 'تم إضافة منتج تعديل الأسهم بنجاح!').then(() => {
        ui.addPointsProductForm.reset();
    }).catch(err => console.error(err));
}


function handleSpinWheelSettingsSubmit(e) {
    e.preventDefault();
    const prizes = Array.from(ui.prizesContainer.querySelectorAll('.prize-entry')).map(entry => ({
        value: entry.querySelector('.prize-value').value,
        weight: entry.querySelector('.prize-weight').value
    })).filter(p => p.value && p.weight);

    const settings = {
        enabled: ui.spinWheelEnabledToggle.checked,
        cooldownHours: parseInt(ui.spinCooldownHours.value) || 24,
        maxAttempts: parseInt(ui.spinMaxAttempts.value) || 1,
        maxAccumulation: parseInt(ui.spinMaxAccumulation.value) || 10,
        purchaseLimit: parseInt(ui.spinPurchaseLimit.value) || 20,
        prizes: prizes
    };

    apiCall('/api/admin/settings/spin_wheel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    }, 'تم حفظ إعدادات عجلة الحظ!');
}

window.adminActions = {
    editUser: (name) => {
        const user = usersCache[name];
        if (!user) return;
        ui.nameInput.value = name;
        ui.pointsInput.value = user.points || 0;
        ui.originalNameInput.value = name;
        ui.formTitle.innerText = `تعديل: ${name}`;
        ui.saveUserBtn.innerText = 'حفظ التعديل';
        ui.saveUserBtn.classList.replace('btn-primary', 'btn-warning');
        ui.clearFormBtn.style.display = 'inline-block';
        ui.nameInput.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    confirmDelete: (name) => {
        Swal.fire({ title: `هل أنت متأكد من حذف ${name}؟`, text: "لا يمكن التراجع عن هذا الإجراء!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم، احذفه!', cancelButtonText: 'إلغاء' }).then((result) => {
            if (result.isConfirmed) apiCall(`/api/admin/delete_user/${name}`, { method: 'POST' }, 'تم حذف الزاحف بنجاح.');
        });
    },
    addCandidate: async () => {
        const { value: name } = await Swal.fire({ title: 'ترشيح زاحف جديد', input: 'text', inputLabel: 'اسم الزاحف المراد ترشيحه', inputPlaceholder: 'أدخل الاسم هنا...', showCancelButton: true, confirmButtonText: 'ترشيح', cancelButtonText: 'إلغاء' });
        if (name && name.trim()) apiCall(`/api/admin/candidate/add/${name.trim()}`, { method: 'POST' }, `تم ترشيح ${name.trim()} بنجاح`);
    },
    toggleCandidate: (name, isCandidate) => {
        apiCall(`/api/admin/candidate/${isCandidate ? 'remove' : 'add'}/${name}`, { method: 'POST' });
    },
    manageUser: async (userId, action, btn) => {
        btn.disabled = true;
        await apiCall(`/api/admin/manage_user/${userId}/${action}`, { method: 'POST' }, `تم ${action === 'approve' ? 'قبول' : 'رفض'} المستخدم.`);
    },
    confirmBanUser: (userId, userName) => {
        Swal.fire({ title: `هل أنت متأكد من حظر ${userName}؟`, icon: 'warning', showCancelButton: true, confirmButtonText: 'نعم، قم بالحظر!', cancelButtonText: 'إلغاء' }).then((result) => {
            if (result.isConfirmed) apiCall('/api/admin/ban_user', { method: 'POST', body: new URLSearchParams({ user_id_to_ban: userId, user_name_to_ban: userName }) }, `تم حظر ${userName} بنجاح.`);
        });
    },
    resetFreeSpinsForUser: (userId, userName) => {
        Swal.fire({
            title: `منح محاولات مجانية لـ ${userName}؟`,
            text: "سيتم إضافة المحاولات المجانية اليومية إلى رصيده وتحديث وقت التبريد.",
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'نعم, امنح المحاولات!',
            cancelButtonText: 'إلغاء'
        }).then((result) => {
            if (result.isConfirmed) {
                apiCall('/api/admin/reset_all_free_spins', {
                    method: 'POST',
                    body: new URLSearchParams({ user_id: userId })
                }, `تم منح المحاولات المجانية لـ ${userName}.`);
            }
        });
    },
    editPurchasedAttempts: async (userId, userName) => {
        const userStateRef = db.ref(`user_spin_state/${userId}`);
        const snapshot = await userStateRef.once('value');
        const currentState = snapshot.val() || { purchasedAttempts: 0 };

        const { value: newAttempts } = await Swal.fire({
            title: `تعديل المحاولات المشتراة لـ ${userName}`,
            input: 'number',
            inputLabel: 'العدد الجديد للمحاولات المشتراة',
            inputValue: currentState.purchasedAttempts,
            showCancelButton: true,
            confirmButtonText: 'تحديث',
            cancelButtonText: 'إلغاء',
            inputValidator: (value) => {
                const num = Number(value);
                if (isNaN(num) || num < 0 || !Number.isInteger(num)) {
                    return 'الرجاء إدخال رقم صحيح وموجب!'
                }
                return null;
            }
        });

        if (newAttempts !== null && typeof newAttempts !== 'undefined') {
            apiCall('/api/admin/update_purchased_attempts', {
                method: 'POST',
                body: new URLSearchParams({ user_id: userId, attempts: newAttempts })
            }, `تم تحديث رصيد ${userName} من المحاولات المشتراة.`);
        }
    },
    // *** התיקון כאן | THE FIX IS HERE ***
    editUserWallet: async (userId, userName) => {
        // أولاً، نحضر الرصيد الحالي للمستخدم
        const walletRef = db.ref(`wallets/${userId}`);
        const snapshot = await walletRef.once('value');
        const currentWallet = snapshot.val() || { cc: 0, sp: 0 };

        // ثانياً، نعرض نافذة منبثقة مع الحقول مملوءة بالقيم الحالية
        const { value: formValues } = await Swal.fire({
            title: `تعديل محفظة ${userName}`,
            html: `
                <div class="mb-2">
                    <label for="swal-cc" class="form-label">رصيد زاحف كوين (CC)</label>
                    <input id="swal-cc" type="number" class="swal2-input" value="${Math.round(currentWallet.cc || 0)}">
                </div>
                <div>
                    <label for="swal-sp" class="form-label">رصيد نقاط الدعم (SP)</label>
                    <input id="swal-sp" type="number" class="swal2-input" value="${(currentWallet.sp || 0).toFixed(2)}">
                </div>`,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'حفظ التعديلات',
            cancelButtonText: 'إلغاء',
            preConfirm: () => {
                const cc = document.getElementById('swal-cc').value;
                const sp = document.getElementById('swal-sp').value;
                if (!cc || !sp || isNaN(cc) || isNaN(sp)) {
                    Swal.showValidationMessage(`الرجاء إدخال قيم رقمية صحيحة`);
                    return false;
                }
                return { cc: Number(cc), sp: Number(sp) };
            }
        });

        // ثالثاً، إذا قام الأدمن بالتأكيد، نرسل الطلب إلى الخادم
        if (formValues) {
            apiCall('/api/admin/update_wallet', {
                method: 'POST',
                body: new URLSearchParams({
                    user_id: userId,
                    user_name: userName, // نرسل الاسم أيضاً لغرض تسجيل النشاط
                    cc: formValues.cc,
                    sp: formValues.sp
                })
            }, `تم تحديث محفظة ${userName} بنجاح.`);
        }
    },
    resetAllFreeSpins: () => {
        Swal.fire({
            title: 'هل أنت متأكد؟',
            text: "سيتم منح المحاولات المجانية لجميع المستخدمين الآن وإعادة ضبط المؤقت الخاص بهم. لا يمكن التراجع عن هذا الإجراء.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#d33',
            confirmButtonText: 'نعم، قم بإعادة التعيين!',
            cancelButtonText: 'إلغاء'
        }).then((result) => {
            if (result.isConfirmed) {
                apiCall('/api/admin/reset_all_free_spins', { method: 'POST' }, 'تم إرسال طلب إعادة التعيين بنجاح.');
            }
        });
    },
    deleteShopProduct: (productId) => {
        Swal.fire({ title: 'هل أنت متأكد؟', text: "سيتم حذف حزمة SP هذه من المتجر نهائياً!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'نعم، احذفه!' }).then((result) => {
            if (result.isConfirmed) {
                db.ref(`site_settings/shop_products/${productId}`).remove()
                    .then(() => Swal.fire('تم الحذف!', 'تم حذف المنتج بنجاح.', 'success'))
                    .catch(err => Swal.fire('خطأ!', `فشل الحذف: ${err.message}`, 'error'));
            }
        });
    },
    deleteShopSpinProduct: (productId) => {
        Swal.fire({ title: 'هل أنت متأكد؟', text: "سيتم حذف حزمة المحاولات هذه من المتجر نهائياً!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'نعم، احذفه!' }).then((result) => {
            if (result.isConfirmed) {
                db.ref(`site_settings/shop_products_spins/${productId}`).remove()
                    .then(() => Swal.fire('تم الحذف!', 'تم حذف المنتج بنجاح.', 'success'))
                    .catch(err => Swal.fire('خطأ!', `فشل الحذف: ${err.message}`, 'error'));
            }
        });
    },
    deleteShopPointsProduct: (productId) => {
        Swal.fire({ title: 'هل أنت متأكد؟', text: "سيتم حذف منتج تعديل الأسهم هذا من المتجر نهائياً!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'نعم، احذفه!' }).then((result) => {
            if (result.isConfirmed) {
                apiCall(`/api/admin/shop/delete_points_product/${productId}`, { method: 'POST' }, 'تم حذف المنتج بنجاح.');
            }
        });
    },
    sendUserMessage: async (userId, userName) => {
        const { value: message } = await Swal.fire({ title: `إرسال رسالة إلى ${userName}`, input: 'textarea', inputPlaceholder: 'اكتب رسالتك هنا...', showCancelButton: true, confirmButtonText: 'إرسال', cancelButtonText: 'إلغاء' });
        if (message && message.trim()) apiCall('/api/admin/user_message/send', { method: 'POST', body: new URLSearchParams({ user_id: userId, user_name: userName, message: message }) }, `تم إرسال الرسالة إلى ${userName} بنجاح.`);
    },
    deleteAnnouncement: (id) => { apiCall(`/api/admin/announcements/delete/${id}`, { method: 'POST' }); },
    deleteFromHonorRoll: (id) => { apiCall(`/api/admin/honor_roll/delete/${id}`, { method: 'POST' }); },
};
// --- END OF FILE static/js/admin.js ---