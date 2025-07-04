// --- START OF FILE static/js/admin.js ---

function enforceEnglishNumbers() {
    const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    const englishNumerals = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

    document.querySelectorAll('input[type="number"]').forEach(input => {
        input.addEventListener('input', (event) => {
            let value = event.target.value;
            let originalValue = value;

            for (let i = 0; i < arabicNumerals.length; i++) {
                const regex = new RegExp(arabicNumerals[i], 'g');
                value = value.replace(regex, englishNumerals[i]);
            }

            if (value !== originalValue) {
                event.target.value = value;
            }
        });
    });
    console.log("English number enforcement has been applied to all number inputs.");
}


let isDomReady = false, isFirebaseReady = false;
function tryToStartApp() { if (isDomReady && isFirebaseReady) initializeAdminPanel(); }
document.addEventListener('DOMContentLoaded', () => { isDomReady = true; tryToStartApp(); });
document.addEventListener('firebase-ready', () => { isFirebaseReady = true; tryToStartApp(); });

const ui = {};
let db, usersCache = {};
let investmentsCache = {};
let registeredUsersCache = {};

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

function renderUserTable() {
    if (!ui.tableBody) return;

    const searchTerm = ui.crawlerSearchInput ? ui.crawlerSearchInput.value.toLowerCase() : '';

    const countInvestorsForCrawler = (crawlerName) => {
        let count = 0;
        for (const investorId in investmentsCache) {
            if (investmentsCache[investorId] && investmentsCache[investorId][crawlerName]) {
                count++;
            }
        }
        return count;
    };

    const usersArray = Object.entries(usersCache)
        .map(([key, value]) => ({ ...value, name: key }))
        .filter(user => user.name.toLowerCase().includes(searchTerm))
        .sort((a, b) => (b.points || 0) - (a.points || 0));

    if (!Array.isArray(usersArray)) {
        ui.tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">خطأ في تحميل بيانات المستخدمين.</td></tr>';
        return;
    }

    const tableRowsHtml = usersArray.map((user, index) => {
        const investorCount = countInvestorsForCrawler(user.name);
        const multiplier = parseFloat(user.stock_multiplier || 1.0);
        const mClass = multiplier > 1.0 ? 'trend-up' : multiplier < 1.0 ? 'trend-down' : 'trend-neutral';
        const mText = `x${multiplier.toFixed(2)}`;
        const avatarImg = user.avatar_url ? `<img src="${user.avatar_url}" class="avatar-preview me-2">` : `<span class="avatar-preview d-inline-block me-2" style="background-color: var(--card-border);"></span>`;

        const actionButtons = `
            <div class="btn-group btn-group-sm" role="group">
                <button class="btn btn-primary" data-action="show-investors" data-username="${user.name}" title="عرض المستثمرين"><i class="bi bi-people-fill"></i></button>
                <button class="btn btn-warning" data-action="show-profit-editor" data-username="${user.name}" title="تعديل أرباح المستثمرين"><i class="bi bi-sliders"></i></button>
                <button class="btn btn-success" data-action="adjust-points-percent" data-direction="increase" data-username="${user.name}" title="رفع النقاط بنسبة"><i class="bi bi-graph-up-arrow"></i></button>
                <button class="btn btn-danger" data-action="adjust-points-percent" data-direction="decrease" data-username="${user.name}" title="خفض النقاط بنسبة"><i class="bi bi-graph-down-arrow"></i></button>
                <button class="btn btn-info" data-action="edit-user" data-username="${user.name}" title="تعديل بيانات الزاحف"><i class="bi bi-pencil-fill"></i></button>
                <button class="btn btn-outline-danger" data-action="delete-user" data-username="${user.name}" title="حذف الزاحف"><i class="bi bi-trash-fill"></i></button>
            </div>
        `;

        return `
            <tr>
                <th class="align-middle rank">#${index + 1}</th>
                <td class="align-middle fw-bold">${avatarImg}${user.name}</td>
                <td class="text-center align-middle">${formatNumber(user.points)}</td>
                <td class="text-center align-middle ${mClass}">${mText}</td>
                <td class="text-center align-middle"><i class="bi bi-heart-fill text-danger"></i> ${formatNumber(user.likes || 0)}</td>
                <td class="text-center align-middle"><i class="bi bi-people-fill text-primary"></i> ${investorCount}</td>
                <td class="text-center align-middle">${actionButtons}</td>
            </tr>
        `;
    }).join('');

    ui.tableBody.innerHTML = tableRowsHtml || `<tr><td colspan="7" class="text-center py-4">${searchTerm ? 'لا يوجد زاحف يطابق البحث.' : 'لا يوجد زواحف.'}</td></tr>`;
}

function initializeApprovalPanel(allUsers) {
    const pending = Object.entries(allUsers).filter(([id, data]) => data.status === "pending");
    ui.pendingCountBadge.textContent = pending.length;
    ui.pendingCountBadge.style.display = pending.length > 0 ? "inline" : "none";
    ui.pendingUsersTable.innerHTML = pending.length === 0 ? '<tr><td colspan="3" class="text-center py-4">لا توجد طلبات.</td></tr>'
        : pending.map(([id, data]) => `<tr>
        <td>${data.name}</td>
        <td>${data.email}</td>
        <td class="text-center">
            <button class="btn btn-sm btn-success" data-action="manage-user" data-user-id="${id}" data-user-action="approve">قبول</button>
            <button class="btn btn-sm btn-danger ms-2" data-action="manage-user" data-user-id="${id}" data-user-action="reject">رفض</button>
        </td>
       </tr>`).join('');
}

function initializeApprovedUsersPanel(allUsers) {
    const searchTerm = ui.approvedUsersSearchInput ? ui.approvedUsersSearchInput.value.toLowerCase() : '';

    const filteredUsers = Object.values(allUsers).filter(u => {
        if (!u || u.status !== "approved") {
            return false;
        }
        const nameMatch = u.name && u.name.toLowerCase().includes(searchTerm);
        const emailMatch = u.email && u.email.toLowerCase().includes(searchTerm);

        return nameMatch || emailMatch;
    });

    ui.approvedUsersTable.innerHTML = filteredUsers.sort((a, b) => (b.registered_at || 0) - (a.registered_at || 0)).map(user => {
        const regDate = safeFormatDate(user.registered_at);
        const roleBadge = user.role === 'admin' ? '<span class="badge bg-danger">أدمن</span>' : '<span class="badge bg-secondary">مستخدم</span>';
        const actions = `
            <button class="btn btn-outline-success btn-sm" data-action="edit-wallet" data-user-id="${user.uid}" data-user-name="${user.name}" title="تعديل المحفظة"><i class="bi bi-wallet2"></i></button>
            <button class="btn btn-outline-info btn-sm" data-action="manage-avatars" data-user-id="${user.uid}" data-user-name="${user.name}" title="إدارة أفاتارات المستخدم"><i class="bi bi-person-bounding-box"></i></button>
            <button class="btn btn-outline-primary btn-sm" data-action="manage-nudges" data-user-id="${user.uid}" data-user-name="${user.name}" title="إدارة نكزات المستخدم"><i class="bi bi-sticky-fill"></i></button>
            <button class="btn btn-outline-secondary btn-sm" data-action="manage-investments" data-user-id="${user.uid}" data-user-name="${user.name}" title="إدارة استثمارات المستخدم"><i class="bi bi-briefcase-fill"></i></button>
            <button class="btn btn-outline-warning btn-sm" data-action="edit-attempts" data-user-id="${user.uid}" data-user-name="${user.name}" title="تعديل المحاولات المشتراة"><i class="bi bi-ticket-perforated-fill"></i></button>
            <button class="btn btn-outline-danger btn-sm" data-action="ban-user" data-user-id="${user.uid}" data-user-name="${user.name}" title="حظر المستخدم"><i class="bi bi-slash-circle-fill"></i></button>`;
        return `<tr><td>${user.name || 'N/A'}</td><td>${user.email || 'N/A'}</td><td class="text-center">${roleBadge}</td><td class="text-center">${regDate}</td><td class="text-center d-flex justify-content-center gap-2">${actions}</td></tr>`
    }).join('') || `<tr><td colspan="5" class="text-center py-4">${searchTerm ? 'لا يوجد مستخدم يطابق البحث.' : 'لا توجد حسابات.'}</td></tr>`
}


function renderBannedUsers(data) {
    ui.bannedUsersTable.innerHTML = Object.entries(data).map(([id, u]) => `<tr>
        <td>${u.name}</td>
        <td>${safeFormatDate(u.timestamp)}</td>
        <td class="text-center">
            <button class="btn btn-sm btn-success" data-action="unban-user" data-user-id="${id}">فك الحظر</button>
        </td>
       </tr>`).join('') || '<tr><td colspan="3" class="text-center text-muted py-3">لا يوجد محظورون.</td></tr>';
}
function renderCandidatesManagement(data) {
    ui.candidatesManagementTable.innerHTML = Object.keys(data).map(name => `<tr>
        <td>${name}</td>
        <td class="text-center">
            <button class="btn btn-sm btn-success" data-action="approve-candidate" data-username="${name}">موافقة</button>
            <button class="btn btn-sm btn-danger ms-2" data-action="reject-candidate" data-username="${name}">رفض</button>
        </td>
       </tr>`).join('') || '<tr><td colspan="2" class="text-center text-muted py-3">لا يوجد ترشيحات حالياً.</td></tr>';
}

function renderWithdrawalRequestsTable(requests) {
    if (!ui.withdrawalRequestsTable) return;
    const requestsArray = Object.entries(requests || {}).filter(([id, req]) => req.status === 'pending');

    if (requestsArray.length === 0) {
        ui.withdrawalRequestsTable.innerHTML = '<tr><td colspan="5" class="text-center text-muted p-3">لا توجد طلبات سحب حالياً.</td></tr>';
        return;
    }

    ui.withdrawalRequestsTable.innerHTML = requestsArray.map(([id, req]) => `
        <tr>
            <td>${req.user_name}</td>
            <td>${req.crawler_name}</td>
            <td class="text-center text-warning fw-bold">${formatNumber(req.amount_to_withdraw)} SP</td>
            <td class="text-center">${safeFormatDate(req.timestamp)}</td>
            <td class="text-center">
                <button class="btn btn-sm btn-success" data-action="handle-withdrawal" data-request-id="${id}" data-withdrawal-action="approve">قبول</button>
                <button class="btn btn-sm btn-danger ms-2" data-action="handle-withdrawal" data-request-id="${id}" data-withdrawal-action="reject">رفض</button>
            </td>
        </tr>
    `).join('');
}

