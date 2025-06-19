document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('adminTab')) return;

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
        spinWheelToggle: document.getElementById('spin-wheel-toggle'),
    };

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
    let usersData = {}, candidatesData = {};

    const formatNumber = (num) => new Intl.NumberFormat('en-US').format(num || 0);
    const parseSnapshot = (snapshot) => {
        const data = snapshot.val() || {};
        return Object.keys(data).map(key => ({ id: key, ...data[key] }));
    };

    const renderAdminTable = () => {
        if (!ui.tableBody) return;
        const userList = Object.keys(usersData).map(key => ({
            name: key,
            points: parseInt(usersData[key].points || 0),
            likes: parseInt(usersData[key].likes || 0),
            is_candidate: key in candidatesData
        })).sort((a, b) => b.points - a.points);

        ui.tableBody.innerHTML = '';
        if (userList.length > 0) {
            userList.forEach((user, index) => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <th class="align-middle">#${index + 1}</th>
                    <td class="align-middle fw-bold">${user.name}</td>
                    <td class="text-center align-middle">${formatNumber(user.points)}</td>
                    <td class="text-center align-middle"><i class="bi bi-heart-fill text-danger"></i> ${formatNumber(user.likes)}</td>
                    <td class="text-center align-middle">
                        <button class="btn btn-info btn-sm" onclick="window.editUserFromTable('${user.name}')" title="تعديل"><i class="bi bi-pencil-fill"></i></button>
                        <button class="btn ${user.is_candidate ? 'btn-warning' : 'btn-outline-success'} btn-sm ms-2" onclick="window.toggleCandidate('${user.name}', ${user.is_candidate})" title="${user.is_candidate ? 'إزالة ترشيح' : 'إضافة كمرشح'}"><i class="bi ${user.is_candidate ? 'bi-person-x-fill' : 'bi-person-check-fill'}"></i></button>
                        <button class="btn btn-danger btn-sm ms-2" onclick="window.confirmDelete('${user.name}')" title="حذف نهائي"><i class="bi bi-trash-fill"></i></button>
                    </td>`;
                ui.tableBody.appendChild(row);
            });
        } else {
            ui.tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">لا يوجد مستخدمين.</td></tr>';
        }
    };

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

    const clearForm = () => {
        if (ui.userForm) ui.userForm.reset();
        if (ui.originalNameInput) ui.originalNameInput.value = '';
        if (ui.formTitle) ui.formTitle.innerText = 'إضافة مستخدم جديد';
        if (ui.saveUserBtn) {
            ui.saveUserBtn.innerText = 'إضافة';
            ui.saveUserBtn.classList.replace('btn-warning', 'btn-primary');
        }
        if (ui.clearFormBtn) ui.clearFormBtn.style.display = 'none';
    };

    window.editUserFromTable = (name) => {
        const user = usersData[name];
        if (!user || !ui.nameInput || !ui.pointsInput || !ui.originalNameInput || !ui.formTitle || !ui.saveUserBtn || !ui.clearFormBtn) return;
        ui.nameInput.value = name;
        ui.pointsInput.value = user.points || 0;
        ui.originalNameInput.value = name;
        ui.formTitle.innerText = `تعديل المستخدم: ${name}`;
        ui.saveUserBtn.innerText = 'حفظ التعديلات';
        ui.saveUserBtn.classList.replace('btn-primary', 'btn-warning');
        ui.clearFormBtn.style.display = 'inline-block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.confirmDelete = (name) => Swal.fire({ title: `هل أنت متأكد؟`, text: `سيتم حذف الزاحف ${name} نهائياً!`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'نعم!', cancelButtonText: 'إلغاء' }).then(r => {
        if (r.isConfirmed) {
            fetch(`/delete/${name}`, { method: 'POST' })
                .then(res => { if (!res.ok) throw new Error('Server-side deletion failed'); })
                .catch(err => Swal.fire('خطأ!', 'فشلت عملية الحذف.', 'error'));
        }
    });

    window.confirmBanVisitor = (name) => Swal.fire({ title: `حظر الزائر "${name}"؟`, text: 'سيتم منعه من استخدام الموقع.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'نعم، احظر!', cancelButtonText: 'إلغاء' }).then(r => {
        if (r.isConfirmed) {
            fetch(`/api/admin/ban_visitor`, { method: 'POST', body: new URLSearchParams({ name_to_ban: name }) })
                .then(res => { if (!res.ok) throw new Error('Server-side ban failed'); })
                .catch(err => Swal.fire('خطأ!', 'فشلت عملية الحظر.', 'error'));
        }
    });

    window.unbanVisitor = (name) => fetch(`/api/admin/unban_visitor/${name}`, { method: 'POST' }).then(res => { if (!res.ok) Swal.fire('خطأ!', 'فشلت عملية رفع الحظر.', 'error'); });
    window.deleteAnnouncement = (id) => fetch(`/api/admin/announcements/delete/${id}`, { method: 'POST' }).then(res => { if (!res.ok) Swal.fire('خطأ!', 'فشلت عملية حذف الإعلان.', 'error'); });
    window.deleteFromHonorRoll = (id) => fetch(`/api/admin/honor_roll/delete/${id}`, { method: 'POST' }).then(res => { if (!res.ok) Swal.fire('خطأ!', 'فشلت عملية الحذف.', 'error'); });
    window.toggleCandidate = (name, isCandidate) => fetch(`/api/admin/candidate/${isCandidate ? 'remove' : 'add'}/${name}`, { method: 'POST' }).then(res => { if (!res.ok) Swal.fire('خطأ!', 'فشلت عملية الترشيح.', 'error'); });

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

    if (ui.userForm) ui.userForm.addEventListener('submit', async e => { e.preventDefault(); try { const res = await fetch('/add', { method: 'POST', body: new FormData(ui.userForm) }); if (res.ok) { clearForm(); } else { Swal.fire('خطأ!', 'فشل الحفظ. تأكد من إدخال البيانات بشكل صحيح.', 'error'); } } catch { Swal.fire('خطأ!', 'فشل الاتصال بالخادم.', 'error'); } });
    if (ui.clearFormBtn) ui.clearFormBtn.addEventListener('click', clearForm);
    if (ui.addCandidateBtn) ui.addCandidateBtn.addEventListener('click', () => Swal.fire({ title: 'ترشيح مستخدم جديد', input: 'text', inputLabel: 'اكتب اسم المستخدم لإضافته للمرشحين', inputPlaceholder: 'اسم المرشح...', showCancelButton: true, confirmButtonText: 'إضافة', cancelButtonText: 'إلغاء', inputValidator: (v) => !v && 'يجب كتابة اسم!' }).then(r => r.isConfirmed && r.value && window.toggleCandidate(r.value.trim(), false).then(() => Swal.fire('تم!', `تمت إضافة ${r.value} للمرشحين.`, 'success'))));
    if (ui.announcementForm) ui.announcementForm.addEventListener('submit', async e => { e.preventDefault(); const text = ui.announcementText.value.trim(); if (!text) return; await fetch('/api/admin/announcements/add', { method: 'POST', body: new FormData(ui.announcementForm) }); ui.announcementForm.reset(); });
    if (ui.honorRollForm) ui.honorRollForm.addEventListener('submit', async e => { e.preventDefault(); const name = ui.honorNameInput.value.trim(); if (!name) return; await fetch('/api/admin/honor_roll/add', { method: 'POST', body: new URLSearchParams({ name: ui.honorNameInput.value }) }); ui.honorNameInput.value = ''; });

    if (ui.spinWheelToggle) {
        ui.spinWheelToggle.addEventListener('change', async () => {
            const isEnabled = ui.spinWheelToggle.checked;
            try {
                const res = await fetch('/api/admin/settings/toggle_spin_wheel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ enabled: isEnabled.toString() })
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.message || 'فشل غير معروف من الخادم');
                Swal.fire({ icon: 'success', title: data.message, toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
            } catch (e) {
                Swal.fire('خطأ!', e.message || 'فشل تحديث إعداد عجلة الحظ.', 'error');
                ui.spinWheelToggle.checked = !isEnabled;
            }
        });
        db.ref('site_settings/spin_wheel_enabled').on('value', snapshot => {
            if (ui.spinWheelToggle) {
                ui.spinWheelToggle.checked = !!snapshot.val();
            }
        }, error => {
            console.error("Firebase error listening to spin_wheel_enabled:", error);
            if (ui.spinWheelToggle && ui.spinWheelToggle.parentElement) {
                let errorMsg = ui.spinWheelToggle.parentElement.querySelector('.firebase-error-msg');
                if (!errorMsg) {
                    errorMsg = document.createElement('small');
                    errorMsg.className = 'text-danger d-block mt-1 firebase-error-msg';
                    ui.spinWheelToggle.parentElement.appendChild(errorMsg);
                }
                errorMsg.textContent = 'خطأ في مزامنة إعداد العجلة.';
            }
        });
    } else {
        console.warn("Element with ID 'spin-wheel-toggle' not found in admin.html. Spin wheel control will not be available.");
    }

    db.ref('users').on('value', snapshot => { usersData = snapshot.val() || {}; renderAdminTable(); });
    db.ref('candidates').on('value', snapshot => { candidatesData = snapshot.val() || {}; renderAdminTable(); });
    db.ref('banned_visitors').on('value', renderBannedVisitors);
    db.ref('activity_log').orderByChild('timestamp').limitToLast(100).on('value', renderActivityLog);
    db.ref('site_settings/announcements').on('value', renderAnnouncements);
    db.ref('site_settings/honor_roll').on('value', renderHonorRoll);
});
