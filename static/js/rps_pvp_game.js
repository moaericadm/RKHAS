// START OF FILE static/js/rps_pvp_game.js
document.addEventListener('firebase-ready', () => {
    const gameCard = document.getElementById('rps-pvp-game-card');
    if (!gameCard) return;

    const auth = firebase.auth();
    const db = firebase.database();

    auth.onAuthStateChanged(user => {
        if (user) {
            initializeGame(user.uid);
        } else {
            gameCard.style.display = 'none';
        }
    });

    function initializeGame(userId) {
        const ui = {
            card: gameCard,
            body: document.getElementById('rps-pvp-game-body'),
            createSection: document.getElementById('rps-create-section'),
            challengesSection: document.getElementById('rps-challenges-section'),
            waitingSection: document.getElementById('rps-waiting-section'),
            playingSection: document.getElementById('rps-playing-section'),
            betAmountInput: document.getElementById('rps-create-bet-amount'),
            createBtn: document.getElementById('rps-create-challenge-btn'),
            challengesList: document.getElementById('rps-challenges-list'),
            waitingText: document.getElementById('rps-waiting-text'),
            cancelChallengeBtn: document.getElementById('rps-cancel-challenge-btn'),
            gameModalElement: document.getElementById('rpsPvPGameModal'),
            gameModalTitle: document.getElementById('rps-modal-title'),
            gameModalBody: document.getElementById('rps-modal-body'),
        };

        let currentUserName;
        let challengesListener = null;
        let activeChallengeListener = null;
        let activeChallengeId = null;
        let gameLockTimer = null;

        const gameModal = ui.gameModalElement ? new bootstrap.Modal(ui.gameModalElement, { keyboard: false, backdrop: 'static' }) : null;

        db.ref(`registered_users/${userId}/name`).once('value', snapshot => {
            currentUserName = snapshot.val();
        });

        if (challengesListener) challengesListener.off();
        challengesListener = db.ref('/');
        challengesListener.on('value', handleGlobalUpdate);

        ui.createBtn.addEventListener('click', createChallenge);

        function handleGlobalUpdate(snapshot) {
            const data = snapshot.val() || {};
            const allChallenges = data.rps_challenges || {};
            const settings = data.site_settings?.rps_game || {};

            if (settings && settings.is_enabled) {
                ui.card.style.display = 'block';
            } else {
                ui.card.style.display = 'none';
                return;
            }

            const lockUntil = settings.lock_until || 0;
            const now = Math.floor(Date.now() / 1000);

            clearInterval(gameLockTimer);
            if (now < lockUntil) {
                ui.card.classList.add('locked');
                let remaining = lockUntil - now;
                const updateTimer = () => {
                    if (remaining > 0) {
                        ui.createBtn.textContent = `اللعبة مقفلة (${remaining} ث)`;
                        remaining--;
                    } else {
                        ui.createBtn.textContent = 'إنشاء تحدي جديد';
                        ui.card.classList.remove('locked');
                        ui.createBtn.disabled = false;
                        clearInterval(gameLockTimer);
                    }
                };
                updateTimer();
                gameLockTimer = setInterval(updateTimer, 1000);
                ui.createBtn.disabled = true;
            } else {
                ui.card.classList.remove('locked');
                ui.createBtn.textContent = 'إنشاء تحدي جديد';
                ui.createBtn.disabled = false;
            }

            const userInGame = Object.values(allChallenges).find(c => c.status === 'playing' && (c.player1.uid === userId || c.player2?.uid === userId));

            if (userInGame) {
                const challengeId = Object.keys(allChallenges).find(key => allChallenges[key] === userInGame);
                if (challengeId && challengeId !== activeChallengeId) {
                    switchToPlayingState(challengeId, userInGame);
                }
                return;
            } else if (activeChallengeId) {
                resetToLobby();
            }

            const openChallenges = Object.entries(allChallenges).filter(([id, c]) => c.status === 'open');
            renderChallenges(openChallenges);
        }

        function renderChallenges(challenges) {
            if (challenges.length > 0) {
                ui.challengesList.innerHTML = challenges.map(([id, challenge]) => {
                    const isMyChallenge = challenge.player1.uid === userId;
                    return `
                        <li class="list-group-item d-flex justify-content-between align-items-center">
                            <div>
                                <strong>${challenge.player1.name}</strong>
                                <span class="badge bg-warning text-dark ms-2">${challenge.bet_amount.toLocaleString()} SP</span>
                            </div>
                            ${isMyChallenge
                            ? `<button class="btn btn-sm btn-outline-danger cancel-btn" data-id="${id}">إلغاء</button>`
                            : `<button class="btn btn-sm btn-success join-btn" data-id="${id}">انضمام</button>`
                        }
                        </li>
                    `;
                }).join('');
            } else {
                ui.challengesList.innerHTML = '<li class="list-group-item text-muted text-center">لا توجد تحديات متاحة حالياً.</li>';
            }

            ui.challengesList.querySelectorAll('.join-btn').forEach(btn => btn.addEventListener('click', joinChallenge));
            ui.challengesList.querySelectorAll('.cancel-btn').forEach(btn => btn.addEventListener('click', cancelChallenge));
        }

        function switchToWaitingState(challengeId) {
            ui.createSection.classList.add('d-none');
            ui.challengesSection.classList.add('d-none');
            ui.waitingSection.classList.remove('d-none');
            ui.waitingText.textContent = `تم إنشاء التحدي. في انتظار لاعب آخر...`;
            ui.cancelChallengeBtn.dataset.id = challengeId;
            ui.cancelChallengeBtn.addEventListener('click', cancelChallenge, { once: true });
        }

        function switchToPlayingState(challengeId, challengeData) {
            if (activeChallengeListener) activeChallengeListener.off();
            activeChallengeId = challengeId;
            ui.createSection.classList.add('d-none');
            ui.challengesSection.classList.add('d-none');
            ui.waitingSection.classList.add('d-none');

            if (gameModal && !ui.gameModalElement.classList.contains('show')) {
                gameModal.show();
            }

            activeChallengeListener = db.ref(`rps_challenges/${challengeId}`);
            activeChallengeListener.on('value', (snapshot) => {
                const gameData = snapshot.val();
                if (!gameData || gameData.status === 'finished') {
                    handleGameEnd(gameData);
                    return;
                }
                renderGameModal(challengeId, gameData);
            });
        }

        function renderGameModal(challengeId, gameData) {
            const playerKey = gameData.player1.uid === userId ? 'player1' : 'player2';
            const opponentKey = playerKey === 'player1' ? 'player2' : 'player1';

            const round = gameData.game_state.round;
            const roundKey = `round${round}`;

            const choices = gameData.game_state.choices || {};
            const myChoice = choices[roundKey]?.[playerKey];

            ui.gameModalTitle.textContent = `جولة ${round}: ${gameData.player1.name} ضد ${gameData.player2.name}`;

            let bodyHtml = `
                <div class="text-center mb-3">
                    <span class="badge bg-primary">${gameData.game_state.scores.player1}</span>
                    - 
                    <span class="badge bg-danger">${gameData.game_state.scores.player2}</span>
                </div>
            `;

            if (myChoice) {
                bodyHtml += `<p class="text-center">لقد اخترت. في انتظار حركة خصمك...</p>`;
            } else {
                bodyHtml += `
                    <p class="text-center">اختر حركتك!</p>
                    <div class="d-flex justify-content-around">
                        <button class="btn btn-lg btn-outline-light modal-choice-btn" data-choice="rock">✊</button>
                        <button class="btn btn-lg btn-outline-light modal-choice-btn" data-choice="paper">✋</button>
                        <button class="btn btn-lg btn-outline-light modal-choice-btn" data-choice="scissors">✌️</button>
                    </div>
                `;
            }

            // <<< بداية التعديل: إضافة زر الاستسلام >>>
            bodyHtml += `
                <hr class="my-3">
                <div class="d-grid">
                    <button class="btn btn-sm btn-outline-danger" id="rps-surrender-btn" data-id="${challengeId}">
                        <i class="bi bi-flag-fill me-2"></i>استسلام وخسارة الرهان
                    </button>
                </div>
            `;
            // <<< نهاية التعديل >>>

            ui.gameModalBody.innerHTML = bodyHtml;

            ui.gameModalBody.querySelectorAll('.modal-choice-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const choice = e.currentTarget.dataset.choice;
                    apiCall('/api/rps_pvp/challenge/play', { challenge_id: challengeId, choice: choice });
                });
            });

            // <<< بداية التعديل: إضافة المستمع لزر الاستسلام >>>
            const surrenderBtn = ui.gameModalBody.querySelector('#rps-surrender-btn');
            if (surrenderBtn) {
                surrenderBtn.addEventListener('click', (e) => {
                    const id = e.currentTarget.dataset.id;
                    Swal.fire({
                        title: 'هل أنت متأكد؟',
                        text: "سيؤدي الاستسلام إلى خسارتك للرهان فوراً.",
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonText: 'نعم، استسلام',
                        cancelButtonText: 'إلغاء'
                    }).then((result) => {
                        if (result.isConfirmed) {
                            apiCall('/api/rps_pvp/challenge/surrender', { challenge_id: id });
                        }
                    });
                });
            }
            // <<< نهاية التعديل >>>
        }

        function handleGameEnd(finalData) {
            if (gameModal) gameModal.hide();

            if (finalData) {
                const winnerKey = finalData.winner;
                let title, text, icon;

                if (winnerKey === 'draw') {
                    title = 'تعادل!';
                    text = 'انتهت المباراة بالتعادل، وتم إعادة الرهان لكل منكما.';
                    icon = 'info';
                } else {
                    const winnerName = finalData[winnerKey].name;
                    const isMeWinner = finalData[winnerKey].uid === userId;
                    title = isMeWinner ? 'لقد فزت!' : 'لقد خسرت!';
                    text = isMeWinner ? `مبروك! لقد ربحت ${finalData.bet_amount * 2} SP.` : `حظ أوفر، لقد فاز ${winnerName}.`;
                    icon = isMeWinner ? 'success' : 'error';
                }
                Swal.fire({ title, text, icon, confirmButtonText: 'حسناً' });
            }

            resetToLobby();
        }

        function resetToLobby() {
            if (activeChallengeListener) activeChallengeListener.off();
            activeChallengeId = null;
            ui.createSection.classList.remove('d-none');
            ui.challengesSection.classList.remove('d-none');
            ui.waitingSection.classList.add('d-none');
        }

        async function createChallenge() {
            const betAmount = parseInt(ui.betAmountInput.value);
            if (isNaN(betAmount) || betAmount <= 0) {
                return Swal.fire('خطأ', 'أدخل مبلغ رهان صحيح.', 'warning');
            }
            ui.createBtn.disabled = true;
            try {
                const data = await apiCall('/api/rps_pvp/challenge/create', { bet_amount: betAmount });
                switchToWaitingState(data.challenge_id);
            } catch (error) {
                // Error already shown by apiCall
            } finally {
                ui.createBtn.disabled = false;
            }
        }

        async function joinChallenge(e) {
            const btn = e.currentTarget;
            const challengeId = btn.dataset.id;
            btn.disabled = true;

            try {
                await apiCall('/api/rps_pvp/challenge/join', { challenge_id: challengeId });
            } catch (error) {
                btn.disabled = false;
            }
        }

        async function cancelChallenge(e) {
            const btn = e.currentTarget;
            const challengeId = btn.dataset.id;
            btn.disabled = true;

            try {
                await apiCall('/api/rps_pvp/challenge/cancel', { challenge_id: challengeId });
                resetToLobby();
            } catch (error) {
                btn.disabled = false;
            }
        }

        async function apiCall(endpoint, body) {
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.message || 'حدث خطأ في الخادم.');
                }
                return data;
            } catch (error) {
                Swal.fire({ icon: 'error', title: 'فشل!', text: error.message });
                throw error;
            }
        }
    }
});
// END OF FILE static/js/rps_pvp_game.js