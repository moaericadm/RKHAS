// --- START OF FILE static/js/admin.js (WITH INVESTMENT SETTINGS AND LOCK HOURS) ---

let isDomReady = false, isFirebaseReady = false;
function tryToStartApp() { if (isDomReady && isFirebaseReady) initializeAdminPanel(); }
document.addEventListener('DOMContentLoaded', () => { isDomReady = true; tryToStartApp(); });
document.addEventListener('firebase-ready', () => { isFirebaseReady = true; tryToStartApp(); });

const ui = {};
let db, usersCache = {};
let investmentsCache = {};

const formatNumber = (num) => new Intl.NumberFormat('en-US').format(parseInt(num || 0));

const apiCall = async (url, options = {}, successMsg) => {
    try {
        const response = await fetch(url, options);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || `Server Error: ${response.status}`);
        if (successMsg) Swal.fire({ icon: 'success', title: 'تم!', text: successMsg, timer: 1500, showConfirmButton: false });
        return data;
    } catch (err) {
        console.error(`API Call Failed for ${url}:`, err);
        Swal.fire('خطأ!', err.message, 'error');
        throw err;
    }
};

const safeFormatDate = (timestampInSeconds) => {
    if (!timestampInSeconds || typeof timestampInSeconds !== 'number' || timestampInSeconds <= 0) {
        return "تاريخ غير صالح";
    }
    const date = new Date(timestampInSeconds * 1000);
    if (isNaN(date.getTime())) {
        return "تاريخ غير صالح";
    }
    return date.toLocaleString('ar-EG', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
    });
};


function initializeAdminPanel() {
    Object.assign(ui, {
        userForm: document.getElementById('userForm'), nameInput: document.getElementById('nameInput'), pointsInput: document.getElementById('pointsInput'), stockTrendInput: document.getElementById('stockTrendInput'), originalNameInput: document.getElementById('originalNameInput'), saveUserBtn: document.getElementById('saveUserBtn'), clearFormBtn: document.getElementById('clearFormBtn'), formTitle: document.getElementById('form-title'), tableBody: document.getElementById('admin-table-body'),
        avatarUrlInput: document.getElementById('avatarUrlInput'),
        pendingUsersTable: document.getElementById('pending-users-table-body'), pendingCountBadge: document.getElementById('pending-count'), approvedUsersTable: document.getElementById('approved-users-table-body'), bannedUsersTable: document.getElementById('banned-users-table'), candidatesManagementTable: document.getElementById('candidates-management-table'),
        giftRequestsTable: document.getElementById('gift-requests-table-body'),
        addCandidateForm: document.getElementById('addCandidateForm'),
        announcementForm: document.getElementById('announcementForm'), announcementsList: document.getElementById('announcements-list'), honorRollForm: document.getElementById('honorRollForm'), honorRollList: document.getElementById('honorRollList'),
        activityLogList: document.getElementById('activityLogList'), investmentLogList: document.getElementById('investment-log-list'), activeUsersList: document.getElementById('active-users-list'),
        spinWheelSettingsForm: document.getElementById('spin-wheel-settings-form'), spinWheelEnabledToggle: document.getElementById('spin-wheel-enabled-toggle'), spinCooldownHours: document.getElementById('spin-cooldown-hours'), spinMaxAttempts: document.getElementById('spin-max-attempts'), spinMaxAccumulation: document.getElementById('spin-max-accumulation'), spinPurchaseLimit: document.getElementById('spin-purchase-limit'), prizesContainer: document.getElementById('prizes-container'), addPrizeBtn: document.getElementById('add-prize-btn'), resetAllSpinsBtn: document.getElementById('resetAllSpinsBtn'),
        investmentSettingsForm: document.getElementById('investment-settings-form'),
        maxInvestmentsInput: document.getElementById('max-investments-input'),
        investmentLockHoursInput: document.getElementById('investment-lock-hours-input'),
        addProductForm: document.getElementById('add-product-form'), shopProductsList: document.getElementById('shop-products-list'), addSpinProductForm: document.getElementById('add-spin-product-form'), shopSpinProductsList: document.getElementById('shop-spin-products-list'), addPointsProductForm: document.getElementById('add-points-product-form'), shopPointsProductsList: document.getElementById('shop-points-products-list'),
        addAvatarForm: document.getElementById('add-avatar-form'),
        shopAvatarsList: document.getElementById('shop-avatars-list'),
        contestSettingsForm: document.getElementById('contest-settings-form'),
        contestEnabledToggle: document.getElementById('contest-enabled-toggle'),
        winnerPointsRewardInput: document.getElementById('winner-points-reward-input'),
        voterSpRewardInput: document.getElementById('voter-sp-reward-input'),
    });
    db = firebase.database();
    firebase.auth().signInWithCustomToken(sessionStorage.getItem('firebaseToken')).then(initializeDataListeners).catch(e => console.error("Admin Auth Error:", e));
    setupEventListeners();
}

