// --- START OF FILE admin.js ---
document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('adminTab')) return;

    // --- UI Elements ---
    const ui = {
        tableBody: document.getElementById('admin-table-body'),
        userForm: document.getElementById('userForm'),
        nameInput: document.getElementById('nameInput'),
        pointsInput: document.getElementById('pointsInput'),
        originalNameInput: document.getElementById('originalNameInput'),
        saveUserBtn: document.getElementById('saveUserBtn'),
        clearFormBtn: document.getElementById('clearFormBtn'),
        formTitle: document.getElementById('form-title'),
        addCandidateBtn: document.getElementById('add-candidate-btn'),
        activityLogList: document.getElementById('activityLogList'),
        bannedVisitorsList: document.getElementById('banned-visitors-list'),
        onlineUsersAdminList: document.getElementById('online-users-admin-list'), // New UI Element
        announcementForm: document.getElementById('announcementForm'),
        announcementText: document.getElementById('announcementText'),
        announcementsList: document.getElementById('announcements-list'),
        honorRollForm: document.getElementById('honorRollForm'),
        honorNameInput: document.getElementById('honorNameInput'),
        honorRollList: document.getElementById('honorRollList'),
        spinWheelSettingsForm: document.getElementById('spin-wheel-settings-form'),
        spinWheelEnabledToggle: document.getElementById('spin-wheel-enabled-toggle'),
        spinCooldownHours: document.getElementById('spin-cooldown-hours'),
        spinMaxAttempts: document.getElementById('spin-max-attempts'),
        prizesContainer: document.getElementById('prizes-container'),
        addPrizeBtn: document.getElementById('add-prize-btn'),
    };

    // --- Firebase Initialization ---
    try {
        if (!window.firebaseConfig || !window.firebaseConfig.apiKey) {
            throw new Error("Firebase config is missing or incomplete on window object in admin.js.");
        }
        if (!firebase.apps.length) {
            firebase.initializeApp(window.firebaseConfig);
        }
    } catch (e) {
        console.error("Admin Firebase Init Error:", e.message);
        const errorContainer = document.getElementById('adminTabContent') || document.body;
        if (errorContainer) {
            errorContainer.innerHTML = `<div class="alert alert-danger m-3">فشل حاسم في تهيئة Firebase. الرجاء مراجعة Console. ${e.message}</div>`;
        }
        return;
    }

    const db = firebase.database();
    let usersCache = {};
    let candidatesData = {};

    const formatNumber = (num) => new Intl.NumberFormat('en-US').format(num || 0);

    const createUserRowHTML = (user) => {
        const isCandidate = user.name in candidatesData;
        return `
            <td class="align-middle fw-bold">${user.name}</td>
            <td class="text-center align-middle">${formatNumber(user.points)}</td>
            <td class="text-center align-middle"><i class="bi bi-heart-fill text-danger"></i> ${formatNumber(user.likes)}</td>
            <td class="text-center align-middle">
                <button class="btn btn-info btn-sm" onclick="window.editUserFromTable('${user.name}')" title="تعديل"><i class="bi bi-pencil-fill"></i></button>
                <button class="btn ${isCandidate ? 'btn-warning' : 'btn-outline-success'} btn-sm ms-2" onclick="window.toggleCandidate('${user.name}', ${isCandidate})" title="${isCandidate ? 'إزالة ترشيح' : 'إضافة كمرشح'}"><i class="bi ${isCandidate ? 'bi-person-x-fill' : 'bi-person-check-fill'}"></i></button>
                <button class="btn btn-danger btn-sm ms-2" onclick="window.confirmDelete('${user.name}')" title="حذف نهائي"><i class="bi bi-trash-fill"></i></button>
            </td>
        `;
    };

    const updateRanks = () => { ui.tableBody.querySelectorAll('tr').forEach((row, index) => { row.querySelector('th').textContent = `#${index + 1}`; }); };
    const findInsertPosition = (userPoints) => { const rows = ui.tableBody.querySelectorAll('tr'); for (const row of rows) { if (userPoints > parseInt(row.dataset.points, 10)) return row; } return null; };
    const addUserToTable = (user) => { if (!usersCache[user.name]) return; const newRow = document.createElement('tr'); newRow.id = `user-row-${user.name}`; newRow.dataset.username = user.name; newRow.dataset.points = user.points; const rankPlaceholder = document.createElement('th'); rankPlaceholder.className = 'align-middle'; newRow.appendChild(rankPlaceholder); newRow.innerHTML += createUserRowHTML(user); ui.tableBody.insertBefore(newRow, findInsertPosition(user.points)); updateRanks(); };
    const updateUserInTable = (user) => { const row = document.getElementById(`user-row-${user.name}`); if (!row) return; const oldPoints = parseInt(row.dataset.points, 10); if (oldPoints === user.points) { row.innerHTML = `<th class="align-middle">${row.querySelector('th').textContent}</th>` + createUserRowHTML(user); } else { row.remove(); addUserToTable(user); } };
    const removeUserFromTable = (username) => { const row = document.getElementById(`user-row-${username}`); if (row) { row.remove(); updateRanks(); } };

    const initializeUserList = () => {
        const usersRef = db.ref('users');
        ui.tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-5"><div class="spinner-border"></div></td></tr>';
        usersRef.orderByChild('points').once('value', snapshot => {
            const initialUsers = [];
            snapshot.forEach(child => initialUsers.push({ name: child.key, ...child.val() }));
            initialUsers.reverse();
            ui.tableBody.innerHTML = '';
            initialUsers.forEach(user => { usersCache[user.name] = user; addUserToTable(user); });
            if (initialUsers.length === 0) ui.tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">لا يوجد مستخدمين.</td></tr>';

            usersRef.on('child_added', s => { const u = { name: s.key, ...s.val() }; if (!usersCache[u.name]) { usersCache[u.name] = u; addUserToTable(u); } });
            usersRef.on('child_changed', s => { const u = { name: s.key, ...s.val() }; usersCache[u.name] = u; updateUserInTable(u); });
            usersRef.on('child_removed', s => { const uname = s.key; delete usersCache[uname]; removeUserFromTable(uname); });
        });
    };

    // --- NEW: Render Online Users for Admin ---
    const renderOnlineUsersAdmin = (snapshot) => {
        const onlineUsers = Object.values(snapshot.val() || {});
        ui.onlineUsersAdminList.innerHTML = '';

        if (onlineUsers.length > 0) {
            onlineUsers.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).forEach(user => {
                const li = document.createElement('li');
                li.className = 'list-group-item d-flex justify-content-between align-items-center';
                const statusBadge = user.status === 'in-game'
                    ? `<span class="badge bg-danger rounded-pill">في معركة</span>`
                    : `<span class="badge bg-success rounded-pill">متصل</span>`;
                const lastSeen = user.timestamp ? new Date(user.timestamp).toLocaleTimeString('ar-EG') : 'غير معروف';
                li.innerHTML = `
                    <div>
                        <i class="bi bi-person-circle me-2"></i>
                        <span class="fw-bold">${user.name}</span>
                        <small class="text-muted ms-3">(آخر ظهور: ${lastSeen})</small>
                    </div>
                    ${statusBadge}
                `;
                ui.onlineUsersAdminList.appendChild(li);
            });
        } else {
            ui.onlineUsersAdminList.innerHTML = '<li class="list-group-item text-muted text-center">لا يوجد لاعبون متصلون حالياً.</li>';
        }
    };

    const renderList = (element, data, renderItem, emptyMsg) => {
        element.innerHTML = '';
        if (data.length > 0) {
            data.forEach(item => {
                const li = document.createElement('li');
                li.className = 'list-group-item d-flex justify-content-between align-items-center';
                li.innerHTML = renderItem(item);
                element.appendChild(li);
            });
        } else {
            element.innerHTML = `<li class="list-group-item text-muted text-center">${emptyMsg || 'القائمة فارغة.'}</li>`;
        }
    };

    const renderActivityLog = (snapshot) => {
        const log = (Object.keys(snapshot.val() || {})).map(key => ({ id: key, ...snapshot.val()[key] })).sort((a, b) => b.timestamp - a.timestamp);
        if (!ui.activityLogList) return;
        ui.activityLogList.innerHTML = '';
        if (log.length > 0) {
            log.slice(0, 100).forEach(item => {
                const li = document.createElement('li');
                li.className = 'list-group-item d-flex justify-content-between align-items-center flex-wrap';
                const icon = { 'like': 'bi-heart-fill text-danger', 'nomination': 'bi-person-up text-success', 'report': 'bi-flag-fill text-warning', 'gift': 'bi-gift-fill text-info' }[item.type] || 'bi-info-circle-fill';
                let buttons = item.visitor_name ? `<button class="btn btn-info btn-sm ms-2" onclick="window.sendVisitorMessage('${item.visitor_name}')" title="إرسال رسالة"><i class="bi bi-chat-dots-fill"></i></button><button class="btn btn-danger btn-sm ms-2" onclick="window.confirmBanVisitor('${item.visitor_name}')" title="حظر"><i class="bi bi-slash-circle-fill"></i></button>` : '';
                li.innerHTML = `<div class="me-auto py-1"><i class="bi ${icon} me-2"></i>${item.text}</div><div class="d-flex align-items-center py-1"><small class="text-muted me-3">${new Date(item.timestamp * 1000).toLocaleString('ar-EG')}</small>${buttons}</div>`;
                ui.activityLogList.appendChild(li);
            });
        } else {
            ui.activityLogList.innerHTML = '<li class="list-group-item text-center text-muted">لا توجد أنشطة.</li>';
        }
    };

    const addPrizeInput = (prize = { value: '', weight: '' }) => { const row = document.createElement('div'); row.className = 'input-group prize-row'; row.innerHTML = `<span class="input-group-text">الجائزة:</span><input type="number" class="form-control prize-value" placeholder="قيمة النقاط" value="${prize.value}" required><span class="input-group-text">الوزن:</span><input type="number" step="any" class="form-control prize-weight" placeholder="نسبة الحظ" value="${prize.weight}" required><button class="btn btn-outline-danger remove-prize-btn" type="button"><i class="bi bi-trash-fill"></i></button>`; ui.prizesContainer.appendChild(row); row.querySelector('.remove-prize-btn').addEventListener('click', () => row.remove()); };
    const loadSpinWheelSettings = () => { db.ref('site_settings/spin_wheel_settings').once('value', s => { const settings = s.val(); if (settings) { ui.spinWheelEnabledToggle.checked = settings.enabled || false; ui.spinCooldownHours.value = settings.cooldownHours || 24; ui.spinMaxAttempts.value = settings.maxAttempts || 1; ui.prizesContainer.innerHTML = ''; if (settings.prizes && settings.prizes.length > 0) { settings.prizes.forEach(addPrizeInput); } else { addPrizeInput(); } } else { addPrizeInput({ value: 100, weight: 35 }); addPrizeInput({ value: 1000, weight: 10 }); } }); };
    const clearForm = () => { ui.userForm.reset(); ui.originalNameInput.value = ''; ui.formTitle.innerText = 'إضافة مستخدم جديد'; ui.saveUserBtn.innerText = 'إضافة'; ui.saveUserBtn.classList.replace('btn-warning', 'btn-primary'); ui.clearFormBtn.style.display = 'none'; };

    ui.userForm.addEventListener('submit', async e => { e.preventDefault(); try { const res = await fetch('/add', { method: 'POST', body: new FormData(ui.userForm) }); if (res.ok) clearForm(); else Swal.fire('خطأ!', 'فشل الحفظ.', 'error'); } catch { Swal.fire('خطأ!', 'فشل الاتصال.', 'error'); } });
    ui.clearFormBtn.addEventListener('click', clearForm);
    ui.addCandidateBtn.addEventListener('click', () => { Swal.fire({ title: 'ترشيح مستخدم', input: 'text', inputLabel: 'اكتب اسم المستخدم', showCancelButton: true, confirmButtonText: 'إضافة' }).then(r => r.isConfirmed && r.value && window.toggleCandidate(r.value.trim(), false)); });
    ui.announcementForm.addEventListener('submit', async e => { e.preventDefault(); if (ui.announcementText.value.trim()) { await fetch('/api/admin/announcements/add', { method: 'POST', body: new FormData(e.currentTarget) }); e.currentTarget.reset(); } });
    ui.honorRollForm.addEventListener('submit', async e => { e.preventDefault(); if (ui.honorNameInput.value.trim()) { await fetch('/api/admin/honor_roll/add', { method: 'POST', body: new URLSearchParams({ name: ui.honorNameInput.value }) }); ui.honorNameInput.value = ''; } });
    ui.addPrizeBtn.addEventListener('click', () => addPrizeInput());
    ui.spinWheelSettingsForm.addEventListener('submit', async e => { e.preventDefault(); const settings = { enabled: ui.spinWheelEnabledToggle.checked, cooldownHours: parseInt(ui.spinCooldownHours.value, 10), maxAttempts: parseInt(ui.spinMaxAttempts.value, 10), prizes: [] }; document.querySelectorAll('.prize-row').forEach(row => { const value = parseFloat(row.querySelector('.prize-value').value); const weight = parseFloat(row.querySelector('.prize-weight').value); if (!isNaN(value) && !isNaN(weight)) settings.prizes.push({ value, weight }); }); if (settings.prizes.length === 0) { Swal.fire('خطأ!', 'يجب إضافة جائزة واحدة على الأقل.', 'error'); return; } try { await fetch('/api/admin/settings/spin_wheel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }); Swal.fire({ icon: 'success', title: 'تم الحفظ!', toast: true, position: 'top-end', showConfirmButton: false, timer: 2500 }); } catch (err) { Swal.fire('خطأ!', err.message, 'error'); } });

    window.editUserFromTable = (name) => { const user = usersCache[name]; if (!user) return; ui.nameInput.value = name; ui.pointsInput.value = user.points || 0; ui.originalNameInput.value = name; ui.formTitle.innerText = `تعديل: ${name}`; ui.saveUserBtn.innerText = 'حفظ'; ui.saveUserBtn.classList.replace('btn-primary', 'btn-warning'); ui.clearFormBtn.style.display = 'inline-block'; window.scrollTo({ top: 0, behavior: 'smooth' }); };
    window.confirmDelete = (name) => { Swal.fire({ title: `هل أنت متأكد؟`, text: `سيتم حذف ${name} نهائياً!`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'نعم!' }).then(r => r.isConfirmed && fetch(`/delete/${name}`, { method: 'POST' })); };
    window.confirmBanVisitor = (name) => { Swal.fire({ title: `حظر "${name}"؟`, text: 'سيتم منعه من استخدام الموقع.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33' }).then(r => r.isConfirmed && fetch(`/api/admin/ban_visitor`, { method: 'POST', body: new URLSearchParams({ name_to_ban: name }) })); };
    window.unbanVisitor = (name) => fetch(`/api/admin/unban_visitor/${name}`, { method: 'POST' });
    window.deleteAnnouncement = (id) => fetch(`/api/admin/announcements/delete/${id}`, { method: 'POST' });
    window.deleteFromHonorRoll = (id) => fetch(`/api/admin/honor_roll/delete/${id}`, { method: 'POST' });
    window.toggleCandidate = (name, isCandidate) => fetch(`/api/admin/candidate/${isCandidate ? 'remove' : 'add'}/${name}`, { method: 'POST' });
    window.sendVisitorMessage = (visitorName) => { Swal.fire({ title: `إرسال رسالة إلى ${visitorName}`, input: 'textarea', inputLabel: 'نص الرسالة', showCancelButton: true, confirmButtonText: 'إرسال' }).then(result => { if (result.isConfirmed && result.value) { fetch('/api/admin/visitor_message/send', { method: 'POST', body: new URLSearchParams({ visitor_name: visitorName, message: result.value }) }); } }); };

    // --- Initial Load ---
    initializeUserList();
    db.ref('candidates').on('value', snapshot => { candidatesData = snapshot.val() || {}; Object.values(usersCache).forEach(updateUserInTable); });
    db.ref('banned_visitors').on('value', s => renderList(ui.bannedVisitorsList, Object.keys(s.val() || {}).map(k => ({ id: k, ...s.val()[k] })), item => `<span>${item.id}</span><button class="btn btn-outline-success btn-sm" onclick="window.unbanVisitor('${item.id}')">إلغاء الحظر</button>`, 'لا يوجد زوار محظورون.'));
    db.ref('activity_log').orderByChild('timestamp').limitToLast(100).on('value', renderActivityLog);
    db.ref('online_users').on('value', renderOnlineUsersAdmin); // New listener
    db.ref('site_settings/announcements').on('value', s => renderList(ui.announcementsList, Object.keys(s.val() || {}).map(k => ({ id: k, ...s.val()[k] })), item => `<span>${item.text}</span><button class="btn btn-outline-danger btn-sm" onclick="window.deleteAnnouncement('${item.id}')">×</button>`, 'لا توجد إعلانات.'));
    db.ref('site_settings/honor_roll').on('value', s => renderList(ui.honorRollList, Object.keys(s.val() || {}).map(k => ({ id: k, ...s.val()[k] })), item => `<span>${item.name}</span><button class="btn btn-outline-danger btn-sm" onclick="window.deleteFromHonorRoll('${item.id}')">×</button>`));
    loadSpinWheelSettings();
});
// --- END OF FILE admin.js ---
