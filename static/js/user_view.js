// --- START OF FILE static/js/user_view.js ---
let isDomReady = false;
let isFirebaseReady = false;

function tryToStartApp() {
    if (isDomReady && isFirebaseReady) {
        initializeUserView();
    }
}

document.addEventListener('DOMContentLoaded', () => { isDomReady = true; tryToStartApp(); });
document.addEventListener('firebase-ready', () => { isFirebaseReady = true; tryToStartApp(); });

function initializeUserView() {
    const DEFAULT_AVATAR_URI = "data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236c757d'%3e%3cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3e%3c/svg%3e";

    const ui = {
        tableBody: document.getElementById('user-table-body'),
        loadingSpinner: document.getElementById('loading-spinner'),
        hallOfFame: document.getElementById('hall-of-fame'),
        honorRollList: document.getElementById('honor-roll-view-list'),
        candidatesList: document.getElementById('candidates-list'),
        richestInvestorsList: document.getElementById('richest-investors-list'),
        userCcBalance: document.getElementById('user-cc-balance'),
        userSpBalance: document.getElementById('user-sp-balance'),
        searchInput: document.getElementById('searchInput'),
        userChartModal: document.getElementById('userChartModal'),
        chartModalLabel: document.getElementById('chartModalLabel'),
        userPointsChartCanvas: document.getElementById('userPointsChart'),
        investmentModal: document.getElementById('investmentModal'),
        investmentForm: document.getElementById('investment-form'),
        investCrawlerName: document.getElementById('invest-crawler-name'),
        investCrawlerNameHidden: document.getElementById('invest-crawler-name-hidden'),
        spAmountInput: document.getElementById('sp-amount-input'),
        investModalTitle: document.getElementById('invest-modal-title'),
        investModalSubtitle: document.getElementById('invest-modal-subtitle'),
        announcementsContainer: document.getElementById('announcements-container'),
        announcementsTicker: document.getElementById('announcements-ticker'),
        sellLotsModal: document.getElementById('sellLotsModal'),
        sellLotsModalTitle: document.getElementById('sellLotsModalTitle'),
        sellLotsModalBody: document.getElementById('sellLotsModalBody'),
        userAvatarPreview: document.getElementById('user-avatar-preview'),
        avatarChooserModal: document.getElementById('avatarChooserModal'),
        ownedAvatarsContainer: document.getElementById('owned-avatars-container'),
        // *** بداية التعديل: تحديث معرّف رأس الجدول ***
        investmentReturnHeader: document.getElementById('investment-return-header'),
        // *** نهاية التعديل ***
        contestCard: document.getElementById('popularity-contest-card'),
        contestContainer: document.getElementById('contest-container'),
        contestTimer: document.getElementById('contest-timer'),
        gamblingCard: document.getElementById('gambling-card'),
        betAmountInput: document.getElementById('bet-amount-input'),
        placeBetBtn: document.getElementById('place-bet-btn'),
        betMaxAmountText: document.getElementById('bet-max-amount-text'),
        privacyToggle: document.getElementById('showOnLeaderboardToggle'),
        contestInfoModal: document.getElementById('contestInfoModal'),
        genericAvatarDisplayModal: document.getElementById('genericAvatarDisplayModal'),
        genericModalAvatarImage: document.getElementById('generic-modal-avatar-image'),
        genericModalAvatarName: document.getElementById('generic-modal-avatar-name'),
    };

    let allUsersCache = [];
    let honorRollCache = [];
    let userInvestments = {};
    let allInvestmentsCache = {};
    let allWallets = {};
    let userChartInstance = null;
    let db;
    let currentUserId;
    let contestTimerInterval = null;
    let registeredUsersCache = {};
    let currentContestData = {};
    let siteSettings = {};
    let gamblingSettings = {};
    let userWallet = {};
    let onlineUserIds = new Set();
    let userNameToUidMap = {};

    async function initializeApp() {
        console.log("User view initialization started.");
        try {
            db = firebase.database();
            const token = sessionStorage.getItem('firebaseToken');
            if (token) {
                await firebase.auth().signInWithCustomToken(token);
                currentUserId = firebase.auth().currentUser.uid;
            } else {
                await new Promise((resolve, reject) => {
                    const unsubscribe = firebase.auth().onAuthStateChanged(user => {
                        unsubscribe();
                        if (user) { currentUserId = user.uid; resolve(); }
                        else { reject(new Error("لا يوجد مستخدم مسجل دخوله.")); }
                    });
                });
            }

            if (currentUserId) {
                await setupDataAndLogic();
                try { await fetch('/api/spin_wheel/state', { method: 'POST' }); }
                catch (e) { console.error("Failed to trigger spin wheel state update:", e.message); }
            } else {
                handleAuthError(new Error("لا يمكن تحديد هوية المستخدم."));
            }
        } catch (e) {
            handleAuthError(e);
        }
    }

    function handleAuthError(e) {
        console.error("CRITICAL AUTHENTICATION ERROR:", e.message);
        if (ui.loadingSpinner && ui.loadingSpinner.parentElement) {
            const tableContainer = ui.loadingSpinner.parentElement;
            tableContainer.innerHTML = `<td colspan="7" class="text-center py-5"><p class="text-danger p-3">فشل المصادقة مع الخادم.<br>قد تحتاج إلى <a href="/auth/logout">تسجيل الخروج والمحاولة مرة أخرى</a>.</p></td>`;
        }
    }

    async function setupDataAndLogic() {
        if (window.interactionsApp?.init) window.interactionsApp.init();
        setupEventListeners();
        const handleFirebaseError = (error, path) => console.error(`Firebase Read Error at ${path}:`, error.code, error.message);

        try {
            const initialDataPromises = [
                db.ref('users').get(),
                db.ref('registered_users').get(),
                db.ref('site_settings/investment_settings').get(),
                db.ref('site_settings/gambling_settings').get()
            ];
            const [usersSnapshot, registeredUsersSnapshot, settingsSnapshot, gamblingSettingsSnapshot] = await Promise.all(initialDataPromises);

            allUsersCache = Object.entries(usersSnapshot.val() || {}).map(([key, value]) => ({ ...value, name: key }));
            registeredUsersCache = registeredUsersSnapshot.val() || {};
            siteSettings = settingsSnapshot.val() || {};
            gamblingSettings = gamblingSettingsSnapshot.val() || {};

            if (window.interactionsApp?.updateUserCache) {
                window.interactionsApp.updateUserCache(allUsersCache);
            }

        } catch (e) {
            handleFirebaseError(e, 'initial_data_fetch');
            ui.loadingSpinner.innerHTML = '<p class="text-danger">فشل تحميل البيانات الأولية.</p>';
            return;
        }

        if (ui.loadingSpinner && ui.loadingSpinner.parentElement) {
            ui.loadingSpinner.parentElement.style.display = 'none';
        }

        sortAndRenderUsers();
        renderGamblingCard();

        db.ref('users').on('value', (snapshot) => {
            allUsersCache = Object.entries(snapshot.val() || {}).map(([key, value]) => ({ ...value, name: key }));
            if (window.interactionsApp?.updateUserCache) window.interactionsApp.updateUserCache(allUsersCache);
            sortAndRenderUsers();
        });

        db.ref('registered_users').on('value', (snapshot) => {
            registeredUsersCache = snapshot.val() || {};
            userNameToUidMap = {};
            for (const uid in registeredUsersCache) {
                const userData = registeredUsersCache[uid];
                if (userData && userData.name) {
                    userNameToUidMap[userData.name] = uid;
                }
            }
            if (currentUserId && registeredUsersCache[currentUserId]) {
                const showOnLeaderboard = registeredUsersCache[currentUserId].show_on_leaderboard !== false;
                if (ui.privacyToggle) {
                    ui.privacyToggle.checked = showOnLeaderboard;
                }
            }
            renderRichestInvestors();
            renderPopularityContest(currentContestData);
        });

        db.ref('online_visitors').on('value', (snapshot) => {
            const onlineData = snapshot.val() || {};
            onlineUserIds = new Set(Object.keys(onlineData));
            renderUserTable();
            renderPopularityContest(currentContestData);
        });

        if (currentUserId) {
            const privateNudgeRef = db.ref(`user_nudges/${currentUserId}/incoming`).limitToLast(1);
            privateNudgeRef.on('child_added', (snapshot) => {
                const nudge = snapshot.val();
                if (nudge && nudge.text && (Date.now() / 1000 - nudge.timestamp < 10)) {
                    displayNudge(nudge, false); // false for private
                }
            });

            const publicNudgeRef = db.ref('public_nudges').limitToLast(1);
            publicNudgeRef.on('child_added', (snapshot) => {
                const nudge = snapshot.val();
                if (nudge && nudge.text && (Date.now() / 1000 - nudge.timestamp < 10)) {
                    displayNudge(nudge, true); // true for public
                }
            });
        }

        db.ref('popularity_contest').on('value', snapshot => {
            currentContestData = snapshot.val();
            renderPopularityContest(currentContestData);
        }, e => handleFirebaseError(e, 'popularity_contest'));

        db.ref('site_settings/investment_settings').on('value', (s) => siteSettings = s.val() || {});
        db.ref('site_settings/gambling_settings').on('value', (s) => {
            gamblingSettings = s.val() || {};
            renderGamblingCard();
        });

        db.ref('wallets').on('value', (s) => {
            allWallets = s.val() || {};
            renderRichestInvestors();
        }, (e) => handleFirebaseError(e, 'wallets'));

        db.ref('investments').on('value', (s) => {
            allInvestmentsCache = s.val() || {};
            userInvestments = (currentUserId && allInvestmentsCache[currentUserId]) ? allInvestmentsCache[currentUserId] : {};
            renderUserTable();
        }, (e) => handleFirebaseError(e, 'investments'));

        db.ref('site_settings/honor_roll').on('value', (s) => { honorRollCache = Object.values(s.val() || {}).map(i => i.name); renderHonorRollList(); renderUserTable(); }, (e) => handleFirebaseError(e, 'site_settings/honor_roll'));
        db.ref('candidates').on('value', (s) => renderCandidatesList(Object.keys(s.val() || {})), (e) => handleFirebaseError(e, 'candidates'));
        db.ref('site_settings/announcements').on('value', (s) => renderAnnouncements(Object.values(s.val() || {})), (e) => handleFirebaseError(e, 'site_settings/announcements'));
        db.ref('site_settings/spin_wheel_settings').on('value', (s) => { if (window.spinWheelApp?.reInit) window.spinWheelApp.reInit(s.val() || {}); }, (e) => handleFirebaseError(e, 'site_settings/spin_wheel_settings'));

        if (currentUserId) {
            db.ref(`wallets/${currentUserId}`).on('value', (s) => renderWallet(s.val()), (e) => handleFirebaseError(e, `wallets/${currentUserId}`));
            db.ref(`user_messages/${currentUserId}`).on('child_added', handleUserMessage, (e) => handleFirebaseError(e, `user_messages/${currentUserId}`));
            db.ref(`user_spin_state/${currentUserId}`).on('value', (s) => { if (window.spinWheelApp?.updateUI) window.spinWheelApp.updateUI(s.val()); }, (e) => handleFirebaseError(e, `user_spin_state/${currentUserId}`));
            db.ref(`registered_users/${currentUserId}/current_avatar`).on('value', (s) => {
                if (ui.userAvatarPreview) ui.userAvatarPreview.src = s.val() || DEFAULT_AVATAR_URI;
            }, (e) => handleFirebaseError(e, 'current_avatar'));
            db.ref(`user_avatars/${currentUserId}/owned`).on('value', renderOwnedAvatars, (e) => handleFirebaseError(e, 'owned_avatars'));
        }
    }

    const formatNumber = (num, compact = true) => { const n = Number(String(num || '0').replace(/,/g, '')); if (isNaN(n)) return '0'; if (!compact || Math.abs(n) < 1e4) return new Intl.NumberFormat('en-US').format(Math.round(n)); let o = { notation: 'compact', compactDisplay: 'short' }; if (Math.abs(n) >= 1e4 && Math.abs(n) < 1e6) { o.minimumFractionDigits = 1; o.maximumFractionDigits = 1 } else if (Math.abs(n) >= 1e6) { o.minimumFractionDigits = 2; o.maximumFractionDigits = 2 } return new Intl.NumberFormat('en-US', o).format(n); };
    const safeFormatDate = (timestampInSeconds, options = {}) => { if (!timestampInSeconds || typeof timestampInSeconds !== 'number' || timestampInSeconds <= 0) return "تاريخ غير صالح"; const date = new Date(timestampInSeconds * 1000); if (isNaN(date.getTime())) return "تاريخ غير صالح"; const defaultOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }; return date.toLocaleString('ar-EG', { ...defaultOptions, ...options }); };

    function startContestTimer(endTime) { clearInterval(contestTimerInterval); const update = () => { const now = Math.floor(Date.now() / 1000); const remaining = Math.max(0, endTime - now); const h = String(Math.floor(remaining / 3600)).padStart(2, '0'); const m = String(Math.floor((remaining % 3600) / 60)).padStart(2, '0'); const s = String(Math.floor(remaining % 60)).padStart(2, '0'); if (ui.contestTimer) ui.contestTimer.textContent = `${h}:${m}:${s}`; if (remaining <= 0) clearInterval(contestTimerInterval); }; update(); contestTimerInterval = setInterval(update, 1000); }

    function showVotersModal(contestantName) {
        const votes = currentContestData.votes || {};
        const voterUids = Object.keys(votes[contestantName] || {});
        if (voterUids.length === 0) {
            Swal.fire({ title: `المصوتون لـِ ${contestantName}`, text: 'لا يوجد مصوتون بعد لهذا المتنافس.', icon: 'info', confirmButtonText: 'حسناً' });
            return;
        }
        const votersHtml = voterUids.map(uid => {
            const voter = registeredUsersCache[uid];
            if (!voter) return '';
            const avatar = voter.current_avatar ? voter.current_avatar : DEFAULT_AVATAR_URI;
            const name = voter.name || 'مستخدم غير معروف';
            const isOnline = onlineUserIds.has(uid);
            const onlineIndicator = isOnline ? ' <span class="online-indicator" title="متصل الآن" style="margin-left: 5px; vertical-align: middle;"></span>' : '';
            return `
                <li class="list-group-item d-flex align-items-center">
                    <img src="${avatar}" class="rounded-circle me-3 nudge-trigger" data-target-name="${name}" data-target-uid="${uid}" data-target-type="user" width="40" height="40" alt="${name}" style="object-fit: cover; cursor: pointer;">
                    <span class="fw-bold">${name}</span>${onlineIndicator}
                </li>`;
        }).join('');
        Swal.fire({
            title: `المصوتون لـِ ${contestantName} (${voterUids.length})`,
            html: `<ul class="list-group list-group-flush" style="max-height: 40vh; overflow-y: auto; text-align: right;">${votersHtml}</ul>`,
            showCloseButton: true,
            showConfirmButton: false,
            width: '450px'
        });
    }

    function renderPopularityContest(contest) {
        if (!ui.contestCard || !ui.contestContainer || Object.keys(registeredUsersCache).length === 0) return;
        if (!contest || contest.status !== 'active') { ui.contestCard.style.display = 'none'; return; }
        ui.contestCard.style.display = 'block'; startContestTimer(contest.end_timestamp || 0);
        const name1 = contest.contestant1_name, name2 = contest.contestant2_name; const contestant1 = allUsersCache.find(u => u.name === name1); const contestant2 = allUsersCache.find(u => u.name === name2);

        if (!contestant1 || !contestant2) {
            ui.contestContainer.innerHTML = `<div class="col-12 text-center text-muted p-4">خطأ في بيانات المنافسة. قد يكون أحد المتنافسين غير متاح حالياً.</div>`;
            return;
        }

        const votes = contest.votes || {}, votes1 = votes[name1] || {}, votes2 = votes[name2] || {}, userVotedFor = (currentUserId && (votes1[currentUserId] ? name1 : (votes2[currentUserId] ? name2 : null)));

        const contestant1Avatar = contestant1.avatar_url ? contestant1.avatar_url : DEFAULT_AVATAR_URI;
        const contestant2Avatar = contestant2.avatar_url ? contestant2.avatar_url : DEFAULT_AVATAR_URI;

        const renderVoters = (votersDict) => {
            const uids = Object.keys(votersDict);
            if (uids.length === 0) return `<div class="small text-muted">لا يوجد مصوتون بعد</div>`;
            return uids.slice(0, 10).map(uid => {
                const voter = registeredUsersCache[uid];
                const avatar = voter?.current_avatar ? voter.current_avatar : DEFAULT_AVATAR_URI;
                const name = voter?.name || 'مستخدم';
                const isOnline = onlineUserIds.has(uid);
                const onlineBorderStyle = isOnline ? 'border: 2px solid #28a745; box-shadow: 0 0 5px #28a745;' : 'border: 1px solid #fff;';
                return `<img src="${avatar}" class="rounded-circle nudge-trigger" data-target-name="${name}" data-target-uid="${uid}" data-target-type="user" width="24" height="24" title="${name}" style="margin-right: -8px; cursor: pointer; ${onlineBorderStyle}">`;
            }).join('');
        };

        let html;
        if (userVotedFor) {
            html = ` <div class="col-6 text-center contestant-info" style="cursor: pointer;" data-contestant-name="${name1}"> <img src="${contestant1Avatar}" class="rounded-circle mb-2 nudge-trigger" data-target-name="${name1}" data-target-type="crawler" width="60" height="60"> <h6 class="mb-1 small">${name1}</h6> <div class="fw-bold mb-2">${Object.keys(votes1).length} صوت</div> <div class="d-flex justify-content-center align-items-center" style="min-height: 26px;">${renderVoters(votes1)}</div> </div> <div class="col-6 text-center contestant-info" style="cursor: pointer;" data-contestant-name="${name2}"> <img src="${contestant2Avatar}" class="rounded-circle mb-2 nudge-trigger" data-target-name="${name2}" data-target-type="crawler" width="60" height="60"> <h6 class="mb-1 small">${name2}</h6> <div class="fw-bold mb-2">${Object.keys(votes2).length} صوت</div> <div class="d-flex justify-content-center align-items-center" style="min-height: 26px;">${renderVoters(votes2)}</div> </div> <div class="col-12 mt-2"><div class="alert alert-success small text-center p-2 mb-0">شكراً لك، لقد قمت بالتصويت لـِ <strong>${userVotedFor}</strong>.</div></div>`;
        } else {
            html = ` <div class="col-5 text-center contestant-info" style="cursor: pointer;" data-contestant-name="${name1}"> <img src="${contestant1Avatar}" class="rounded-circle mb-2 nudge-trigger" data-target-name="${name1}" data-target-type="crawler" width="60" height="60"> <h6 class="mb-2 small">${name1}</h6> <button class="btn btn-sm btn-outline-success w-100 vote-btn" data-name="${name1}">صوّت</button> </div> <div class="col-2 d-flex justify-content-center align-items-center fs-4 fw-bold text-danger">VS</div> <div class="col-5 text-center contestant-info" style="cursor: pointer;" data-contestant-name="${name2}"> <img src="${contestant2Avatar}" class="rounded-circle mb-2 nudge-trigger" data-target-name="${name2}" data-target-type="crawler" width="60" height="60"> <h6 class="mb-2 small">${name2}</h6> <button class="btn btn-sm btn-outline-success w-100 vote-btn" data-name="${name2}">صوّت</button> </div>`;
        }
        ui.contestContainer.innerHTML = html;
        ui.contestContainer.querySelectorAll('.vote-btn').forEach(btn => btn.addEventListener('click', handleVoteClick));
        ui.contestContainer.querySelectorAll('.contestant-info').forEach(el => { el.addEventListener('click', (e) => { if (e.target.classList.contains('vote-btn') || e.target.classList.contains('nudge-trigger')) return; const name = e.currentTarget.dataset.contestantName; if (name) { showVotersModal(name); } }); });
    }

    async function handleVoteClick(e) { const btn = e.target, name = btn.dataset.name; Swal.fire({ title: `تأكيد التصويت`, text: `هل أنت متأكد من أنك تريد التصويت لـِ ${name}؟ لا يمكنك التراجع عن هذا القرار.`, icon: 'question', showCancelButton: true, confirmButtonText: 'نعم، صوّت!', cancelButtonText: 'إلغاء' }).then(async r => { if (r.isConfirmed) { btn.disabled = true; btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`; try { await apiCall('/api/contest/vote', { method: 'POST', body: new URLSearchParams({ voted_for_name: name }) }) } catch (err) { Swal.fire('فشل!', err.message, 'error'); btn.disabled = false; btn.innerHTML = 'صوّت' } } }) }

    function setupEventListeners() {
        document.body.addEventListener('click', e => {
            const tableBtn = e.target.closest('#user-table-body button');
            if (tableBtn) {
                const username = tableBtn.dataset.username;
                if (tableBtn.classList.contains('like-btn')) handleLike(tableBtn);
                else if (tableBtn.classList.contains('chart-btn')) showUserHistoryChart(username);
                else if (tableBtn.classList.contains('invest-btn')) showInvestmentModal(username);
                else if (tableBtn.classList.contains('sell-btn')) showSellLotsModal(username);
                else if (tableBtn.classList.contains('nudge-btn-table')) handleNudgeClick(tableBtn);
                return;
            }

            const trigger = e.target.closest('.nudge-trigger, .user-avatar-preview');
            if (trigger) {
                handleAvatarOrNudgeClick(trigger);
            }
        });

        if (ui.searchInput) ui.searchInput.addEventListener('input', renderUserTable);
        if (ui.investmentForm) ui.investmentForm.addEventListener('submit', handleInvestment);
        if (ui.placeBetBtn) ui.placeBetBtn.addEventListener('click', () => {
            const amount = parseFloat(ui.betAmountInput.value);
            handlePlaceBet(amount, false);
        });
        if (ui.privacyToggle) {
            ui.privacyToggle.addEventListener('change', handlePrivacyToggle);
        }
    }

    async function handlePrivacyToggle(event) {
        const toggle = event.target;
        const isChecked = toggle.checked;
        const label = document.querySelector('label[for="showOnLeaderboardToggle"]');
        const originalText = label.textContent;

        toggle.disabled = true;
        label.textContent = 'جاري الحفظ...';

        try {
            await apiCall('/api/user/privacy_settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ show_on_leaderboard: isChecked })
            });
            Toastify({
                text: "تم حفظ الإعداد بنجاح!",
                duration: 3000,
                gravity: "top",
                position: "center",
                style: { background: "linear-gradient(to right, #00b09b, #96c93d)" }
            }).showToast();
        } catch (error) {
            console.error('Error saving privacy setting:', error);
            Swal.fire('خطأ!', 'فشل حفظ الإعداد. يرجى المحاولة مرة أخرى.', 'error');
            toggle.checked = !isChecked;
        } finally {
            toggle.disabled = false;
            label.textContent = originalText;
        }
    }

    function sortAndRenderUsers() {
        allUsersCache.sort((a, b) => (b.points || 0) - (a.points || 0));
        renderUserTable();
        renderTop3();
        renderRichestInvestors();
    }

    function renderUserTable() {
        if (!ui.tableBody) return;
        const userHasAnyInvestment = Object.keys(userInvestments).length > 0;
        // *** بداية التعديل: تحديث معرّف رأس الجدول ***
        if (ui.investmentReturnHeader) {
            ui.investmentReturnHeader.style.display = userHasAnyInvestment ? '' : 'none';
        }
        // *** نهاية التعديل ***

        const term = ui.searchInput.value.toLowerCase();
        const usersToRender = allUsersCache.filter(u => u?.name?.toLowerCase().includes(term));

        ui.tableBody.innerHTML = usersToRender.map(user => {
            const rank = allUsersCache.findIndex(u => u.name === user.name) + 1;
            const honor = honorRollCache.includes(user.name) ? ` <span class="badge rounded-pill" style="background:var(--primary-glow);color:#fff;"><i class="bi bi-award-fill"></i></span>` : '';
            const isLiked = (JSON.parse(localStorage.getItem('likedUsers')) || []).includes(user.name);
            const investment = userInvestments[user.name];
            const lots = investment ? investment.lots || {} : {};
            const hasInvestment = Object.keys(lots).length > 0;

            const pointsNow = parseFloat(user.points) || 0;
            const stockMultiplier = parseFloat(user.stock_multiplier) || 1.0;
            const avatarSrc = user.avatar_url || DEFAULT_AVATAR_URI;
            const avatarHtml = `<img src="${avatarSrc}" alt="${user.name}" class="crawler-avatar nudge-trigger" data-target-name="${user.name}" data-target-type="crawler" style="cursor: pointer;">`;

            const uid = userNameToUidMap[user.name];
            const isOnline = uid && onlineUserIds.has(uid);
            const onlineIndicatorHtml = isOnline ? '<span class="online-indicator" title="متصل الآن"></span>' : '';

            const nudgeButtonHtml = `<button class="btn btn-sm btn-link text-secondary nudge-btn nudge-btn-table" data-username="${user.name}" title="نكز الزاحف"><i class="bi bi-hand-index-thumb-fill"></i></button>`;

            let returnPercentageHtml = '<td></td>';
            let totalInvestedSP = 0;
            let currentValue = 0;

            if (hasInvestment) {
                totalInvestedSP = Object.values(lots).reduce((sum, lot) => sum + (lot.sp || 0), 0);

                // *** بداية التعديل: تطبيق المضاعف الشخصي هنا ***
                const personalMultiplier = parseFloat(investment.personal_multiplier || 1.0);
                currentValue = Object.values(lots).reduce((sum, lot) => {
                    const pointsThen = Math.max(1, lot.p || 1);
                    return sum + ((lot.sp || 0) * (Math.max(1, pointsNow) / pointsThen) * stockMultiplier * personalMultiplier);
                }, 0);
                // *** نهاية التعديل ***

                const returnPercentage = totalInvestedSP > 0 ? ((currentValue / totalInvestedSP) - 1) * 100 : 0;
                const percentageColor = returnPercentage > 0.01 ? 'text-success' : returnPercentage < -0.01 ? 'text-danger' : 'text-muted';

                returnPercentageHtml = `<td class="text-center align-middle">
                                          <div class="fw-bold ${percentageColor}">${returnPercentage.toFixed(1)}%</div>
                                        </td>`;
            } else if (userHasAnyInvestment) {
                returnPercentageHtml = '<td></td>';
            }

            let actionHtml;
            if (hasInvestment) {
                const profit = currentValue - totalInvestedSP;
                const profitColor = profit > 0.005 ? 'text-success' : profit < -0.005 ? 'text-danger' : 'text-muted';

                actionHtml = `<div class="d-flex align-items-center justify-content-center">
                                <div class="text-center flex-grow-1">
                                    <div class="fw-bold">${currentValue.toFixed(2)} SP</div>
                                    <div class="small ${profitColor}">${profit >= 0 ? '+' : ''}${profit.toFixed(2)} SP</div>
                                </div>
                                <div class="btn-group-vertical ms-2 btn-group-sm" role="group">
                                    <button class="btn btn-outline-success invest-btn" data-username="${user.name}" title="استثمار إضافي"><i class="bi bi-plus-lg"></i></button>
                                    <button class="btn btn-outline-danger sell-btn" data-username="${user.name}" title="إدارة البيع"><i class="bi bi-cash-coin"></i></button>
                                </div>
                              </div>`;
            } else {
                actionHtml = `<button class="btn btn-success invest-btn w-100 d-flex flex-column justify-content-center" style="min-height:58px" data-username="${user.name}"><span><i class="bi bi-graph-up me-1"></i> استثمار</span></button>`;
            }

            return `<tr id="user-row-${user.name}">
                        <th class="align-middle">#${rank}</th>
                        <td class="align-middle fw-bold crawler-name-cell">${avatarHtml}${onlineIndicatorHtml} ${user.name}${honor}</td>
                        <td class="text-center align-middle fs-5 fw-bold" title="النقاط: ${formatNumber(pointsNow, false)}">${formatNumber(pointsNow)}</td>
                        <td class="text-center align-middle">
                            <div class="d-flex justify-content-center align-items-center gap-2">
                                <button class="btn btn-sm like-btn ${isLiked ? 'liked' : 'btn-outline-danger'}" data-username="${user.name}">
                                    <span class="icon-heart"><i class="bi bi-heart-fill"></i></span>
                                    <span class="like-count ms-1">${formatNumber(user.likes || 0, false)}</span>
                                </button>
                                <button class="btn btn-sm btn-outline-info chart-btn" data-username="${user.name}" title="عرض التقدم"><i class="bi bi-graph-up"></i></button>
                            </div>
                        </td>
                        <td class="text-center align-middle">${nudgeButtonHtml}</td>
                        ${userHasAnyInvestment ? returnPercentageHtml : ''}
                        <td class="text-center align-middle investment-actions-col">${actionHtml}</td>
                    </tr>`;
        }).join('') || `<tr><td colspan="${userHasAnyInvestment ? 7 : 6}" class="text-center py-4">${term ? 'لا يوجد زاحف يطابق البحث' : 'لا يوجد بيانات حالياً'}</td></tr>`;
    }

    function renderRichestInvestors() {
        if (!ui.richestInvestorsList || Object.keys(allWallets).length === 0 || Object.keys(registeredUsersCache).length === 0) {
            if (ui.richestInvestorsList) ui.richestInvestorsList.innerHTML = '<p class="text-muted text-center my-3">لا يوجد مستثمرون لعرضهم بعد.</p>';
            return;
        }

        const adminUIDs = new Set(Object.keys(registeredUsersCache).filter(id => registeredUsersCache[id].role === 'admin'));

        const richList = Object.entries(allWallets)
            .filter(([uid]) => !adminUIDs.has(uid) && registeredUsersCache[uid])
            .filter(([uid]) => registeredUsersCache[uid].show_on_leaderboard !== false)
            .map(([uid, wallet]) => ({
                uid,
                name: registeredUsersCache[uid].name,
                avatar: registeredUsersCache[uid].current_avatar,
                sp: wallet.sp || 0
            }))
            .sort((a, b) => b.sp - a.sp)
            .slice(0, 3);

        if (richList.length === 0) {
            ui.richestInvestorsList.innerHTML = '<p class="text-muted text-center my-3">لا يوجد مستثمرون لعرضهم بعد.</p>';
            return;
        }

        const medalColors = { '0': '#FFD700', '1': '#C0C0C0', '2': '#CD7F32' };
        const medalIcons = { '0': '🥇', '1': '🥈', '2': '🥉' };

        ui.richestInvestorsList.innerHTML = richList.map((investor, index) => {
            const avatarSrc = investor.avatar || DEFAULT_AVATAR_URI;
            return `<div class="d-flex align-items-center p-2 rounded" style="background-color: rgba(255,255,255,0.04);">
                <span class="fs-4 me-3" title="المركز ${index + 1}">${medalIcons[index]}</span>
                <img src="${avatarSrc}" class="rounded-circle me-3 nudge-trigger" data-target-name="${investor.name}" data-target-uid="${investor.uid}" data-target-type="user" width="48" height="48" alt="${investor.name}" style="border: 2px solid ${medalColors[index]}; object-fit: cover; cursor: pointer;">
                <div class="flex-grow-1">
                    <div class="fw-bold">${investor.name}</div>
                    <small class="text-success">${(investor.sp || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SP</small>
                </div>
            </div>`
        }).join('');
    }

    async function renderOwnedAvatars(snapshot) { const ownedData = snapshot.val(); if (!ui.ownedAvatarsContainer || !ownedData) { if (ui.ownedAvatarsContainer) ui.ownedAvatarsContainer.innerHTML = '<p class="text-muted text-center w-100">أنت لا تمتلك أي أفاتارات بعد. قم بشراء واحدة من المتجر!</p>'; return; } const ownedIds = Object.keys(ownedData); const avatarPromises = ownedIds.map(id => db.ref(`site_settings/shop_avatars/${id}`).get()); const avatarSnapshots = await Promise.all(avatarPromises); let html = ''; avatarSnapshots.forEach((snap, index) => { if (snap.exists()) { const avatar = snap.val(); const avatarId = ownedIds[index]; html += `<div class="text-center"><img src="${avatar.image_url}" alt="${avatar.name}" class="user-avatar-preview" data-avatar-id="${avatarId}" style="width: 80px; height: 80px;" title="تعيين كصورة شخصية"><p class="small mt-1 mb-0">${avatar.name}</p></div>`; } }); ui.ownedAvatarsContainer.innerHTML = html || '<p class="text-muted text-center w-100">أنت لا تمتلك أي أفاتارات بعد.</p>'; ui.ownedAvatarsContainer.querySelectorAll('.user-avatar-preview').forEach(img => { img.addEventListener('click', handleSetAvatar); }); }
    async function handleSetAvatar(e) { const avatarId = e.target.dataset.avatarId; if (!avatarId) return; Swal.fire({ title: 'تغيير الأفاتار', text: 'هل أنت متأكد أنك تريد تعيين هذا الأفاتار كصورتك الشخصية؟', icon: 'question', showCancelButton: true, confirmButtonText: 'نعم، قم بالتعيين', cancelButtonText: 'إلغاء' }).then(async result => { if (result.isConfirmed) { try { const data = await apiCall('/api/user/set_avatar', { method: 'POST', body: new URLSearchParams({ avatar_id: avatarId }) }); Swal.fire('تم!', data.message, 'success'); if (ui.avatarChooserModal) bootstrap.Modal.getInstance(ui.avatarChooserModal)?.hide(); } catch (err) { Swal.fire('فشل!', err.message, 'error'); } } }); }

    function renderWallet(wallet) {
        userWallet = wallet || { cc: 0, sp: 0 };
        if (ui.userCcBalance) ui.userCcBalance.textContent = formatNumber(userWallet.cc, false);
        if (ui.userSpBalance) ui.userSpBalance.textContent = formatNumber(userWallet.sp, false);
    }

    function renderTop3() { if (!ui.hallOfFame) return; const top3 = allUsersCache.slice(0, 3); ui.hallOfFame.innerHTML = top3.length > 0 ? top3.map((u, i) => `<li class="list-group-item d-flex justify-content-between"><span>${['🥇', '🥈', '🥉'][i]} ${u.name}</span><span class="badge rounded-pill" style="background-color:var(--primary-glow)">${formatNumber(u.points)}</span></li>`).join('') : '<li class="list-group-item text-muted text-center">القائمة فارغة.</li>'; }
    function renderHonorRollList() { if (!ui.honorRollList) return; ui.honorRollList.innerHTML = honorRollCache.length ? honorRollCache.map(n => `<li class="list-group-item fw-bold text-center"><i class="bi bi-star-fill text-warning me-2"></i>${n}</li>`).join('') : '<li class="list-group-item text-muted text-center">القائمة فارغة.</li>'; }
    function renderCandidatesList(candidates) { if (!ui.candidatesList) return; ui.candidatesList.innerHTML = candidates.length ? candidates.map(n => `<li class="list-group-item"><i class="bi bi-person-check-fill me-2"></i>${n}</li>`).join('') : '<li class="list-group-item text-muted text-center">لا يوجد مرشحون.</li>'; }
    function renderAnnouncements(announcements) { if (!ui.announcementsTicker || !ui.announcementsContainer) return; if (announcements.length > 0) { ui.announcementsContainer.style.display = 'flex'; requestAnimationFrame(() => ui.announcementsContainer.classList.add('visible')); ui.announcementsTicker.innerHTML = announcements.map(n => `<div class="ticker-item">${n.text}</div>`).join(''); ui.announcementsTicker.style.animationDuration = `${Math.max(announcements.length * 8, 20)}s`; } else { ui.announcementsContainer.classList.remove('visible'); setTimeout(() => { ui.announcementsContainer.style.display = 'none'; }, 500); } }
    async function apiCall(endpoint, options = {}) { const response = await fetch(endpoint, options); const data = await response.json(); if (!response.ok) throw new Error(data.message || 'خطأ في الخادم'); return data; }

    function showInvestmentModal(crawlerName) { if (!ui.investmentModal) return; const crawler = allUsersCache.find(u => u.name === crawlerName); if (!crawler) return; ui.investCrawlerName.textContent = crawlerName; ui.investCrawlerNameHidden.value = crawlerName; ui.spAmountInput.value = ''; ui.investModalTitle.textContent = `الاستثمار في `; const points = crawler.points || 0; const multiplier = crawler.stock_multiplier || 1.0; const subtitleHtml = `<div class="mb-2">النقاط الحالية: <strong>${formatNumber(points, false)}</strong></div><div>مضاعف السهم الحالي: <strong class="text-info">x${multiplier.toFixed(2)}</strong></div>`; ui.investModalSubtitle.innerHTML = subtitleHtml; bootstrap.Modal.getOrCreateInstance(ui.investmentModal).show(); ui.investmentModal.addEventListener('shown.bs.modal', () => ui.spAmountInput.focus(), { once: true }); }

    async function handleInvestment(e) { e.preventDefault(); const form = e.target, btn = form.querySelector('button[type="submit"]'), originalHTML = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`; try { const data = await apiCall('/api/invest', { method: 'POST', body: new FormData(form) }); Swal.fire('تم الاستثمار!', data.message, 'success'); bootstrap.Modal.getInstance(ui.investmentModal)?.hide(); form.reset(); } catch (err) { Swal.fire('فشل!', err.message, 'error'); } finally { btn.disabled = false; btn.innerHTML = originalHTML; } }

    async function showSellLotsModal(crawlerName) {
        if (!ui.sellLotsModal) return;
        ui.sellLotsModalTitle.textContent = `إدارة استثمارك في ${crawlerName}`;
        ui.sellLotsModalBody.innerHTML = `<div class="text-center p-5"><div class="spinner-border"></div></div>`;
        bootstrap.Modal.getOrCreateInstance(ui.sellLotsModal).show();

        const investment = userInvestments[crawlerName];
        const lots = investment?.lots || {};
        const crawler = allUsersCache.find(u => u.name === crawlerName);

        if (!crawler || Object.keys(lots).length === 0) {
            ui.sellLotsModalBody.innerHTML = '<p class="text-muted text-center my-4">لا توجد دفعات استثمار لهذا الزاحف.</p>';
            return;
        }

        const lockSeconds = (siteSettings.investment_lock_hours || 0) * 3600;
        const now = Math.floor(Date.now() / 1000);
        const pointsNow = Math.max(1, parseFloat(crawler.points) || 1);
        const stockMultiplier = parseFloat(crawler.stock_multiplier) || 1.0;
        // *** بداية التعديل: جلب المضاعف الشخصي للاستخدام في النافذة ***
        const personalMultiplier = parseFloat(investment.personal_multiplier || 1.0);
        // *** نهاية التعديل ***

        const lotsArray = Object.entries(lots).map(([lotKey, lotData]) => ({ lotKey, ...lotData }));
        lotsArray.sort((a, b) => (a.t || 0) - (b.t || 0));

        let tableHtml = `<div class="table-responsive"> <table class="table table-sm table-hover align-middle"> <thead><tr><th>المبلغ المستثمر</th><th>تاريخ الشراء</th><th>القيمة الحالية</th><th>الحالة</th><th></th></tr></thead> <tbody>`;
        lotsArray.forEach(({ lotKey, sp, p, t }) => {
            const investedSP = sp || 0;
            const pointsThen = Math.max(1, p || 1);
            const lotTimestamp = t || 0;
            const isLocked = (now - lotTimestamp) < lockSeconds;

            // *** بداية التعديل: تطبيق المضاعف الشخصي هنا أيضاً ***
            const currentValue = investedSP * (pointsNow / pointsThen) * stockMultiplier * personalMultiplier;
            // *** نهاية التعديل ***

            const profit = currentValue - investedSP;
            const profitColor = profit > 0.01 ? 'text-success' : profit < -0.01 ? 'text-danger' : 'text-muted';
            let statusHtml, actionHtml;
            if (isLocked) {
                const unlockTime = lotTimestamp + lockSeconds;
                const remaining = unlockTime - now;
                const hours = Math.floor(remaining / 3600);
                const minutes = Math.floor((remaining % 3600) / 60);
                statusHtml = `<span class="badge bg-secondary">مقفلة (${hours}س ${minutes}د)</span>`;
                actionHtml = `<button class="btn btn-sm btn-outline-secondary" disabled>بيع</button>`;
            } else {
                statusHtml = `<span class="badge bg-success">متاحة</span>`;
                actionHtml = `<button class="btn btn-sm btn-danger sell-lot-btn" data-lot-key="${lotKey}" data-crawler-name="${crawlerName}">بيع</button>`;
            }
            tableHtml += `<tr id="lot-row-${lotKey}"> <td>${investedSP.toFixed(2)} SP</td> <td>${safeFormatDate(lotTimestamp)}</td> <td class="${profitColor} fw-bold">${currentValue.toFixed(2)} SP</td> <td>${statusHtml}</td> <td class="text-end">${actionHtml}</td> </tr>`;
        });
        tableHtml += `</tbody></table></div>`;
        ui.sellLotsModalBody.innerHTML = tableHtml;
        ui.sellLotsModalBody.querySelectorAll('.sell-lot-btn').forEach(btn => {
            btn.addEventListener('click', handleSellSingleLot);
        });
    }

    async function handleSellSingleLot(e) { const btn = e.target; const { lotKey, crawlerName } = btn.dataset; const row = document.getElementById(`lot-row-${lotKey}`); btn.disabled = true; btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`; try { const data = await apiCall('/api/sell_lot', { method: 'POST', body: new URLSearchParams({ crawler_name: crawlerName, lot_id: lotKey }) }); Toastify({ text: data.message, duration: 3000, gravity: "top", position: "center", style: { background: "linear-gradient(to right, #00b09b, #96c93d)" } }).showToast(); row.style.opacity = '0.4'; row.style.pointerEvents = 'none'; row.querySelector('td:last-child').innerHTML = `<span class="text-muted">تم البيع</span>`; } catch (error) { Swal.fire('فشل!', error.message, 'error'); btn.disabled = false; btn.innerHTML = 'بيع'; } }

    function handleLike(btn) { if (btn.disabled) return; const username = btn.dataset.username, likedUsers = new Set(JSON.parse(localStorage.getItem('likedUsers')) || []), countSpan = btn.querySelector('.like-count'), currentLikes = parseInt(String(countSpan.textContent || '0').replace(/[^0-9.-]+/g, "")), isLiked = likedUsers.has(username), action = isLiked ? 'unlike' : 'like'; btn.disabled = true; if (action === 'like') { likedUsers.add(username); btn.classList.add('liked'); btn.classList.remove('btn-outline-danger'); countSpan.textContent = formatNumber(currentLikes + 1, false); for (let i = 0; i < 7; i++) { const burst = document.createElement('span'); burst.className = 'heart-burst'; burst.style.left = `${Math.random() * 100}%`; burst.style.top = `${Math.random() * 100}%`; burst.style.animationDelay = `${Math.random() * 0.3}s`; btn.appendChild(burst); setTimeout(() => burst.remove(), 800); } } else { likedUsers.delete(username); btn.classList.remove('liked'); btn.classList.add('btn-outline-danger'); countSpan.textContent = formatNumber(Math.max(0, currentLikes - 1), false); } localStorage.setItem('likedUsers', JSON.stringify([...likedUsers])); apiCall(`/api/like/${username}?action=${action}`, { method: 'POST' }).catch(e => console.error("Like error:", e)).finally(() => btn.disabled = false); }

    async function showUserHistoryChart(username) { if (!ui.userChartModal) return; try { const history = await apiCall(`/api/user_history/${username}`); if (!history || history.length < 2) return Swal.fire({ icon: 'info', title: 'لا توجد بيانات كافية', text: 'لا يوجد سجل نقاط كافٍ لعرض الرسم البياني.' }); ui.chartModalLabel.innerText = `تقدم الزاحف: ${username}`; if (userChartInstance) userChartInstance.destroy(); const ctx = ui.userPointsChartCanvas.getContext('2d'); const gradient = ctx.createLinearGradient(0, 0, 0, 400); gradient.addColorStop(0, 'rgba(0, 242, 255, 0.4)'); gradient.addColorStop(1, 'rgba(159, 122, 234, 0.1)'); userChartInstance = new Chart(ctx, { type: 'line', data: { labels: history.map(d => safeFormatDate(d.timestamp, { day: '2-digit', month: 'short' })), datasets: [{ label: 'النقاط', data: history.map(d => d.points), fill: true, backgroundColor: gradient, borderColor: '#00f2ff', tension: 0.4 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { color: 'var(--text-color)' }, grid: { color: 'rgba(255,255,255,.1)' } }, x: { ticks: { color: 'var(--text-color)' }, grid: { display: false } } }, plugins: { legend: { display: false } } } }); bootstrap.Modal.getOrCreateInstance(ui.userChartModal).show(); } catch (e) { Swal.fire('خطأ', 'لم نتمكن من جلب سجل نقاط هذا الزاحف.', 'error'); } }

    function handleUserMessage(snapshot) { const getProcessedIds = () => new Set(JSON.parse(sessionStorage.getItem('processedMessageIds') || '[]')); const setProcessedIds = ids => sessionStorage.setItem('processedMessageIds', JSON.stringify([...ids])); const processedIds = getProcessedIds(), messageId = snapshot.key; if (snapshot.val()?.text && !processedIds.has(messageId)) { processedIds.add(messageId); setProcessedIds(processedIds); Swal.fire({ title: 'رسالة من الإدارة!', text: snapshot.val().text, icon: 'info', confirmButtonText: 'تم الاطلاع' }).then(() => snapshot.ref.remove()); } }

    function renderGamblingCard() {
        if (!ui.gamblingCard) return;
        if (gamblingSettings && gamblingSettings.is_enabled) {
            ui.gamblingCard.style.display = 'block';
            ui.betMaxAmountText.textContent = `الحد الأعلى للرهان: ${formatNumber(gamblingSettings.max_bet || 0, false)} SP`;
            ui.betAmountInput.max = gamblingSettings.max_bet || 0;
        } else {
            ui.gamblingCard.style.display = 'none';
        }
    }

    async function handlePlaceBet(amount, isDoubleDown = false) {
        const btn = ui.placeBetBtn;

        if (!isDoubleDown) {
            const maxBet = gamblingSettings.max_bet || 0;
            if (isNaN(amount) || amount <= 0) {
                return Swal.fire({ icon: 'warning', title: 'خطأ', text: 'الرجاء إدخال مبلغ رهان صحيح.' });
            }
            if (amount > maxBet) {
                return Swal.fire({ icon: 'warning', title: 'خطأ', text: `لا يمكنك المراهنة بأكثر من ${formatNumber(maxBet, false)} SP.` });
            }
        }

        if (amount > (userWallet.sp || 0)) {
            return Swal.fire({ icon: 'error', title: 'رصيد غير كافٍ', text: 'رصيد SP لديك لا يكفي لهذا الرهان.' });
        }

        if (!isDoubleDown) {
            btn.disabled = true;
        }

        Swal.fire({
            title: 'جاري تحديد المصير...',
            html: `
                <style>
                    .coin-container { position: relative; margin: auto; perspective: 1000px; display: inline-block; }
                    .coin { width: 120px; height: 120px; position: relative; transform-style: preserve-3d; animation: flip 4.5s linear; }
                    .coin-face { display: flex; flex-direction: column; justify-content: center; align-items: center; position: absolute; width: 100%; height: 100%; backface-visibility: hidden; border-radius: 50%; border: 5px solid rgba(255,255,255,0.5); box-shadow: 0 0 20px #28a745; }
                    .front { background: radial-gradient(circle, #28a745 60%, #1c7430 100%); }
                    .back { background: radial-gradient(circle, #28a745 60%, #1c7430 100%); transform: rotateY(180deg); }
                    .coin-text { color: white; font-weight: 800; text-shadow: 0 0 5px rgba(0,0,0,0.5); }
                    .coin-text-sp { font-size: 1.5rem; }
                    .coin-text-amount { font-size: 1.2rem; font-family: monospace; }
                    @keyframes flip { from { transform: rotateY(0deg); } to { transform: rotateY(2160deg); } }
                </style>
                <div class="coin-container my-3">
                    <div class="coin">
                        <div class="coin-face front">
                            <span class="coin-text coin-text-sp">SP</span>
                            <span class="coin-text coin-text-amount">${formatNumber(amount, false)}</span>
                        </div>
                        <div class="coin-face back">
                            <span class="coin-text coin-text-sp">SP</span>
                            <span class="coin-text coin-text-amount">${formatNumber(amount, false)}</span>
                        </div>
                    </div>
                </div>
            `,
            showConfirmButton: false,
            allowOutsideClick: false,
            willOpen: () => {
                Swal.showLoading();
            },
            didOpen: () => {
                setTimeout(async () => {
                    try {
                        const params = new URLSearchParams({ bet_amount: amount });
                        if (isDoubleDown) {
                            params.append('is_double_down', 'true');
                        }
                        const data = await apiCall('/api/place_bet', {
                            method: 'POST',
                            body: params
                        });

                        Swal.hideLoading();

                        if (data.result === 'win') {
                            Swal.update({
                                icon: 'success',
                                title: 'مبروك!',
                                html: data.message,
                                showConfirmButton: true,
                                showDenyButton: true,
                                confirmButtonText: 'اكتفِ بالربح',
                                denyButtonText: 'المضاعفة!',
                                denyButtonColor: '#dc3545',
                            });

                            Swal.getDenyButton().addEventListener('click', () => {
                                Swal.getDenyButton().disabled = true;
                                Swal.getConfirmButton().disabled = true;
                                handlePlaceBet(data.winnings, true);
                            });

                        } else {
                            Swal.update({
                                icon: 'error',
                                title: 'للأسف!',
                                html: data.message,
                                showConfirmButton: true,
                                confirmButtonText: 'حسناً',
                            });
                        }
                    } catch (error) {
                        Swal.fire('فشل!', error.message, 'error');
                    } finally {
                        if (!isDoubleDown) {
                            btn.disabled = false;
                            btn.innerHTML = 'راهن الآن!';
                            ui.betAmountInput.value = '';
                        }
                    }
                }, 4500);
            }
        });
    }

    function handleUserMessage(snapshot) { const getProcessedIds = () => new Set(JSON.parse(sessionStorage.getItem('processedMessageIds') || '[]')); const setProcessedIds = ids => sessionStorage.setItem('processedMessageIds', JSON.stringify([...ids])); const processedIds = getProcessedIds(), messageId = snapshot.key; if (snapshot.val()?.text && !processedIds.has(messageId)) { processedIds.add(messageId); setProcessedIds(processedIds); Swal.fire({ title: 'رسالة من الإدارة!', text: snapshot.val().text, icon: 'info', confirmButtonText: 'تم الاطلاع' }).then(() => snapshot.ref.remove()); } }

    async function handleAvatarOrNudgeClick(element) {
        if (element.id === 'user-avatar-preview') {
            const modalInstance = bootstrap.Modal.getOrCreateInstance(ui.avatarChooserModal);
            if (modalInstance) {
                modalInstance.show();
            }
            return;
        }

        const targetName = element.dataset.targetName;
        const targetType = element.dataset.targetType;
        const avatarUrl = element.src || DEFAULT_AVATAR_URI;
        let targetUid = element.dataset.targetUid || userNameToUidMap[targetName];

        if (targetType === 'crawler' && currentContestData && currentContestData.status === 'active' &&
            (targetName === currentContestData.contestant1_name || targetName === currentContestData.contestant2_name)) {
            showContestInfoModal();
            return;
        }

        const isOnline = targetUid && onlineUserIds.has(targetUid);
        const canInteract = (targetType === 'crawler') || (isOnline && targetType === 'user');

        if (canInteract) {
            const ownedNudgesSnap = await db.ref(`user_nudges/${currentUserId}/owned`).get();
            let nudgeSelectionHtml = '';

            if (ownedNudgesSnap.exists()) {
                const allNudgesSnap = await db.ref('site_settings/shop_products_nudges').get();
                const allNudges = allNudgesSnap.val() || {};
                const ownedIds = Object.keys(ownedNudgesSnap.val() || {});

                const itemsHtml = ownedIds.map(id => {
                    const nudge = allNudges[id];
                    if (!nudge) return '';
                    return `<button type="button" class="list-group-item list-group-item-action nudge-select-button" data-nudge-id="${id}">
                                ${nudge.text}
                            </button>`;
                }).join('');

                nudgeSelectionHtml = `
                    <hr>
                    <h6 class="mt-3">إرسال نكزة:</h6>
                    <div class="list-group" style="max-height: 20vh; overflow-y: auto;">
                        ${itemsHtml || '<p class="text-muted small">لا توجد نكزات</p>'}
                    </div>`;
            } else {
                nudgeSelectionHtml = `
                    <hr>
                    <div class="d-grid mt-3">
                        <a href="/shop" class="btn btn-warning">شراء نكزات لإرسالها</a>
                    </div>`;
            }

            Swal.fire({
                title: targetName,
                html: `
                    <img src="${avatarUrl}" alt="${targetName}" class="img-fluid rounded-circle mb-3" style="max-width: 200px; border: 5px solid var(--primary-glow); box-shadow: 0 0 25px var(--primary-glow);">
                    ${nudgeSelectionHtml}
                `,
                showConfirmButton: false,
                showCloseButton: true,
                didOpen: () => {
                    const container = Swal.getHtmlContainer();
                    container.querySelectorAll('.nudge-select-button').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            const nudgeId = btn.dataset.nudgeId;
                            Swal.close();
                            try {
                                const targetElementId = (targetType === 'crawler') ? `user-row-${targetName}` : null;
                                await apiCall('/api/send_nudge', {
                                    method: 'POST',
                                    body: new URLSearchParams({
                                        target_uid: targetUid,
                                        nudge_id: nudgeId,
                                        target_type: targetType,
                                        target_element_id: targetElementId || ''
                                    })
                                });
                                Toastify({ text: `تم إرسال النكزة إلى ${targetName}`, duration: 2000 }).showToast();
                            } catch (error) {
                                Swal.fire('فشل!', error.message, 'error');
                            }
                        });
                    });
                }
            });
        } else {
            if (ui.genericModalAvatarImage) ui.genericModalAvatarImage.src = avatarUrl;
            if (ui.genericModalAvatarName) ui.genericModalAvatarName.textContent = targetName;
            const modalInstance = bootstrap.Modal.getOrCreateInstance(ui.genericAvatarDisplayModal);
            modalInstance.show();
        }
    }

    function showContestInfoModal() {
        if (!ui.contestInfoModal || !currentContestData || currentContestData.status !== 'active') return;

        const name1 = currentContestData.contestant1_name;
        const name2 = currentContestData.contestant2_name;
        const contestant1 = allUsersCache.find(u => u.name === name1);
        const contestant2 = allUsersCache.find(u => u.name === name2);

        if (!contestant1 || !contestant2) return;

        const uid1 = userNameToUidMap[name1];
        const uid2 = userNameToUidMap[name2];

        const votes = currentContestData.votes || {};
        const votes1 = votes[name1] || {};
        const votes2 = votes[name2] || {};
        const userVotedFor = currentUserId && (votes1[currentUserId] ? name1 : (votes2[currentUserId] ? name2 : null));

        const renderVotersList = (votersDict) => {
            const uids = Object.keys(votersDict);
            if (uids.length === 0) return `<li class="list-group-item text-muted text-center small">لا يوجد مصوتون بعد</li>`;
            return uids.map(uid => {
                const voter = registeredUsersCache[uid];
                const avatar = voter?.current_avatar || DEFAULT_AVATAR_URI;
                return `<li class="list-group-item p-1 border-0 bg-transparent"><img src="${avatar}" class="rounded-circle" width="24" height="24" title="${voter?.name || 'مستخدم'}"></li>`;
            }).join('');
        };

        const modalBody = ui.contestInfoModal.querySelector('.modal-body');
        modalBody.innerHTML = `
            <div class="row g-3 text-center">
                <!-- Contestant 1 -->
                <div class="col">
                    <img src="${contestant1.avatar_url || DEFAULT_AVATAR_URI}" class="img-fluid rounded-circle mb-2" style="width: 90px; height: 90px; border: 3px solid var(--secondary-glow);">
                    <h5 class="mb-1">${name1}</h5>
                    <p class="text-warning fw-bold fs-5 mb-2">${Object.keys(votes1).length} صوت</p>
                    <ul class="list-group list-group-flush list-group-horizontal justify-content-center flex-wrap" style="max-height: 60px; overflow-y: auto;">
                        ${renderVotersList(votes1)}
                    </ul>
                    <button class="btn btn-sm btn-outline-warning mt-2 nudge-from-modal-btn" data-target-name="${name1}" data-target-uid="${uid1}"><i class="bi bi-hand-index-thumb-fill"></i> نكز ${name1}</button>
                </div>

                <!-- VS Separator -->
                <div class="col-2 d-flex align-items-center justify-content-center fs-2 fw-bold text-danger">VS</div>

                <!-- Contestant 2 -->
                <div class="col">
                    <img src="${contestant2.avatar_url || DEFAULT_AVATAR_URI}" class="img-fluid rounded-circle mb-2" style="width: 90px; height: 90px; border: 3px solid var(--secondary-glow);">
                    <h5 class="mb-1">${name2}</h5>
                    <p class="text-warning fw-bold fs-5 mb-2">${Object.keys(votes2).length} صوت</p>
                    <ul class="list-group list-group-flush list-group-horizontal justify-content-center flex-wrap" style="max-height: 60px; overflow-y: auto;">
                        ${renderVotersList(votes2)}
                    </ul>
                     <button class="btn btn-sm btn-outline-warning mt-2 nudge-from-modal-btn" data-target-name="${name2}" data-target-uid="${uid2}"><i class="bi bi-hand-index-thumb-fill"></i> نكز ${name2}</button>
                </div>
            </div>
            <hr style="border-color: var(--card-border);">
            ${userVotedFor
                ? `<div class="alert alert-success text-center small p-2">شكراً لك، لقد قمت بالتصويت لـِ <strong>${userVotedFor}</strong>.</div>`
                : `<div class="d-grid gap-2">
                       <button class="btn btn-primary vote-btn-modal" data-name="${name1}">صوّت لـِ ${name1}</button>
                       <button class="btn btn-primary vote-btn-modal" data-name="${name2}">صوّت لـِ ${name2}</button>
                   </div>`
            }
        `;

        modalBody.querySelectorAll('.vote-btn-modal').forEach(btn => btn.addEventListener('click', (e) => {
            handleVoteClick(e);
            const modalInstance = bootstrap.Modal.getInstance(ui.contestInfoModal);
            if (modalInstance) modalInstance.hide();
        }));

        modalBody.querySelectorAll('.nudge-from-modal-btn').forEach(btn => btn.addEventListener('click', (e) => {
            handleNudgeClick(e.currentTarget);
        }));

        const modalInstance = bootstrap.Modal.getOrCreateInstance(ui.contestInfoModal);
        modalInstance.show();
    }

    async function handleNudgeClick(button) {
        const username = button.dataset.username || button.dataset.targetName;
        if (!username) return;

        const uid = userNameToUidMap[username] || button.dataset.targetUid;
        if (!uid) {
            console.error(`Could not find UID for crawler: ${username}`);
            return;
        }

        const crawlerData = allUsersCache.find(u => u.name === username);
        handleAvatarOrNudgeClick({
            dataset: {
                targetName: username,
                targetUid: uid,
                targetType: 'crawler'
            },
            src: crawlerData?.avatar_url
        });
    }

    function displayNudge(nudge, isPublic) {
        const senderAvatar = nudge.sender_avatar || DEFAULT_AVATAR_URI;
        const senderName = nudge.sender_name || 'مستخدم';
        const nudgeText = nudge.text || '...';

        if (isPublic) {
            const targetRow = document.getElementById(nudge.target_element_id);
            if (!targetRow) return;

            const targetCell = targetRow.querySelector('.crawler-name-cell');
            if (!targetCell) return;

            const nudgeEl = document.createElement('div');
            nudgeEl.className = 'table-nudge-indicator';

            const priceTagHtml = (nudge.sp_price && nudge.sp_price > 0)
                ? `<span class="sp-price-tag">${formatNumber(nudge.sp_price, false)} SP</span>`
                : '';

            nudgeEl.innerHTML = `
                <img src="${senderAvatar}" alt="${senderName}">
                <span>${senderName}: ${nudgeText}</span>
                ${priceTagHtml}
            `;

            targetCell.appendChild(nudgeEl);

            setTimeout(() => {
                nudgeEl.remove();
            }, 4000);

        } else {
            const node = document.createElement('div');
            node.className = 'd-flex align-items-center p-2';
            node.style.fontFamily = "'Almarai', sans-serif";
            node.innerHTML = `
                <img src="${senderAvatar}" style="width: 40px; height: 40px; border-radius: 50%; margin-inline-end: 12px; border: 2px solid rgba(255,255,255,0.7);">
                <div>
                    <strong class="d-block" style="font-size: 15px; margin-bottom: 2px;">${senderName}</strong>
                    <span>${nudgeText}</span>
                </div>
            `;
            Toastify({
                node: node,
                duration: 5000,
                gravity: "top",
                position: "center",
                className: "toastify-center-nudge",
                style: {
                    background: "linear-gradient(to right, #ffc107, #ff8c00)",
                    padding: "15px 20px",
                    borderRadius: "10px",
                    boxShadow: "0 8px 25px rgba(0, 0, 0, 0.5)",
                    fontSize: "16px"
                }
            }).showToast();
        }
    }

    initializeApp();
}
// --- END OF FILE static/js/user_view.js ---