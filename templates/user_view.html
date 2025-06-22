<!-- START OF MODIFIED SCRIPT FOR user_view.html -->
{% block scripts %}
<script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.11.5/gsap.min.js"></script>
<script src="{{ url_for('static', filename='js/Winwheel.min.js') }}"></script>

<script>
document.addEventListener('DOMContentLoaded', function() {
    const ui = {
        tableBody: document.getElementById('user-table-body'),
        loadingSpinner: document.getElementById('loading-spinner'),
        hallOfFame: document.getElementById('hall-of-fame'),
        honorRollList: document.getElementById('honor-roll-view-list'),
        candidatesList: document.getElementById('candidates-list'),
        searchInput: document.getElementById('searchInput'),
        nominateBtn: document.getElementById('nominate-btn'),
        reportBtn: document.getElementById('report-btn'),
        userChartModal: document.getElementById('userChartModal'),
        chartModalLabel: document.getElementById('chartModalLabel'),
        userPointsChartCanvas: document.getElementById('userPointsChart'),
        announcementsContainer: document.getElementById('announcements-container'),
        announcementsTicker: document.getElementById('announcements-ticker'),
        spinWheel: {
            card: document.getElementById('spin-wheel-card'),
            btn: document.getElementById('spin-wheel-btn'),
            timerContainer: document.getElementById('spin-timer-container'),
            timer: document.getElementById('spin-timer'),
            attemptsText: document.getElementById('spin-attempts-text'),
            modal: document.getElementById('spinWheelModal'),
            canvas: document.getElementById('spin-canvas'),
            modalCloseBtn: document.querySelector('#spinWheelModal .custom-close-btn')
        }
    };

    let allUsersCache = [], honorRollCache = [], candidatesCache = [], announcementsCache = [];
    let userChartInstance = null, announcementInterval = null, theWheel = null;
    let wheelSpinning = false, cooldownInterval = null, dbInstance = null, spinWheelSettings = null;
    const isLoggedIn = {{ 'true' if session.user else 'false' }};
    let userIsBanned = false; // <-- NEW: Flag for ban status

    const formatNumber = (num) => new Intl.NumberFormat('ar-EG').format(num || 0);

    async function initializeApp() {
        try {
            if (!window.firebaseConfig?.apiKey) throw new Error("Firebase config missing.");
            dbInstance = firebase.database();

            setupEventListeners();

            if (isLoggedIn) {
                await checkUserBanStatus(); // <-- NEW: Check ban status on load
                if (userIsBanned) return; // Stop initialization if banned

                if (ui.spinWheel.card) {
                    const settingsRes = await fetch('/api/settings/spin_wheel');
                    if(!settingsRes.ok) throw new Error('Failed to fetch wheel settings');
                    spinWheelSettings = await settingsRes.json();
                    if (spinWheelSettings?.enabled) {
                        ui.spinWheel.card.style.display = 'block';
                        initializeSpinWheel();
                        updateSpinWheelUI();
                    }
                }
            }

            dbInstance.ref('users').on('value', handleUsersSnapshot, handleFirebaseError);
            dbInstance.ref('site_settings/honor_roll').on('value', handleHonorRollSnapshot, handleFirebaseError);
            dbInstance.ref('candidates').on('value', handleCandidatesSnapshot, handleFirebaseError);
            dbInstance.ref('site_settings/announcements').on('value', handleAnnouncementsSnapshot, handleFirebaseError);
        } catch (e) {
            console.error("CRITICAL INITIALIZATION ERROR:", e.message);
            if (ui.loadingSpinner?.parentElement) {
                 ui.loadingSpinner.parentElement.innerHTML = `<td colspan="4" class="text-center py-4"><div class="alert alert-danger m-3"><strong>خطأ حرج:</strong> ${e.message}</div></td>`;
            }
        }
    }

    // <-- START: NEW BAN CHECK FUNCTION -->
    async function checkUserBanStatus() {
        if (!isLoggedIn) return false;
        try {
            const response = await fetch('/api/check_ban_status');
            if (!response.ok) {
                throw new Error(`: ${response.status}`);
            }
            const data = await response.json();
            if (data.banned) {
                userIsBanned = true;
                // Disable all interactive elements
                if(ui.nominateBtn) ui.nominateBtn.disabled = true;
                if(ui.reportBtn) ui.reportBtn.disabled = true;
                if(ui.spinWheel.btn) ui.spinWheel.btn.disabled = true;
                document.querySelectorAll('.like-btn').forEach(b => b.disabled = true);

                Swal.fire({
                    icon: 'error',
                    title: 'لقد تم حظرك!',
                    text: 'لا يمكنك التفاعل مع الموقع. الرجاء الاتصال بالدعم لمزيد من المعلومات.',
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    showConfirmButton: false,
                });
            }
            return data.banned;
        } catch (error) {
            console.error("Ban check failed", error);
            Swal.fire({
                icon: 'error',
                title: 'خطأ حرج',
                text: `Ban status check failed${error.message}. يرجى المحاولة لاحقاً أو الاتصال بالدعم.`,
            });
            return true; // Assume banned if check fails to prevent actions
        }
    }
    // <-- END: NEW BAN CHECK FUNCTION -->

    function handleFirebaseError(error) {
        console.error("Firebase Read Error:", error.code, error.message);
        if (ui.loadingSpinner?.parentElement) {
            ui.loadingSpinner.parentElement.innerHTML = `<td colspan="4" class="text-center py-4"><div class="alert alert-warning">فشل الاتصال بقاعدة البيانات. (${error.code})</div></td>`;
        }
    }

    function handleUsersSnapshot(snapshot) {
        if (ui.loadingSpinner) ui.loadingSpinner.style.display = 'none';
        const usersData = snapshot.val() || {};
        allUsersCache = Object.keys(usersData).map(k => ({ name: k, ...usersData[k] })).sort((a, b) => (b.points || 0) - (a.points || 0));
        renderUserTable();
        renderTop3();
    }

    function handleHonorRollSnapshot(snapshot) {
        honorRollCache = Object.values(snapshot.val() || {}).map(i => i.name);
        renderHonorRollList();
        if(allUsersCache.length > 0) renderUserTable();
    }

    function handleCandidatesSnapshot(snapshot) {
        candidatesCache = Object.keys(snapshot.val() || {});
        renderCandidatesList();
    }

    function handleAnnouncementsSnapshot(snapshot) {
        announcementsCache = Object.values(snapshot.val() || {});
        renderAnnouncements();
    }

    function renderUserTable() {
        if (!ui.tableBody) return;
        const term = ui.searchInput.value.toLowerCase();
        const filteredUsers = allUsersCache.filter(u => u.name.toLowerCase().includes(term));
        ui.tableBody.innerHTML = filteredUsers.length ? filteredUsers.map((user) => {
            const rank = allUsersCache.findIndex(u => u.name === user.name) + 1;
            const honorBadge = honorRollCache.includes(user.name) ? ` <span class="badge rounded-pill" style="background:var(--primary-glow);color:#fff;"><i class="bi bi-award-fill"></i></span>` : '';
            const likedUsers = new Set(JSON.parse(localStorage.getItem('likedUsers')) || []);
            const hasLiked = likedUsers.has(user.name);
            return `
                <tr>
                    <th class="align-middle">#${rank}</th>
                    <td class="align-middle fw-bold">${user.name}${honorBadge}</td>
                    <td class="text-center align-middle fs-5 fw-bold">${formatNumber(user.points)}</td>
                    <td class="text-center align-middle">
                        <button class="btn btn-sm like-btn ${hasLiked ? 'liked' : 'btn-outline-danger'}" data-username="${user.name}" title="إعجاب">
                            <i class="bi bi-heart-fill"></i> <span class="like-count">${formatNumber(user.likes || 0)}</span>
                        </button>
                        <button class="btn btn-sm btn-outline-info ms-2 chart-btn" data-username="${user.name}" title="عرض تقدم الزاحف">
                            <i class="bi bi-graph-up-arrow"></i>
                        </button>
                    </td>
                </tr>`;
        }).join('') : `<tr><td colspan="4" class="text-center py-4">${term ? 'لا يوجد زاحف يطابق البحث.' : 'لا يوجد بيانات لعرضها.'}</td></tr>`;
    }

    function renderTop3() {
        if (!ui.hallOfFame) return;
        ui.hallOfFame.innerHTML = allUsersCache.slice(0, 3).map((u, i) =>
            `<li class="list-group-item d-flex justify-content-between"><span>${['🥇','🥈','🥉'][i]} ${u.name}</span><span class="badge rounded-pill" style="background-color:var(--primary-glow)">${formatNumber(u.points)}</span></li>`
        ).join('') || `<li class="list-group-item text-muted text-center">القائمة فارغة.</li>`;
    }

    function renderHonorRollList() { ui.honorRollList.innerHTML = honorRollCache.length ? honorRollCache.map(name => `<li class="list-group-item fw-bold text-center"><i class="bi bi-star-fill text-warning me-2"></i>${name}</li>`).join('') : `<li class="list-group-item text-muted text-center">القائمة فارغة.</li>`; }
    function renderCandidatesList() { ui.candidatesList.innerHTML = candidatesCache.length ? candidatesCache.map(name => `<li class="list-group-item"><i class="bi bi-person-check-fill me-2"></i>${name}</li>`).join('') : `<li class="list-group-item text-muted text-center">لا يوجد مرشحون.</li>`; }

    function renderAnnouncements() {
        if (!ui.announcementsTicker || !ui.announcementsContainer) return;
        ui.announcementsTicker.innerHTML = '';
        if (announcementInterval) clearInterval(announcementInterval);
        if (announcementsCache.length > 0) {
            ui.announcementsContainer.style.display = '';
            announcementsCache.forEach(ann => { ui.announcementsTicker.innerHTML += `<div class="ticker-item">${ann.text}</div>`; });
            const items = ui.announcementsTicker.querySelectorAll('.ticker-item');
            if (items.length === 0) return;
            let currentIndex = 0;
            items[currentIndex].classList.add('active');
            if (items.length > 1) {
                announcementInterval = setInterval(() => {
                    items[currentIndex].classList.remove('active');
                    currentIndex = (currentIndex + 1) % items.length;
                    items[currentIndex].classList.add('active');
                }, 5000);
            }
        } else {
            ui.announcementsContainer.style.display = 'none';
        }
    }

    function setupEventListeners() {
        ui.searchInput?.addEventListener('input', renderUserTable);

        document.querySelectorAll('.custom-modal .custom-close-btn').forEach(btn =>
            btn.addEventListener('click', e => e.target.closest('.custom-modal')?.classList.remove('show'))
        );

        ui.tableBody?.addEventListener('click', e => {
            const likeBtn = e.target.closest('.like-btn');
            const chartBtn = e.target.closest('.chart-btn');
            if (likeBtn) handleLike(likeBtn);
            if (chartBtn) showUserHistoryChart(chartBtn.dataset.username);
        });

        ui.nominateBtn?.addEventListener('click', handleNomination);
        ui.reportBtn?.addEventListener('click', handleReport);
        ui.spinWheel.btn?.addEventListener('click', handleSpinStart);
    }

    function handleLike(likeBtn) {
        if (userIsBanned) return; // <-- Check if banned
        if (!isLoggedIn) {
            Swal.fire('تنبيه', 'يجب تسجيل الدخول أولاً للإعجاب.', 'warning');
            document.getElementById('login-btn')?.click();
            return;
        }
        const username = likeBtn.dataset.username;
        const likedUsers = new Set(JSON.parse(localStorage.getItem('likedUsers')) || []);
        const action = likedUsers.has(username) ? 'unlike' : 'like';
        const countSpan = likeBtn.querySelector('.like-count');
        let currentCount = parseInt(countSpan.textContent.replace(/,/g, ''), 10);

        if (action === 'like') {
            likedUsers.add(username);
            likeBtn.classList.add('liked');
            likeBtn.classList.remove('btn-outline-danger');
            countSpan.textContent = formatNumber(currentCount + 1);
        } else {
            likedUsers.delete(username);
            likeBtn.classList.remove('liked');
            likeBtn.classList.add('btn-outline-danger');
            countSpan.textContent = formatNumber(Math.max(0, currentCount - 1));
        }
        localStorage.setItem('likedUsers', JSON.stringify([...likedUsers]));
        fetch(`/like/${username}?action=${action}`, { method:'POST' });
    }

    function handleNomination() {
        if (userIsBanned) return; // <-- Check if banned
        if (!isLoggedIn) {
            Swal.fire('تنبيه', 'يجب تسجيل الدخول أولاً للترشيح.', 'warning');
            document.getElementById('login-btn')?.click();
            return;
        }
        Swal.fire({
            title: 'رشح نفسك كزاحف', input: 'text', inputLabel: 'اكتب اسمك للترشيح',
            inputPlaceholder: 'الاسم المراد ترشيحه...', showCancelButton: true,
            confirmButtonText: 'إرسال الترشيح', cancelButtonText: 'إلغاء',
            inputValidator: (v) => !v && 'يجب كتابة اسم!'
        }).then(async res => {
            if (res.isConfirmed && res.value) {
                const r = await fetch('/api/nominate', { method: 'POST', body: new URLSearchParams({name: res.value}) });
                const j = await r.json();
                Swal.fire(j.success ? 'تم!' : 'خطأ!', j.message, j.success ? 'success' : 'error');
            }
        });
    }

    function handleReport() {
        if (userIsBanned) return; // <-- Check if banned
        if (!isLoggedIn) {
            Swal.fire('تنبيه', 'يجب تسجيل الدخول أولاً للإبلاغ.', 'warning');
            document.getElementById('login-btn')?.click();
            return;
        }
        if (!allUsersCache.length) return Swal.fire('لا يوجد زواحف للإبلاغ عنهم حالياً.', '', 'info');
        const userOptions = allUsersCache.reduce((obj, user) => ({...obj, [user.name]: user.name}), {});
        Swal.fire({
            title: 'الإبلاغ عن زاحف', input: 'select', inputOptions: userOptions,
            inputPlaceholder: 'اختر الزاحف', showCancelButton: true,
            confirmButtonText: 'التالي →',
        }).then(result => {
            if (result.isConfirmed && result.value) {
                const reportedUser = result.value;
                Swal.fire({
                    title: `الإبلاغ عن ${reportedUser}`, input: 'textarea',
                    inputLabel: 'سبب الإبلاغ', inputPlaceholder: 'اشرح المشكلة...',
                    showCancelButton: true, confirmButtonText: 'إرسال البلاغ',
                    inputValidator: (v) => !v && 'يجب كتابة سبب البلاغ!'
                }).then(async reasonResult => {
                    if (reasonResult.isConfirmed && reasonResult.value) {
                        const r = await fetch('/api/report', { method: 'POST', body: new URLSearchParams({ reported_user: reportedUser, reason: reasonResult.value }) });
                        const j = await r.json();
                        Swal.fire(j.success ? 'تم!' : 'خطأ!', j.message, j.success ? 'success' : 'error');
                    }
                });
            }
        });
    }

    async function showUserHistoryChart(username) {
        if (!ui.userChartModal) return;
        try {
            const response = await fetch(`/api/user_history/${username}`);
            if(!response.ok) throw new Error("Failed to fetch history");
            let history = await response.json();
            if (!history || history.length === 0) return Swal.fire({icon: 'info', title: 'لا توجد بيانات', text: 'لا يوجد سجل نقاط لهذا الزاحف بعد.'});

            ui.chartModalLabel.innerText = `تقدم الزاحف: ${username}`;
            if (userChartInstance) userChartInstance.destroy();
            const chartContext = ui.userPointsChartCanvas.getContext('2d');
            const gradient = chartContext.createLinearGradient(0, 0, 0, 400);
            gradient.addColorStop(0, 'rgba(0, 242, 255, 0.4)');
            gradient.addColorStop(1, 'rgba(159, 122, 234, 0.1)');
            userChartInstance = new Chart(chartContext, {
                type: 'line',
                data: {
                    labels: history.map(h => new Date(h.timestamp * 1000).toLocaleDateString('ar-EG', { day: '2-digit', month: 'short', hour:'2-digit', minute:'2-digit'})),
                    datasets: [{ label: 'النقاط', data: history.map(h => h.points), fill: true, backgroundColor: gradient, borderColor: '#00f2ff', borderWidth: 3, pointBackgroundColor: '#fff', pointBorderColor: '#00f2ff', pointRadius: 5, pointHoverRadius: 8, tension: 0.4 }]
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { color: 'var(--text-color)' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } }, x: { ticks: { color: 'var(--text-color)' }, grid: { display: false } } }, plugins: { legend: { display: false } } }
            });
            ui.userChartModal.classList.add('show');
        } catch(e) { Swal.fire('خطأ', 'لم نتمكن من جلب سجل نقاط هذا الزاحف.', 'error'); }
    }

    function initializeSpinWheel() {
        if (!ui.spinWheel.canvas || typeof Winwheel === 'undefined' || !spinWheelSettings?.prizes) return;
        const prizeSegments = spinWheelSettings.prizes.map((p, index) => {
            const colors = ['#eae56f', '#7de6ef', '#89f26e', '#e7706f', '#c789f2', '#f2a15f', '#6aaff2', '#f289b4'];
            return { 'fillStyle': colors[index % colors.length], 'text': p.value.toLocaleString('en-US') };
        });
        theWheel = new Winwheel({
            'canvasId': ui.spinWheel.canvas.id, 'numSegments': prizeSegments.length, 'outerRadius': 212,
            'textFontSize': 22, 'textFontWeight': 'bold', 'segments': prizeSegments,
            'animation': { 'type': 'spinToStop', 'duration': 8, 'spins': 10, 'callbackFinished': handleSpinFinish, 'easing': 'Power4.easeOut' },
            'pins': { 'number': prizeSegments.length * 2, 'fillStyle': 'silver', 'outerRadius': 4, 'margin': 5 }
        });
    }

    async function handleSpinStart() {
        if (userIsBanned) return; // <-- Check if banned
        if (wheelSpinning || !theWheel) return;
        ui.spinWheel.btn.disabled = true;
        ui.spinWheel.btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
        try {
            const res = await fetch('/api/spin_wheel', { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || `Server error: ${res.status}`);

            let state = JSON.parse(localStorage.getItem('winwheelState') || '{}');
            state.attemptsUsed = (state.attemptsUsed || 0) + 1;
            localStorage.setItem('winwheelState', JSON.stringify(state));
            updateSpinWheelUI();

            let stopAtSegment = theWheel.segments.findIndex(s => s && parseInt(s.text.replace(/,/g, '')) === data.prize);
            if (stopAtSegment === -1) stopAtSegment = Math.floor(Math.random() * theWheel.numSegments) + 1;

            theWheel.animation.stopAngle = theWheel.getRandomForSegment(stopAtSegment);
            wheelSpinning = true;
            theWheel.startAnimation();
            ui.spinWheel.modal.classList.add('show');
            if (ui.spinWheel.modalCloseBtn) ui.spinWheel.modalCloseBtn.style.display = 'none';
        } catch (error) {
            Swal.fire('خطأ', error.message || 'فشل الاتصال بالخادم.', 'error');
            resetSpinButton();
        }
    }

    function handleSpinFinish(indicatedSegment) {
        wheelSpinning = false;
        if (ui.spinWheel.modalCloseBtn) ui.spinWheel.modalCloseBtn.style.display = 'block';
        const prizeWon = parseInt(indicatedSegment.text.replace(/,/g, ''));
        const userOptions = allUsersCache.reduce((obj, user) => ({...obj, [user.name]: user.name}), {});
        Swal.fire({
            title: `🎉 مبروك! فزت بـ ${formatNumber(prizeWon)} نقطة!`,
            input: 'select', inputOptions: userOptions, inputPlaceholder: 'اختر زاحفاً للتبرع',
            confirmButtonText: 'تبرع الآن!', showCancelButton: true, cancelButtonText: 'إلغاء',
        }).then(async (result) => {
            if (result.isConfirmed && result.value) {
                const res = await fetch('/api/donate_points', {
                    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    body: new URLSearchParams({ username: result.value, points: prizeWon })
                });
                const data = await res.json();
                Swal.fire(data.success ? 'شكراً لك!' : 'خطأ!', data.message, data.success ? 'success' : 'error');
            } else { Swal.fire('تم الإلغاء', 'لم يتم التبرع بالنقاط.', 'info'); }
            resetSpinButton();
        });
    }

    function updateSpinWheelUI() {
        if (!spinWheelSettings || !ui.spinWheel.btn) return;
        if (cooldownInterval) clearInterval(cooldownInterval);

        let state = JSON.parse(localStorage.getItem('winwheelState') || '{}');
        const cooldownMillis = spinWheelSettings.cooldownHours * 60 * 60 * 1000;
        const timeSinceReset = Date.now() - (state.lastReset || 0);

        if (timeSinceReset >= cooldownMillis) {
            state = { lastReset: Date.now(), attemptsUsed: 0 };
            localStorage.setItem('winwheelState', JSON.stringify(state));
        }

        const attemptsLeft = spinWheelSettings.maxAttempts - (state.attemptsUsed || 0);
        ui.spinWheel.attemptsText.textContent = `لديك ${attemptsLeft} / ${spinWheelSettings.maxAttempts} محاولات`;

        if (attemptsLeft > 0) {
            ui.spinWheel.btn.disabled = false;
            ui.spinWheel.btn.style.display = 'block';
            ui.spinWheel.timerContainer.style.display = 'none';
            resetSpinButton();
        } else {
            ui.spinWheel.btn.style.display = 'none';
            ui.spinWheel.timerContainer.style.display = 'block';
            let timeLeft = cooldownMillis - timeSinceReset;
            const updateTimer = () => {
                timeLeft -= 1000;
                if (timeLeft <= 0) {
                    clearInterval(cooldownInterval);
                    updateSpinWheelUI();
                    return;
                }
                const h = Math.floor(timeLeft / 3600000).toString().padStart(2, '0');
                const m = Math.floor((timeLeft % 3600000) / 60000).toString().padStart(2, '0');
                const s = Math.floor((timeLeft % 60000) / 1000).toString().padStart(2, '0');
                if(ui.spinWheel.timer) ui.spinWheel.timer.textContent = `${h}:${m}:${s}`;
            };
            updateTimer();
            cooldownInterval = setInterval(updateTimer, 1000);
        }
    }

    function resetSpinButton() {
        if (ui.spinWheel.btn) {
            ui.spinWheel.btn.disabled = false;
            ui.spinWheel.btn.innerHTML = `<i class="bi bi-arrow-repeat me-2"></i>لف العجلة الآن!`;
        }
    }

    initializeApp();
});
</script>
{% endblock %}
<!-- END OF MODIFIED SCRIPT FOR user_view.html -->