function initializeDataListeners() {
    const onValue = (path, callback) => db.ref(path).on('value', s => callback(s.val() || {}), e => console.error(`Read error at ${path}:`, e));
    onValue('users', data => { usersCache = data; renderUserTable(); });
    onValue('investments', data => { investmentsCache = data; renderUserTable(); });
    onValue('candidates', renderCandidatesManagement); onValue('banned_users', renderBannedUsers); onValue('site_settings/announcements', renderAnnouncements); onValue('site_settings/honor_roll', renderHonorRoll);
    onValue('site_settings/investment_settings', loadInvestmentSettings);
    onValue('site_settings/spin_wheel_settings', loadSpinWheelSettings);
    onValue('site_settings/shop_products', renderShopProducts); onValue('site_settings/shop_products_spins', renderShopSpinProducts); onValue('site_settings/shop_products_points', renderShopPointsProducts);
    onValue('site_settings/shop_avatars', data => { renderShopAvatars(data); populateCrawlerAvatarDropdown(data); });
    onValue('registered_users', data => { initializeApprovalPanel(data); initializeApprovedUsersPanel(data); });
    onValue('gift_requests', renderGiftRequestsTable);
    onValue('site_settings/contest_settings', loadContestSettings);
    db.ref('activity_log').orderByChild('timestamp').limitToLast(50).on('value', s => renderGeneralActivityLog(Object.values(s.val() || {}).reverse()));
    db.ref('investment_log').orderByChild('timestamp').limitToLast(100).on('value', s => renderInvestmentLog(Object.values(s.val() || {}).reverse()));
    onValue('online_visitors', renderActiveUsers);
}

function renderGiftRequestsTable(requests) {
    if (!ui.giftRequestsTable) return;
    const requestsArray = Object.entries(requests).filter(([id, req]) => req.status === 'pending');
    if (requestsArray.length === 0) {
        ui.giftRequestsTable.innerHTML = '<tr><td colspan="5" class="text-center text-muted p-3">لا توجد طلبات إهداء حالياً.</td></tr>';
        return;
    }
    ui.giftRequestsTable.innerHTML = requestsArray.map(([id, req]) => `
        <tr>
            <td>${req.gifter_name}</td>
            <td>${req.target_user_name}</td>
            <td>
                <img src="${req.avatar_image_url}" class="avatar-preview me-2" alt="${req.avatar_name}">
                ${req.avatar_name}
            </td>
            <td class="text-center">${formatNumber(req.price_sp)} SP</td>
            <td class="text-center">
                <button class="btn btn-sm btn-success" onclick="adminActions.handleGiftRequest('${id}', 'approve', this)">قبول</button>
                <button class="btn btn-sm btn-danger ms-2" onclick="adminActions.handleGiftRequest('${id}', 'reject', this)">رفض</button>
            </td>
        </tr>
    `).join('');
}


function populateCrawlerAvatarDropdown(avatars) {
    if (!ui.avatarUrlInput) return;
    const currentSelection = ui.avatarUrlInput.value;
    ui.avatarUrlInput.innerHTML = '<option value="">-- بلا أفاتار --</option>';
    Object.values(avatars).forEach(avatar => {
        const option = new Option(`${avatar.name}`, avatar.image_url);
        ui.avatarUrlInput.add(option);
    });
    ui.avatarUrlInput.value = currentSelection;
}

