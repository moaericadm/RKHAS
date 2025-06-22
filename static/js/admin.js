// --- START OF FILE static/js/admin.js ---
document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('adminTab')) return;

    // --- UI Elements ---
    const ui = {
        tableBody: document.getElementById('admin-table-body'),
        registeredUsersTableBody: document.getElementById('registered-users-table-body'), // <-- ADDED
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
    let usersCache = {};
    let candidatesData = {};

    // --- Helper Functions ---
    const formatNumber = (num) => new Intl.NumberFormat('en-US').format(num || 0);
    const parseSnapshot = (snapshot) => {
        const data = snapshot.val() || {};
        return Object.keys(data).map(key => ({ id: key, ...data[key] }));
    };

    // --- START: Registered Users Rendering ---
    const renderRegisteredUsers = (snapshot) => {
        if (!ui.registeredUsersTableBody) return;
        ui.registeredUsersTableBody.innerHTML = '';
        const usersData = snapshot.val() || {};
        const usersList = Object.keys(usersData).map(uid => ({ uid, ...usersData[uid] }));

        if (usersList.length > 0) {
            usersList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // Sort by newest first
            usersList.forEach(user => {
                const tr = document.createElement('tr');
                const registrationDate = user.createdAt ? new Date(user.createdAt * 1000).toLocaleDateString('ar-EG') : 'غير معروف';
                const photoURL = user.photoURL || 'https://i.imgur.com/sC3b3d5.png';

                tr.innerHTML = `
                    <td><img src="${photoURL}" alt="avatar" width="40" height="40" class="rounded-circle"></td>
                    <td class="align-middle fw-bold">${user.displayName || 'لا يوجد اسم'}</td>
                    <td class="align-middle">${user.email || 'لا يوجد بريد'}</td>
                    <td class="align-middle">${registrationDate}</td>
                    <td class="align-middle"><small class="text-muted" style="font-size: 0.8em; word-break: break-all;">${user.uid}</small></td>
                `;
                ui.registeredUsersTableBody.appendChild(tr);
            });
        } else {
            ui.registeredUsersTableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">لا يوجد مستخدمين مسجلين.</td></tr>';
        }
    };
    // --- END: Registered Users Rendering ---

    // --- The rest of the functions from your file ---
    const createUserRowHTML = (user) => {
        const isCandidate = user.name in candidatesData;
        return `
            <td class="align-middle fw-bold">${user.name}</td>
            <td class="text-center align-middle">${formatNumber(user.points)}</td>
            <td class="text-center align-middle"><i class="bi bi-heart-fill text-danger"></i> ${formatNumber(user.likes || 0)}</td>
            <td class="text-center align-middle">
                <button class="btn btn-info btn-sm" onclick="window.editUserFromTable('${user.name}')" title="تعديل"><i class="bi bi-pencil-fill"></i></button>
                <button class="btn ${isCandidate ? 'btn-warning' : 'btn-outline-success'} btn-sm ms-2" onclick="window.toggleCandidate('${user.name}', ${isCandidate})" title="${isCandidate ? 'إزالة ترشيح' : 'إضافة كمرشح'}"><i class="bi ${isCandidate ? 'bi-person-x-fill' : 'bi-person-check-fill'}"></i></button>
                <button class="btn btn-danger btn-sm ms-2" onclick="window.confirmDelete('${user.name}')" title="حذف نهائي"><i class="bi bi-trash-fill"></i></button>
            </td>
        `;
    };

    const updateRanks = () => {
        ui.tableBody.querySelectorAll('tr').forEach((row, index) => {
            const rankCell = row.querySelector('th');
            if (rankCell) rankCell.textContent = `#${index + 1}`;
        });
    };

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

    const addUserToTable = (user) => {
        if (!usersCache[user.name] || document.getElementById(`user-row-${user.name}`)) return;
        const newRow = document.createElement('tr');
        newRow.id = `user-row-${user.name}`;
        newRow.dataset.username = user.name;
        newRow.dataset.points = user.points || 0;
        const rankPlaceholder = document.createElement('th');
        rankPlaceholder.className = 'align-middle';
        newRow.appendChild(rankPlaceholder);
        newRow.innerHTML += createUserRowHTML(user);
        const position = findInsertPosition(user.points || 0);
        ui.tableBody.insertBefore(newRow, position);
        updateRanks();
    };

    const updateUserInTable = (user) => {
        const row = document.getElementById(`user-row-${user.name}`);
        if (!row) {
            addUserToTable(user);
            return;
        }
        const oldPoints = parseInt(row.dataset.points, 10);
        if (oldPoints === (user.points || 0)) {
            row.innerHTML = `<th class="align-middle">${row.querySelector('th').textContent}</th>` + createUserRowHTML(user);
        } else {
            row.remove();
            addUserToTable(user);
        }
    };

    const removeUserFromTable = (username) => {
        const row = document.getElementById(`user-row-${username}`);
        if (row) { row.remove(); updateRanks(); }
    };

    const initializeUserList = () => {
        const usersRef = db.ref('users');
        ui.tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-5"><div class="spinner-border"></div></td></tr>';
        usersRef.orderByChild('points').once('value', (snapshot) => {
            const initialUsers = [];
            snapshot.forEach(childSnapshot => {
                initialUsers.push({ name: childSnapshot.key, ...childSnapshot.val() });
            });
            initialUsers.reverse();
            ui.tableBody.innerHTML = '';
            initialUsers.forEach(user => {
                usersCache[user.name] = user;
                addUserToTable(user);
            });
            if (initialUsers.length === 0) {
                ui.tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">لا يوجد مستخدمين.</td></tr>';
            }
            usersRef.on('child_added', (snapshot) => {
                const user = { name: snapshot.key, ...snapshot.val() };
                if (!usersCache[user.name]) {
                    usersCache[user.name] = user;
                    addUserToTable(user);
                }
            });
            usersRef.on('child_changed', (snapshot) => {
                const user = { name: snapshot.key, ...snapshot.val() };
                usersCache[user.name] = user;
                updateUserInTable(user);
            });
            usersRef.on('child_removed', (snapshot) => {
                const username = snapshot.key;
                delete usersCache[username];
                removeUserFromTable(username);
            });
        });
    };

    const renderBannedVisitors = (bannedSnapshot) => { /* ... unchanged ... */ };
    const renderActivityLog = (logSnapshot) => { /* ... unchanged ... */ };
    const renderAnnouncements = (announcementsSnapshot) => { /* ... unchanged ... */ };
    const renderHonorRoll = (honorRollSnapshot) => { /* ... unchanged ... */ };
    const addPrizeInput = (prize = { value: '', weight: '' }) => { /* ... unchanged ... */ };
    const loadSpinWheelSettings = () => { /* ... unchanged ... */ };
    const clearForm = () => { /* ... unchanged ... */ };

    ui.userForm.addEventListener('submit', async e => { /* ... unchanged ... */ });
    ui.clearFormBtn.addEventListener('click', clearForm);
    ui.addCandidateBtn.addEventListener('click', () => { /* ... unchanged ... */ });
    ui.announcementForm.addEventListener('submit', async e => { /* ... unchanged ... */ });
    ui.honorRollForm.addEventListener('submit', async e => { /* ... unchanged ... */ });
    ui.addPrizeBtn.addEventListener('click', () => addPrizeInput());
    ui.spinWheelSettingsForm.addEventListener('submit', async (e) => { /* ... unchanged ... */ });

    window.editUserFromTable = (name) => { /* ... unchanged ... */ };
    window.confirmDelete = (name) => { /* ... unchanged ... */ };
    window.confirmBanVisitor = (name) => { /* ... unchanged ... */ };
    window.unbanVisitor = (name) => { /* ... unchanged ... */ };
    window.deleteAnnouncement = (id) => { /* ... unchanged ... */ };
    window.deleteFromHonorRoll = (id) => { /* ... unchanged ... */ };
    window.toggleCandidate = (name, isCandidate) => { /* ... unchanged ... */ };
    window.sendVisitorMessage = (visitorName) => { /* ... unchanged ... */ };

    // --- Initial Data Load and Listeners Setup ---
    initializeUserList();
    db.ref('registered_users').on('value', renderRegisteredUsers); // <-- ADDED
    db.ref('candidates').on('value', snapshot => {
        candidatesData = snapshot.val() || {};
        Object.values(usersCache).forEach(updateUserInTable);
    });
    db.ref('banned_visitors').on('value', renderBannedVisitors);
    db.ref('activity_log').orderByChild('timestamp').limitToLast(100).on('value', renderActivityLog);
    db.ref('site_settings/announcements').on('value', renderAnnouncements);
    db.ref('site_settings/honor_roll').on('value', renderHonorRoll);
    if (ui.spinWheelSettingsForm) loadSpinWheelSettings();
});
// --- END OF FILE static/js/admin.js ---
