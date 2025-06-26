// --- START OF FILE static/js/game_lobby.js ---
document.addEventListener('DOMContentLoaded', () => {
    const gameLobbyCard = document.getElementById('game-lobby-card');
    if (!gameLobbyCard) return;

    let db; // سيتم تهيئته لاحقاً في دالة init
    let allUsersCache = [];
    let gameSettings = {};
    let currentLobbyId = null;
    let myPlayerKey = null;
    let lobbyListener = null;

    const ui = {
        onlineList: document.getElementById('online-users-list'),
        gameModal: document.getElementById('gameModal'),
        punchBtn: document.getElementById('punch-btn'),
        gameStatus: document.getElementById('game-status-text'),
        gf1: { name: document.getElementById('gf1-name'), proxy: document.getElementById('gf1-proxy'), health: document.getElementById('gf1-health'), div: document.getElementById('game-fighter1') },
        gf2: { name: document.getElementById('gf2-name'), proxy: document.getElementById('gf2-proxy'), health: document.getElementById('gf2-health'), div: document.getElementById('game-fighter2') }
    };

    function init(users, settings) {
        db = firebase.database(); // *** تم نقل تعريف قاعدة البيانات إلى هنا ***
        allUsersCache = users;
        gameSettings = settings;
        if (settings && settings.enabled) {
            gameLobbyCard.style.display = 'block';
            listenForOnlineUsers();
            listenForGameInvites();
            ui.punchBtn.addEventListener('click', handlePunch);
        }
    }

    function updateUserCache(users) {
        allUsersCache = users;
    }

    function listenForOnlineUsers() {
        if (!db) return;
        db.ref('online_visitors').on('value', snapshot => {
            const onlineUsers = snapshot.val() || {};
            ui.onlineList.innerHTML = '';
            let count = 0;
            const onlineUserList = Object.values(onlineUsers);
            onlineUserList.forEach(user => {
                if (user.user_id !== visitorId) {
                    count++;
                    const li = document.createElement('li');
                    li.className = 'list-group-item d-flex justify-content-between align-items-center';
                    li.innerHTML = `<span><i class="bi bi-person-check-fill text-success me-2"></i>${user.name}</span> <button class="btn btn-sm btn-outline-danger challenge-btn" data-uid="${user.user_id}" data-name="${user.name}">تحدي</button>`;
                    ui.onlineList.appendChild(li);
                }
            });
            if (count === 0) {
                ui.onlineList.innerHTML = '<li class="list-group-item text-center text-muted">لا يوجد لاعبون آخرون متصلون.</li>';
            }
        });
    }

    document.body.addEventListener('click', e => {
        if (e.target && e.target.classList.contains('challenge-btn')) {
            const opponentUid = e.target.dataset.uid;
            const opponentName = e.target.dataset.name;
            promptForGameDetails(opponentUid, opponentName);
        }
    });

    async function promptForGameDetails(opponentUid, opponentName) {
        const zahfOptions = allUsersCache.map(u => `<option value="${u.name}">${u.name} (${u.points.toLocaleString()})</option>`).join('');
        const { value: formValues } = await Swal.fire({
            title: `تحدي اللاعب ${opponentName}`,
            html: `<p class="text-muted small">اختر الزاحف الذي ستمثله والرهان!</p>` +
                `<select id="swal-zahf" class="swal2-select">${zahfOptions}</select>` +
                (gameSettings.fixedPoints > 0 ?
                    `<p class="mt-3">الرهان ثابت: <strong>${gameSettings.fixedPoints.toLocaleString()}</strong> نقطة</p><input id="swal-points" type="hidden" value="${gameSettings.fixedPoints}">` :
                    `<input id="swal-points" type="number" class="swal2-input" placeholder="عدد نقاط الرهان">`),
            focusConfirm: false,
            confirmButtonText: 'أرسل التحدي',
            showCancelButton: true,
            preConfirm: () => {
                const points = document.getElementById('swal-points').value;
                if (!points || parseInt(points) <= 0) {
                    Swal.showValidationMessage('الرجاء إدخال قيمة رهان صالحة');
                    return false;
                }
                return { proxyZahf: document.getElementById('swal-zahf').value, pointsBet: points }
            }
        });
        if (formValues) sendInvite(opponentUid, formValues.proxyZahf, formValues.pointsBet);
    }

    async function sendInvite(opponent_uid, proxy_zahf, points_bet) {
        try {
            const res = await fetch('/api/game/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ opponent_uid, proxy_zahf, points_bet })
            });
            const data = await res.json();
            Swal.fire(data.success ? 'تم!' : 'خطأ!', data.message, data.success ? 'success' : 'error');
        } catch (e) { Swal.fire('خطأ!', 'فشل الاتصال بالخادم.', 'error'); }
    }

    function listenForGameInvites() {
        db.ref('game_lobbies').orderByChild('player2_uid').equalTo(visitorId).on('child_added', snapshot => {
            const lobby = snapshot.val();
            if (lobby && lobby.status === 'pending') {
                handleInvite(snapshot.key, lobby);
            }
        });

        db.ref('game_lobbies').orderByChild('player1/uid').equalTo(visitorId).on('child_changed', snapshot => {
            const lobby = snapshot.val();
            if (lobby && lobby.status === 'active' && !currentLobbyId) {
                Swal.close();
                startGame(snapshot.key);
            } else if (lobby && lobby.status === 'declined') {
                Swal.fire('تم الرفض', 'لقد رفض خصمك التحدي.', 'info');
                snapshot.ref.remove();
            }
        });
    }

    function handleInvite(lobbyId, lobby) {
        Swal.fire({
            title: 'تحدي جديد!',
            text: `${lobby.player1.name} يتحداك للعب باسم الزاحف "${lobby.player1.proxyZahf}" مقابل ${lobby.player1.pointsBet.toLocaleString()} نقطة.`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'قبول',
            cancelButtonText: 'رفض',
            allowOutsideClick: false
        }).then(result => {
            if (result.isConfirmed) {
                promptForAcceptance(lobbyId);
            } else {
                respondToInvite(lobbyId, 'declined');
            }
        });
    }

    async function promptForAcceptance(lobbyId) {
        const zahfOptions = allUsersCache.map(u => `<option value="${u.name}">${u.name} (${u.points.toLocaleString()})</option>`).join('');
        const { value: formValues } = await Swal.fire({
            title: `قبول التحدي`,
            html: `<p class="text-muted small">اختر زاحفك والرهان!</p>` +
                `<select id="swal-zahf" class="swal2-select">${zahfOptions}</select>` +
                (gameSettings.fixedPoints > 0 ?
                    `<p class="mt-3">الرهان ثابت: <strong>${gameSettings.fixedPoints.toLocaleString()}</strong> نقطة</p><input id="swal-points" type="hidden" value="${gameSettings.fixedPoints}">` :
                    `<input id="swal-points" type="number" class="swal2-input" placeholder="عدد نقاط الرهان">`),
            focusConfirm: false,
            confirmButtonText: 'ادخل الحلبة!',
            preConfirm: () => {
                const points = document.getElementById('swal-points').value;
                if (!points || parseInt(points) <= 0) {
                    Swal.showValidationMessage('الرجاء إدخال قيمة رهان صالحة');
                    return false;
                }
                return { proxyZahf: document.getElementById('swal-zahf').value, pointsBet: points }
            }
        });
        if (formValues) respondToInvite(lobbyId, 'accepted', { proxyZahf: formValues.proxyZahf, pointsBet: formValues.pointsBet });
    }

    async function respondToInvite(lobbyId, response, details = {}) {
        try {
            const payload = { response, ...details };
            const res = await fetch(`/api/game/respond/${lobbyId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.success && response === 'accepted') {
                startGame(lobbyId);
            } else if (!data.success) {
                Swal.fire('خطأ!', data.message, 'error');
            }
        } catch (e) { console.error(e); }
    }

    function startGame(lobbyId) {
        if (currentLobbyId) return;
        currentLobbyId = lobbyId;
        ui.gameModal.classList.add('show');
        if (lobbyListener) lobbyListener.off();
        lobbyListener = db.ref(`game_lobbies/${lobbyId}`);
        lobbyListener.on('value', snapshot => {
            const lobby = snapshot.val();
            if (!lobby || !lobby.player1 || lobby.status === 'declined') {
                if (lobbyListener) lobbyListener.off();
                ui.gameModal.classList.remove('show');
                currentLobbyId = null;
                return;
            };
            if (!lobby.player2 && lobby.status === 'pending') return;
            myPlayerKey = (visitorId === lobby.player1.uid) ? 'player1' : 'player2';
            updateGameUI(lobby);
            if (lobby.status === 'finished') {
                handleGameEnd(lobby);
            }
        });
    }

    function updateGameUI(lobby) {
        ui.gf1.name.textContent = lobby.player1.name;
        ui.gf1.proxy.textContent = `(يلعب بـ: ${lobby.player1.proxyZahf})`;
        ui.gf1.health.style.width = `${lobby.player1_health}%`;
        ui.gf2.name.textContent = lobby.player2.name;
        ui.gf2.proxy.textContent = `(يلعب بـ: ${lobby.player2.proxyZahf})`;
        ui.gf2.health.style.width = `${lobby.player2_health}%`;
        const isMyTurn = lobby.turn === visitorId;
        ui.punchBtn.disabled = !isMyTurn || lobby.status !== 'active';
        ui.punchBtn.querySelector('.spinner-border').style.display = 'none';
        if (lobby.status === 'active') {
            ui.gameStatus.textContent = isMyTurn ? "دورك! وجه لكمة!" : `انتظر دور ${lobby.turn === lobby.player1.uid ? lobby.player1.name : lobby.player2.name}`;
            if (lobby.last_hit > 0) ui.gameStatus.innerHTML += `<br><small class="text-white-50">آخر لكمة سببت ضرر ${lobby.last_hit}</small>`;
        }
    }

    async function handlePunch() {
        if (!currentLobbyId) return;
        ui.punchBtn.disabled = true;
        ui.punchBtn.querySelector('.spinner-border').style.display = 'inline-block';
        try {
            await fetch(`/api/game/punch/${currentLobbyId}`, { method: 'POST' });
        } catch (e) {
            console.error("Punch error:", e);
            ui.punchBtn.disabled = false;
            ui.punchBtn.querySelector('.spinner-border').style.display = 'none';
        }
    }

    function handleGameEnd(lobby) {
        if (lobbyListener) lobbyListener.off();
        const winnerName = lobby.winner === lobby.player1.uid ? lobby.player1.name : lobby.player2.name;
        const loserName = lobby.winner === lobby.player1.uid ? lobby.player2.name : lobby.player1.name;
        ui.gameStatus.innerHTML = `🏆 الفائز هو ${winnerName}! 🏆`;
        ui.punchBtn.disabled = true;
        Swal.fire({
            title: 'انتهت المباراة!',
            html: `لقد فاز <strong>${winnerName}</strong> على <strong>${loserName}</strong>!`,
            icon: 'success',
            timer: 5000,
            timerProgressBar: true,
        }).then(() => {
            ui.gameModal.classList.remove('show');
            if (visitorId === lobby.player1.uid) { // فقط اللاعب الأول يحذف اللوبي لتجنب التكرار
                db.ref(`game_lobbies/${currentLobbyId}`).remove();
            }
            currentLobbyId = null;
        });
    }

    window.gameLobbyApp = { init, updateUserCache };
});