function setupEventListeners() {
    const listen = (el, event, handler) => el?.addEventListener(event, handler);
    listen(ui.userForm, "submit", handleUserFormSubmit);
    listen(ui.clearFormBtn, "click", resetUserForm);
    listen(ui.addCandidateForm, 'submit', handleAddCandidate);
    listen(ui.announcementForm, 'submit', e => { e.preventDefault(); apiCall('/api/admin/announcements/add', { method: 'POST', body: new FormData(e.target) }, 'تم إضافة الإعلان.').then(() => e.target.reset()); });
    listen(ui.honorRollForm, 'submit', e => { e.preventDefault(); apiCall('/api/admin/honor_roll/add', { method: 'POST', body: new FormData(e.target) }, 'تمت الإضافة للقائمة.').then(() => e.target.reset()); });
    listen(ui.addPrizeBtn, 'click', () => addPrizeRow());
    listen(ui.spinWheelSettingsForm, 'submit', handleSpinWheelSettingsSubmit);
    listen(ui.investmentSettingsForm, 'submit', handleInvestmentSettingsSubmit);
    listen(ui.addProductForm, 'submit', e => handleShopProductForm(e, '/api/admin/shop/add_product'));
    listen(ui.addSpinProductForm, 'submit', e => handleShopProductForm(e, '/api/admin/shop/add_spin_product'));
    listen(ui.addPointsProductForm, 'submit', e => handleShopProductForm(e, '/api/admin/shop/add_points_product'));
    listen(ui.resetAllSpinsBtn, 'click', () => Swal.fire({ title: 'هل أنت متأكد؟', text: "سيتم إعادة تعيين المحاولات المجانية لليوم لجميع المستخدمين المعتمدين.", icon: 'warning', showCancelButton: true, confirmButtonText: "نعم, أعد التعيين!" }).then(r => r.isConfirmed && apiCall('/api/admin/reset_all_free_spins', { method: 'POST' }, "تمت إعادة التعيين بنجاح!")));
    listen(ui.addAvatarForm, 'submit', handleAddAvatar);
    listen(ui.contestSettingsForm, 'submit', handleContestSettingsSubmit);
}

function loadContestSettings(data) {
    if (ui.contestEnabledToggle) {
        ui.contestEnabledToggle.checked = data.is_enabled || false;
    }
    if (ui.winnerPointsRewardInput) {
        ui.winnerPointsRewardInput.value = data.winner_points_reward || 0;
    }
    if (ui.voterSpRewardInput) {
        ui.voterSpRewardInput.value = data.voter_sp_reward || 0;
    }
}

