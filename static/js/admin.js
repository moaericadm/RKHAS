// --- START OF FILE static/js/admin.js ---
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
        onlineVisitorsList: document.getElementById('online-visitors-list'),
        bannedVisitorsList: document.getElementById('banned-visitors-list'),
        announcementForm: document.getElementById('announcementForm'),
        announcementsList: document.getElementById('announcements-list'),
        honorRollForm: document.getElementById('honorRollForm'),
        honorRollList: document.getElementById('honorRollList'),
        spinWheelSettingsForm: document.getElementById('spin-wheel-settings-form'),
        spinWheelEnabledToggle: document.getElementById('spin-wheel-enabled-toggle'),
        spinCooldownHours: document.getElementById('spin-cooldown-hours'),
        spinMaxAttempts: document.getElementById('spin-max-attempts'),
        prizesContainer: document.getElementById('prizes-container'),
        addPrizeBtn: document.getElementById('add-prize-btn'),
        pendingUsersTable: document.getElementById('pending-users-table-body'),
        pendingCountBadge: document.getElementById('pending-count'),
    };

    let db;
    let usersCache = {};
    let candidatesData = {};

    async function initializeFirebaseAndAuth() {
        try {
            if (!window.firebaseConfig || !window.firebaseConfig.apiKey) {
                throw new Error("إعدادات Firebase غير موجودة. لا يمكن المتابعة.");
            }
            if (!firebase.apps.length) {
                firebase.initializeApp(window.firebaseConfig);
            }

            const token = sessionStorage.getItem('firebaseToken');
            if (!token) {
                Swal.fire({
                    title: 'انتهت الجلسة',
                    text: 'الرجاء تسجيل الدخول مرة أخرى للوصول إلى لوحة التحكم.',
                    icon: 'warning',
                    confirmButtonText: 'تسجيل الدخول',
                    allowOutsideClick: false,
                    allowEscapeKey: false
                }).then(() => {
                    window.location.href = '/login';
                });
                return;
            }

            await firebase.auth().signInWithCustomToken(token);
            console.log("Firebase authentication successful as Admin.");

            db = firebase.database();
            initializeAllPanels();

        } catch (e) {
            console.error("Firebase Initialization or Auth Failed:", e);
            Swal.fire({
                title: 'انتهت صلاحية الجلسة',
                text: 'الرجاء تسجيل الدخول مرة أخرى للاستمرار.',
                icon: 'error',
                confirmButtonText: 'تسجيل الدخول',
                allowOutsideClick: false,
                allowEscapeKey: false
            }).then(() => {
                sessionStorage.removeItem('firebaseToken');
                window.location.href = '/login';
            });
        }
    }

    function initializeAllPanels() {
        initializeApprovalPanel();
        initializeUserList();
        initializeActivityLog();
        setupEventListeners();

        db.ref('candidates').on('value', snapshot => {
            candidatesData = snapshot.val() || {};
            const sortedUsers = Object.values(usersCache).sort((a, b) => (b.points || 0) - (a.points || 0));
            ui.tableBody.innerHTML = '';
            sortedUsers.forEach(user => addUserToTable(user.name, user));

        }, handleFirebaseError);

        db.ref('banned_users').on('value', renderBannedUsers, handleFirebaseError);
        db.ref('site_settings/announcements').on('value', renderAnnouncements, handleFirebaseError);
        db.ref('site_settings/honor_roll').on('value', renderHonorRoll, handleFirebaseError);

        db.ref('online_visitors').on('value', renderOnlineVisitors, handleFirebaseError);
        loadSpinWheelSettings();
    }

    const formatNumber = (num) => new Intl.NumberFormat('en-US').format(num || 0);
    const handleFirebaseError = (error) => {
        console.error("Firebase read error:", error);
        Swal.fire('خطأ في الاتصال', `فشل في قراءة البيانات من Firebase. تأكد من صلاحياتك واتصالك بالإنترنت. رمز الخطأ: ${error.code}`, 'error');
    };

    const renderOnlineVisitors = (snapshot) => {
        const visitors = snapshot.val() || {};
        ui.onlineVisitorsList.innerHTML = '';
        if (Object.keys(visitors).length === 0) {
            ui.onlineVisitorsList.innerHTML = '<li class="list-group-item text-muted text-center">لا يوجد زوار متصلون حالياً.</li>';
            return;
        }
        Object.values(visitors).forEach(visitor => {
            if (!visitor.user_id || !visitor.name) return;

            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.innerHTML = `
                <span><i class="bi bi-person-fill text-success me-2"></i> ${visitor.name}</span>
                <div class="d-flex align-items-center">
                    <small class="text-muted me-3">${new Date(visitor.timestamp).toLocaleTimeString('ar-EG')}</small>
                    <button class="btn btn-outline-info btn-sm" onclick="window.sendUserMessage('${visitor.user_id}', '${visitor.name}')" title="إرسال رسالة"><i class="bi bi-chat-dots-fill"></i></button>
                    <button class="btn btn-outline-danger btn-sm ms-2" onclick="window.confirmBanUser('${visitor.user_id}', '${visitor.name}')" title="حظر هذا المستخدم"><i class="bi bi-slash-circle-fill"></i></button>
                </div>`;
            ui.onlineVisitorsList.appendChild(li);
        });
    };

    const initializeApprovalPanel = () => {
        if (!ui.pendingUsersTable || !db) return;
        ui.pendingUsersTable.innerHTML = '<tr><td colspan="4" class="text-center py-5"><div class="spinner-border"></div></td></tr>';

        db.ref('registered_users').orderByChild('status').equalTo('pending').on('value', snapshot => {
            const data = snapshot.val() || {};
            const users = Object.values(data).sort((a, b) => (b.registered_at || 0) - (a.registered_at || 0));

            if (users.length > 0) {
                ui.pendingCountBadge.textContent = users.length;
                ui.pendingCountBadge.style.display = 'inline-block';
                ui.pendingUsersTable.innerHTML = '';
                users.forEach(user => {
                    const row = document.createElement('tr');
                    row.id = `pending-user-${user.uid}`;
                    row.innerHTML = `
                    <td>${user.name || 'N/A'}</td>
                    <td>${user.email || 'N/A'}</td>
                    <td>${user.phone_number || 'N/A'}</td>
                    <td class="text-center">
                        <button class="btn btn-success btn-sm" onclick="window.manageUser('${user.uid}', 'approve', this)">قبول</button>
                        <button class="btn btn-danger btn-sm ms-2" onclick="window.manageUser('${user.uid}', 'reject', this)">رفض</button>
                    </td>`;
                    ui.pendingUsersTable.appendChild(row);
                });
            } else {
                ui.pendingCountBadge.style.display = 'none';
                ui.pendingUsersTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">لا توجد طلبات تسجيل جديدة.</td></tr>';
            }
        }, handleFirebaseError);
    };

    window.manageUser = (userId, action, btn) => {
        const originalHTML = btn.innerHTML;
        const title = `هل أنت متأكد من ${action === 'approve' ? 'قبول' : 'رفض'} هذا المستخدم؟`;
        Swal.fire({ title, icon: 'warning', showCancelButton: true, confirmButtonText: 'نعم', cancelButtonText: 'إلغاء' })
            .then(result => {
                if (result.isConfirmed) {
                    btn.disabled = true;
                    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
                    fetch(`/api/admin/manage_user/${userId}/${action}`, { method: 'POST' })
                        .then(res => res.json()).then(data => {
                            if (data.success) {
                                Swal.fire({ icon: 'success', title: 'تم!', text: data.message, timer: 1500, showConfirmButton: false });
                            } else {
                                Swal.fire('خطأ!', data.message, 'error');
                                btn.disabled = false;
                                btn.innerHTML = originalHTML;
                            }
                        }).catch(() => {
                            Swal.fire('خطأ!', 'فشل الاتصال بالخادم.', 'error');
                            btn.disabled = false;
                            btn.innerHTML = originalHTML;
                        });
                }
            });
    };

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
        </td>`;
    };

    const updateRanks = () => {
        const sortedUsers = Object.values(usersCache).sort((a, b) => (b.points || 0) - (a.points || 0));
        sortedUsers.forEach((user, index) => {
            const row = document.getElementById(`user-row-${user.name}`);
            if (row) {
                const rankCell = row.querySelector('th.rank');
                if (rankCell) rankCell.textContent = `#${index + 1}`;
            }
        });
    };

    const findInsertPosition = (userPoints) => {
        const rows = ui.tableBody.querySelectorAll('tr');
        for (const row of rows) {
            const rowPoints = parseInt(row.dataset.points, 10);
            if (userPoints > rowPoints) {
                return row;
            }
        }
        return null;
    };

    const addUserToTable = (username, user) => {
        if (!user || !user.name) return;
        const existingRow = document.getElementById(`user-row-${user.name}`);
        if (existingRow) {
            updateUserInTable(username, user);
            return;
        }

        const newRow = document.createElement('tr');
        newRow.id = `user-row-${user.name}`;
        newRow.dataset.username = user.name;
        newRow.dataset.points = user.points || 0;
        newRow.innerHTML = `<th class="align-middle rank"></th>` + createUserRowHTML(user);

        const position = findInsertPosition(user.points || 0);
        ui.tableBody.insertBefore(newRow, position);
        usersCache[user.name] = user;
        updateRanks();
    };

    const updateUserInTable = (username, user) => {
        const row = document.getElementById(`user-row-${username}`);
        if (!row) {
            addUserToTable(username, user);
            return;
        }

        const oldPoints = parseInt(row.dataset.points, 10);
        usersCache[username] = user;

        if (oldPoints !== (user.points || 0)) {
            row.remove();
            addUserToTable(username, user);
        } else {
            row.innerHTML = `<th class="align-middle rank">${row.querySelector('th.rank').textContent}</th>` + createUserRowHTML(user);
            row.dataset.points = user.points || 0;
        }
    };

    const removeUserFromTable = (username) => {
        const row = document.getElementById(`user-row-${username}`);
        if (row) {
            row.remove();
            delete usersCache[username];
            updateRanks();
        }
    };

    const initializeUserList = () => {
        if (!db) return;
        const usersRef = db.ref('users');
        ui.tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-5"><div class="spinner-border"></div> <p>جاري تحميل القائمة...</p></td></tr>';

        usersRef.on('child_added', (snapshot) => addUserToTable(snapshot.key, { name: snapshot.key, ...snapshot.val() }));
        usersRef.on('child_changed', (snapshot) => updateUserInTable(snapshot.key, { name: snapshot.key, ...snapshot.val() }));
        usersRef.on('child_removed', (snapshot) => removeUserFromTable(snapshot.key));

        usersRef.once('value', snapshot => {
            if (!snapshot.exists()) {
                ui.tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">لا يوجد زواحف حالياً.</td></tr>';
            }
        }, handleFirebaseError);
    };

    const addActivityLogItem = (item) => {
        if (!item || !item.type || !item.text) return;

        const iconClass = { 'like': 'bi-heart-fill text-danger', 'nomination': 'bi-person-up text-success', 'report': 'bi-flag-fill text-warning', 'gift': 'bi-gift-fill text-info' }[item.type] || 'bi-info-circle-fill';
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center flex-wrap';

        let actionButtonsHTML = '';
        if (item.user_id && item.user_name) {
            actionButtonsHTML = `
            <button class="btn btn-info btn-sm ms-2" onclick="window.sendUserMessage('${item.user_id}', '${item.user_name}')" title="إرسال رسالة"><i class="bi bi-chat-dots-fill"></i></button>
            <button class="btn btn-danger btn-sm ms-2" onclick="window.confirmBanUser('${item.user_id}', '${item.user_name}')" title="حظر هذا المستخدم"><i class="bi bi-slash-circle-fill"></i></button>`;
        }

        li.innerHTML = `
            <div class="me-auto py-1">
                <i class="bi ${iconClass} me-2"></i>${item.text}
            </div>
            <div class="d-flex align-items-center py-1">
                <small class="text-muted me-3">${new Date(item.timestamp * 1000).toLocaleString('ar-EG')}</small>
                ${actionButtonsHTML}
            </div>`;
        ui.activityLogList.prepend(li);
    };

    const initializeActivityLog = () => {
        if (!ui.activityLogList || !db) return;
        const logRef = db.ref('activity_log');
        ui.activityLogList.innerHTML = '';

        logRef.orderByChild('timestamp').startAt(Date.now() / 1000).on('child_added', (childSnapshot) => {
            addActivityLogItem(childSnapshot.val());
        });

        logRef.orderByChild('timestamp').limitToLast(50).once('value', (snapshot) => {
            if (!snapshot.exists()) {
                ui.activityLogList.innerHTML = '<li class="list-group-item text-center text-muted">لا توجد أنشطة مسجلة.</li>';
            } else {
                const items = [];
                snapshot.forEach(childSnapshot => { items.push(childSnapshot.val()); });
                items.reverse().forEach(item => addActivityLogItem(item));
            }
        }, handleFirebaseError);
    };

    const renderBannedUsers = (snapshot) => {
        const banned = snapshot.val() || {};
        ui.bannedVisitorsList.innerHTML = '';
        if (Object.keys(banned).length === 0) {
            ui.bannedVisitorsList.innerHTML = '<li class="list-group-item text-muted text-center">قائمة الحظر فارغة.</li>';
            return;
        }
        Object.entries(banned).forEach(([userId, banInfo]) => {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.innerHTML = `<span><i class="bi bi-person-x-fill me-2"></i> ${banInfo.name || 'مستخدم محظور'}</span> <button class="btn btn-sm btn-outline-success" onclick="window.unbanUser('${userId}')">رفع الحظر</button>`;
            ui.bannedVisitorsList.appendChild(li);
        });
    };

    const renderAnnouncements = (snapshot) => {
        const announcements = snapshot.val() || {};
        ui.announcementsList.innerHTML = '';
        if (Object.keys(announcements).length === 0) {
            ui.announcementsList.innerHTML = '<li class="list-group-item text-muted text-center">لا توجد إعلانات.</li>';
            return;
        }
        Object.entries(announcements).forEach(([id, ann]) => {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.innerHTML = `<span>${ann.text}</span> <button class="btn btn-sm btn-outline-danger" onclick="window.deleteAnnouncement('${id}')"><i class="bi bi-trash-fill"></i></button>`;
            ui.announcementsList.appendChild(li);
        });
    };

    const renderHonorRoll = (snapshot) => {
        const honorRoll = snapshot.val() || {};
        ui.honorRollList.innerHTML = '';
        if (Object.keys(honorRoll).length === 0) {
            ui.honorRollList.innerHTML = '<li class="list-group-item text-muted text-center">القائمة فارغة.</li>';
            return;
        }
        Object.entries(honorRoll).forEach(([id, item]) => {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.innerHTML = `<span>${item.name}</span> <button class="btn btn-sm btn-outline-danger" onclick="window.deleteFromHonorRoll('${id}')"><i class="bi bi-trash-fill"></i></button>`;
            ui.honorRollList.appendChild(li);
        });
    };

    const addPrizeInput = (prize = { value: '', weight: '' }) => {
        const prizeRow = document.createElement('div');
        prizeRow.className = 'input-group prize-row mb-2';
        prizeRow.innerHTML = ` <span class="input-group-text">الجائزة:</span> <input type="number" class="form-control prize-value" placeholder="قيمة النقاط" value="${prize.value}" required> <span class="input-group-text">الوزن:</span> <input type="number" step="any" class="form-control prize-weight" placeholder="نسبة الحظ" value="${prize.weight}" required> <button class="btn btn-outline-danger remove-prize-btn" type="button"><i class="bi bi-trash-fill"></i></button> `;
        ui.prizesContainer.appendChild(prizeRow);
        prizeRow.querySelector('.remove-prize-btn').addEventListener('click', () => prizeRow.remove());
    };

    const loadSpinWheelSettings = () => {
        if (!db) return;
        db.ref('site_settings/spin_wheel_settings').once('value', snapshot => {
            const settings = snapshot.val();
            if (settings) {
                ui.spinWheelEnabledToggle.checked = settings.enabled || false;
                ui.spinCooldownHours.value = settings.cooldownHours || 24;
                ui.spinMaxAttempts.value = settings.maxAttempts || 1;
                ui.prizesContainer.innerHTML = '';
                if (settings.prizes && settings.prizes.length > 0) {
                    settings.prizes.forEach(prize => addPrizeInput(prize));
                } else {
                    addPrizeInput();
                }
            } else {
                addPrizeInput({ value: 100, weight: 35 });
                addPrizeInput({ value: 1000, weight: 10 });
            }
        }, handleFirebaseError);
    };

    const setupEventListeners = () => {
        const clearForm = () => { ui.userForm.reset(); ui.originalNameInput.value = ''; ui.formTitle.innerText = 'إضافة زاحف جديد'; ui.saveUserBtn.innerText = 'إضافة'; ui.saveUserBtn.classList.replace('btn-warning', 'btn-primary'); ui.clearFormBtn.style.display = 'none'; };
        ui.userForm.addEventListener('submit', async e => { e.preventDefault(); try { const res = await fetch('/add', { method: 'POST', body: new FormData(ui.userForm) }); const data = await res.json(); if (res.ok && data.success) { clearForm(); Swal.fire({ icon: 'success', title: 'تم!', text: 'تمت العملية بنجاح.', timer: 1500, showConfirmButton: false }); } else { Swal.fire('خطأ!', data.message || 'فشل الحفظ. تأكد من إدخال البيانات بشكل صحيح.', 'error'); } } catch (err) { Swal.fire('خطأ!', `فشل الاتصال بالخادم: ${err.message}`, 'error'); } });
        ui.clearFormBtn.addEventListener('click', clearForm);
        ui.addCandidateBtn.addEventListener('click', () => { Swal.fire({ title: 'ترشيح زاحف جديد', input: 'text', inputLabel: 'اكتب اسم الزاحف لإضافته للمرشحين', showCancelButton: true, confirmButtonText: 'إضافة', inputValidator: (v) => !v && 'يجب كتابة اسم!' }).then(r => r.isConfirmed && r.value && window.toggleCandidate(r.value.trim(), false).then(() => Swal.fire('تم!', `تمت إضافة ${r.value} للمرشحين.`, 'success'))); });
        ui.announcementForm.addEventListener('submit', async e => { e.preventDefault(); if (!e.target.text.value.trim()) return; await fetch('/api/admin/announcements/add', { method: 'POST', body: new FormData(e.target) }); e.target.reset(); });
        ui.honorRollForm.addEventListener('submit', async e => { e.preventDefault(); if (!e.target.name.value.trim()) return; await fetch('/api/admin/honor_roll/add', { method: 'POST', body: new FormData(e.target) }); e.target.reset(); });
        ui.addPrizeBtn.addEventListener('click', () => addPrizeInput());
        ui.spinWheelSettingsForm.addEventListener('submit', async (e) => {
            e.preventDefault(); const settings = { enabled: ui.spinWheelEnabledToggle.checked, cooldownHours: parseInt(ui.spinCooldownHours.value, 10), maxAttempts: parseInt(ui.spinMaxAttempts.value, 10), prizes: [] };
            document.querySelectorAll('.prize-row').forEach(row => { const value = parseFloat(row.querySelector('.prize-value').value); const weight = parseFloat(row.querySelector('.prize-weight').value); if (!isNaN(value) && !isNaN(weight) && value > 0 && weight > 0) { settings.prizes.push({ value, weight }); } });
            if (settings.prizes.length === 0) { Swal.fire('خطأ!', 'يجب إضافة جائزة واحدة على الأقل ببيانات صحيحة.', 'error'); return; }
            try { const res = await fetch('/api/admin/settings/spin_wheel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }); const data = await res.json(); if (!res.ok || !data.success) throw new Error(data.message || 'فشل غير معروف'); Swal.fire({ icon: 'success', title: data.message, toast: true, position: 'top-end', showConfirmButton: false, timer: 2500 }); } catch (err) { Swal.fire('خطأ!', err.message, 'error'); }
        });
    };

    window.editUserFromTable = (name) => { const user = usersCache[name]; if (!user) return; ui.nameInput.value = name; ui.pointsInput.value = user.points || 0; ui.originalNameInput.value = name; ui.formTitle.innerText = `تعديل الزاحف: ${name}`; ui.saveUserBtn.innerText = 'حفظ التعديلات'; ui.saveUserBtn.classList.replace('btn-primary', 'btn-warning'); ui.clearFormBtn.style.display = 'inline-block'; ui.nameInput.focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    window.confirmDelete = (name) => { Swal.fire({ title: `هل أنت متأكد؟`, text: `سيتم حذف الزاحف ${name} نهائياً!`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'نعم!', cancelButtonText: 'إلغاء' }).then(r => { if (r.isConfirmed) { fetch(`/delete/${name}`, { method: 'POST' }); } }); };

    window.confirmBanUser = (userId, userName) => {
        Swal.fire({
            title: `حظر المستخدم "${userName}"؟`,
            text: 'سيتم منعه من استخدام الموقع.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonText: 'إلغاء',
            confirmButtonText: 'نعم، احظر!'
        }).then(result => {
            if (result.isConfirmed) {
                fetch(`/api/admin/ban_user`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ user_id_to_ban: userId, user_name_to_ban: userName })
                });
            }
        });
    };

    window.unbanUser = (userId) => {
        fetch(`/api/admin/unban_user/${userId}`, { method: 'POST' });
    };

    window.sendUserMessage = (userId, userName) => {
        Swal.fire({
            title: `إرسال رسالة إلى ${userName}`,
            input: 'textarea',
            inputLabel: 'نص الرسالة',
            showCancelButton: true,
            confirmButtonText: 'إرسال',
            cancelButtonText: 'إلغاء',
            inputValidator: (v) => !v && 'يجب كتابة رسالة!'
        }).then(result => {
            if (result.isConfirmed && result.value) {
                // START: تعديل - الآن نمرر اسم المستخدم أيضاً
                fetch('/api/admin/user_message/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ user_id: userId, user_name: userName, message: result.value })
                }).then(res => res.json()).then(data => {
                    Swal.fire(data.success ? 'تم!' : 'خطأ!', data.message, data.success ? 'success' : 'error');
                });
                // END: تعديل
            }
        });
    };

    window.deleteAnnouncement = (id) => fetch(`/api/admin/announcements/delete/${id}`, { method: 'POST' });
    window.deleteFromHonorRoll = (id) => fetch(`/api/admin/honor_roll/delete/${id}`, { method: 'POST' });
    window.toggleCandidate = (name, isCandidate) => fetch(`/api/admin/candidate/${isCandidate ? 'remove' : 'add'}/${name}`, { method: 'POST' });

    initializeFirebaseAndAuth();
});
// --- END OF FILE static/js/admin.js ---