function renderGeneralActivityLog(logs) { ui.activityLogList.innerHTML = logs.map(log => { const d = safeFormatDate(log.timestamp); const i = { like: "bi-heart-fill text-danger", nomination: "bi-person-up text-info", report: "bi-exclamation-triangle-fill text-warning", invest: "bi-graph-up-arrow text-success", sell: "bi-cash-coin text-primary", gift: "bi-gift-fill text-warning", admin_edit: "bi-pencil-fill text-info", item_effect_raise: "bi-arrow-up-circle-fill text-success", item_effect_drop: "bi-arrow-down-circle-fill text-danger", gamble_win: "bi-dice-5-fill text-success", gamble_loss: "bi-dice-1-fill text-danger" }[log.type] || "bi-info-circle-fill"; const a = log.user_id && log.user_name ? `<div class="ms-auto ps-3"><button class="btn btn-outline-info btn-sm" data-action="send-message" data-user-id="${log.user_id}" data-user-name="${log.user_name}"><i class="bi bi-chat-dots-fill"></i></button></div>` : ''; return `<li class="list-group-item d-flex align-items-center"><div><i class="bi ${i} me-2"></i><span>${log.text}</span><small class="text-muted d-block mt-1">${d}</small></div>${a}</li>`; }).join('') || '<li class="list-group-item text-muted">لا يوجد نشاط.</li>'; }
function renderInvestmentLog(logs) { ui.investmentLogList.innerHTML = logs.map(log => { const d = safeFormatDate(log.timestamp); const aC = log.action === 'invest' ? 'text-success' : 'text-danger'; const aI = log.action === 'invest' ? 'bi-arrow-up' : 'bi-arrow-down'; return `<li class="list-group-item"><strong>${log.investor_name}</strong> <span class="${aC}"><i class="bi ${aI}"></i> ${log.action === 'invest' ? 'استثمر' : 'باع'} ${log.sp_amount.toFixed(2)} SP</span> في <strong>${log.target_name}</strong><br><small class="text-muted">${d}</small></li>`; }).join('') || '<li class="list-group-item text-muted">لا يوجد سجل استثمار.</li>'; }
function renderActiveUsers(data) { const active = Object.values(data || {}).filter(u => u.name); ui.activeUsersList.innerHTML = active.length ? active.sort((a, b) => b.online_since - a.online_since).map(u => `<li class="list-group-item"><i class="bi bi-circle-fill text-success me-2" style="font-size: 0.5rem;"></i><strong>${u.name || 'غير معروف'}</strong><small class="text-muted d-block mt-1">${safeFormatDate(u.online_since)}</small></li>`).join('') : '<li class="list-group-item text-muted">لا يوجد متصلون.</li>'; }
const addPrizeRow = (v, w) => { if (!ui.prizesContainer) return; const r = document.createElement('div'); r.className = 'row g-2 mb-2 align-items-center prize-row'; r.innerHTML = `<div class="col"><input type="number" class="form-control form-control-sm prize-value" value="${v || ''}" placeholder="CC" required></div><div class="col"><input type="number" step="0.1" class="form-control form-control-sm prize-weight" value="${w || ''}" placeholder="الوزن" required></div><div class="col-auto"><button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.prize-row').remove()">×</button></div>`; ui.prizesContainer.appendChild(r); };

function loadSpinWheelSettings(data) {
    if (!ui.spinWheelSettingsForm) return;
    ui.spinWheelEnabledToggle.checked = data.enabled || false;
    ui.spinCooldownHours.value = data.cooldownHours || 24;
    ui.spinMaxAttempts.value = data.maxAttempts || 1;
    ui.spinMaxAccumulation.value = data.maxAccumulation || 10;
    ui.spinPurchaseLimit.value = data.purchaseLimit || 20;
    ui.prizesContainer.innerHTML = '';
    (data.prizes && data.prizes.length ? data.prizes : [{ value: 100, weight: 1 }]).forEach(p => addPrizeRow(p.value, p.weight))
}

// <<< بداية التعديل: تحميل القيمة الجديدة >>>
function loadContestSettings(data) {
    if (!ui.contestSettingsForm) return;
    ui.contestEnabledToggle.checked = data.is_enabled || false;
    ui.winnerPointsRewardInput.value = data.winner_points_reward || 0;
    ui.voterSpRewardInput.value = data.voter_sp_reward || 0;
    ui.contestMultiplierBoostInput.value = data.multiplier_boost || 0.2;
}
// <<< نهاية التعديل >>>

function loadGamblingSettings(data) { if (ui.gamblingEnabledToggle) ui.gamblingEnabledToggle.checked = data.is_enabled || false; if (ui.gamblingMaxBetInput) ui.gamblingMaxBetInput.value = data.max_bet || 1000; if (ui.gamblingWinChanceInput) ui.gamblingWinChanceInput.value = data.win_chance_percent || 49.5; }

function loadInvestmentSettings(data) {
    if (ui.maxInvestmentsInput) ui.maxInvestmentsInput.value = data.max_investments || '0';
    if (ui.investmentLockHoursInput) ui.investmentLockHoursInput.value = data.investment_lock_hours || '0';
    if (ui.sellTaxPercentInput) ui.sellTaxPercentInput.value = data.sell_tax_percent || '0';
    if (ui.sellFeeSpInput) ui.sellFeeSpInput.value = data.sell_fee_sp || '0';
    if (ui.withdrawalApprovalLimitInput) ui.withdrawalApprovalLimitInput.value = data.withdrawal_approval_limit || '500000';
}
function renderShopAvatars(data) { if (!ui.shopAvatarsList) return; ui.shopAvatarsList.innerHTML = Object.entries(data).map(([id, avatar]) => ` <tr> <td><img src="${avatar.image_url}" alt="${avatar.name}" class="avatar-preview"></td> <td>${avatar.name}</td> <td>${formatNumber(avatar.price_sp_personal || 0)} / ${formatNumber(avatar.price_sp_gift || 0)} SP</td> <td><button class="btn btn-sm btn-outline-info" data-action="edit-avatar" data-avatar-id="${id}" data-avatar-name="${avatar.name}" data-price-personal="${avatar.price_sp_personal || 0}" data-price-gift="${avatar.price_sp_gift || 0}"><i class="bi bi-pencil"></i></button> <button class="btn btn-sm btn-outline-danger ms-1" data-action="delete-avatar" data-avatar-id="${id}"><i class="bi bi-trash"></i></button> </td> </tr> `).join('') || '<tr><td colspan="4" class="text-center text-muted p-3">لا توجد أفاتارات.</td></tr>'; }
const renderListItemWithEdit = (id, text, deleteAction, editAction, editArgs) => { const editButton = editAction ? `<button class="btn btn-sm btn-outline-info me-1" data-action="${editAction}" data-id="${id}" ${editArgs}><i class="bi bi-pencil"></i></button>` : ''; return `<li class="list-group-item d-flex justify-content-between align-items-center"> ${text} <div> ${editButton} <button class="btn btn-sm btn-outline-danger" data-action="${deleteAction}" data-id="${id}"><i class="bi bi-trash"></i></button> </div> </li>`; };
const renderShopProducts = data => ui.shopProductsList.innerHTML = Object.entries(data).map(([id, p]) => renderListItemWithEdit(id, `حزمة ${formatNumber(p.sp_amount)} SP مقابل ${formatNumber(p.cc_price)} CC`, 'delete-product', 'edit-product', `data-sp-amount="${p.sp_amount}" data-cc-price="${p.cc_price}"`)).join('') || '<li class="list-group-item text-muted">لا توجد منتجات.</li>';
const renderShopSpinProducts = data => ui.shopSpinProductsList.innerHTML = Object.entries(data).map(([id, p]) => renderListItemWithEdit(id, `${formatNumber(p.attempts_amount)} محاولات مقابل ${formatNumber(p.sp_price)} SP`, 'delete-spin-product', 'edit-spin-product', `data-attempts-amount="${p.attempts_amount}" data-sp-price="${p.sp_price}"`)).join('') || '<li class="list-group-item text-muted">لا توجد منتجات.</li>';
const renderShopPointsProducts = data => ui.shopPointsProductsList.innerHTML = Object.entries(data).map(([id, p]) => renderListItemWithEdit(id, `منتج ${p.type === 'raise' ? 'رفع' : 'إسقاط'} (${formatNumber(p.points_amount)} نقطة) / ${formatNumber(p.sp_price)} SP`, 'delete-points-product', 'edit-points-product', `data-points-amount="${p.points_amount}" data-sp-price="${p.sp_price}" data-daily-limit="${p.daily_limit}"`)).join('') || '<li class="list-group-item text-muted">لا توجد منتجات.</li>';
const renderShopNudges = data => { if (!ui.shopNudgesList) return; const nudges = Object.entries(data).map(([id, p]) => renderListItemWithEdit(id, `"${p.text.substring(0, 50)}..." - ${formatNumber(p.sp_price)} SP`, 'delete-nudge', 'edit-nudge', `data-text="${p.text.replace(/"/g, '"')}" data-price="${p.sp_price}"`)).join(''); ui.shopNudgesList.innerHTML = nudges || '<li class="list-group-item text-muted">لا توجد نكزات.</li>'; };
const renderAnnouncements = data => ui.announcementsList.innerHTML = Object.entries(data).map(([id, ann]) => renderListItemWithEdit(id, `"${ann.text}"`, 'delete-announcement')).join('') || '<li class="list-group-item text-muted">لا توجد إعلانات.</li>';
const renderHonorRoll = data => ui.honorRollList.innerHTML = Object.entries(data).map(([id, item]) => renderListItemWithEdit(id, item.name, 'delete-honor-roll')).join('') || '<li class="list-group-item text-muted">القائمة فارغة.</li>';
function renderGiftRequestsTable(requests) { if (!ui.giftRequestsTable) return; const requestsArray = Object.entries(requests).filter(([id, req]) => req.status === 'pending'); if (requestsArray.length === 0) { ui.giftRequestsTable.innerHTML = '<tr><td colspan="5" class="text-center text-muted p-3">لا توجد طلبات إهداء حالياً.</td></tr>'; return; } ui.giftRequestsTable.innerHTML = requestsArray.map(([id, req]) => ` <tr> <td>${req.gifter_name}</td> <td>${req.target_user_name}</td> <td> <img src="${req.avatar_image_url}" class="avatar-preview me-2" alt="${req.avatar_name}"> ${req.avatar_name} </td> <td class="text-center">${formatNumber(req.price_sp)} SP</td> <td class="text-center"> <button class="btn btn-sm btn-success" data-action="handle-gift" data-request-id="${id}" data-gift-action="approve">قبول</button> <button class="btn btn-sm btn-danger ms-2" data-action="handle-gift" data-request-id="${id}" data-gift-action="reject">رفض</button> </td> </tr> `).join(''); }
function populateCrawlerAvatarDropdown(avatars) { if (!ui.avatarUrlInput) return; const currentSelection = ui.avatarUrlInput.value; ui.avatarUrlInput.innerHTML = '<option value="">-- بلا أفاتار --</option>'; Object.values(avatars).forEach(avatar => { const option = new Option(`${avatar.name}`, avatar.image_url); ui.avatarUrlInput.add(option); }); ui.avatarUrlInput.value = currentSelection; }

