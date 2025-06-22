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
            console.log("Firebase initialized in admin.js");
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

    // --- Local State and Caches ---
    let usersCache = {}; // Cache for user data to avoid re-fetching
    let candidatesData = {}; // Cache for candidate data

    // --- Helper Functions ---
    const formatNumber = (num) => new Intl.NumberFormat('en-US').format(num || 0);
    const parseSnapshot = (snapshot) => {
        const data = snapshot.val() || {};
        return Object.keys(data).map(key => ({ id: key, ...data[key] }));
    };

    // --- START: OPTIMIZED USER TABLE RENDERING LOGIC ---

    // Creates the HTML for a single user row.
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

    // Updates the rank number (#) for all rows in the table.
    const updateRanks = () => {
        ui.tableBody.querySelectorAll('tr').forEach((row, index) => {
            row.querySelector('th').textContent = `#${index + 1}`;
        });
    };

    // Finds the correct position to insert a new or updated row based on points.
    const findInsertPosition = (userPoints) => {
        const rows = ui.tableBody.querySelectorAll('tr');
        let insertBeforeNode = null;
        for (const row of rows) {
            const rowPoints = parseInt(row.dataset.points, 10);
            if (userPoints > rowPoints) {
                insertBeforeNode = row;
                break;
            }
        }
        return insertBeforeNode;
    };

    // Adds a new user row to the table in the correct sorted position.
    const addUserToTable = (user) => {
        if (!usersCache[user.name]) return; // Avoid adding if already removed

        const newRow = document.createElement('tr');
        newRow.id = `user-row-${user.name}`;
        newRow.dataset.username = user.name;
        newRow.dataset.points = user.points;

        const rankPlaceholder = document.createElement('th');
        rankPlaceholder.className = 'align-middle';
        newRow.appendChild(rankPlaceholder);
        newRow.innerHTML += createUserRowHTML(user);

        const position = findInsertPosition(user.points);
        ui.tableBody.insertBefore(newRow, position);
        updateRanks();
    };

    // Updates an existing user row. If points change, it re-sorts the row.
    const updateUserInTable = (user) => {
        const row = document.getElementById(`user-row-${user.name}`);
        if (!row) return;

        const oldPoints = parseInt(row.dataset.points, 10);

        // If points haven't changed, just update the content.
        if (oldPoints === user.points) {
            row.innerHTML = `<th class="align-middle">${row.querySelector('th').textContent}</th>` + createUserRowHTML(user);
        } else {
            // If points changed, remove the old row and insert a new one in the correct sorted position.
            row.remove();
            addUserToTable(user);
        }
    };

    // Removes a user row from the table.
    const removeUserFromTable = (username) => {
        const row = document.getElementById(`user-row-${username}`);
        if (row) {
            row.remove();
            updateRanks();
        }
    };

    const initializeUserList = () => {
        const usersRef = db.ref('users');

        // Step 1: Initial load (fetch all data once, sorted by points)
        ui.tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-5"><div class="spinner-border"></div> <p>جاري تحميل القائمة لأول مرة...</p></td></tr>';
        usersRef.orderByChild('points').once('value', (snapshot) => {
            const initialUsers = [];
            snapshot.forEach(childSnapshot => {
                initialUsers.push({ name: childSnapshot.key, ...childSnapshot.val() });
            });

            // Reverse the array because orderByChild('points') is ascending
            initialUsers.reverse();

            ui.tableBody.innerHTML = ''; // Clear loading spinner
            initialUsers.forEach(user => {
                usersCache[user.name] = user; // Populate cache
                addUserToTable(user); // Add to table
            });

            // If no users, show empty message
            if (initialUsers.length === 0) {
                ui.tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">لا يوجد مستخدمين.</td></tr>';
            }

            // Step 2: Set up real-time listeners for individual changes

            // Fires when a new user is added
            usersRef.on('child_added', (snapshot) => {
                const user = { name: snapshot.key, ...snapshot.val() };
                if (!usersCache[user.name]) { // Check if it's truly new
                    console.log('User added:', user.name);
                    usersCache[user.name] = user;
                    addUserToTable(user);
                }
            });

            // Fires when a user's data (e.g., points) changes
            usersRef.on('child_changed', (snapshot) => {
                const user = { name: snapshot.key, ...snapshot.val() };
                console.log('User changed:', user.name);
                usersCache[user.name] = user;
                updateUserInTable(user);
            });

            // Fires when a user is deleted
            usersRef.on('child_removed', (snapshot) => {
                const username = snapshot.key;
                console.log('User removed:', username);
                delete usersCache[username];
                removeUserFromTable(username);
            });

        });
    };

    // --- END: OPTIMIZED USER TABLE RENDERING LOGIC ---


    // --- Other Panel Rendering Functions (unchanged) ---
    const renderBannedVisitors = (bannedSnapshot) => {
        if (!ui.bannedVisitorsList) return;
        const bannedList = parseSnapshot(bannedSnapshot);
        ui.bannedVisitorsList.innerHTML = '';
        if (bannedList.length > 0) {
            bannedList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).forEach(user => {
                const li = document.createElement('li');
                li.className = 'list-group-item d-flex justify-content-between align-items-center';
                li.innerHTML = `<span>${user.id} <small class="text-muted">(${new Date((user.timestamp || 0) * 1000).toLocaleDateString()})</small></span><button class="btn btn-outline-success btn-sm" onclick="window.unbanVisitor('${user.id}')">إلغاء الحظر</button>`;
                ui.bannedVisitorsList.appendChild(li);
            });
        } else {
            ui.bannedVisitorsList.innerHTML = '<li class="list-group-item text-muted text-center">لا يوجد زوار محظورون.</li>';
        }
    };

    const renderActivityLog = (logSnapshot) => {
        if (!ui.activityLogList) return;
        const sortedLog = parseSnapshot(logSnapshot).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        ui.activityLogList.innerHTML = '';
        if (sortedLog.length > 0) {
            sortedLog.slice(0, 100).forEach(item => {
                const li = document.createElement('li');
                li.className = 'list-group-item d-flex justify-content-between align-items-center flex-wrap';
                const iconClass = {
                    'like': 'bi-heart-fill text-danger',
                    'nomination': 'bi-person-up text-success',
                    'report': 'bi-flag-fill text-warning',
                    'gift': 'bi-gift-fill text-info'
                }[item.type] || 'bi-info-circle-fill';

                let actionButtons = '';
                if (item.visitor_name) {
                    actionButtons = `
                        <button class="btn btn-info btn-sm ms-2" onclick="window.sendVisitorMessage('${item.visitor_name}')" title="إرسال رسالة"><i class="bi bi-chat-dots-fill"></i></button>
                        <button class="btn btn-danger btn-sm ms-2" onclick="window.confirmBanVisitor('${item.visitor_name}')" title="حظر هذا الزائر"><i class="bi bi-slash-circle-fill"></i></button>
                    `;
                }
                li.innerHTML = `<div class="me-auto py-1"><i class="bi ${iconClass} me-2"></i>${item.text}</div><div class="d-flex align-items-center py-1"><small class="text-muted me-3">${new Date(item.timestamp * 1000).toLocaleString('ar-EG')}</small>${actionButtons}</div>`;
                ui.activityLogList.appendChild(li);
            });
        } else {
            ui.activityLogList.innerHTML = '<li class="list-group-item text-center text-muted">لا توجد أنشطة مسجلة.</li>';
        }
    };

    const renderAnnouncements = (announcementsSnapshot) => {
        if (!ui.announcementsList) return;
        const announcements = parseSnapshot(announcementsSnapshot);
        ui.announcementsList.innerHTML = '';
        if (announcements.length > 0) {
            announcements.forEach(item => {
                const li = document.createElement('li');
                li.className = 'list-group-item d-flex justify-content-between align-items-center';
                li.innerHTML = `<span>${item.text}</span><button class="btn btn-outline-danger btn-sm" onclick="window.deleteAnnouncement('${item.id}')">×</button>`;
                ui.announcementsList.appendChild(li);
            });
        } else {
            ui.announcementsList.innerHTML = '<li class="list-group-item text-center text-muted">لا توجد إعلانات.</li>';
        }
    };

    const renderHonorRoll = (honorRollSnapshot) => {
        if (!ui.honorRollList) return;
        const honorList = parseSnapshot(honorRollSnapshot);
        ui.honorRollList.innerHTML = '';
        if (honorList.length > 0) {
            honorList.forEach(item => {
                const li = document.createElement('li');
                li.className = 'list-group-item d-flex justify-content-between align-items-center';
                li.innerHTML = `<span>${item.name}</span><button class="btn btn-outline-danger btn-sm" onclick="window.deleteFromHonorRoll('${item.id}')">×</button>`;
                ui.honorRollList.appendChild(li);
            });
        } else {
            ui.honorRollList.innerHTML = '<li class="list-group-item text-center text-muted">القائمة فارغة.</li>';
        }
    };

    // --- Spin Wheel Settings Functions ---
    const addPrizeInput = (prize = { value: '', weight: '' }) => {
        const prizeRow = document.createElement('div');
        prizeRow.className = 'input-group prize-row';
        prizeRow.innerHTML = `
            <span class="input-group-text">الجائزة:</span>
            <input type="number" class="form-control prize-value" placeholder="قيمة النقاط" value="${prize.value}" required>
            <span class="input-group-text">الوزن:</span>
            <input type="number" step="any" class="form-control prize-weight" placeholder="نسبة الحظ" value="${prize.weight}" required>
            <button class="btn btn-outline-danger remove-prize-btn" type="button"><i class="bi bi-trash-fill"></i></button>
        `;
        ui.prizesContainer.appendChild(prizeRow);
        prizeRow.querySelector('.remove-prize-btn').addEventListener('click', () => prizeRow.remove());
    };

    const loadSpinWheelSettings = () => {
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
        });
    };

    // --- Form and Button Event Listeners ---
    const clearForm = () => {
        ui.userForm.reset();
        ui.originalNameInput.value = '';
        ui.formTitle.innerText = 'إضافة مستخدم جديد';
        ui.saveUserBtn.innerText = 'إضافة';
        ui.saveUserBtn.classList.replace('btn-warning', 'btn-primary');
        ui.clearFormBtn.style.display = 'none';
    };

    ui.userForm.addEventListener('submit', async e => {
        e.preventDefault();
        try {
            const res = await fetch('/add', { method: 'POST', body: new FormData(ui.userForm) });
            if (res.ok) {
                clearForm();
            } else {
                Swal.fire('خطأ!', 'فشل الحفظ. تأكد من إدخال البيانات بشكل صحيح.', 'error');
            }
        } catch {
            Swal.fire('خطأ!', 'فشل الاتصال بالخادم.', 'error');
        }
    });

    ui.clearFormBtn.addEventListener('click', clearForm);

    ui.addCandidateBtn.addEventListener('click', () => {
        Swal.fire({
            title: 'ترشيح مستخدم جديد',
            input: 'text',
            inputLabel: 'اكتب اسم المستخدم لإضافته للمرشحين',
            inputPlaceholder: 'اسم المرشح...',
            showCancelButton: true,
            confirmButtonText: 'إضافة',
            cancelButtonText: 'إلغاء',
            inputValidator: (v) => !v && 'يجب كتابة اسم!'
        }).then(r => r.isConfirmed && r.value && window.toggleCandidate(r.value.trim(), false).then(() => Swal.fire('تم!', `تمت إضافة ${r.value} للمرشحين.`, 'success')));
    });

    ui.announcementForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (!ui.announcementText.value.trim()) return;
        await fetch('/api/admin/announcements/add', { method: 'POST', body: new FormData(ui.announcementForm) });
        ui.announcementForm.reset();
    });

    ui.honorRollForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (!ui.honorNameInput.value.trim()) return;
        await fetch('/api/admin/honor_roll/add', { method: 'POST', body: new URLSearchParams({ name: ui.honorNameInput.value }) });
        ui.honorNameInput.value = '';
    });

    ui.addPrizeBtn.addEventListener('click', () => addPrizeInput());

    ui.spinWheelSettingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const settings = {
            enabled: ui.spinWheelEnabledToggle.checked,
            cooldownHours: parseInt(ui.spinCooldownHours.value, 10),
            maxAttempts: parseInt(ui.spinMaxAttempts.value, 10),
            prizes: []
        };

        document.querySelectorAll('.prize-row').forEach(row => {
            const value = parseFloat(row.querySelector('.prize-value').value);
            const weight = parseFloat(row.querySelector('.prize-weight').value);
            if (!isNaN(value) && !isNaN(weight)) {
                settings.prizes.push({ value, weight });
            }
        });

        if (settings.prizes.length === 0) {
            Swal.fire('خطأ!', 'يجب إضافة جائزة واحدة على الأقل.', 'error');
            return;
        }

        try {
            const res = await fetch('/api/admin/settings/spin_wheel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'فشل غير معروف من الخادم');
            Swal.fire({ icon: 'success', title: data.message, toast: true, position: 'top-end', showConfirmButton: false, timer: 2500 });
        } catch (err) {
            Swal.fire('خطأ!', err.message || 'فشل حفظ إعدادات عجلة الحظ.', 'error');
        }
    });

    // --- Global Window Functions (for inline onclicks) ---
    window.editUserFromTable = (name) => {
        const user = usersCache[name];
        if (!user) return;
        ui.nameInput.value = name;
        ui.pointsInput.value = user.points || 0;
        ui.originalNameInput.value = name;
        ui.formTitle.innerText = `تعديل المستخدم: ${name}`;
        ui.saveUserBtn.innerText = 'حفظ التعديلات';
        ui.saveUserBtn.classList.replace('btn-primary', 'btn-warning');
        ui.clearFormBtn.style.display = 'inline-block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.confirmDelete = (name) => {
        Swal.fire({
            title: `هل أنت متأكد؟`,
            text: `سيتم حذف الزاحف ${name} نهائياً!`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'نعم!',
            cancelButtonText: 'إلغاء'
        }).then(r => {
            if (r.isConfirmed) {
                fetch(`/delete/${name}`, { method: 'POST' }).catch(() => Swal.fire('خطأ!', 'فشلت عملية الحذف.', 'error'));
            }
        });
    };

    window.confirmBanVisitor = (name) => {
        Swal.fire({
            title: `حظر الزائر "${name}"؟`,
            text: 'سيتم منعه من استخدام الموقع.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'نعم، احظر!',
            cancelButtonText: 'إلغاء'
        }).then(r => {
            if (r.isConfirmed) {
                fetch(`/api/admin/ban_visitor`, { method: 'POST', body: new URLSearchParams({ name_to_ban: name }) }).catch(() => Swal.fire('خطأ!', 'فشلت عملية الحظر.', 'error'));
            }
        });
    };

    window.unbanVisitor = (name) => fetch(`/api/admin/unban_visitor/${name}`, { method: 'POST' }).catch(() => Swal.fire('خطأ!', 'فشلت عملية رفع الحظر.', 'error'));
    window.deleteAnnouncement = (id) => fetch(`/api/admin/announcements/delete/${id}`, { method: 'POST' }).catch(() => Swal.fire('خطأ!', 'فشلت عملية حذف الإعلان.', 'error'));
    window.deleteFromHonorRoll = (id) => fetch(`/api/admin/honor_roll/delete/${id}`, { method: 'POST' }).catch(() => Swal.fire('خطأ!', 'فشلت عملية الحذف.', 'error'));
    window.toggleCandidate = (name, isCandidate) => fetch(`/api/admin/candidate/${isCandidate ? 'remove' : 'add'}/${name}`, { method: 'POST' }).catch(() => Swal.fire('خطأ!', 'فشلت عملية الترشيح.', 'error'));

    window.sendVisitorMessage = (visitorName) => {
        Swal.fire({
            title: `إرسال رسالة إلى ${visitorName}`, input: 'textarea', inputLabel: 'نص الرسالة',
            inputPlaceholder: 'اكتب رسالتك هنا...', showCancelButton: true, confirmButtonText: 'إرسال',
            cancelButtonText: 'إلغاء',
            inputValidator: (value) => !value && 'لا يمكنك إرسال رسالة فارغة!'
        }).then(result => {
            if (result.isConfirmed && result.value) {
                fetch('/api/admin/visitor_message/send', {
                    method: 'POST', body: new URLSearchParams({ visitor_name: visitorName, message: result.value })
                }).then(res => res.json()).then(data => {
                    if (data.success) Swal.fire('تم!', data.message, 'success');
                    else Swal.fire('خطأ!', data.message, 'error');
                }).catch(() => Swal.fire('خطأ!', 'فشل الاتصال بالخادم.', 'error'));
            }
        });
    };

    // --- Initial Data Load and Listeners Setup ---
    initializeUserList();
    db.ref('candidates').on('value', snapshot => {
        candidatesData = snapshot.val() || {};
        // Re-render all rows to update candidate buttons
        Object.values(usersCache).forEach(updateUserInTable);
    });
    db.ref('banned_visitors').on('value', renderBannedVisitors);
    db.ref('activity_log').orderByChild('timestamp').limitToLast(100).on('value', renderActivityLog);
    db.ref('site_settings/announcements').on('value', renderAnnouncements);
    db.ref('site_settings/honor_roll').on('value', renderHonorRoll);
    loadSpinWheelSettings();
});
// --- END OF FILE admin.js ---