async function handleContestSettingsSubmit(e) {
    e.preventDefault();
    const settings = {
        is_enabled: ui.contestEnabledToggle.checked,
        winner_points_reward: parseInt(ui.winnerPointsRewardInput.value) || 0,
        voter_sp_reward: parseInt(ui.voterSpRewardInput.value) || 0
    };
    await apiCall('/api/admin/settings/contest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    }, 'تم حفظ إعدادات المنافسة!');
}

function loadInvestmentSettings(data) {
    if (ui.maxInvestmentsInput) {
        ui.maxInvestmentsInput.value = data.max_investments || '';
    }
    if (ui.investmentLockHoursInput) {
        ui.investmentLockHoursInput.value = data.investment_lock_hours || '';
    }
}

async function handleInvestmentSettingsSubmit(e) {
    e.preventDefault();
    const maxInvestments = ui.maxInvestmentsInput.value;
    const lockHours = ui.investmentLockHoursInput.value;
    const settings = {
        max_investments: parseInt(maxInvestments) || 0,
        investment_lock_hours: parseInt(lockHours) || 0,
    };
    await apiCall('/api/admin/settings/investment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    }, 'تم حفظ إعدادات الاستثمار!');
}

function renderShopAvatars(data) {
    if (!ui.shopAvatarsList) return;
    ui.shopAvatarsList.innerHTML = Object.entries(data).map(([id, avatar]) => `
        <tr>
            <td><img src="${avatar.image_url}" alt="${avatar.name}" class="avatar-preview"></td>
            <td>${avatar.name}</td>
            <td>${formatNumber(avatar.price_sp_personal || 0)} / ${formatNumber(avatar.price_sp_gift || 0)} SP</td>
            <td><button class="btn btn-sm btn-outline-danger" onclick="adminActions.deleteAvatar('${id}')"><i class="bi bi-trash"></i></button></td>
        </tr>
    `).join('') || '<tr><td colspan="4" class="text-center text-muted p-3">لا توجد أفاتارات.</td></tr>';
}

async function handleAddAvatar(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> جارِ الرفع...`;
    try {
        await apiCall('/api/admin/shop/add_avatar', { method: 'POST', body: new FormData(form) }, 'تمت إضافة الأفاتار بنجاح!');
        form.reset();
    } catch (err) {
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

async function handleAddCandidate(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    if (!form.name.value.trim()) return;
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
    try {
        await apiCall('/api/admin/candidate/add', { method: 'POST', body: new FormData(form) }, 'تمت إضافة المرشح.');
        form.reset();
    } catch (err) { }
    finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

const renderListItem = (id, text, deleteFnName) => `<li class="list-group-item d-flex justify-content-between align-items-center">${text}<button class="btn btn-sm btn-outline-danger" onclick="window.adminActions.${deleteFnName}('${id}')"><i class="bi bi-trash"></i></button></li>`;
const renderShopProducts = data => ui.shopProductsList.innerHTML = Object.entries(data).map(([id, p]) => renderListItem(id, `حزمة ${formatNumber(p.sp_amount)} SP مقابل ${formatNumber(p.cc_price)} CC`, 'deleteProduct')).join('') || '<li class="list-group-item text-muted">لا توجد منتجات.</li>';
const renderShopSpinProducts = data => ui.shopSpinProductsList.innerHTML = Object.entries(data).map(([id, p]) => renderListItem(id, `${formatNumber(p.attempts_amount)} محاولات مقابل ${formatNumber(p.sp_price)} SP`, 'deleteSpinProduct')).join('') || '<li class="list-group-item text-muted">لا توجد منتجات.</li>';
const renderShopPointsProducts = data => ui.shopPointsProductsList.innerHTML = Object.entries(data).map(([id, p]) => renderListItem(id, `منتج ${p.type === 'raise' ? 'رفع' : 'إسقاط'} (${formatNumber(p.points_amount)} نقطة) / ${formatNumber(p.sp_price)} SP`, 'deletePointsProduct')).join('') || '<li class="list-group-item text-muted">لا توجد منتجات.</li>';
const renderAnnouncements = data => ui.announcementsList.innerHTML = Object.entries(data).map(([id, ann]) => renderListItem(id, `"${ann.text}"`, 'deleteAnnouncement')).join('') || '<li class="list-group-item text-muted">لا توجد إعلانات.</li>';
const renderHonorRoll = data => ui.honorRollList.innerHTML = Object.entries(data).map(([id, item]) => renderListItem(id, item.name, 'deleteFromHonorRoll')).join('') || '<li class="list-group-item text-muted">القائمة فارغة.</li>';

function renderUserTable() {
    if (!ui.tableBody) return;
    const countInvestorsForCrawler = (crawlerName) => {
        let count = 0;
        for (const investorId in investmentsCache) {
            if (investmentsCache[investorId] && investmentsCache[investorId][crawlerName]) {
                count++;
            }
        }
        return count;
    };
    const usersArray = Object.entries(usersCache).map(([key, value]) => ({ ...value, name: key })).sort((a, b) => (b.points || 0) - (a.points || 0));
    ui.tableBody.innerHTML = usersArray.map((user, index) => {
        const investorCount = countInvestorsForCrawler(user.name);
        const multiplier = parseFloat(user.stock_multiplier || 1.0);
        const mClass = multiplier > 1.0 ? 'trend-up' : multiplier < 1.0 ? 'trend-down' : 'trend-neutral';
        const mText = `x${multiplier.toFixed(2)}`;
        const avatarImg = user.avatar_url ? `<img src="${user.avatar_url}" class="avatar-preview me-2">` : `<span class="avatar-preview d-inline-block me-2" style="background-color: var(--card-border);"></span>`;
        return `<tr>
                    <th class="align-middle rank">#${index + 1}</th>
                    <td class="align-middle fw-bold">${avatarImg}${user.name}</td>
                    <td class="text-center align-middle">${formatNumber(user.points)}</td>
                    <td class="text-center align-middle ${mClass}">${mText}</td>
                    <td class="text-center align-middle"><i class="bi bi-heart-fill text-danger"></i> ${formatNumber(user.likes || 0)}</td>
                    <td class="text-center align-middle"><i class="bi bi-people-fill text-primary"></i> ${investorCount}</td>
                    <td class="text-center align-middle">
                        <button class="btn btn-info btn-sm" onclick="adminActions.editUser('${user.name}')"><i class="bi bi-pencil-fill"></i></button>
                        <button class="btn btn-danger btn-sm ms-2" onclick="adminActions.confirmDelete('${user.name}')"><i class="bi bi-trash-fill"></i></button>
                    </td>
                </tr>`;
    }).join('') || '<tr><td colspan="7" class="text-center py-4">لا يوجد زواحف.</td></tr>';
}
function initializeApprovalPanel(allUsers) { const pending = Object.entries(allUsers).filter(([id, data]) => data.status === "pending"); ui.pendingCountBadge.textContent = pending.length; ui.pendingCountBadge.style.display = pending.length > 0 ? "inline" : "none"; ui.pendingUsersTable.innerHTML = pending.length === 0 ? '<tr><td colspan="3" class="text-center py-4">لا توجد طلبات.</td></tr>' : pending.map(([id, data]) => `<tr><td>${data.name}</td><td>${data.email}</td><td class="text-center"><button class="btn btn-sm btn-success" onclick="adminActions.manageUser('${id}','approve',this)">قبول</button><button class="btn btn-sm btn-danger ms-2" onclick="adminActions.manageUser('${id}','reject',this)">رفض</button></td></tr>`).join(''); }
function initializeApprovedUsersPanel(allUsers) {
    ui.approvedUsersTable.innerHTML = Object.values(allUsers).filter(u => u.status === "approved").sort((a, b) => (b.registered_at || 0) - (a.registered_at || 0)).map(user => {
        const regDate = safeFormatDate(user.registered_at);
        const roleBadge = user.role === 'admin' ? '<span class="badge bg-danger">أدمن</span>' : '<span class="badge bg-secondary">مستخدم</span>';
        const actions = `
            <button class="btn btn-outline-success btn-sm" onclick="adminActions.editUserWallet('${user.uid}','${user.name}')" title="تعديل المحفظة"><i class="bi bi-wallet2"></i></button>
            <button class="btn btn-outline-info btn-sm" onclick="adminActions.manageUserAvatars('${user.uid}','${user.name}')" title="إدارة أفاتارات المستخدم"><i class="bi bi-person-bounding-box"></i></button>
            <button class="btn btn-outline-warning btn-sm" onclick="adminActions.editPurchasedAttempts('${user.uid}','${user.name}')" title="تعديل المحاولات المشتراة"><i class="bi bi-ticket-perforated-fill"></i></button>
            <button class="btn btn-outline-danger btn-sm" onclick="adminActions.confirmBanUser('${user.uid}','${user.name}')" title="حظر المستخدم"><i class="bi bi-slash-circle-fill"></i></button>`;
        return `<tr><td>${user.name}</td><td>${user.email}</td><td class="text-center">${roleBadge}</td><td class="text-center">${regDate}</td><td class="text-center d-flex justify-content-center gap-2">${actions}</td></tr>`
    }).join('') || '<tr><td colspan="5" class="text-center py-4">لا توجد حسابات.</td></tr>'
}
function renderBannedUsers(data) { ui.bannedUsersTable.innerHTML = Object.entries(data).map(([id, u]) => `<tr><td>${u.name}</td><td>${safeFormatDate(u.timestamp)}</td><td class="text-center"><button class="btn btn-sm btn-success" onclick="adminActions.unbanUser('${id}')">فك الحظر</button></td></tr>`).join('') || '<tr><td colspan="3" class="text-center text-muted py-3">لا يوجد محظورون.</td></tr>'; }
function renderCandidatesManagement(data) { ui.candidatesManagementTable.innerHTML = Object.keys(data).map(name => `<tr><td>${name}</td><td class="text-center"><button class="btn btn-sm btn-success" onclick="adminActions.approveCandidate('${name}')">موافقة</button><button class="btn btn-sm btn-danger ms-2" onclick="adminActions.rejectCandidate('${name}')">رفض</button></td></tr>`).join('') || '<tr><td colspan="2" class="text-center text-muted py-3">لا يوجد ترشيحات حالياً.</td></tr>'; }
function renderGeneralActivityLog(logs) { ui.activityLogList.innerHTML = logs.map(log => { const d = safeFormatDate(log.timestamp); const i = { like: "bi-heart-fill text-danger", nomination: "bi-person-up text-info", report: "bi-exclamation-triangle-fill text-warning", invest: "bi-graph-up-arrow text-success", sell: "bi-cash-coin text-primary", gift: "bi-gift-fill text-warning", admin_edit: "bi-pencil-fill text-info", item_effect_raise: "bi-arrow-up-circle-fill text-success", item_effect_drop: "bi-arrow-down-circle-fill text-danger" }[log.type] || "bi-info-circle-fill"; const a = log.user_id && log.user_name ? `<div class="ms-auto ps-3"><button class="btn btn-outline-info btn-sm" onclick="adminActions.sendUserMessage('${log.user_id}','${log.user_name}')"><i class="bi bi-chat-dots-fill"></i></button></div>` : ''; return `<li class="list-group-item d-flex align-items-center"><div><i class="bi ${i} me-2"></i><span>${log.text}</span><small class="text-muted d-block mt-1">${d}</small></div>${a}</li>`; }).join('') || '<li class="list-group-item text-muted">لا يوجد نشاط.</li>'; }
function renderInvestmentLog(logs) { ui.investmentLogList.innerHTML = logs.map(log => { const d = safeFormatDate(log.timestamp); const aC = log.action === 'invest' ? 'text-success' : 'text-danger'; const aI = log.action === 'invest' ? 'bi-arrow-up' : 'bi-arrow-down'; return `<li class="list-group-item"><strong>${log.investor_name}</strong> <span class="${aC}"><i class="bi ${aI}"></i> ${log.action === 'invest' ? 'استثمر' : 'باع'} ${log.sp_amount.toFixed(2)} SP</span> في <strong>${log.target_name}</strong><br><small class="text-muted">${d}</small></li>`; }).join('') || '<li class="list-group-item text-muted">لا يوجد سجل استثمار.</li>'; }
function renderActiveUsers(data) { const active = Object.values(data || {}).filter(u => u.name); ui.activeUsersList.innerHTML = active.length ? active.sort((a, b) => b.online_since - a.online_since).map(u => `<li class="list-group-item"><i class="bi bi-circle-fill text-success me-2" style="font-size: 0.5rem;"></i><strong>${u.name || 'غير معروف'}</strong><small class="text-muted d-block mt-1">${safeFormatDate(u.online_since)}</small></li>`).join('') : '<li class="list-group-item text-muted">لا يوجد متصلون.</li>'; }
const addPrizeRow = (v, w) => { if (!ui.prizesContainer) return; const r = document.createElement('div'); r.className = 'row g-2 mb-2 align-items-center prize-row'; r.innerHTML = `<div class="col"><input type="number" class="form-control form-control-sm prize-value" value="${v || ''}" placeholder="CC" required></div><div class="col"><input type="number" step="0.1" class="form-control form-control-sm prize-weight" value="${w || ''}" placeholder="الوزن" required></div><div class="col-auto"><button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.prize-row').remove()">×</button></div>`; ui.prizesContainer.appendChild(r); };
function loadSpinWheelSettings(data) { if (!ui.spinWheelSettingsForm) return; ui.spinWheelEnabledToggle.checked = data.enabled || !1; ui.spinCooldownHours.value = data.cooldownHours || 24; ui.spinMaxAttempts.value = data.maxAttempts || 1; ui.spinMaxAccumulation.value = data.maxAccumulation || 10; ui.spinPurchaseLimit.value = data.purchaseLimit || 20; ui.prizesContainer.innerHTML = ''; (data.prizes && data.prizes.length ? data.prizes : [{ value: 100, weight: 1 }]).forEach(p => addPrizeRow(p.value, p.weight)) }
async function handleUserFormSubmit(e) { e.preventDefault(); const btn = ui.saveUserBtn; btn.disabled = true; btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`; try { await apiCall('/api/admin/add_user', { method: 'POST', body: new FormData(e.target) }, 'تم حفظ البيانات.'); resetUserForm(); } catch (err) { } finally { btn.disabled = false; btn.innerHTML = ui.originalNameInput.value ? 'حفظ التعديل' : 'إضافة'; } }
function resetUserForm() { if (ui.userForm) { ui.userForm.reset(); ui.originalNameInput.value = ''; ui.formTitle.innerText = 'إضافة/تعديل زاحف'; ui.saveUserBtn.innerText = 'إضافة'; ui.saveUserBtn.classList.replace('btn-warning', 'btn-primary'); ui.clearFormBtn.style.display = 'none'; } }
async function handleSpinWheelSettingsSubmit(e) { e.preventDefault(); const settings = { enabled: ui.spinWheelEnabledToggle.checked, cooldownHours: parseInt(ui.spinCooldownHours.value), maxAttempts: parseInt(ui.spinMaxAttempts.value), maxAccumulation: parseInt(ui.spinMaxAccumulation.value), purchaseLimit: parseInt(ui.spinPurchaseLimit.value), prizes: Array.from(ui.prizesContainer.querySelectorAll('.prize-row')).map(r => ({ value: r.querySelector('.prize-value').value, weight: r.querySelector('.prize-weight').value })).filter(p => p.value && p.weight) }; await apiCall('/api/admin/settings/spin_wheel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }, 'تم حفظ إعدادات العجلة!'); }
async function handleShopProductForm(e, url) { e.preventDefault(); await apiCall(url, { method: 'POST', body: new FormData(e.target) }, "تمت إضافة المنتج!").then(() => e.target.reset()).catch(() => { }); }

window.adminActions = {
    editUser: (name) => {
        const u = usersCache[name];
        if (u) {
            ui.nameInput.value = name;
            ui.pointsInput.value = u.points || 0;
            ui.stockTrendInput.value = u.stock_trend || 0;
            ui.originalNameInput.value = name;
            ui.avatarUrlInput.value = u.avatar_url || "";
            ui.formTitle.innerText = `تعديل: ${name}`;
            ui.saveUserBtn.innerText = 'حفظ';
            ui.saveUserBtn.classList.replace('btn-primary', 'btn-warning');
            ui.clearFormBtn.style.display = 'inline-block';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    },
    confirmDelete: name => Swal.fire({ title: `حذف ${name}؟`, icon: 'warning', showCancelButton: true, confirmButtonText: 'نعم, احذف' }).then(r => r.isConfirmed && apiCall(`/api/admin/delete_user/${name}`, { method: 'POST' }, 'تم الحذف.')),
    manageUser: (id, action, btn) => { btn.disabled = true; apiCall(`/api/admin/manage_user/${id}/${action}`, { method: 'POST' }, `تم ${action === 'approve' ? 'قبول' : 'رفض'} المستخدم.`).catch(() => btn.disabled = false) },
    confirmBanUser: (id, name) => Swal.fire({ title: `حظر ${name}؟`, icon: 'warning', showCancelButton: true, confirmButtonText: 'نعم, قم بالحظر' }).then(r => r.isConfirmed && apiCall('/api/admin/ban_user', { method: 'POST', body: new URLSearchParams({ user_id_to_ban: id, user_name_to_ban: name }) }, `تم حظر ${name}.`)),
    unbanUser: id => apiCall(`/api/admin/unban_user/${id}`, { method: 'POST' }, 'تم فك الحظر.'),
    approveCandidate: name => apiCall('/api/admin/candidate/approve', { method: 'POST', body: new URLSearchParams({ name }) }),
    rejectCandidate: name => apiCall('/api/admin/candidate/reject', { method: 'POST', body: new URLSearchParams({ name }) }),
    deleteAnnouncement: id => apiCall(`/api/admin/announcements/delete/${id}`, { method: 'POST' }),
    deleteFromHonorRoll: id => apiCall(`/api/admin/honor_roll/delete/${id}`, { method: 'POST' }),
    deleteProduct: id => apiCall(`/api/admin/shop/delete_product/${id}`, { method: 'POST' }),
    deleteSpinProduct: id => apiCall(`/api/admin/shop/delete_spin_product/${id}`, { method: 'POST' }),
    deletePointsProduct: id => apiCall(`/api/admin/shop/delete_points_product/${id}`, { method: 'POST' }),
    deleteAvatar: id => { Swal.fire({ title: 'هل أنت متأكد؟', text: "سيتم حذف الأفاتار نهائياً من المتجر والتخزين!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'نعم, احذفه!', cancelButtonText: 'إلغاء' }).then(result => { if (result.isConfirmed) { apiCall(`/api/admin/shop/delete_avatar/${id}`, { method: 'POST' }, 'تم حذف الأفاتار.'); } }); },
    manageUserAvatars: async (userId, userName) => { Swal.fire({ title: `جلب أفاتارات ${userName}...`, didOpen: () => Swal.showLoading() }); try { const ownedAvatarsSnap = await db.ref(`user_avatars/${userId}/owned`).once('value'); const ownedAvatars = ownedAvatarsSnap.val() || {}; const avatarIds = Object.keys(ownedAvatars); if (avatarIds.length === 0) { Swal.fire('فارغ', `المستخدم ${userName} لا يمتلك أي أفاتارات.`, 'info'); return; } const allAvatarsSnap = await db.ref('site_settings/shop_avatars').once('value'); const allAvatars = allAvatarsSnap.val() || {}; const listHtml = avatarIds.map(id => { const avatar = allAvatars[id]; if (!avatar) return ''; return ` <li class="list-group-item d-flex justify-content-between align-items-center" id="user-avatar-li-${id}"> <div> <img src="${avatar.image_url}" class="avatar-preview me-2"> <span>${avatar.name}</span> </div> <button class="btn btn-sm btn-outline-danger" data-avatar-id="${id}" data-avatar-name="${avatar.name}">إزالة</button> </li> `; }).join(''); Swal.fire({ title: `أفاتارات ${userName}`, html: `<ul class="list-group" style="max-height: 40vh; overflow-y: auto;">${listHtml}</ul>`, width: '500px', didOpen: () => { document.querySelectorAll('.swal2-container .btn-outline-danger').forEach(btn => { btn.addEventListener('click', (e) => { const avatarId = e.currentTarget.dataset.avatarId; const avatarName = e.currentTarget.dataset.avatarName; Swal.fire({ title: `تأكيد الإزالة`, text: `هل أنت متأكد من إزالة أفاتار "${avatarName}" من المستخدم ${userName}؟`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'نعم، قم بالإزالة!', cancelButtonText: 'إلغاء' }).then(async (result) => { if (result.isConfirmed) { try { await apiCall('/api/admin/user_avatar/remove', { method: 'POST', body: new URLSearchParams({ user_id: userId, avatar_id: avatarId }) }, `تمت إزالة الأفاتار.`); document.getElementById(`user-avatar-li-${id}`).remove(); } catch (err) { } } }); }); }); } }); } catch (error) { console.error("Error fetching user avatars:", error); Swal.fire('خطأ', 'فشل في جلب بيانات أفاتارات المستخدم.', 'error'); } },
    handleGiftRequest: (requestId, action, btn) => {
        btn.disabled = true;
        const otherBtn = action === 'approve' ? btn.nextElementSibling : btn.previousElementSibling;
        if (otherBtn) otherBtn.disabled = true;
        apiCall(`/api/admin/gift_request/${requestId}/${action}`, { method: 'POST' }).then(response => { Swal.fire('تم!', response.message, 'success'); }).catch(err => { btn.disabled = false; if (otherBtn) otherBtn.disabled = false; });
    },
    sendUserMessage: async (id, name) => { const { value: msg } = await Swal.fire({ title: `رسالة إلى ${name}`, input: 'textarea', inputPlaceholder: 'اكتب رسالتك هنا...' }); if (msg) apiCall('/api/admin/user_message/send', { method: 'POST', body: new URLSearchParams({ user_id: id, message: msg }) }) },
    editUserWallet: async (id, name) => {
        const walletSnapshot = await db.ref(`wallets/${id}`).once('value');
        const wallet = walletSnapshot.val() || { cc: 0, sp: 0 };
        const { value: formValues } = await Swal.fire({
            title: `تعديل محفظة ${name}`,
            html: `
                <label for="swal-cc" class="swal2-label">زاحف كوين (CC)</label>
                <input id="swal-cc" type="number" class="swal2-input" value="${wallet.cc || 0}">
                <label for="swal-sp" class="swal2-label">نقاط الدعم (SP)</label>
                <input id="swal-sp" type="number" step="0.01" class="swal2-input" value="${(wallet.sp || 0).toFixed(2)}">
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'حفظ التغييرات',
            cancelButtonText: 'إلغاء',
            preConfirm: () => ({
                cc: document.getElementById('swal-cc').value,
                sp: document.getElementById('swal-sp').value
            })
        });
        if (formValues) {
            apiCall('/api/admin/update_wallet', {
                method: 'POST',
                body: new URLSearchParams({
                    user_id: id,
                    user_name: name,
                    cc: formValues.cc,
                    sp: formValues.sp
                })
            }, 'تم تحديث المحفظة بنجاح.');
        }
    },
    editPurchasedAttempts: async (id, name) => { const state = (await db.ref(`user_spin_state/${id}`).once('value')).val() || {}; const current = state.purchasedAttempts || 0; const { value: newVal } = await Swal.fire({ title: `تعديل محاولات ${name}`, input: 'number', inputValue: current }); if (newVal !== undefined && newVal !== null) { apiCall('/api/admin/update_purchased_attempts', { method: 'POST', body: new URLSearchParams({ user_id: id, attempts: newVal }) }, 'تم تحديث الرصيد.') } }
};