function renderMarketWatchlist(data) {
    if (!ui.marketWatchlistBody) return;
    const watchlist = Object.entries(data || {});

    ui.watchlistCount.textContent = watchlist.length;
    ui.watchlistCount.style.display = watchlist.length > 0 ? 'inline' : 'none';

    if (watchlist.length === 0) {
        ui.marketWatchlistBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">قائمة المراقبة فارغة حالياً. كل شيء مستقر.</td></tr>';
        return;
    }

    ui.marketWatchlistBody.innerHTML = watchlist.map(([userId, item]) => {
        let reasonClass = '';
        if (item.reason.includes('ربح مفرط')) reasonClass = 'text-danger';
        if (item.reason.includes('خسارة قاسية')) reasonClass = 'text-success';

        const displayName = item.name || (registeredUsersCache[userId] ? registeredUsersCache[userId].name : userId);

        return `<tr>
                    <td>${displayName}</td>
                    <td><strong class="${reasonClass}">${item.reason}</strong><br><small class="text-muted">${item.details || ''}</small></td>
                    <td class="text-center fw-bold">${item.value || 'N/A'}</td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-outline-info" data-action="manage-investments" data-user-id="${userId}" data-user-name="${displayName}" title="إدارة استثمارات المستخدم"><i class="bi bi-briefcase-fill"></i></button>
                    </td>
                </tr>`;
    }).join('');
}

function initializeAdminPanel() {
    Object.assign(ui, {
        userForm: document.getElementById('userForm'),
        nameInput: document.getElementById('nameInput'),
        pointsInput: document.getElementById('pointsInput'),
        stockMultiplierInput: document.getElementById('stockMultiplierInput'),
        originalNameInput: document.getElementById('originalNameInput'),
        saveUserBtn: document.getElementById('saveUserBtn'),
        clearFormBtn: document.getElementById('clearFormBtn'),
        formTitle: document.getElementById('form-title'),
        tableBody: document.getElementById('admin-table-body'),
        avatarUrlInput: document.getElementById('avatarUrlInput'),
        pendingUsersTable: document.getElementById('pending-users-table-body'),
        pendingCountBadge: document.getElementById('pending-count'),
        approvedUsersTable: document.getElementById('approved-users-table-body'),
        bannedUsersTable: document.getElementById('banned-users-table'),
        candidatesManagementTable: document.getElementById('candidates-management-table'),
        giftRequestsTable: document.getElementById('gift-requests-table-body'),
        withdrawalRequestsTable: document.getElementById('withdrawal-requests-table-body'),
        addCandidateForm: document.getElementById('addCandidateForm'),
        announcementForm: document.getElementById('announcementForm'),
        announcementsList: document.getElementById('announcements-list'),
        honorRollForm: document.getElementById('honorRollForm'),
        honorRollList: document.getElementById('honorRollList'),
        activityLogList: document.getElementById('activityLogList'),
        investmentLogList: document.getElementById('investment-log-list'),
        activeUsersList: document.getElementById('active-users-list'),
        spinWheelSettingsForm: document.getElementById('spin-wheel-settings-form'),
        spinWheelEnabledToggle: document.getElementById('spin-wheel-enabled-toggle'),
        spinCooldownHours: document.getElementById('spin-cooldown-hours'),
        spinMaxAttempts: document.getElementById('spin-max-attempts'),
        spinMaxAccumulation: document.getElementById('spin-max-accumulation'),
        spinPurchaseLimit: document.getElementById('spin-purchase-limit'),
        prizesContainer: document.getElementById('prizes-container'),
        addPrizeBtn: document.getElementById('add-prize-btn'),
        resetAllSpinsBtn: document.getElementById('resetAllSpinsBtn'),
        investmentSettingsForm: document.getElementById('investment-settings-form'),
        maxInvestmentsInput: document.getElementById('max-investments-input'),
        investmentLockHoursInput: document.getElementById('investment-lock-hours-input'),
        sellTaxPercentInput: document.getElementById('sell-tax-percent-input'),
        sellFeeSpInput: document.getElementById('sell-fee-sp-input'),
        withdrawalApprovalLimitInput: document.getElementById('withdrawal-approval-limit-input'),
        addProductForm: document.getElementById('add-product-form'),
        shopProductsList: document.getElementById('shop-products-list'),
        addSpinProductForm: document.getElementById('add-spin-product-form'),
        shopSpinProductsList: document.getElementById('shop-spin-products-list'),
        addPointsProductForm: document.getElementById('add-points-product-form'),
        shopPointsProductsList: document.getElementById('shop-points-products-list'),
        addAvatarForm: document.getElementById('add-avatar-form'),
        shopAvatarsList: document.getElementById('shop-avatars-list'),
        contestSettingsForm: document.getElementById('contest-settings-form'),
        contestEnabledToggle: document.getElementById('contest-enabled-toggle'),
        winnerPointsRewardInput: document.getElementById('winner-points-reward-input'),
        voterSpRewardInput: document.getElementById('voter-sp-reward-input'),
        // <<< بداية التعديل: إضافة الحقل الجديد >>>
        contestMultiplierBoostInput: document.getElementById('contest-multiplier-boost-input'),
        // <<< نهاية التعديل >>>
        gamblingSettingsForm: document.getElementById('gambling-settings-form'),
        gamblingEnabledToggle: document.getElementById('gambling-enabled-toggle'),
        gamblingMaxBetInput: document.getElementById('gambling-max-bet-input'),
        gamblingWinChanceInput: document.getElementById('gambling-win-chance-input'),
        addNudgeForm: document.getElementById('add-nudge-form'),
        shopNudgesList: document.getElementById('shop-nudges-list'),
        stockPredictionSettingsForm: document.getElementById('stock-prediction-settings-form'),
        stockPredictionEnabledToggle: document.getElementById('stock-prediction-enabled-toggle'),
        stockPredictionMaxBetInput: document.getElementById('stock-prediction-max-bet-input'),
        stockPredictionWinChanceInput: document.getElementById('stock-prediction-win-chance-input'),
        rpsGameSettingsForm: document.getElementById('rps-game-settings-form'),
        rpsGameEnabledToggle: document.getElementById('rps-game-enabled-toggle'),
        rpsGameMaxBetInput: document.getElementById('rps-game-max-bet-input'),
        rpsGameCooldownInput: document.getElementById('rps-game-cooldown-input'),
        manageInvestmentsModal: document.getElementById('manageInvestmentsModal'),
        manageInvestmentsModalLabel: document.getElementById('manageInvestmentsModalLabel'),
        crawlerSearchInput: document.getElementById('crawlerSearchInput'),
        approvedUsersSearchInput: document.getElementById('approvedUsersSearchInput'),
        manageInvestmentsModalBody: document.getElementById('manageInvestmentsModalBody'),
        investorsModal: bootstrap.Modal.getOrCreateInstance(document.getElementById('investorsModal')),
        profitEditorModal: bootstrap.Modal.getOrCreateInstance(document.getElementById('profitEditorModal')),
        governorSettingsForm: document.getElementById('governor-settings-form'),
        governorEnabledToggle: document.getElementById('governor-enabled-toggle'),
        governorIntervalHours: document.getElementById('governor-interval-hours'),
        governorIntervalMinutes: document.getElementById('governor-interval-minutes'),
        governorIntervalSeconds: document.getElementById('governor-interval-seconds'),
        balanceProfitThreshold: document.getElementById('balance-profit-threshold'),
        balanceValueThreshold: document.getElementById('balance-value-threshold'),
        rescueWalletThreshold: document.getElementById('rescue-wallet-threshold'),
        rescueLossThreshold: document.getElementById('rescue-loss-threshold'),
        jackpotChancePercent: document.getElementById('jackpot-chance-percent'),
        jackpotMultiplier: document.getElementById('jackpot-multiplier'),
        dealBonusEnabledToggle: document.getElementById('deal-bonus-enabled-toggle'),
        underdogRankThreshold: document.getElementById('underdog-rank-threshold'),
        underdogBonusPercent: document.getElementById('underdog-bonus-percent'),
        diversifyMilestones: document.getElementById('diversify-milestones'),
        diversifyBonusPercent: document.getElementById('diversify-bonus-percent'),
        marketWatchlistBody: document.getElementById('market-watchlist-body'),
        watchlistCount: document.getElementById('watchlist-count'),
        instantBonusEnabledToggle: document.getElementById('instant-bonus-enabled-toggle'),
        instantWinChance: document.getElementById('instant-win-chance'),
        instantLossChance: document.getElementById('instant-loss-chance'),
        instantNeutralChance: document.getElementById('instant-neutral-chance'),
        instantWinMaxPercent: document.getElementById('instant-win-max-percent'),
        instantLossMaxPercent: document.getElementById('instant-loss-max-percent'),
        volatilityEnabledToggle: document.getElementById('volatility-enabled-toggle'),
        volatilityChancePercent: document.getElementById('volatility-chance-percent'),
        volatilityUpChance: document.getElementById('volatility-up-chance'),
        volatilityUpMinPercent: document.getElementById('volatility-up-min-percent'),
        volatilityUpMaxPercent: document.getElementById('volatility-up-max-percent'),
        volatilityDownChance: document.getElementById('volatility-down-chance'),
        volatilityDownMinPercent: document.getElementById('volatility-down-min-percent'),
        volatilityDownMaxPercent: document.getElementById('volatility-down-max-percent'),
        volatilityStrongUpChance: document.getElementById('volatility-strong-up-chance'),
        volatilityStrongUpMinPercent: document.getElementById('volatility-strong-up-min-percent'),
        volatilityStrongUpMaxPercent: document.getElementById('volatility-strong-up-max-percent'),
        volatilityCrashChance: document.getElementById('volatility-crash-chance'),
        volatilityCrashMinPercent: document.getElementById('volatility-crash-min-percent'),
        volatilityCrashMaxPercent: document.getElementById('volatility-crash-max-percent'),
    });
    db = firebase.database();
    firebase.auth().signInWithCustomToken(sessionStorage.getItem('firebaseToken')).then(initializeDataListeners).catch(e => console.error("Admin Auth Error:", e));
    setupEventListeners();
    enforceEnglishNumbers();
}

