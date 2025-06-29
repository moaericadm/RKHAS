// --- START OF FILE static/js/user_view.js (WITH CONDITIONAL INVESTMENT DEMAND) ---

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
        investmentInfoModal: document.getElementById('investmentInfoModal'),
        userAvatarPreview: document.getElementById('user-avatar-preview'),
        avatarChooserModal: document.getElementById('avatarChooserModal'),
        ownedAvatarsContainer: document.getElementById('owned-avatars-container'),
        investmentDemandHeader: document.getElementById('investment-demand-header'),
        contestCard: document.getElementById('popularity-contest-card'),
        contestContainer: document.getElementById('contest-container'),
        contestTimer: document.getElementById('contest-timer'),
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
                setupDataAndLogic();
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
            tableContainer.innerHTML = `<td colspan="6" class="text-center py-5"><p class="text-danger p-3">فشل المصادقة مع الخادم.<br>قد تحتاج إلى <a href="/auth/logout">تسجيل الخروج والمحاولة مرة أخرى</a>.</p></td>`;
        }
    }

    function setupDataAndLogic() {
        if (window.interactionsApp?.init) window.interactionsApp.init();
        setupEventListeners();
        const handleFirebaseError = (error, path) => console.error(`Firebase Read Error at ${path}:`, error.code, error.message);

        db.ref('users').on('value', (snapshot) => {
            if (ui.loadingSpinner && ui.loadingSpinner.parentElement) ui.loadingSpinner.parentElement.style.display = 'none';
            allUsersCache = Object.entries(snapshot.val() || {}).map(([key, value]) => ({ ...value, name: key }));
            if (window.interactionsApp?.updateUserCache) window.interactionsApp.updateUserCache(allUsersCache);
            sortAndRenderUsers();
        }, (e) => handleFirebaseError(e, 'users/initial_load'));

        db.ref('registered_users').once('value').then((snapshot) => {
            registeredUsersCache = snapshot.val() || {};
        });
        db.ref('popularity_contest').on('value', snapshot => renderPopularityContest(snapshot.val()));


        db.ref('investments').on('value', (s) => {
            allInvestmentsCache = s.val() || {};
            if (currentUserId && allInvestmentsCache[currentUserId]) {
                userInvestments = allInvestmentsCache[currentUserId];
            } else {
                userInvestments = {};
            }
            renderUserTable();
        }, (e) => handleFirebaseError(e, `investments`));

        if (currentUserId) {
            db.ref(`wallets/${currentUserId}`).on('value', (s) => renderWallet(s.val()), (e) => handleFirebaseError(e, `wallets/${currentUserId}`));
            db.ref(`user_messages/${currentUserId}`).on('child_added', handleUserMessage, (e) => handleFirebaseError(e, `user_messages/${currentUserId}`));
            db.ref(`user_spin_state/${currentUserId}`).on('value', (s) => { if (window.spinWheelApp?.updateUI) window.spinWheelApp.updateUI(s.val()); }, (e) => handleFirebaseError(e, `user_spin_state/${currentUserId}`));
            db.ref(`registered_users/${currentUserId}/current_avatar`).on('value', (s) => {
                if (ui.userAvatarPreview) ui.userAvatarPreview.src = s.val() || DEFAULT_AVATAR_URI;
            }, (e) => handleFirebaseError(e, 'current_avatar'));
            db.ref(`user_avatars/${currentUserId}/owned`).on('value', renderOwnedAvatars, (e) => handleFirebaseError(e, 'owned_avatars'));
        }

        db.ref('wallets').on('value', (s) => { allWallets = s.val() || {}; renderRichestInvestors(); }, (e) => handleFirebaseError(e, 'wallets'));
        db.ref('site_settings/honor_roll').on('value', (s) => { honorRollCache = Object.values(s.val() || {}).map(i => i.name); renderHonorRollList(); renderUserTable(); }, (e) => handleFirebaseError(e, 'site_settings/honor_roll'));
        db.ref('candidates').on('value', (s) => renderCandidatesList(Object.keys(s.val() || {})), (e) => handleFirebaseError(e, 'candidates'));
        db.ref('site_settings/announcements').on('value', (s) => renderAnnouncements(Object.values(s.val() || {})), (e) => handleFirebaseError(e, 'site_settings/announcements'));
        db.ref('site_settings/spin_wheel_settings').on('value', (s) => { if (window.spinWheelApp?.reInit) window.spinWheelApp.reInit(s.val() || {}); }, (e) => handleFirebaseError(e, 'site_settings/spin_wheel_settings'));
    }

    const formatNumber = (num, compact = true) => { const n = Number(String(num || '0').replace(/,/g, '')); if (isNaN(n)) return '0'; if (!compact || Math.abs(n) < 1e4) return new Intl.NumberFormat('en-US').format(Math.round(n)); let o = { notation: 'compact', compactDisplay: 'short' }; if (Math.abs(n) >= 1e4 && Math.abs(n) < 1e6) { o.minimumFractionDigits = 1; o.maximumFractionDigits = 1 } else if (Math.abs(n) >= 1e6) { o.minimumFractionDigits = 2; o.maximumFractionDigits = 2 } return new Intl.NumberFormat('en-US', o).format(n); };
    const safeFormatDate = (timestampInSeconds, options = {}) => { if (!timestampInSeconds || typeof timestampInSeconds !== 'number' || timestampInSeconds <= 0) return "تاريخ غير صالح"; const date = new Date(timestampInSeconds * 1000); if (isNaN(date.getTime())) return "تاريخ غير صالح"; const defaultOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }; return date.toLocaleString('ar-EG', { ...defaultOptions, ...options }); };

    function startContestTimer(endTime) {
        clearInterval(contestTimerInterval);
        const update = () => {
            const now = Math.floor(Date.now() / 1000);
            const remaining = Math.max(0, endTime - now);
            const h = String(Math.floor(remaining / 3600)).padStart(2, '0');
            const m = String(Math.floor((remaining % 3600) / 60)).padStart(2, '0');
            const s = String(Math.floor(remaining % 60)).padStart(2, '0');
            ui.contestTimer.textContent = `${h}:${m}:${s}`;
            if (remaining <= 0) clearInterval(contestTimerInterval);
        };
        update();
        contestTimerInterval = setInterval(update, 1000);
    }

    function renderPopularityContest(contest) {
        if (!ui.contestCard || !ui.contestContainer) return;
        if (!contest || contest.status !== 'active') {
            ui.contestCard.style.display = 'none';
            return;
        }

        ui.contestCard.style.display = 'block';
        startContestTimer(contest.end_timestamp || 0);

        const name1 = contest.contestant1_name;
        const name2 = contest.contestant2_name;
        const contestant1 = allUsersCache.find(u => u.name === name1);
        const contestant2 = allUsersCache.find(u => u.name === name2);

        if (!contestant1 || !contestant2) {
            ui.contestContainer.innerHTML = `<div class="col-12 text-center text-muted p-4">خطأ في بيانات المنافسة.</div>`;
            return;
        }

        const votes = contest.votes || {};
        const votes1 = votes[name1] || {};
        const votes2 = votes[name2] || {};
        const userVotedFor = (votes1[currentUserId] ? name1 : (votes2[currentUserId] ? name2 : null));

        const renderVoters = (votersDict) => {
            const uids = Object.keys(votersDict);
            if (uids.length === 0) return `<div class="small text-muted">لا يوجد مصوتون بعد</div>`;
            return uids.slice(0, 10).map(uid => {
                const voter = registeredUsersCache[uid];
                const avatar = voter?.current_avatar || DEFAULT_AVATAR_URI;
                return `<img src="${avatar}" class="rounded-circle" width="24" height="24" title="${voter?.name || 'مستخدم'}" style="margin-right: -8px; border: 1px solid #fff;">`;
            }).join('');
        };

        let html;

        if (userVotedFor) {
            html = `
                <div class="col-6 text-center">
                    <img src="${contestant1.avatar_url || DEFAULT_AVATAR_URI}" class="rounded-circle mb-2" width="60" height="60">
                    <h6 class="mb-1 small">${name1}</h6>
                    <div class="fw-bold mb-2">${Object.keys(votes1).length} صوت</div>
                    <div class="d-flex justify-content-center align-items-center">${renderVoters(votes1)}</div>
                </div>
                <div class="col-6 text-center">
                    <img src="${contestant2.avatar_url || DEFAULT_AVATAR_URI}" class="rounded-circle mb-2" width="60" height="60">
                    <h6 class="mb-1 small">${name2}</h6>
                    <div class="fw-bold mb-2">${Object.keys(votes2).length} صوت</div>
                    <div class="d-flex justify-content-center align-items-center">${renderVoters(votes2)}</div>
                </div>
                <div class="col-12 mt-2">
                    <div class="alert alert-success small text-center p-2 mb-0">شكراً لك، لقد قمت بالتصويت لـِ <strong>${userVotedFor}</strong>.</div>
                </div>
            `;
        } else {
            html = `
                <div class="col-5 text-center">
                    <img src="${contestant1.avatar_url || DEFAULT_AVATAR_URI}" class="rounded-circle mb-2" width="60" height="60">
                    <h6 class="mb-2 small">${name1}</h6>
                    <button class="btn btn-sm btn-outline-success w-100 vote-btn" data-name="${name1}">صوّت</button>
                </div>
                <div class="col-2 d-flex justify-content-center align-items-center fs-4 fw-bold text-danger">VS</div>
                <div class="col-5 text-center">
                    <img src="${contestant2.avatar_url || DEFAULT_AVATAR_URI}" class="rounded-circle mb-2" width="60" height="60">
                    <h6 class="mb-2 small">${name2}</h6>
                    <button class="btn btn-sm btn-outline-success w-100 vote-btn" data-name="${name2}">صوّت</button>
                </div>
            `;
        }

        ui.contestContainer.innerHTML = html;
        ui.contestContainer.querySelectorAll('.vote-btn').forEach(btn => btn.addEventListener('click', handleVoteClick));
    }

    async function handleVoteClick(e) {
        const btn = e.target;
        const name = btn.dataset.name;

        Swal.fire({
            title: `تأكيد التصويت`,
            text: `هل أنت متأكد من أنك تريد التصويت لـِ ${name}؟ لا يمكنك التراجع عن هذا القرار.`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'نعم، صوّت!',
            cancelButtonText: 'إلغاء'
        }).then(async (result) => {
            if (result.isConfirmed) {
                btn.disabled = true;
                btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
                try {
                    const data = await apiCall('/api/contest/vote', {
                        method: 'POST',
                        body: new URLSearchParams({ voted_for_name: name })
                    });
                } catch (err) {
                    Swal.fire('فشل!', err.message, 'error');
                    btn.disabled = false;
                    btn.innerHTML = 'صوّت';
                }
            }
        });
    }

    function setupEventListeners() {
        if (ui.tableBody) {
            ui.tableBody.addEventListener('click', e => {
                const btn = e.target.closest('button');
                if (btn) {
                    const username = btn.dataset.username;
                    if (btn.classList.contains('like-btn')) handleLike(btn);
                    else if (btn.classList.contains('chart-btn')) showUserHistoryChart(username);
                    else if (btn.classList.contains('invest-btn')) showInvestmentModal(username, 'new');
                    else if (btn.classList.contains('boost-btn')) showInvestmentModal(username, 'boost');
                    else if (btn.classList.contains('sell-btn')) confirmSell(username);
                    else if (btn.classList.contains('info-btn')) showInvestmentInfo(btn);
                }
            });
        }
        if (ui.searchInput) ui.searchInput.addEventListener('input', renderUserTable);
        if (ui.investmentForm) ui.investmentForm.addEventListener('submit', handleInvestment);
        if (ui.userAvatarPreview) ui.userAvatarPreview.addEventListener('click', () => ui.avatarChooserModal.classList.add('show'));
        document.querySelectorAll('.custom-modal').forEach(m => { m.addEventListener('click', e => { if (e.target === m || e.target.closest('.custom-close-btn')) m.classList.remove('show'); }); });
    }

    function sortAndRenderUsers() {
        allUsersCache.sort((a, b) => (b.points || 0) - (a.points || 0));
        renderUserTable();
        renderTop3();
    }

    function renderUserTable() {
        if (!ui.tableBody) return;
        const userHasInvestments = Object.keys(userInvestments).length > 0;
        if (ui.investmentDemandHeader) {
            ui.investmentDemandHeader.style.display = userHasInvestments ? '' : 'none';
        }
        let grandTotalInvestedSP = 0;
        if (userHasInvestments) {
            for (const uid in allInvestmentsCache) {
                for (const crawlerName in allInvestmentsCache[uid]) {
                    grandTotalInvestedSP += allInvestmentsCache[uid][crawlerName].invested_sp || 0;
                }
            }
        }
        const term = ui.searchInput.value.toLowerCase();
        const users = allUsersCache.filter(u => u?.name?.toLowerCase().includes(term));
        const html = users.map(user => {
            const rank = allUsersCache.findIndex(u => u.name === user.name) + 1;
            const honor = honorRollCache.includes(user.name) ? ` <span class="badge rounded-pill" style="background:var(--primary-glow);color:#fff;"><i class="bi bi-award-fill"></i></span>` : '';
            const liked = (JSON.parse(localStorage.getItem('likedUsers')) || []).includes(user.name);
            const invest = userInvestments[user.name];
            const pointsNow = parseFloat(user.points) || 0;
            const stockMultiplier = parseFloat(user.stock_multiplier) || 1.0;
            const avatarHtml = `<img src="${user.avatar_url || DEFAULT_AVATAR_URI}" alt="${user.name}" class="crawler-avatar">`;
            let demandHtml = '';
            if (userHasInvestments) {
                if (invest) {
                    let totalSpForThisCrawler = 0;
                    for (const uid in allInvestmentsCache) {
                        if (allInvestmentsCache[uid][user.name]) {
                            totalSpForThisCrawler += allInvestmentsCache[uid][user.name].invested_sp || 0;
                        }
                    }
                    const demandPercentage = grandTotalInvestedSP > 0 ? (totalSpForThisCrawler / grandTotalInvestedSP) * 100 : 0;
                    demandHtml = `
                        <td class="text-center align-middle" title="إجمالي المستثمر: ${formatNumber(totalSpForThisCrawler, false)} SP">
                            <div class="fw-bold">${demandPercentage.toFixed(1)}%</div>
                        </td>`;
                } else {
                    demandHtml = '<td></td>';
                }
            }
            let actionHtml;
            if (invest) {
                const pointsThen = parseFloat(invest.points_at_investment) || 1;
                const sp = parseFloat(invest.invested_sp) || 0;
                const value = sp * (pointsNow / pointsThen) * stockMultiplier;
                const profit = value - sp;
                const color = profit > 0.005 ? 'text-success' : profit < -0.005 ? 'text-danger' : 'text-muted';
                actionHtml = `
                    <div class="d-flex align-items-center justify-content-center">
                        <div class="text-center flex-grow-1">
                            <div class="fw-bold">${value.toFixed(2)} SP</div>
                            <div class="small ${color}">${profit >= 0 ? '+' : ''}${profit.toFixed(2)} SP</div>
                        </div>
                        <div class="btn-group-vertical ms-2 btn-group-sm" role="group">
                            <button class="btn btn-outline-success boost-btn" data-username="${user.name}" title="تعزيز الاستثمار">
                                <i class="bi bi-plus-lg"></i>
                            </button>
                            <button class="btn btn-outline-info info-btn" data-crawler-name="${user.name}" data-invested-sp="${sp.toFixed(2)}" data-points-then="${formatNumber(pointsThen, false)}" data-points-now="${formatNumber(pointsNow, false)}" data-stock-multiplier="${stockMultiplier.toFixed(2)}" data-profit="${profit.toFixed(2)}" data-profit-color="${color}" title="عرض التفاصيل">
                                <i class="bi bi-info-circle"></i>
                            </button>
                            <button class="btn btn-outline-danger sell-btn" data-username="${user.name}" title="بيع الاستثمار">
                                <i class="bi bi-cash-coin"></i>
                            </button>
                        </div>
                    </div>`;
            } else {
                actionHtml = `<button class="btn btn-success invest-btn w-100 d-flex flex-column justify-content-center" style="min-height:58px" data-username="${user.name}"><span><i class="bi bi-graph-up me-1"></i> استثمار</span></button>`;
            }
            return `<tr id="user-row-${user.name}">
                        <th class="align-middle">#${rank}</th>
                        <td class="align-middle fw-bold">${avatarHtml} ${user.name}${honor}</td>
                        <td class="text-center align-middle fs-5 fw-bold" title="النقاط: ${formatNumber(pointsNow, false)}">${formatNumber(pointsNow)}</td>
                        <td class="text-center align-middle">
                            <div class="d-flex justify-content-center align-items-center gap-2">
                                <button class="btn btn-sm like-btn ${liked ? 'liked' : 'btn-outline-danger'}" data-username="${user.name}">
                                    <span class="icon-heart"><i class="bi bi-heart-fill"></i></span>
                                    <span class="like-count ms-1">${formatNumber(user.likes || 0, false)}</span>
                                </button>
                                <button class="btn btn-sm btn-outline-info chart-btn" data-username="${user.name}" title="عرض التقدم">
                                    <i class="bi bi-graph-up"></i>
                                </button>
                            </div>
                        </td>
                        ${demandHtml}
                        <td class="text-center align-middle">${actionHtml}</td>
                    </tr>`;
        }).join('');
        ui.tableBody.innerHTML = html || `<tr><td colspan="${userHasInvestments ? 6 : 5}" class="text-center py-4">${term ? 'لا يوجد زاحف يطابق البحث' : 'لا يوجد بيانات حالياً'}</td></tr>`;
    }

    async function renderOwnedAvatars(snapshot) {
        const ownedData = snapshot.val();
        if (!ui.ownedAvatarsContainer || !ownedData) {
            if (ui.ownedAvatarsContainer) ui.ownedAvatarsContainer.innerHTML = '<p class="text-muted text-center w-100">أنت لا تمتلك أي أفاتارات بعد. قم بشراء واحدة من المتجر!</p>';
            return;
        }
        const ownedIds = Object.keys(ownedData);
        const avatarPromises = ownedIds.map(id => db.ref(`site_settings/shop_avatars/${id}`).get());
        const avatarSnapshots = await Promise.all(avatarPromises);
        let html = '';
        avatarSnapshots.forEach((snap, index) => {
            if (snap.exists()) {
                const avatar = snap.val();
                const avatarId = ownedIds[index];
                html += `<div class="text-center"><img src="${avatar.image_url}" alt="${avatar.name}" class="user-avatar-preview" data-avatar-id="${avatarId}" style="width: 80px; height: 80px;" title="تعيين كصورة شخصية"><p class="small mt-1 mb-0">${avatar.name}</p></div>`;
            }
        });
        ui.ownedAvatarsContainer.innerHTML = html || '<p class="text-muted text-center w-100">أنت لا تمتلك أي أفاتارات بعد.</p>';
        ui.ownedAvatarsContainer.querySelectorAll('.user-avatar-preview').forEach(img => {
            img.addEventListener('click', handleSetAvatar);
        });
    }

    async function handleSetAvatar(e) { const avatarId = e.target.dataset.avatarId; if (!avatarId) return; Swal.fire({ title: 'تغيير الأفاتار', text: 'هل أنت متأكد أنك تريد تعيين هذا الأفاتار كصورتك الشخصية؟', icon: 'question', showCancelButton: true, confirmButtonText: 'نعم، قم بالتعيين', cancelButtonText: 'إلغاء' }).then(async result => { if (result.isConfirmed) { try { const data = await apiCall('/api/user/set_avatar', { method: 'POST', body: new URLSearchParams({ avatar_id: avatarId }) }); Swal.fire('تم!', data.message, 'success'); ui.avatarChooserModal.classList.remove('show'); } catch (err) { Swal.fire('فشل!', err.message, 'error'); } } }); }
    function showInvestmentInfo(btn) { if (!ui.investmentInfoModal) return; const { crawlerName, investedSp, pointsThen, pointsNow, stockMultiplier, profit, profitColor } = btn.dataset; ui.investmentInfoModal.querySelector('#infoModalCrawlerName').textContent = crawlerName; ui.investmentInfoModal.querySelector('#infoModalInvestedSP').textContent = `${investedSp} SP`; ui.investmentInfoModal.querySelector('#infoModalPointsThen').textContent = pointsThen; ui.investmentInfoModal.querySelector('#infoModalPointsNow').textContent = pointsNow; ui.investmentInfoModal.querySelector('#infoModalStockMultiplier').textContent = `x${stockMultiplier}`; const p = ui.investmentInfoModal.querySelector('#infoModalProfitLoss'); p.textContent = `${parseFloat(profit) >= 0 ? '+' : ''}${profit} SP`; p.className = `fw-bold ${profitColor}`; ui.investmentInfoModal.classList.add('show'); }
    function renderWallet(wallet) { wallet = wallet || { cc: 0, sp: 0 }; if (ui.userCcBalance) ui.userCcBalance.textContent = formatNumber(wallet.cc, false); if (ui.userSpBalance) ui.userSpBalance.textContent = formatNumber(wallet.sp, false); }
    function renderRichestInvestors() { if (!ui.richestInvestorsList || !allWallets) return; db.ref('registered_users').once('value', s => { const usersMap = s.val() || {}; const adminUIDs = new Set(Object.keys(usersMap).filter(id => usersMap[id].role === 'admin')); const richList = Object.entries(allWallets).filter(([uid]) => !adminUIDs.has(uid) && usersMap[uid]).sort(([, a], [, b]) => (b.sp || 0) - (a.sp || 0)).slice(0, 10); ui.richestInvestorsList.innerHTML = richList.length === 0 ? '<li class="list-group-item text-muted text-center">لا يوجد مستثمرون بعد.</li>' : richList.map(([uid, w], i) => `<li class="list-group-item d-flex justify-content-between"><span>${['🥇', '🥈', '🥉'][i] || `<b>#${i + 1}</b>`} ${usersMap[uid].name}</span><span class="badge rounded-pill bg-success">${(w.sp || 0).toFixed(2)} SP</span></li>`).join(''); }); }
    function renderTop3() { if (!ui.hallOfFame) return; const top3 = allUsersCache.slice(0, 3); ui.hallOfFame.innerHTML = top3.length > 0 ? top3.map((u, i) => `<li class="list-group-item d-flex justify-content-between"><span>${['🥇', '🥈', '🥉'][i]} ${u.name}</span><span class="badge rounded-pill" style="background-color:var(--primary-glow)">${formatNumber(u.points)}</span></li>`).join('') : '<li class="list-group-item text-muted text-center">القائمة فارغة.</li>'; }
    function renderHonorRollList() { if (!ui.honorRollList) return; ui.honorRollList.innerHTML = honorRollCache.length ? honorRollCache.map(n => `<li class="list-group-item fw-bold text-center"><i class="bi bi-star-fill text-warning me-2"></i>${n}</li>`).join('') : '<li class="list-group-item text-muted text-center">القائمة فارغة.</li>'; }
    function renderCandidatesList(candidates) { if (!ui.candidatesList) return; ui.candidatesList.innerHTML = candidates.length ? candidates.map(n => `<li class="list-group-item"><i class="bi bi-person-check-fill me-2"></i>${n}</li>`).join('') : '<li class="list-group-item text-muted text-center">لا يوجد مرشحون.</li>'; }
    function renderAnnouncements(announcements) { if (!ui.announcementsTicker || !ui.announcementsContainer) return; if (announcements.length > 0) { ui.announcementsContainer.style.display = 'flex'; requestAnimationFrame(() => ui.announcementsContainer.classList.add('visible')); ui.announcementsTicker.innerHTML = announcements.map(n => `<div class="ticker-item">${n.text}</div>`).join(''); ui.announcementsTicker.style.animationDuration = `${Math.max(announcements.length * 8, 20)}s`; } else { ui.announcementsContainer.classList.remove('visible'); setTimeout(() => { ui.announcementsContainer.style.display = 'none' }, 500); } }
    async function apiCall(endpoint, options = {}) { const response = await fetch(endpoint, options); const data = await response.json(); if (!response.ok) throw new Error(data.message || 'خطأ في الخادم'); return data; }
    function showInvestmentModal(crawlerName, type = 'new') { if (!ui.investmentModal) return; ui.investCrawlerName.textContent = crawlerName; ui.investCrawlerNameHidden.value = crawlerName; ui.spAmountInput.value = ''; if (type === 'boost') { ui.investModalTitle.textContent = `تعزيز الاستثمار في `; ui.investModalSubtitle.textContent = `أدخل كمية SP الإضافية التي ترغب في استثمارها.`; } else { ui.investModalTitle.textContent = `الاستثمار في `; ui.investModalSubtitle.textContent = `أدخل كمية SP التي ترغب في استثمارها.`; } ui.investmentModal.classList.add('show'); ui.spAmountInput.focus(); }
    async function handleInvestment(e) { e.preventDefault(); const form = e.target, btn = form.querySelector('button[type="submit"]'), originalHTML = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`; try { const data = await apiCall('/api/invest', { method: 'POST', body: new FormData(form) }); Swal.fire('تم الاستثمار!', data.message, 'success'); ui.investmentModal.classList.remove('show'); form.reset(); } catch (err) { Swal.fire('فشل!', err.message, 'error'); } finally { btn.disabled = false; btn.innerHTML = originalHTML; } }
    function confirmSell(crawlerName) { Swal.fire({ title: `هل أنت متأكد من بيع استثمارك في ${crawlerName}؟`, text: "سيتم إضافة قيمة الاستثمار الحالية إلى رصيدك من SP.", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم, قم بالبيع!', cancelButtonText: 'إلغاء' }).then(async (result) => { if (result.isConfirmed) { try { const data = await apiCall('/api/sell', { method: 'POST', body: new URLSearchParams({ 'crawler_name': crawlerName }) }); Swal.fire('تم البيع!', data.message, 'success'); } catch (e) { Swal.fire('فشل!', e.message, 'error'); } } }); }
    function handleLike(btn) { if (btn.disabled) return; const username = btn.dataset.username, likedUsers = new Set(JSON.parse(localStorage.getItem('likedUsers')) || []), countSpan = btn.querySelector('.like-count'), currentLikes = parseInt(String(countSpan.textContent || '0').replace(/[^0-9.-]+/g, "")), isLiked = likedUsers.has(username), action = isLiked ? 'unlike' : 'like'; btn.disabled = true; if (action === 'like') { likedUsers.add(username); btn.classList.add('liked'); btn.classList.remove('btn-outline-danger'); countSpan.textContent = formatNumber(currentLikes + 1, false); for (let i = 0; i < 7; i++) { const burst = document.createElement('span'); burst.className = 'heart-burst'; burst.style.left = `${Math.random() * 100}%`; burst.style.top = `${Math.random() * 100}%`; burst.style.animationDelay = `${Math.random() * 0.3}s`; btn.appendChild(burst); setTimeout(() => burst.remove(), 800); } } else { likedUsers.delete(username); btn.classList.remove('liked'); btn.classList.add('btn-outline-danger'); countSpan.textContent = formatNumber(Math.max(0, currentLikes - 1), false); } localStorage.setItem('likedUsers', JSON.stringify([...likedUsers])); apiCall(`/api/like/${username}?action=${action}`, { method: 'POST' }).catch(e => console.error("Like error:", e)).finally(() => btn.disabled = false); }
    async function showUserHistoryChart(username) { if (!ui.userChartModal) return; try { const history = await apiCall(`/api/user_history/${username}`); if (!history || history.length < 2) return Swal.fire({ icon: 'info', title: 'لا توجد بيانات كافية', text: 'لا يوجد سجل نقاط كافٍ لعرض الرسم البياني.' }); ui.chartModalLabel.innerText = `تقدم الزاحف: ${username}`; if (userChartInstance) userChartInstance.destroy(); const ctx = ui.userPointsChartCanvas.getContext('2d'); const gradient = ctx.createLinearGradient(0, 0, 0, 400); gradient.addColorStop(0, 'rgba(0, 242, 255, 0.4)'); gradient.addColorStop(1, 'rgba(159, 122, 234, 0.1)'); userChartInstance = new Chart(ctx, { type: 'line', data: { labels: history.map(d => safeFormatDate(d.timestamp, { day: '2-digit', month: 'short' })), datasets: [{ label: 'النقاط', data: history.map(d => d.points), fill: true, backgroundColor: gradient, borderColor: '#00f2ff', tension: 0.4 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { color: 'var(--text-color)' }, grid: { color: 'rgba(255,255,255,.1)' } }, x: { ticks: { color: 'var(--text-color)' }, grid: { display: false } } }, plugins: { legend: { display: false } } } }); ui.userChartModal.classList.add('show'); } catch (e) { Swal.fire('خطأ', 'لم نتمكن من جلب سجل نقاط هذا الزاحف.', 'error'); } }
    function handleUserMessage(snapshot) { const getProcessedIds = () => new Set(JSON.parse(sessionStorage.getItem('processedMessageIds') || '[]')), setProcessedIds = ids => sessionStorage.setItem('processedMessageIds', JSON.stringify([...ids])), processedIds = getProcessedIds(), messageId = snapshot.key; if (snapshot.val()?.text && !processedIds.has(messageId)) { processedIds.add(messageId), setProcessedIds(processedIds), Swal.fire({ title: 'رسالة من الإدارة!', text: snapshot.val().text, icon: 'info', confirmButtonText: 'تم الاطلاع' }).then(() => snapshot.ref.remove()) } }

    initializeApp();
}