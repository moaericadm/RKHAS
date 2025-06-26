// --- START OF FILE static/js/user_view.js ---

// --- App Initialization Logic ---
let isDomReady = false;
let isFirebaseReady = false;

function tryToStartApp() {
    if (isDomReady && isFirebaseReady) {
        initializeUserView();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    isDomReady = true;
    tryToStartApp();
});

document.addEventListener('firebase-ready', () => {
    isFirebaseReady = true;
    tryToStartApp();
});

function initializeUserView() {
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
        announcementsContainer: document.getElementById('announcements-container'),
        announcementsTicker: document.getElementById('announcements-ticker'),
        // *** إضافة جديدة للوصول إلى نافذة المعلومات ***
        investmentInfoModal: document.getElementById('investmentInfoModal'),
    };

    let allUsersCache = [];
    let honorRollCache = [];
    let userInvestments = {};
    let allWallets = {};
    let userChartInstance = null;
    let db;
    let currentUserId;
    let usersRef; // Reference to the 'users' node in Firebase

    async function initializeApp() {
        console.log("User view initialization started (triggered by event).");
        try {
            db = firebase.database();
            usersRef = db.ref('users');
            const token = sessionStorage.getItem('firebaseToken');
            if (token) {
                await firebase.auth().signInWithCustomToken(token).then(cred => {
                    currentUserId = cred.user.uid;
                });
            } else {
                handleAuthError(new Error('توكن المصادقة مفقود.'));
                return;
            }
            setupDataAndLogic();
        } catch (e) { handleAuthError(e); }
    }

    function handleAuthError(e) {
        console.error("CRITICAL INITIALIZATION ERROR:", e);
        Swal.fire({ title: 'انتهت صلاحية الجلسة', text: 'الرجاء تسجيل الدخول مرة أخرى للاستمرار.', icon: 'error', confirmButtonText: 'تسجيل الدخول', allowOutsideClick: false, allowEscapeKey: false })
            .then(() => { sessionStorage.removeItem('firebaseToken'); window.location.href = '/login'; });
    }

    async function setupDataAndLogic() {
        if (window.interactionsApp?.init) window.interactionsApp.init();
        setupEventListeners();

        const handleFirebaseError = (error, path) => console.error(`Firebase Read Error at ${path}:`, error.code, error.message);

        usersRef.once('value', (snapshot) => {
            if (ui.loadingSpinner) ui.loadingSpinner.parentElement.style.display = 'none';
            const usersData = snapshot.val() || {};
            allUsersCache = Object.entries(usersData).map(([key, value]) => ({ ...value, name: key }))
                .sort((a, b) => (b.points || 0) - (a.points || 0));

            if (window.interactionsApp?.updateUserCache) window.interactionsApp.updateUserCache(allUsersCache);
            renderUserTable();
            renderTop3();

            usersRef.on('child_added', (childSnapshot) => {
                const newUser = { ...childSnapshot.val(), name: childSnapshot.key };
                if (!allUsersCache.find(u => u.name === newUser.name)) {
                    allUsersCache.push(newUser);
                }
                sortAndRenderUsers();
            }, (e) => handleFirebaseError(e, 'users/child_added'));

            usersRef.on('child_changed', (childSnapshot) => {
                const changedUser = { ...childSnapshot.val(), name: childSnapshot.key };
                const index = allUsersCache.findIndex(u => u.name === changedUser.name);

                let oldPoints = 0;
                if (index > -1) {
                    oldPoints = allUsersCache[index].points || 0;
                    allUsersCache[index] = { ...allUsersCache[index], ...changedUser };
                } else {
                    allUsersCache.push(changedUser);
                }

                sortAndRenderUsers();

                const newPoints = changedUser.points || 0;
                if (oldPoints !== 0) {
                    const userRow = document.getElementById(`user-row-${changedUser.name}`);
                    if (userRow) {
                        if (newPoints > oldPoints) {
                            userRow.classList.add('flash-up');
                        } else if (newPoints < oldPoints) {
                            userRow.classList.add('flash-down');
                        }
                        setTimeout(() => {
                            userRow.classList.remove('flash-up', 'flash-down');
                        }, 2000);
                    }
                }
            }, (e) => handleFirebaseError(e, 'users/child_changed'));

            usersRef.on('child_removed', (childSnapshot) => {
                allUsersCache = allUsersCache.filter(u => u.name !== childSnapshot.key);
                sortAndRenderUsers();
            }, (e) => handleFirebaseError(e, 'users/child_removed'));

        }, (e) => {
            handleFirebaseError(e, 'users/initial_load');
            if (ui.loadingSpinner) ui.loadingSpinner.innerHTML = '<p class="text-danger">فشل تحميل بيانات الزواحف.</p>';
        });

        if (currentUserId) {
            db.ref(`wallets/${currentUserId}`).on('value', (s) => renderWallet(s.val()), (e) => handleFirebaseError(e, `wallets/${currentUserId}`));
            db.ref(`investments/${currentUserId}`).on('value', (snapshot) => {
                userInvestments = snapshot.val() || {};
                renderUserTable();
            }, (e) => handleFirebaseError(e, `investments/${currentUserId}`));
            db.ref(`user_messages/${currentUserId}`).on('child_added', handleUserMessage, (e) => handleFirebaseError(e, `user_messages/${currentUserId}`));
            db.ref(`user_spin_state/${currentUserId}`).on('value', (snapshot) => {
                const state = snapshot.val();
                if (window.spinWheelApp && window.spinWheelApp.updateUI) {
                    window.spinWheelApp.updateUI(state);
                }
            }, (e) => handleFirebaseError(e, `user_spin_state/${currentUserId}`));
        }

        db.ref('wallets').on('value', (s) => { allWallets = s.val() || {}; renderRichestInvestors(); }, (e) => handleFirebaseError(e, 'wallets'));
        db.ref('site_settings/honor_roll').on('value', (s) => { honorRollCache = Object.values(s.val() || {}).map(i => i.name); renderHonorRollList(); renderUserTable(); }, (e) => handleFirebaseError(e, 'site_settings/honor_roll'));
        db.ref('candidates').on('value', (s) => renderCandidatesList(Object.keys(s.val() || {})), (e) => handleFirebaseError(e, 'candidates'));
        db.ref('site_settings/announcements').on('value', (s) => renderAnnouncements(Object.values(s.val() || {})), (e) => handleFirebaseError(e, 'site_settings/announcements'));
        db.ref('site_settings/spin_wheel_settings').on('value', (snapshot) => {
            const settings = snapshot.val() || {};
            if (window.spinWheelApp && window.spinWheelApp.reInit) {
                window.spinWheelApp.reInit(settings);
            }
        }, (e) => handleFirebaseError(e, 'site_settings/spin_wheel_settings'));

        try {
            await fetch('/api/spin_wheel/state', { method: 'POST' });
        } catch (e) {
            console.error("Failed to check/update spin state on load:", e);
        }
    }

    function sortAndRenderUsers() {
        allUsersCache.sort((a, b) => (b.points || 0) - (a.points || 0));
        if (window.interactionsApp?.updateUserCache) window.interactionsApp.updateUserCache(allUsersCache);
        renderUserTable();
        renderTop3();
    }

    function setupEventListeners() {
        if (ui.tableBody) {
            ui.tableBody.addEventListener('click', e => {
                const btn = e.target.closest('button');
                if (!btn) return;

                if (btn.classList.contains('like-btn')) handleLike(btn);
                if (btn.classList.contains('chart-btn')) showUserHistoryChart(btn.dataset.username);
                if (btn.classList.contains('invest-btn')) showInvestmentModal(btn.dataset.username);
                if (btn.classList.contains('sell-btn')) confirmSell(btn.dataset.username);
                if (btn.classList.contains('info-btn')) showInvestmentInfo(btn);
            });
        }

        if (ui.searchInput) ui.searchInput.addEventListener('input', renderUserTable);
        if (ui.investmentForm) ui.investmentForm.addEventListener('submit', handleInvestment);

        document.querySelectorAll('.custom-modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('show');
                }
                if (e.target.closest('[data-bs-dismiss="modal"]')) {
                    modal.classList.remove('show');
                }
            });
        });
    }

    const formatNumber = (num, compact = true) => {
        const number = Number(String(num || '0').replace(/,/g, ''));
        if (isNaN(number)) return '0';

        if (!compact || Math.abs(number) < 10000) {
            return new Intl.NumberFormat('en-US').format(Math.round(number));
        }

        let options = {
            notation: 'compact',
            compactDisplay: 'short'
        };

        if (Math.abs(number) >= 10000 && Math.abs(number) < 1000000) {
            options.minimumFractionDigits = 1;
            options.maximumFractionDigits = 1;
        } else if (Math.abs(number) >= 1000000) {
            options.minimumFractionDigits = 2;
            options.maximumFractionDigits = 2;
        }
        return new Intl.NumberFormat('en-US', options).format(number);
    };

    function renderUserTable() {
        if (!ui.tableBody) return;
        const term = ui.searchInput.value.toLowerCase();
        const filteredUsers = allUsersCache.filter(u => u && u.name && u.name.toLowerCase().includes(term));
        let tableHtml = '';

        if (ui.loadingSpinner && allUsersCache.length === 0 && !term) {
            ui.loadingSpinner.parentElement.style.display = 'block';
            ui.loadingSpinner.innerHTML = '<div class="spinner-border text-danger"></div><p class="mt-2">جاري تحميل السوق...</p>';
            ui.tableBody.innerHTML = '';
            return;
        } else if (ui.loadingSpinner) {
            ui.loadingSpinner.parentElement.style.display = 'none';
        }

        if (filteredUsers.length > 0) {
            const likedUsers = new Set(JSON.parse(localStorage.getItem('likedUsers')) || []);
            filteredUsers.forEach((userInLoop) => {
                if (!userInLoop || !userInLoop.name) return;

                const currentCrawlerData = allUsersCache.find(c => c.name === userInLoop.name);
                if (!currentCrawlerData) return;

                const rank = allUsersCache.findIndex(u => u && u.name === currentCrawlerData.name) + 1;
                const honorBadge = honorRollCache.includes(currentCrawlerData.name) ? ` <span class="badge rounded-pill" style="background:var(--primary-glow);color:#fff;"><i class="bi bi-award-fill"></i></span>` : '';
                const hasLiked = likedUsers.has(currentCrawlerData.name);
                const investment = userInvestments[currentCrawlerData.name];

                const pointsNow = parseFloat(currentCrawlerData.points) || 0;

                const compactPoints = formatNumber(pointsNow, true);
                const fullPoints = formatNumber(pointsNow, false);

                let actionButtonHtml = '';
                const buttonStyle = "min-height: 58px;";

                if (investment) {
                    const pointsThen = parseFloat(investment.points_at_investment) || 1;
                    const investedSP = parseFloat(investment.invested_sp) || 0;

                    let currentValue = investedSP;
                    if (pointsThen !== 0) {
                        currentValue = investedSP * (pointsNow / pointsThen);
                    }
                    const profit = currentValue - investedSP;

                    let profitColor = 'text-muted';
                    let profitSymbol = profit >= 0 ? '+' : '';

                    if (profit > 0.005) {
                        profitColor = 'text-success';
                    } else if (profit < -0.005) {
                        profitColor = 'text-danger';
                    }

                    actionButtonHtml = `
                        <div class="investment-details d-flex align-items-center justify-content-center" style="${buttonStyle}">
                            <div class="text-center flex-grow-1">
                                <div class="fw-bold">${currentValue.toFixed(2)} SP</div>
                                <div class="small ${profitColor}">${profitSymbol}${profit.toFixed(2)} SP</div>
                            </div>
                            <div class="d-flex flex-column ms-2 gap-1">
                                <button class="btn btn-sm btn-danger sell-btn" data-username="${currentCrawlerData.name}" style="line-height: 1;">
                                    <i class="bi bi-cash-coin"></i>
                                </button>
                                <button class="btn btn-sm btn-info info-btn" 
                                        data-crawler-name="${currentCrawlerData.name}"
                                        data-invested-sp="${investedSP.toFixed(2)}"
                                        data-points-then="${formatNumber(pointsThen, false)}"
                                        data-points-now="${fullPoints}"
                                        data-profit="${profit.toFixed(2)}"
                                        data-profit-color="${profitColor}"
                                        style="line-height: 1;">
                                    <i class="bi bi-info-circle"></i>
                                </button>
                            </div>
                        </div>`;

                } else {
                    actionButtonHtml = `
                        <button class="btn btn-sm btn-success invest-btn w-100 d-flex flex-column justify-content-center" style="${buttonStyle}" data-username="${currentCrawlerData.name}">
                            <span><i class="bi bi-graph-up me-1"></i> استثمر</span>
                        </button>`;
                }

                tableHtml += `
                    <tr id="user-row-${currentCrawlerData.name}">
                        <th class="align-middle">#${rank || 'N/A'}</th>
                        <td class="align-middle fw-bold">${currentCrawlerData.name}${honorBadge}</td>
                        <td class="text-center align-middle fs-5 fw-bold" title="النقاط الدقيقة: ${fullPoints}">${compactPoints}</td>
                        <td class="text-center align-middle">
                            <div class="d-flex justify-content-center align-items-center gap-2">
                                <button class="btn btn-sm like-btn ${hasLiked ? 'liked' : 'btn-outline-danger'}" data-username="${currentCrawlerData.name}">
                                    <span class="icon-heart"><i class="bi bi-heart-fill"></i></span>
                                    <span class="like-count ms-1">${formatNumber(currentCrawlerData.likes || 0, false)}</span>
                                </button>
                                <button class="btn btn-sm btn-outline-info chart-btn" data-username="${currentCrawlerData.name}" title="عرض تقدم الزاحف"><i class="bi bi-graph-up"></i></button>
                            </div>
                        </td>
                        <td class="text-center align-middle">${actionButtonHtml}</td>
                    </tr>`;
            });
        }
        if (tableHtml === '') { tableHtml = `<tr><td colspan="5" class="text-center py-4">${term ? 'لا يوجد زاحف يطابق البحث.' : 'لا يوجد بيانات لعرضها حالياً في السوق.'}</td></tr>`; }
        ui.tableBody.innerHTML = tableHtml;
    }

    function showInvestmentInfo(button) {
        if (!ui.investmentInfoModal) return;

        const {
            crawlerName,
            investedSp,
            pointsThen,
            pointsNow,
            profit,
            profitColor
        } = button.dataset;

        const profitSymbol = parseFloat(profit) >= 0 ? '+' : '';

        ui.investmentInfoModal.querySelector('#infoModalCrawlerName').textContent = crawlerName;
        ui.investmentInfoModal.querySelector('#infoModalInvestedSP').textContent = `${investedSp} SP`;
        ui.investmentInfoModal.querySelector('#infoModalPointsThen').textContent = pointsThen;
        ui.investmentInfoModal.querySelector('#infoModalPointsNow').textContent = pointsNow;

        const profitElement = ui.investmentInfoModal.querySelector('#infoModalProfitLoss');
        profitElement.textContent = `${profitSymbol}${profit} SP`;
        profitElement.className = `fw-bold ${profitColor}`;

        ui.investmentInfoModal.classList.add('show');
    }

    function renderWallet(wallet) { wallet = wallet || { cc: 0, sp: 0 }; if (ui.userCcBalance) ui.userCcBalance.textContent = formatNumber(wallet.cc, false); if (ui.userSpBalance) ui.userSpBalance.textContent = formatNumber(wallet.sp, false); }

    function renderRichestInvestors() {
        if (!ui.richestInvestorsList || !allWallets) return;
        db.ref('registered_users').once('value', s => {
            const users = s.val() || {};
            const adminUids = new Set();
            for (const uid in users) {
                if (users[uid].role === 'admin') {
                    adminUids.add(uid);
                }
            }

            const userNames = Object.fromEntries(Object.entries(users).map(([uid, u]) => [uid, u.name]));

            // ***  התיקון כאן | THE FIX IS HERE  ***
            // قمنا بإضافة .filter() لتجاهل أي محفظة ليس لها اسم مستخدم مسجل
            const sortedInvestors = Object.entries(allWallets)
                .filter(([uid]) => !adminUids.has(uid)) // 1. تجاهل الأدمن
                .filter(([uid, wallet]) => userNames[uid]) // 2. تجاهل أي محفظة ليس لها مستخدم مسجل
                .sort(([, a], [, b]) => (b.sp || 0) - (a.sp || 0)) // 3. ترتيب حسب رصيد SP
                .slice(0, 10); // 4. أخذ أول 10 فقط

            if (sortedInvestors.length === 0) {
                ui.richestInvestorsList.innerHTML = `<li class="list-group-item text-muted text-center">لا يوجد مستثمرون بعد.</li>`;
                return;
            }

            ui.richestInvestorsList.innerHTML = sortedInvestors.map(([uid, wallet], index) => {
                // الآن نحن متأكدون أن الاسم موجود دائماً
                const name = userNames[uid];
                if (!wallet || typeof wallet.sp === 'undefined') return '';
                const spBalance = (wallet.sp || 0).toFixed(2);
                return `<li class="list-group-item d-flex justify-content-between"><span>${['🥇', '🥈', '🥉'][index] || `<b>#${index + 1}</b>`} ${name}</span><span class="badge rounded-pill bg-success">${spBalance} SP</span></li>`;
            }).join('');
        });
    }

    function renderTop3() { if (!ui.hallOfFame) return; const topUsers = allUsersCache.filter(u => u && u.name).slice(0, 3); ui.hallOfFame.innerHTML = topUsers.length > 0 ? topUsers.map((u, i) => `<li class="list-group-item d-flex justify-content-between"><span>${['🥇', '🥈', '🥉'][i]} ${u.name}</span><span class="badge rounded-pill" style="background-color:var(--primary-glow)">${formatNumber(u.points, true)}</span></li>`).join('') : `<li class="list-group-item text-muted text-center">القائمة فارغة.</li>`; }
    function renderHonorRollList() { if (!ui.honorRollList) return; ui.honorRollList.innerHTML = honorRollCache.length ? honorRollCache.map(name => `<li class="list-group-item fw-bold text-center"><i class="bi bi-star-fill text-warning me-2"></i>${name}</li>`).join('') : `<li class="list-group-item text-muted text-center">القائمة فارغة.</li>`; }
    function renderCandidatesList(candidatesCache) { if (!ui.candidatesList) return; ui.candidatesList.innerHTML = candidatesCache.length ? candidatesCache.map(name => `<li class="list-group-item"><i class="bi bi-person-check-fill me-2"></i>${name}</li>`).join('') : `<li class="list-group-item text-muted text-center">لا يوجد مرشحون.</li>`; }
    function renderAnnouncements(announcementsCache) { if (!ui.announcementsTicker || !ui.announcementsContainer) return; if (announcementsCache && announcementsCache.length > 0) { ui.announcementsContainer.classList.add('visible'); ui.announcementsTicker.innerHTML = announcementsCache.map(ann => `<div class="ticker-item">${ann.text}</div>`).join(''); const animationDuration = Math.max(announcementsCache.length * 8, 20); ui.announcementsTicker.style.animationDuration = `${animationDuration}s`; } else { ui.announcementsContainer.classList.remove('visible'); } }

    async function apiCall(endpoint, options) { const response = await fetch(endpoint, options); const data = await response.json(); if (!response.ok) throw new Error(data.message || 'خطأ في الخادم'); return data; }
    function showInvestmentModal(crawlerName) { if (!ui.investmentModal) return; ui.investCrawlerName.textContent = crawlerName; ui.investCrawlerNameHidden.value = crawlerName; ui.investmentModal.classList.add('show'); ui.spAmountInput.focus(); }
    async function handleInvestment(e) { e.preventDefault(); const form = e.target; const btn = form.querySelector('button[type="submit"]'); if (!form || !btn) return; const originalText = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`; try { const data = await apiCall('/api/invest', { method: 'POST', body: new FormData(form) }); Swal.fire('تم الاستثمار!', data.message, 'success'); ui.investmentModal.classList.remove('show'); form.reset(); } catch (error) { Swal.fire('فشل!', error.message, 'error'); } finally { btn.disabled = false; btn.innerHTML = originalText; } }
    function confirmSell(crawlerName) { Swal.fire({ title: `هل أنت متأكد من بيع استثمارك في ${crawlerName}؟`, text: "سيتم إضافة قيمة الاستثمار الحالية إلى رصيدك من SP.", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'نعم, قم بالبيع!', cancelButtonText: 'إلغاء' }).then(async (result) => { if (result.isConfirmed) { try { const data = await apiCall('/api/sell', { method: 'POST', body: new URLSearchParams({ 'crawler_name': crawlerName }) }); Swal.fire('تم البيع!', data.message, 'success'); } catch (error) { Swal.fire('فشل!', error.message, 'error'); } } }); }
    function handleLike(likeBtn) { if (likeBtn.disabled) return; const username = likeBtn.dataset.username; const likedUsers = new Set(JSON.parse(localStorage.getItem('likedUsers')) || []); const countSpan = likeBtn.querySelector('.like-count'); const currentCount = parseInt(String(countSpan.textContent || '0').replace(/[^0-9.-]+/g, "")); const hasLiked = likedUsers.has(username); const action = hasLiked ? 'unlike' : 'like'; likeBtn.disabled = true; if (action === 'like') { likedUsers.add(username); likeBtn.classList.add('liked'); likeBtn.classList.remove('btn-outline-danger'); countSpan.textContent = formatNumber(currentCount + 1, false); for (let i = 0; i < 7; i++) { const burst = document.createElement('span'); burst.className = 'heart-burst'; burst.style.left = `${Math.random() * 100}%`; burst.style.top = `${Math.random() * 100}%`; burst.style.animationDelay = `${Math.random() * 0.3}s`; likeBtn.appendChild(burst); setTimeout(() => burst.remove(), 800); } } else { likedUsers.delete(username); likeBtn.classList.remove('liked'); likeBtn.classList.add('btn-outline-danger'); countSpan.textContent = formatNumber(Math.max(0, currentCount - 1), false); } localStorage.setItem('likedUsers', JSON.stringify([...likedUsers])); apiCall(`/api/like/${username}?action=${action}`, { method: 'POST' }).catch(err => console.error("Network error on like/unlike:", err)).finally(() => { likeBtn.disabled = false; }); }
    async function showUserHistoryChart(username) { if (!ui.userChartModal) return; try { const history = await apiCall(`/api/user_history/${username}`); if (!history || history.length < 2) { return Swal.fire({ icon: 'info', title: 'لا توجد بيانات كافية', text: 'لا يوجد سجل نقاط كافٍ لعرض الرسم البياني.' }); } ui.chartModalLabel.innerText = `تقدم الزاحف: ${username}`; if (userChartInstance) userChartInstance.destroy(); const chartContext = ui.userPointsChartCanvas.getContext('2d'); const gradient = chartContext.createLinearGradient(0, 0, 0, 400); gradient.addColorStop(0, 'rgba(0, 242, 255, 0.4)'); gradient.addColorStop(1, 'rgba(159, 122, 234, 0.1)'); userChartInstance = new Chart(chartContext, { type: 'line', data: { labels: history.map(h => new Date(h.timestamp * 1000).toLocaleDateString('ar-EG', { day: '2-digit', month: 'short' })), datasets: [{ label: 'النقاط', data: history.map(h => h.points), fill: true, backgroundColor: gradient, borderColor: '#00f2ff', tension: 0.4 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { color: 'var(--text-color)' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } }, x: { ticks: { color: 'var(--text-color)' }, grid: { display: false } } }, plugins: { legend: { display: false } } } }); ui.userChartModal.classList.add('show'); } catch (e) { Swal.fire('خطأ', 'لم نتمكن من جلب سجل نقاط هذا الزاحف.', 'error'); } }
    function handleUserMessage(snapshot) { const getProcessedMessageIds = () => new Set(JSON.parse(sessionStorage.getItem('processedMessageIds') || '[]')); const saveProcessedMessageIds = (idSet) => sessionStorage.setItem('processedMessageIds', JSON.stringify([...idSet])); const sessionProcessedMessageIds = getProcessedMessageIds(); const messageId = snapshot.key; const message = snapshot.val(); if (!message || !message.text || sessionProcessedMessageIds.has(messageId)) return; sessionProcessedMessageIds.add(messageId); saveProcessedMessageIds(sessionProcessedMessageIds); Swal.fire({ title: 'رسالة من الإدارة!', text: message.text, icon: 'info', confirmButtonText: 'تم الاطلاع' }).then((result) => { if (result.isConfirmed) { snapshot.ref.remove().catch(err => console.error("Failed to remove message.", err)); } }); }

    initializeApp();
}
// --- END OF FILE static/js/user_view.js ---