function initializeDataListeners() {
    const onValue = (path, callback) => db.ref(path).on('value', s => callback(s.val() || {}), e => console.error(`Read error at ${path}:`, e));
    onValue('users', data => { usersCache = data; renderUserTable(); });
    onValue('investments', data => { investmentsCache = data; renderUserTable(); });
    onValue('candidates', renderCandidatesManagement);
    onValue('banned_users', renderBannedUsers);
    onValue('site_settings/announcements', renderAnnouncements);
    onValue('site_settings/honor_roll', renderHonorRoll);
    onValue('site_settings/investment_settings', loadInvestmentSettings);
    onValue('site_settings/spin_wheel_settings', loadSpinWheelSettings);
    onValue('site_settings/shop_products', renderShopProducts);
    onValue('site_settings/shop_products_spins', renderShopSpinProducts);
    onValue('site_settings/shop_products_points', renderShopPointsProducts);
    onValue('site_settings/shop_avatars', data => { renderShopAvatars(data); populateCrawlerAvatarDropdown(data); });
    onValue('site_settings/shop_products_nudges', renderShopNudges);
    onValue('site_settings/stock_prediction_game', loadStockPredictionSettings);
    onValue('site_settings/rps_game', loadRpsGameSettings);
    onValue('registered_users', data => { registeredUsersCache = data; initializeApprovalPanel(data); initializeApprovedUsersPanel(data); });
    onValue('gift_requests', renderGiftRequestsTable);
    onValue('withdrawal_requests', renderWithdrawalRequestsTable);
    onValue('site_settings/contest_settings', loadContestSettings);
    onValue('site_settings/gambling_settings', loadGamblingSettings);
    db.ref('activity_log').orderByChild('timestamp').limitToLast(50).on('value', s => renderGeneralActivityLog(Object.values(s.val() || {}).reverse()));
    db.ref('investment_log').orderByChild('timestamp').limitToLast(100).on('value', s => renderInvestmentLog(Object.values(s.val() || {}).reverse()));
    onValue('online_visitors', renderActiveUsers);
    onValue('site_settings/market_governor', loadGovernorSettings);
    onValue('market_watchlist', renderMarketWatchlist);
}

function setupEventListeners() {
    const listen = (el, event, handler) => el?.addEventListener(event, handler);
    listen(ui.userForm, "submit", handleUserFormSubmit);
    listen(ui.addCandidateForm, 'submit', handleAddCandidate);
    listen(ui.announcementForm, 'submit', e => { e.preventDefault(); apiCall('/api/admin/announcements/add', { method: 'POST', body: new FormData(e.target) }, 'تم إضافة الإعلان.').then(() => e.target.reset()); });
    listen(ui.honorRollForm, 'submit', e => { e.preventDefault(); apiCall('/api/admin/honor_roll/add', { method: 'POST', body: new FormData(e.target) }, 'تمت الإضافة للقائمة.').then(() => e.target.reset()); });
    listen(ui.addPrizeBtn, 'click', () => addPrizeRow());
    listen(ui.spinWheelSettingsForm, 'submit', handleSpinWheelSettingsSubmit);
    listen(ui.investmentSettingsForm, 'submit', handleInvestmentSettingsSubmit);
    listen(ui.addProductForm, 'submit', e => handleShopProductForm(e, '/api/admin/shop/add_product'));
    listen(ui.addSpinProductForm, 'submit', e => handleShopProductForm(e, '/api/admin/shop/add_spin_product'));
    listen(ui.addPointsProductForm, 'submit', e => handleShopProductForm(e, '/api/admin/shop/add_points_product'));
    listen(ui.addNudgeForm, 'submit', e => handleShopProductForm(e, '/api/admin/shop/add_nudge'));
    listen(ui.resetAllSpinsBtn, 'click', () => Swal.fire({ title: 'هل أنت متأكد؟', text: "سيتم إعادة تعيين المحاولات المجانية لليوم لجميع المستخدمين المعتمدين.", icon: 'warning', showCancelButton: true, confirmButtonText: "نعم, أعد التعيين!" }).then(r => r.isConfirmed && apiCall('/api/admin/reset_all_free_spins', { method: 'POST' }, "تمت إعادة التعيين بنجاح!")));
    listen(ui.addAvatarForm, 'submit', handleAddAvatar);
    listen(ui.contestSettingsForm, 'submit', handleContestSettingsSubmit);
    listen(ui.gamblingSettingsForm, 'submit', handleGamblingSettingsSubmit);
    listen(ui.stockPredictionSettingsForm, 'submit', handleStockPredictionSettingsSubmit);
    listen(ui.rpsGameSettingsForm, 'submit', handleRpsGameSettingsSubmit);
    listen(ui.crawlerSearchInput, 'input', renderUserTable);
    listen(ui.approvedUsersSearchInput, 'input', () => initializeApprovedUsersPanel(registeredUsersCache));
    listen(ui.clearFormBtn, "click", resetUserForm);
    listen(ui.governorSettingsForm, 'submit', handleGovernorSettingsSubmit);
    listen(ui.instantWinChance, 'input', updateNeutralChance);
    listen(ui.instantLossChance, 'input', updateNeutralChance);

    const handleActionClick = (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;

        e.preventDefault();
        const action = button.dataset.action;
        const username = button.dataset.username;
        const userId = button.dataset.userId;
        const userName = button.dataset.userName;

        switch (action) {
            case 'show-investors': adminActions.showInvestors(username); break;
            case 'show-profit-editor': adminActions.showProfitEditor(username); break;
            case 'edit-user': adminActions.editUser(username); break;
            case 'delete-user': adminActions.confirmDelete(username); break;
            case 'manage-user': adminActions.manageUser(userId, button.dataset.userAction, button); break;
            case 'edit-wallet': adminActions.editUserWallet(userId, userName); break;
            case 'manage-avatars': adminActions.manageUserAvatars(userId, userName); break;
            case 'manage-nudges': adminActions.manageUserNudges(userId, userName); break;
            case 'manage-investments': adminActions.manageUserInvestments(userId, userName); break;
            case 'edit-attempts': adminActions.editPurchasedAttempts(userId, userName); break;
            case 'ban-user': adminActions.confirmBanUser(userId, userName); break;
            case 'unban-user': adminActions.unbanUser(userId); break;
            case 'approve-candidate': adminActions.approveCandidate(username); break;
            case 'reject-candidate': adminActions.rejectCandidate(username); break;
            case 'handle-gift': adminActions.handleGiftRequest(button.dataset.requestId, button.dataset.giftAction, button); break;
            case 'send-message': adminActions.sendUserMessage(userId, userName); break;
            case 'handle-withdrawal': adminActions.handleWithdrawalRequest(button.dataset.requestId, button.dataset.withdrawalAction, button); break;
            case 'adjust-points-percent': adminActions.adjustPointsByPercent(username, button.dataset.direction); break;
            case 'delete-product': apiCall(`/api/admin/shop/delete_product/${button.dataset.id}`, { method: 'POST' }); break;
            case 'edit-product': adminActions.editProduct(button.dataset.id, button.dataset.spAmount, button.dataset.ccPrice); break;
            case 'delete-spin-product': apiCall(`/api/admin/shop/delete_spin_product/${button.dataset.id}`, { method: 'POST' }); break;
            case 'edit-spin-product': adminActions.editSpinProduct(button.dataset.id, button.dataset.attemptsAmount, button.dataset.spPrice); break;
            case 'delete-points-product': apiCall(`/api/admin/shop/delete_points_product/${button.dataset.id}`, { method: 'POST' }); break;
            case 'edit-points-product': adminActions.editPointsProduct(button.dataset.id, button.dataset.pointsAmount, button.dataset.spPrice, button.dataset.dailyLimit); break;
            case 'delete-avatar': adminActions.deleteAvatar(button.dataset.avatarId); break;
            case 'edit-avatar': adminActions.editAvatar(button.dataset.avatarId, button.dataset.avatarName, button.dataset.pricePersonal, button.dataset.priceGift); break;
            case 'delete-nudge': apiCall(`/api/admin/shop/delete_nudge/${button.dataset.id}`, { method: 'POST' }); break;
            case 'edit-nudge': adminActions.editNudge(button.dataset.id, button.dataset.text, button.dataset.price); break;
            case 'delete-announcement': apiCall(`/api/admin/announcements/delete/${button.dataset.id}`, { method: 'POST' }); break;
            case 'delete-honor-roll': apiCall(`/api/admin/honor_roll/delete/${button.dataset.id}`, { method: 'POST' }); break;
        }
    };

    const adminContent = document.getElementById('adminTabContent');
    if (adminContent) {
        adminContent.addEventListener('click', handleActionClick);
    }
}

