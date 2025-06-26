// --- START OF FILE static/js/spin_wheel.js ---

// --- الكائن العام للتطبيق ---
window.spinWheelApp = window.spinWheelApp || {};

// --- الإعدادات المركزية ---
window.spinWheelApp.settings = {};
window.spinWheelApp.lastKnownState = {};

document.addEventListener('DOMContentLoaded', () => {
    const spinWheelCard = document.getElementById('spin-wheel-card');
    if (!spinWheelCard) return;

    let theWheel = null;
    let wheelSpinning = false;
    let cooldownInterval = null;

    const ui = {
        free: {
            card: spinWheelCard,
            btn: document.getElementById('spin-wheel-btn'),
            timerContainer: document.getElementById('spin-timer-container'),
            timer: document.getElementById('spin-timer'),
            attemptsText: document.getElementById('free-attempts-text'),
        },
        purchased: {
            card: document.getElementById('purchased-spins-card'),
            btn: document.getElementById('use-purchased-spin-btn'),
            attemptsText: document.getElementById('purchased-attempts-text'),
        },
        modal: document.getElementById('spinWheelModal'),
        canvas: document.getElementById('spin-canvas'),
        modalCloseBtn: document.querySelector('#spinWheelModal .custom-close-btn')
    };

    function reInit(settings) {
        window.spinWheelApp.settings = settings;
        if (settings && settings.enabled) {
            ui.free.card.style.display = 'block';
            if (typeof Winwheel !== 'undefined' && typeof TweenMax !== 'undefined') {
                initializeWinwheelInstance(settings);
            } else {
                console.error('Winwheel/TweenMax library is not defined!');
                ui.free.card.innerHTML = '<p class="text-danger p-3">خطأ في تحميل مكتبة عجلة الحظ.</p>';
            }
        } else {
            ui.free.card.style.display = 'none';
        }
        updateUI(window.spinWheelApp.lastKnownState);
    }

    function updateUI(state) {
        window.spinWheelApp.lastKnownState = state;
        const settings = window.spinWheelApp.settings;

        const isEnabled = settings && settings.enabled;
        ui.free.card.style.display = isEnabled ? 'block' : 'none';

        const currentState = state || { freeAttempts: 0, purchasedAttempts: 0, lastFreeUpdateTimestamp: 0 };
        const freeAttempts = currentState.freeAttempts || 0;
        const purchasedAttempts = currentState.purchasedAttempts || 0;

        // --- تحديث واجهة المحاولات المجانية ---
        if (isEnabled && ui.free.attemptsText) {
            ui.free.attemptsText.textContent = `لديك ${freeAttempts} محاولات متبقية`;

            if (cooldownInterval) clearInterval(cooldownInterval);

            // *** الإصلاح الجذري للمنطق ***
            if (freeAttempts > 0) {
                // إذا كان لدى المستخدم محاولات، أظهر الزر دائماً
                ui.free.btn.style.display = 'block';
                ui.free.timerContainer.style.display = 'none';
            } else {
                // إذا كان رصيد المحاولات صفراً، عندها فقط تحقق من المؤقت
                ui.free.btn.style.display = 'none';
                ui.free.timerContainer.style.display = 'block';

                const cooldown_seconds = (settings.cooldownHours || 24) * 3600;
                const time_since_update = (Date.now() / 1000) - (currentState.lastFreeUpdateTimestamp || 0);
                let timeLeft = (cooldown_seconds - time_since_update) * 1000;

                if (timeLeft <= 0) {
                    ui.free.timer.textContent = "جاهز للتحديث! (أعد تحميل الصفحة)";
                } else {
                    const updateTimer = () => {
                        timeLeft -= 1000;
                        if (timeLeft <= 0) {
                            clearInterval(cooldownInterval);
                            ui.free.timer.textContent = "جاهز للتحديث! (أعد تحميل الصفحة)";
                            return;
                        }
                        const h = Math.floor(timeLeft / 3600000).toString().padStart(2, '0');
                        const m = Math.floor((timeLeft % 3600000) / 60000).toString().padStart(2, '0');
                        const s = Math.floor((timeLeft % 60000) / 1000).toString().padStart(2, '0');
                        if (ui.free.timer) ui.free.timer.textContent = `${h}:${m}:${s}`;
                    };
                    updateTimer();
                    cooldownInterval = setInterval(updateTimer, 1000);
                }
            }
        }

        // --- تحديث واجهة المحاولات المشتراة ---
        if (ui.purchased.card) {
            if (purchasedAttempts > 0) {
                ui.purchased.card.style.display = 'block';
                if (ui.purchased.attemptsText) ui.purchased.attemptsText.textContent = `لديك ${purchasedAttempts} محاولات مشتراة`;
            } else {
                ui.purchased.card.style.display = 'none';
            }
        }
    }

    function setupEventListeners() {
        if (ui.free.btn) ui.free.btn.addEventListener('click', () => handleSpinStart('free'));
        if (ui.purchased.btn) ui.purchased.btn.addEventListener('click', () => handleSpinStart('purchased'));

        if (ui.modalCloseBtn) {
            ui.modalCloseBtn.addEventListener('click', () => {
                if (!wheelSpinning) {
                    ui.modal.classList.remove('show');
                    resetWheel();
                }
            });
        }
    }

    function initializeWinwheelInstance(settings) {
        if (!ui.canvas || typeof Winwheel === 'undefined' || !settings.prizes) return;
        const prizeSegments = settings.prizes.map((p, index) => {
            const colors = ['#eae56f', '#7de6ef', '#89f26e', '#e7706f', '#c789f2', '#f2a15f', '#6aaff2', '#f289b4'];
            const textFill = ['#000', '#000', '#000', '#fff', '#fff', '#000', '#fff', '#fff'];
            let prizeText = parseInt(p.value).toLocaleString('en-US');
            return { 'fillStyle': colors[index % colors.length], 'text': `${prizeText} CC`, 'textFillStyle': textFill[index % textFill.length] };
        });

        if (theWheel) { theWheel.stopAnimation(false); theWheel = null; }
        try {
            theWheel = new Winwheel({
                'canvasId': ui.canvas.id, 'numSegments': prizeSegments.length, 'outerRadius': 212,
                'textFontSize': 22, 'textFontWeight': 'bold', 'segments': prizeSegments,
                'animation': { 'type': 'spinToStop', 'duration': 8, 'spins': 10, 'callbackFinished': handleSpinFinish, 'easing': 'Power4.easeOut' },
                'pins': { 'number': prizeSegments.length * 2, 'fillStyle': 'silver', 'outerRadius': 4, 'margin': 5 }
            });
        } catch (e) { console.error("Error initializing Winwheel:", e); }
    }

    async function handleSpinStart(type) {
        if (wheelSpinning || !theWheel) return;

        const btn = (type === 'free') ? ui.free.btn : ui.purchased.btn;
        const endpoint = (type === 'free') ? '/api/spin_wheel/spin/free' : '/api/spin_wheel/spin/purchased';

        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;

        try {
            const res = await fetch(endpoint, { method: 'POST' });
            const data = await res.json();

            if (!res.ok || !data.success) throw new Error(data.message || 'فشل الخادم');

            const prizeWon = data.prize;
            const currentSettings = window.spinWheelApp.settings;
            let stopAtSegmentIndex = currentSettings.prizes.findIndex(p => parseInt(p.value) === prizeWon) + 1;
            if (stopAtSegmentIndex <= 0) {
                stopAtSegmentIndex = Math.floor(Math.random() * theWheel.numSegments) + 1;
            }
            theWheel.animation.stopAngle = theWheel.getRandomForSegment(stopAtSegmentIndex);
            wheelSpinning = true;
            theWheel.startAnimation();
            ui.modal.classList.add('show');
            if (ui.modalCloseBtn) ui.modalCloseBtn.style.display = 'none';

        } catch (error) {
            Swal.fire('خطأ!', error.message, 'error');
            resetWheel();
        } finally {
            btn.disabled = false;
            btn.innerHTML = (type === 'free') ? '<i class="bi bi-arrow-repeat me-2"></i>لف العجلة الآن!' : '<i class="bi bi-play-circle-fill me-2"></i>استخدام محاولة';
        }
    }

    function handleSpinFinish(indicatedSegment) {
        wheelSpinning = false;
        if (ui.modalCloseBtn) ui.modalCloseBtn.style.display = 'block';
        if (!indicatedSegment || typeof indicatedSegment.text === 'undefined') {
            Swal.fire('عذراً', 'حدث خطأ غير متوقع.', 'error');
            resetWheel();
            return;
        }

        const prizeWon = parseInt(indicatedSegment.text.replace(/[^0-9]/g, ''));
        Swal.fire({
            title: '🎉 مبروك! 🎉',
            html: `لقد فزت بـ <strong>${prizeWon.toLocaleString('en-US')}</strong> زاحف كوين (CC)!`,
            icon: 'success',
            confirmButtonText: 'رائع!',
        }).then(() => resetWheel());
    }

    function resetWheel() {
        if (theWheel) { theWheel.stopAnimation(false); theWheel.rotationAngle = 0; theWheel.draw(); wheelSpinning = false; }
        if (ui.modal) ui.modal.classList.remove('show');
    }

    window.spinWheelApp.reInit = reInit;
    window.spinWheelApp.updateUI = updateUI;

    setupEventListeners();
});