async function handleGamblingSettingsSubmit(e) { e.preventDefault(); const settings = { is_enabled: ui.gamblingEnabledToggle.checked, max_bet: parseInt(ui.gamblingMaxBetInput.value) || 1000, win_chance_percent: parseFloat(ui.gamblingWinChanceInput.value) || 49.5 }; await apiCall('/api/admin/settings/gambling', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }, 'تم حفظ إعدادات الرهان!'); }
// <<< بداية التعديل: حفظ القيمة الجديدة >>>
async function handleContestSettingsSubmit(e) {
    e.preventDefault();
    const settings = {
        is_enabled: ui.contestEnabledToggle.checked,
        winner_points_reward: parseInt(ui.winnerPointsRewardInput.value) || 0,
        voter_sp_reward: parseInt(ui.voterSpRewardInput.value) || 0,
        multiplier_boost: parseFloat(ui.contestMultiplierBoostInput.value) || 0.2
    };
    await apiCall('/api/admin/settings/contest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }, 'تم حفظ إعدادات المنافسة!');
}
// <<< نهاية التعديل >>>
async function handleInvestmentSettingsSubmit(e) {
    e.preventDefault();
    const settings = {
        max_investments: ui.maxInvestmentsInput.value,
        investment_lock_hours: ui.investmentLockHoursInput.value,
        sell_tax_percent: ui.sellTaxPercentInput.value,
        sell_fee_sp: ui.sellFeeSpInput.value,
        withdrawal_approval_limit: ui.withdrawalApprovalLimitInput.value
    };
    await apiCall('/api/admin/settings/investment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    }, 'تم حفظ إعدادات الاستثمار!');
}
async function handleAddAvatar(e) { e.preventDefault(); const form = e.target; const btn = form.querySelector('button[type="submit"]'); const originalHTML = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> جارِ الرفع...`; try { await apiCall('/api/admin/shop/add_avatar', { method: 'POST', body: new FormData(form) }, 'تمت إضافة الأفاتار بنجاح!'); form.reset(); } catch (err) { } finally { btn.disabled = false; btn.innerHTML = originalHTML; } }
async function handleAddCandidate(e) { e.preventDefault(); const form = e.target; const btn = form.querySelector('button[type="submit"]'); if (!form.name.value.trim()) return; const originalHTML = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`; try { await apiCall('/api/admin/candidate/add', { method: 'POST', body: new FormData(form) }, 'تمت إضافة المرشح.'); form.reset(); } catch (err) { } finally { btn.disabled = false; btn.innerHTML = originalHTML; } }
async function handleUserFormSubmit(e) { e.preventDefault(); const btn = ui.saveUserBtn; btn.disabled = true; btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`; try { await apiCall('/api/admin/add_user', { method: 'POST', body: new FormData(e.target) }, 'تم حفظ البيانات.'); resetUserForm(); } catch (err) { } finally { btn.disabled = false; btn.innerHTML = ui.originalNameInput.value ? 'حفظ التعديل' : 'إضافة'; } }
function resetUserForm() { if (ui.userForm) { ui.userForm.reset(); ui.originalNameInput.value = ''; ui.formTitle.innerText = 'إضافة/تعديل زاحف'; ui.saveUserBtn.innerText = 'إضافة'; ui.saveUserBtn.classList.replace('btn-warning', 'btn-primary'); ui.clearFormBtn.style.display = 'none'; } }

async function handleSpinWheelSettingsSubmit(e) {
    e.preventDefault();
    const settings = {
        enabled: ui.spinWheelEnabledToggle.checked,
        cooldownHours: parseInt(ui.spinCooldownHours.value),
        maxAttempts: parseInt(ui.spinMaxAttempts.value),
        maxAccumulation: parseInt(ui.spinMaxAccumulation.value),
        purchaseLimit: parseInt(ui.spinPurchaseLimit.value),
        prizes: Array.from(ui.prizesContainer.querySelectorAll('.prize-row')).map(r => ({
            value: r.querySelector('.prize-value').value,
            weight: r.querySelector('.prize-weight').value
        })).filter(p => p.value && p.weight)
    };
    await apiCall('/api/admin/settings/spin_wheel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    }, 'تم حفظ إعدادات العجلة!');
}

async function handleShopProductForm(e, url) { e.preventDefault(); await apiCall(url, { method: 'POST', body: new FormData(e.target) }, "تمت إضافة المنتج!").then(() => e.target.reset()).catch(() => { }); }

async function handleStockPredictionSettingsSubmit(e) {
    e.preventDefault();
    const settings = {
        is_enabled: ui.stockPredictionEnabledToggle.checked,
        max_bet: parseInt(ui.stockPredictionMaxBetInput.value) || 1000,
        win_chance_percent: parseFloat(ui.stockPredictionWinChanceInput.value) || 49.0
    };
    await apiCall('/api/admin/settings/stock_prediction_game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    }, 'تم حفظ إعدادات لعبة توقع السهم!');
}

async function handleRpsGameSettingsSubmit(e) {
    e.preventDefault();
    const settings = {
        is_enabled: ui.rpsGameEnabledToggle.checked,
        max_bet: parseInt(ui.rpsGameMaxBetInput.value) || 500,
        cooldown_seconds: parseInt(ui.rpsGameCooldownInput.value) || 60
    };
    await apiCall('/api/admin/settings/rps_game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    }, 'تم حفظ إعدادات لعبة حجر، ورقة، مقص!');
}

function loadStockPredictionSettings(data) {
    if (!data || !ui.stockPredictionSettingsForm) return;
    ui.stockPredictionEnabledToggle.checked = data.is_enabled || false;
    ui.stockPredictionMaxBetInput.value = data.max_bet || 1000;
    ui.stockPredictionWinChanceInput.value = data.win_chance_percent || 49.0;
}

function loadRpsGameSettings(data) {
    if (!data || !ui.rpsGameSettingsForm) return;
    ui.rpsGameEnabledToggle.checked = data.is_enabled || false;
    ui.rpsGameMaxBetInput.value = data.max_bet || 500;
    ui.rpsGameCooldownInput.value = data.cooldown_seconds || 60;
}

function updateNeutralChance() {
    if (!ui.instantWinChance || !ui.instantLossChance || !ui.instantNeutralChance) return;
    const win = parseFloat(ui.instantWinChance.value) || 0;
    const loss = parseFloat(ui.instantLossChance.value) || 0;
    const neutral = 100 - win - loss;
    ui.instantNeutralChance.value = neutral.toFixed(1);
}

function loadGovernorSettings(data) {
    if (!ui.governorSettingsForm || !data) return;
    ui.governorEnabledToggle.checked = data.enabled || false;
    ui.governorIntervalHours.value = data.interval_hours || 0;
    ui.governorIntervalMinutes.value = data.interval_minutes || 10;
    ui.governorIntervalSeconds.value = data.interval_seconds || 0;

    const volatility = data.market_volatility || {};
    ui.volatilityEnabledToggle.checked = volatility.enabled || false;
    ui.volatilityChancePercent.value = volatility.chance_percent || 25;

    ui.volatilityUpChance.value = volatility.up_chance || 45;
    ui.volatilityUpMinPercent.value = volatility.up_min_percent || 1.0;
    ui.volatilityUpMaxPercent.value = volatility.up_max_percent || 5.0;

    ui.volatilityDownChance.value = volatility.down_chance || 40;
    ui.volatilityDownMinPercent.value = volatility.down_min_percent || 1.0;
    ui.volatilityDownMaxPercent.value = volatility.down_max_percent || 3.0;

    ui.volatilityStrongUpChance.value = volatility.strong_up_chance || 7.5;
    ui.volatilityStrongUpMinPercent.value = volatility.strong_up_min_percent || 10.0;
    ui.volatilityStrongUpMaxPercent.value = volatility.strong_up_max_percent || 25.0;

    ui.volatilityCrashChance.value = volatility.crash_chance || 7.5;
    ui.volatilityCrashMinPercent.value = volatility.crash_min_percent || 8.0;
    ui.volatilityCrashMaxPercent.value = volatility.crash_max_percent || 20.0;

    ui.balanceProfitThreshold.value = data.balance_profit_threshold || 350;
    ui.balanceValueThreshold.value = data.balance_value_threshold || 75000;
    ui.rescueWalletThreshold.value = data.rescue_wallet_threshold || 500;
    ui.rescueLossThreshold.value = data.rescue_loss_threshold || 70;
    ui.jackpotChancePercent.value = data.jackpot_chance_percent || 0.5;
    ui.jackpotMultiplier.value = data.jackpot_multiplier || 10;
    ui.dealBonusEnabledToggle.checked = data.deal_bonus_enabled || false;
    ui.underdogRankThreshold.value = data.underdog_rank_threshold || 10;
    ui.underdogBonusPercent.value = data.underdog_bonus_percent || 5;
    ui.diversifyMilestones.value = (data.diversify_milestones || []).join(', ');
    ui.diversifyBonusPercent.value = data.diversify_bonus_percent || 3;
    ui.instantBonusEnabledToggle.checked = data.instant_bonus_enabled || false;
    ui.instantWinChance.value = data.instant_win_chance || 20;
    ui.instantLossChance.value = data.instant_loss_chance || 15;
    ui.instantWinMaxPercent.value = data.instant_win_max_percent || 10;
    ui.instantLossMaxPercent.value = data.instant_loss_max_percent || 5;
    ui.instantNeutralChance.value = data.instant_neutral_chance || 65;
}

async function handleGovernorSettingsSubmit(e) {
    e.preventDefault();
    const winChance = parseFloat(ui.instantWinChance.value) || 0;
    const lossChance = parseFloat(ui.instantLossChance.value) || 0;
    const neutralChance = parseFloat(ui.instantNeutralChance.value) || 0;

    if (Math.abs(winChance + lossChance + neutralChance - 100) > 0.01) {
        Swal.fire('خطأ في الإدخال', 'مجموع احتمالات (الربح، الخسارة، لا شيء) يجب أن يساوي 100% بالضبط.', 'error');
        return;
    }
    const h = parseInt(ui.governorIntervalHours.value) || 0;
    const m = parseInt(ui.governorIntervalMinutes.value) || 0;
    const s = parseInt(ui.governorIntervalSeconds.value) || 0;
    if ((h * 3600 + m * 60 + s) < 10) {
        Swal.fire('خطأ في الإدخال', 'أقل تردد مسموح به هو 10 ثوانٍ.', 'error');
        return;
    }

    const settings = {
        enabled: ui.governorEnabledToggle.checked,
        interval_hours: h,
        interval_minutes: m,
        interval_seconds: s,

        market_volatility: {
            enabled: ui.volatilityEnabledToggle.checked,
            chance_percent: parseFloat(ui.volatilityChancePercent.value || 25),

            up_chance: parseFloat(ui.volatilityUpChance.value || 45),
            up_min_percent: parseFloat(ui.volatilityUpMinPercent.value || 1.0),
            up_max_percent: parseFloat(ui.volatilityUpMaxPercent.value || 5.0),

            down_chance: parseFloat(ui.volatilityDownChance.value || 40),
            down_min_percent: parseFloat(ui.volatilityDownMinPercent.value || 1.0),
            down_max_percent: parseFloat(ui.volatilityDownMaxPercent.value || 3.0),

            strong_up_chance: parseFloat(ui.volatilityStrongUpChance.value || 7.5),
            strong_up_min_percent: parseFloat(ui.volatilityStrongUpMinPercent.value || 10.0),
            strong_up_max_percent: parseFloat(ui.volatilityStrongUpMaxPercent.value || 25.0),

            crash_chance: parseFloat(ui.volatilityCrashChance.value || 7.5),
            crash_min_percent: parseFloat(ui.volatilityCrashMinPercent.value || 8.0),
            crash_max_percent: parseFloat(ui.volatilityCrashMaxPercent.value || 20.0),
        },

        balance_profit_threshold: ui.balanceProfitThreshold.value,
        balance_value_threshold: ui.balanceValueThreshold.value,
        rescue_wallet_threshold: ui.rescueWalletThreshold.value,
        rescue_loss_threshold: ui.rescueLossThreshold.value,
        jackpot_chance_percent: ui.jackpotChancePercent.value,
        jackpot_multiplier: ui.jackpotMultiplier.value,
        deal_bonus_enabled: ui.dealBonusEnabledToggle.checked,
        underdog_rank_threshold: ui.underdogRankThreshold.value,
        underdog_bonus_percent: ui.underdogBonusPercent.value,
        diversify_milestones: ui.diversifyMilestones.value,
        diversify_bonus_percent: ui.diversifyBonusPercent.value,
        instant_bonus_enabled: ui.instantBonusEnabledToggle.checked,
        instant_win_chance: ui.instantWinChance.value,
        instant_loss_chance: ui.instantLossChance.value,
        instant_neutral_chance: ui.instantNeutralChance.value,
        instant_win_max_percent: ui.instantWinMaxPercent.value,
        instant_loss_max_percent: ui.instantLossMaxPercent.value
    };

    await apiCall('/api/admin/settings/market_governor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    }, 'تم حفظ إعدادات حاكم السوق وإعادة جدولة المهمة!');
}

window.adminActions = {
    editUser: (name) => { const u = usersCache[name]; if (u) { ui.nameInput.value = name; ui.pointsInput.value = u.points || 0; ui.stockMultiplierInput.value = u.stock_multiplier || 1.0; ui.originalNameInput.value = name; ui.avatarUrlInput.value = u.avatar_url || ""; ui.formTitle.innerText = `تعديل: ${name}`; ui.saveUserBtn.innerText = 'حفظ'; ui.saveUserBtn.classList.replace('btn-primary', 'btn-warning'); ui.clearFormBtn.style.display = 'inline-block'; window.scrollTo({ top: 0, behavior: 'smooth' }); } },
    confirmDelete: name => Swal.fire({ title: `حذف ${name}؟`, icon: 'warning', showCancelButton: true, confirmButtonText: 'نعم, احذف' }).then(r => r.isConfirmed && apiCall(`/api/admin/delete_user/${name}`, { method: 'POST' }, 'تم الحذف.')),
    manageUser: (id, action, btn) => { btn.disabled = true; apiCall(`/api/admin/manage_user/${id}/${action}`, { method: 'POST' }, `تم ${action === 'approve' ? 'قبول' : 'رفض'} المستخدم.`).catch(() => btn.disabled = false) },
    confirmBanUser: (id, name) => Swal.fire({ title: `حظر ${name}؟`, icon: 'warning', showCancelButton: true, confirmButtonText: 'نعم, قم بالحظر' }).then(r => r.isConfirmed && apiCall('/api/admin/ban_user', { method: 'POST', body: new URLSearchParams({ user_id_to_ban: id, user_name_to_ban: name }) }, `تم حظر ${name}.`)),
    unbanUser: id => apiCall(`/api/admin/unban_user/${id}`, { method: 'POST' }, 'تم فك الحظر.'),
    approveCandidate: name => apiCall('/api/admin/candidate/approve', { method: 'POST', body: new URLSearchParams({ name }) }),
    rejectCandidate: name => apiCall('/api/admin/candidate/reject', { method: 'POST', body: new URLSearchParams({ name }) }),
    deleteAvatar: id => { Swal.fire({ title: 'هل أنت متأكد؟', text: "سيتم حذف الأفاتار نهائياً من المتجر والتخزين!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'نعم, احذفه!', cancelButtonText: 'إلغاء' }).then(result => { if (result.isConfirmed) { apiCall(`/api/admin/shop/delete_avatar/${id}`, { method: 'POST' }, 'تم حذف الأفاتار.'); } }); },
    manageUserAvatars: async (userId, userName) => { Swal.fire({ title: `جلب أفاتارات ${userName}...`, didOpen: () => Swal.showLoading() }); try { const ownedAvatarsSnap = await db.ref(`user_avatars/${userId}/owned`).once('value'); const ownedAvatars = ownedAvatarsSnap.val() || {}; const avatarIds = Object.keys(ownedAvatars); if (avatarIds.length === 0) { Swal.fire('فارغ', `المستخدم ${userName} لا يمتلك أي أفاتارات.`, 'info'); return; } const allAvatarsSnap = await db.ref('site_settings/shop_avatars').once('value'); const allAvatars = allAvatarsSnap.val() || {}; const listHtml = avatarIds.map(id => { const avatar = allAvatars[id]; if (!avatar) return ''; return ` <li class="list-group-item d-flex justify-content-between align-items-center" id="user-avatar-li-${id}"> <div> <img src="${avatar.image_url}" class="avatar-preview me-2"> <span>${avatar.name}</span> </div> <button class="btn btn-sm btn-outline-danger" data-avatar-id="${id}" data-avatar-name="${avatar.name}">إزالة</button> </li> `; }).join(''); Swal.fire({ title: `أفاتارات ${userName}`, html: `<ul class="list-group" style="max-height: 40vh; overflow-y: auto;">${listHtml}</ul>`, width: '500px', didOpen: () => { document.querySelectorAll('.swal2-container .btn-outline-danger').forEach(btn => { btn.addEventListener('click', (e) => { const avatarId = e.currentTarget.dataset.avatarId; const avatarName = e.currentTarget.dataset.avatarName; Swal.fire({ title: `تأكيد الإزالة`, text: `هل أنت متأكد من إزالة أفاتار "${avatarName}" من المستخدم ${userName}؟`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'نعم، قم بالإزالة!', cancelButtonText: 'إلغاء' }).then(async (result) => { if (result.isConfirmed) { try { await apiCall('/api/admin/user_avatar/remove', { method: 'POST', body: new URLSearchParams({ user_id: userId, avatar_id: avatarId }) }, `تمت إزالة الأفاتار.`); document.getElementById(`user-avatar-li-${id}`).remove(); } catch (err) { } } }); }); }); } }); } catch (error) { console.error("Error fetching user avatars:", error); Swal.fire('خطأ', 'فشل في جلب بيانات أفاتارات المستخدم.', 'error'); } },
    handleGiftRequest: (requestId, action, btn) => { btn.disabled = true; const otherBtn = action === 'approve' ? btn.nextElementSibling : btn.previousElementSibling; if (otherBtn) otherBtn.disabled = true; apiCall(`/api/admin/gift_request/${requestId}/${action}`, { method: 'POST' }).then(response => { Swal.fire('تم!', response.message, 'success'); }).catch(err => { btn.disabled = false; if (otherBtn) otherBtn.disabled = false; }); },
    handleWithdrawalRequest: (requestId, action, btn) => {
        btn.disabled = true;
        const otherBtn = action === 'approve' ? btn.nextElementSibling : btn.previousElementSibling;
        if (otherBtn) otherBtn.disabled = true;
        apiCall(`/api/admin/handle_withdrawal_request/${requestId}/${action}`, { method: 'POST' })
            .then(response => { Swal.fire('تم!', response.message, 'success'); })
            .catch(err => {
                btn.disabled = false;
                if (otherBtn) otherBtn.disabled = false;
            });
    },
    sendUserMessage: async (id, name) => { const { value: msg } = await Swal.fire({ title: `رسالة إلى ${name}`, input: 'textarea', inputPlaceholder: 'اكتب رسالتك هنا...' }); if (msg) apiCall('/api/admin/user_message/send', { method: 'POST', body: new URLSearchParams({ user_id: id, message: msg }) }) },
    editUserWallet: async (id, name) => { const walletSnapshot = await db.ref(`wallets/${id}`).once('value'); const wallet = walletSnapshot.val() || { cc: 0, sp: 0 }; const { value: formValues } = await Swal.fire({ title: `تعديل محفظة ${name}`, html: ` <label for="swal-cc" class="swal2-label">زاحف كوين (CC)</label> <input id="swal-cc" type="number" class="swal2-input" value="${wallet.cc || 0}"> <label for="swal-sp" class="swal2-label">نقاط الدعم (SP)</label> <input id="swal-sp" type="number" step="0.01" class="swal2-input" value="${(wallet.sp || 0).toFixed(2)}"> `, focusConfirm: false, showCancelButton: true, confirmButtonText: 'حفظ التغييرات', cancelButtonText: 'إلغاء', preConfirm: () => ({ cc: document.getElementById('swal-cc').value, sp: document.getElementById('swal-sp').value }) }); if (formValues) { apiCall('/api/admin/update_wallet', { method: 'POST', body: new URLSearchParams({ user_id: id, user_name: name, cc: formValues.cc, sp: formValues.sp }) }, 'تم تحديث المحفظة بنجاح.'); } },
    editPurchasedAttempts: async (id, name) => { const state = (await db.ref(`user_spin_state/${id}`).once('value')).val() || {}; const current = state.purchasedAttempts || 0; const { value: newVal } = await Swal.fire({ title: `تعديل محاولات ${name}`, input: 'number', inputValue: current }); if (newVal !== undefined && newVal !== null) { apiCall('/api/admin/update_purchased_attempts', { method: 'POST', body: new URLSearchParams({ user_id: id, attempts: newVal }) }, 'تم تحديث الرصيد.') } },
    editProduct: (id, sp, cc) => { Swal.fire({ title: 'تعديل منتج SP', html: `<input id="swal-sp" class="swal2-input" placeholder="كمية SP" value="${sp}" type="number"><input id="swal-cc" class="swal2-input" placeholder="سعر CC" value="${cc}" type="number">`, showCancelButton: true, confirmButtonText: 'حفظ التعديل', preConfirm: () => ({ sp_amount: document.getElementById('swal-sp').value, cc_price: document.getElementById('swal-cc').value }) }).then(r => { if (r.isConfirmed) apiCall(`/api/admin/shop/edit_product/${id}`, { method: 'POST', body: new URLSearchParams(r.value) }, 'تم تعديل المنتج بنجاح.') }); },
    editSpinProduct: (id, attempts, sp) => { Swal.fire({ title: 'تعديل منتج المحاولات', html: `<input id="swal-attempts" class="swal2-input" placeholder="عدد المحاولات" value="${attempts}" type="number"><input id="swal-sp" class="swal2-input" placeholder="سعر SP" value="${sp}" type="number">`, showCancelButton: true, confirmButtonText: 'حفظ التعديل', preConfirm: () => ({ attempts_amount: document.getElementById('swal-attempts').value, sp_price: document.getElementById('swal-sp').value }) }).then(r => { if (r.isConfirmed) apiCall(`/api/admin/shop/edit_spin_product/${id}`, { method: 'POST', body: new URLSearchParams(r.value) }, 'تم تعديل المنتج بنجاح.') }); },
    editPointsProduct: (id, points, sp, limit) => { Swal.fire({ title: 'تعديل منتج الأسهم', html: `<input id="swal-points" class="swal2-input" placeholder="كمية النقاط" value="${points}" type="number"><input id="swal-sp" class="swal2-input" placeholder="سعر SP" value="${sp}" type="number"><input id="swal-limit" class="swal2-input" placeholder="الحد اليومي" value="${limit}" type="number">`, showCancelButton: true, confirmButtonText: 'حفظ التعديل', preConfirm: () => ({ points_amount: document.getElementById('swal-points').value, sp_price: document.getElementById('swal-sp').value, daily_limit: document.getElementById('swal-limit').value }) }).then(r => { if (r.isConfirmed) apiCall(`/api/admin/shop/edit_points_product/${id}`, { method: 'POST', body: new URLSearchParams(r.value) }, 'تم تعديل المنتج بنجاح.') }); },
    editAvatar: (id, name, personalPrice, giftPrice) => { Swal.fire({ title: 'تعديل بيانات الأفاتار', html: `<input id="swal-name" class="swal2-input" placeholder="اسم الأفاتار" value="${name}"> <input id="swal-personal" class="swal2-input" placeholder="السعر الشخصي (SP)" value="${personalPrice}" type="number"> <input id="swal-gift" class="swal2-input" placeholder="سعر الهدية (SP)" value="${giftPrice}" type="number">`, showCancelButton: true, confirmButtonText: 'حفظ التعديل', preConfirm: () => ({ avatar_name: document.getElementById('swal-name').value, price_sp_personal: document.getElementById('swal-personal').value, price_sp_gift: document.getElementById('swal-gift').value }) }).then(r => { if (r.isConfirmed) apiCall(`/api/admin/shop/edit_avatar/${id}`, { method: 'POST', body: new URLSearchParams(r.value) }, 'تم تعديل الأفاتار بنجاح.') }); },
    editNudge: (id, text, price) => { Swal.fire({ title: 'تعديل النكزة', html: `<textarea id="swal-text" class="swal2-textarea" placeholder="نص النكزة">${text}</textarea><input id="swal-sp" class="swal2-input" placeholder="سعر SP" value="${price}" type="number">`, showCancelButton: true, confirmButtonText: 'حفظ التعديل', preConfirm: () => ({ nudge_text: document.getElementById('swal-text').value, sp_price: document.getElementById('swal-sp').value }) }).then(r => { if (r.isConfirmed) apiCall(`/api/admin/shop/edit_nudge/${id}`, { method: 'POST', body: new URLSearchParams(r.value) }, 'تم تعديل النكزة بنجاح.') }); },
    manageUserNudges: async (userId, userName) => {
        Swal.fire({ title: `جلب نكزات ${userName}...`, didOpen: () => Swal.showLoading() });
        try {
            const [ownedNudgesSnap, allNudgesSnap] = await Promise.all([
                db.ref(`user_nudges/${userId}/owned`).once('value'),
                db.ref('site_settings/shop_products_nudges').once('value')
            ]);
            const ownedNudges = new Set(Object.keys(ownedNudgesSnap.val() || {}));
            const allNudges = allNudgesSnap.val() || {};

            if (Object.keys(allNudges).length === 0) {
                Swal.fire('فارغ', 'لا توجد نكزات معرفة في المتجر حالياً.', 'info');
                return;
            }

            const listHtml = Object.entries(allNudges).map(([id, nudge]) => {
                const isChecked = ownedNudges.has(id) ? 'checked' : '';
                return `
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" role="switch" id="nudge-toggle-${id}" data-nudge-id="${id}" ${isChecked}>
                            <label class="form-check-label" for="nudge-toggle-${id}">${nudge.text}</label>
                        </div>
                        <span class="badge bg-primary rounded-pill">${nudge.sp_price} SP</span>
                    </li>`;
            }).join('');

            Swal.fire({
                title: `التحكم في نكزات ${userName}`,
                html: `<ul class="list-group" style="max-height: 40vh; overflow-y: auto; text-align: right;">${listHtml}</ul>`,
                width: '600px',
                didOpen: () => {
                    document.querySelectorAll('.swal2-container .form-check-input').forEach(toggle => {
                        toggle.addEventListener('change', async (e) => {
                            const nudgeId = e.target.dataset.nudgeId;
                            const action = e.target.checked ? 'grant' : 'revoke';
                            e.target.disabled = true;
                            try {
                                await apiCall('/api/admin/user_nudge/toggle', {
                                    method: 'POST',
                                    body: new URLSearchParams({ user_id: userId, nudge_id: nudgeId, action: action })
                                });
                            } catch (err) {
                                e.target.checked = !e.target.checked;
                            } finally {
                                e.target.disabled = false;
                            }
                        });
                    });
                }
            });
        } catch (error) {
            console.error("Error fetching user nudges:", error);
            Swal.fire('خطأ!', 'فشل في جلب بيانات النكزات.', 'error');
        }
    },
    manageUserInvestments: async (userId, userName) => {
        const modal = bootstrap.Modal.getOrCreateInstance(ui.manageInvestmentsModal);
        ui.manageInvestmentsModalLabel.textContent = `إدارة استثمارات: ${userName}`;
        ui.manageInvestmentsModalBody.innerHTML = `<div class="text-center p-5"><div class="spinner-border text-info"></div></div>`;
        modal.show();

        try {
            const data = await apiCall(`/api/admin/user_investments/${userId}`);
            const investments = data.investments || {};

            if (Object.keys(investments).length === 0) {
                ui.manageInvestmentsModalBody.innerHTML = '<p class="text-muted text-center my-4">هذا المستخدم ليس لديه أي استثمارات حالياً.</p>';
                return;
            }

            let accordionHtml = '<div class="accordion" id="investmentsAccordion">';
            for (const crawlerName in investments) {
                const investment = investments[crawlerName];
                const lots = investment.lots || {};
                const lotsHtml = Object.entries(lots).map(([lotId, lotData]) => {
                    return `
                        <li class="list-group-item d-flex justify-content-between align-items-center" id="lot-row-${lotId}">
                            <div>
                                <span>كمية: <strong>${(lotData.sp || 0).toFixed(2)} SP</strong></span>
                                <small class="d-block text-muted">في تاريخ: ${safeFormatDate(lotData.t || 0)}</small>
                            </div>
                            <button class="btn btn-sm btn-outline-danger" data-action="delete-lot" data-user-id="${userId}" data-crawler-name="${crawlerName}" data-lot-id="${lotId}">
                                <i class="bi bi-trash"></i>
                            </button>
                        </li>
                    `;
                }).join('');

                accordionHtml += `
                    <div class="accordion-item">
                        <h2 class="accordion-header">
                            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${crawlerName.replace(/\s+/g, '')}">
                                ${crawlerName}
                            </button>
                        </h2>
                        <div id="collapse-${crawlerName.replace(/\s+/g, '')}" class="accordion-collapse collapse" data-bs-parent="#investmentsAccordion">
                            <div class="accordion-body p-0">
                                <ul class="list-group list-group-flush">${lotsHtml}</ul>
                            </div>
                        </div>
                    </div>
                `;
            }
            accordionHtml += '</div>';
            ui.manageInvestmentsModalBody.innerHTML = accordionHtml;

            ui.manageInvestmentsModalBody.addEventListener('click', (e) => {
                const button = e.target.closest('button[data-action="delete-lot"]');
                if (button) {
                    const { userId, crawlerName, lotId } = button.dataset;
                    adminActions.deleteInvestmentLot(userId, crawlerName, lotId);
                }
            });

        } catch (error) {
            ui.manageInvestmentsModalBody.innerHTML = `<p class="text-danger text-center my-4">فشل تحميل بيانات الاستثمارات.</p>`;
        }
    },
    deleteInvestmentLot: (userId, crawlerName, lotId) => {
        Swal.fire({
            title: 'هل أنت متأكد؟',
            text: "سيتم حذف دفعة الاستثمار هذه بشكل نهائي. لا يمكن التراجع عن هذا الإجراء!",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonText: 'إلغاء',
            confirmButtonText: 'نعم، قم بالحذف!'
        }).then((result) => {
            if (result.isConfirmed) {
                const payload = new URLSearchParams({ user_id: userId, crawler_name: crawlerName, lot_id: lotId });
                apiCall('/api/admin/delete_investment_lot', { method: 'POST', body: payload }, 'تم حذف دفعة الاستثمار بنجاح.').then(() => {
                    const lotRow = document.getElementById(`lot-row-${lotId}`);
                    if (lotRow) lotRow.remove();
                });
            }
        });
    },
    showInvestors: (crawlerName) => {
        ui.investorsModal.show();
        const modalTitle = document.getElementById('investorsModalLabel');
        const modalBody = document.getElementById('investorsModalBody');

        modalTitle.textContent = `المستثمرون في: ${crawlerName}`;
        modalBody.innerHTML = `<div class="text-center py-5"><div class="spinner-border"></div></div>`;

        const crawlerData = usersCache[crawlerName];
        if (!crawlerData) {
            modalBody.innerHTML = `<p class="text-danger text-center">لم يتم العثور على بيانات الزاحف.</p>`;
            return;
        }

        const investorsList = [];
        for (const investorId in investmentsCache) {
            if (investmentsCache[investorId] && investmentsCache[investorId][crawlerName]) {
                const investment = investmentsCache[investorId][crawlerName];
                const lots = investment.lots || {};
                if (Object.keys(lots).length === 0) continue;

                const totalInvestedSP = Object.values(lots).reduce((sum, lot) => sum + (lot.sp || 0), 0);
                const personalMultiplier = parseFloat(investment.personal_multiplier || 1.0);
                const totalCurrentValue = Object.values(lots).reduce((sum, lot) => {
                    const pointsThen = Math.max(1, lot.p || 1);
                    const pointsNow = Math.max(1, crawlerData.points || 1);
                    const stockMultiplier = crawlerData.stock_multiplier || 1.0;
                    return sum + ((lot.sp || 0) * (pointsNow / pointsThen) * stockMultiplier * personalMultiplier);
                }, 0);
                const profitPercentage = totalInvestedSP > 0 ? ((totalCurrentValue / totalInvestedSP) - 1) * 100 : 0;
                const investorInfo = registeredUsersCache[investorId];
                const investorName = investorInfo ? investorInfo.name : `مستخدم (${investorId.slice(0, 5)}...)`;

                investorsList.push({ name: investorName, profit: profitPercentage, invested: totalInvestedSP, currentValue: totalCurrentValue });
            }
        }

        if (investorsList.length === 0) {
            modalBody.innerHTML = `<p class="text-muted text-center my-4">لا يوجد مستثمرون في هذا الزاحف حالياً.</p>`;
            return;
        }

        investorsList.sort((a, b) => b.profit - a.profit);
        modalBody.innerHTML = `<ul class="list-group list-group-flush">${investorsList.map(investor => { const profitClass = investor.profit > 0.01 ? 'text-success' : investor.profit < -0.01 ? 'text-danger' : 'text-muted'; const profitIcon = investor.profit > 0.01 ? 'bi-arrow-up' : investor.profit < -0.01 ? 'bi-arrow-down' : 'bi-dash'; const formattedProfit = `${investor.profit >= 0 ? '+' : ''}${investor.profit.toFixed(2)}%`; return ` <li class="list-group-item d-flex justify-content-between align-items-center"> <div> <strong>${investor.name}</strong> <div class="small text-muted"> المستثمر: ${investor.invested.toFixed(2)} SP | القيمة الحالية: ${investor.currentValue.toFixed(2)} SP </div> </div> <span class="fw-bold fs-5 ${profitClass}"> <i class="bi ${profitIcon}"></i> ${formattedProfit} </span> </li>`; }).join('')}</ul>`;
    },
    showProfitEditor: (crawlerName) => {
        ui.profitEditorModal.show();
        const modalTitle = document.getElementById('profitEditorModalLabel');
        const modalBody = document.getElementById('profitEditorModalBody');

        modalTitle.textContent = `تعديل أرباح المستثمرين في: ${crawlerName}`;
        modalBody.innerHTML = `<div class="text-center py-5"><div class="spinner-border text-warning"></div></div>`;

        const investorsList = [];
        for (const investorId in investmentsCache) {
            if (investmentsCache[investorId] && investmentsCache[investorId][crawlerName]) {
                const investment = investmentsCache[investorId][crawlerName];
                const investorInfo = registeredUsersCache[investorId];
                const investorName = investorInfo ? investorInfo.name : `مستخدم (${investorId.slice(0, 5)}...)`;
                investorsList.push({ id: investorId, name: investorName, multiplier: parseFloat(investment.personal_multiplier || 1.0) });
            }
        }

        if (investorsList.length === 0) {
            modalBody.innerHTML = `<p class="text-muted text-center my-4">لا يوجد مستثمرون للتعديل عليهم.</p>`;
            return;
        }

        modalBody.innerHTML = `
            <div class="alert alert-warning small">
                <i class="bi bi-info-circle-fill me-2"></i>
                استخدم الأزرار لتطبيق إجراءات سريعة، أو أدخل قيمة يدوياً. سيتم الحفظ تلقائياً.
            </div>
            <ul class="list-group list-group-flush">
                ${investorsList.map(investor => `
                    <li class="list-group-item d-flex justify-content-between align-items-center flex-wrap" id="profit-editor-row-${investor.id}">
                        <strong>${investor.name}</strong>
                        <div class="d-flex align-items-center mt-2 mt-md-0">
                             <div class="btn-group btn-group-sm me-2" role="group">
                                <button type="button" class="btn btn-outline-danger" title="تصفية إجبارية" data-action="force_sell" data-user-id="${investor.id}" data-user-name="${investor.name}" data-crawler-name="${crawlerName}"><i class="bi bi-fire"></i></button>
                                <button type="button" class="btn btn-outline-secondary quick-action-btn" title="إعادة تعيين (1x)" data-action="reset_to_normal" data-user-id="${investor.id}" data-crawler-name="${crawlerName}"><i class="bi bi-arrow-clockwise"></i></button>
                                <button type="button" class="btn btn-outline-info quick-action-btn" title="تصفير الربح" data-action="reset_profit" data-user-id="${investor.id}" data-crawler-name="${crawlerName}"><i class="bi bi-arrow-repeat"></i></button>
                                <button type="button" class="btn btn-outline-warning quick-action-btn" title="عكس (دين)" data-action="invert_profit" data-user-id="${investor.id}" data-crawler-name="${crawlerName}"><i class="bi bi-currency-exchange"></i></button>
                                <button type="button" class="btn btn-outline-danger quick-action-btn" title="خسارة كاملة (0x)" data-action="total_loss" data-user-id="${investor.id}" data-crawler-name="${crawlerName}"><i class="bi bi-x-octagon-fill"></i></button>
                            </div>
                            <div class="input-group" style="width: 120px;">
                                <span class="input-group-text">x</span>
                                <input 
                                    type="number" 
                                    step="0.01" 
                                    class="form-control form-control-sm personal-multiplier-input" 
                                    value="${investor.multiplier.toFixed(2)}"
                                    data-user-id="${investor.id}"
                                    data-crawler-name="${crawlerName}"
                                    id="multiplier-input-${investor.id}"
                                    placeholder="1.00">
                            </div>
                        </div>
                    </li>
                `).join('')}
            </ul>`;

        const applyMultiplierUpdate = async (input, newValue) => {
            input.value = parseFloat(newValue).toFixed(2);
            input.style.transition = 'none';
            input.style.boxShadow = '0 0 10px rgba(255, 193, 7, 0.5)'; // Yellow
            try {
                await apiCall('/api/admin/update_personal_multiplier', {
                    method: 'POST',
                    body: new URLSearchParams({ user_id: input.dataset.userId, crawler_name: input.dataset.crawlerName, multiplier: newValue })
                });
                input.style.transition = 'box-shadow 0.5s ease-out';
                input.style.boxShadow = '0 0 10px rgba(25, 135, 84, 0.8)'; // Green
            } catch (error) {
                input.style.boxShadow = '0 0 10px rgba(220, 53, 69, 0.8)'; // Red
            } finally {
                setTimeout(() => { if (input) input.style.boxShadow = 'none'; }, 1500);
            }
        };

        modalBody.querySelectorAll('.personal-multiplier-input').forEach(input => {
            input.addEventListener('blur', (e) => applyMultiplierUpdate(e.target, e.target.value));
        });

        modalBody.querySelectorAll('.quick-action-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                const btn = e.currentTarget;
                const { userId, crawlerName, action } = btn.dataset;
                const inputField = document.getElementById(`multiplier-input-${userId}`);
                if (!inputField) return;

                btn.disabled = true;
                try {
                    const data = await apiCall('/api/admin/set_special_multiplier', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ user_id: userId, crawler_name: crawlerName, action: action })
                    });
                    if (data.success) {
                        inputField.value = data.new_multiplier.toFixed(2);
                        await applyMultiplierUpdate(inputField, data.new_multiplier);
                    }
                } catch (error) {
                    Swal.fire('خطأ!', 'فشل تطبيق الإجراء.', 'error');
                } finally {
                    btn.disabled = false;
                }
            });
        });

        modalBody.querySelectorAll('button[data-action="force_sell"]').forEach(button => {
            button.addEventListener('click', (e) => {
                const btn = e.currentTarget;
                const { userId, userName, crawlerName } = btn.dataset;
                adminActions.forceSellAll(userId, userName, crawlerName, btn.closest('li'));
            });
        });
    },
    forceSellAll: (userId, userName, crawlerName, listItemElement) => {
        const investorName = userName || registeredUsersCache[userId]?.name || `مستخدم (${userId.slice(0, 5)})`;
        Swal.fire({
            title: 'تصفية إجبارية!',
            html: `هل أنت متأكد أنك تريد تصفية <strong>جميع</strong> استثمارات <strong>${investorName}</strong> في <strong>${crawlerName}</strong>؟<br><br><strong class="text-danger">هذا الإجراء لا يمكن التراجع عنه.</strong>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'نعم، قم بالتصفية!',
            cancelButtonText: 'إلغاء',
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const data = await apiCall('/api/admin/force_sell_all_lots', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ user_id: userId, crawler_name: crawlerName })
                    });
                    Swal.fire('تم بنجاح!', data.message, 'success');
                    if (listItemElement) {
                        listItemElement.remove();
                    }
                } catch (error) {
                    Swal.fire('فشل!', error.message, 'error');
                }
            }
        });
    },
    adjustPointsByPercent: async (username, direction) => {
        const actionText = direction === 'increase' ? 'رفع' : 'خفض';
        const { value: percent } = await Swal.fire({
            title: `${actionText} نقاط ${username} بنسبة`,
            input: 'number',
            inputLabel: `أدخل النسبة المئوية (%) لـ ${actionText}`,
            inputPlaceholder: 'مثال: 10',
            showCancelButton: true,
            inputValidator: (value) => {
                if (!value || isNaN(parseFloat(value)) || parseFloat(value) <= 0) {
                    return 'الرجاء إدخال نسبة مئوية موجبة وصحيحة!';
                }
            }
        });

        if (percent) {
            await apiCall('/api/admin/adjust_points_percent', {
                method: 'POST',
                body: new URLSearchParams({
                    username: username,
                    percent: percent,
                    direction: direction
                })
            }, `تم ${actionText} نقاط ${username} بنجاح.`);
        }
    }
};
// --- END OF FILE static/js/admin.js ---