// --- START OF FILE static/js/spin_wheel.js (FINAL, REFACTORED, AND VERIFIED) ---

document.addEventListener('firebase-ready', () => {
    // Ensure the main user_view app is running before initializing the wheel
    if (!document.getElementById('user-table-body')) return;

    const ui = {
        spinWheelCard: document.getElementById('spin-wheel-card'),
        purchasedSpinsCard: document.getElementById('purchased-spins-card'),
        spinBtn: document.getElementById('spin-wheel-btn'),
        usePurchasedBtn: document.getElementById('use-purchased-spin-btn'),
        freeAttemptsText: document.getElementById('free-attempts-text'),
        purchasedAttemptsText: document.getElementById('purchased-attempts-text'),
        spinTimerContainer: document.getElementById('spin-timer-container'),
        spinTimer: document.getElementById('spin-timer'),
        spinWheelModal: document.getElementById('spinWheelModal'),
        spinCanvas: document.getElementById('spin-canvas')
    };

    let wheel, settings, userState, timerInterval;
    // <<< بداية الإضافة: متغير لتتبع حالة الدوران >>>
    let isSpinning = false;
    // <<< نهاية الإضافة >>>

    const THEME_COLORS = ['#9f7aea', '#00f2ff', '#ff00f3', '#4fd1c5', '#ed64a6', '#63b3ed', '#f6ad55', '#718096'];
    let colorIndex = 0;

    function getNextColor() {
        const color = THEME_COLORS[colorIndex];
        colorIndex = (colorIndex + 1) % THEME_COLORS.length;
        return color;
    }

    function reInit(newSettings) {
        if (!newSettings || !newSettings.prizes || newSettings.prizes.length === 0) {
            console.warn("Spin wheel settings are missing or invalid. Wheel disabled.");
            if (ui.spinWheelCard) ui.spinWheelCard.style.display = 'none';
            if (ui.purchasedSpinsCard) ui.purchasedSpinsCard.style.display = 'none';
            return;
        }

        settings = newSettings;
        if (ui.spinWheelCard) ui.spinWheelCard.style.display = settings.enabled ? 'block' : 'none';

        colorIndex = 0;
        const segments = settings.prizes.map(p => ({
            'fillStyle': getNextColor(),
            'text': p.value.toString(),
            'value': p.value,
            'weight': Number(p.weight) || 1
        }));

        const numSegments = segments.length;
        if (numSegments === 0) {
            if (wheel) { wheel.numSegments = 0; wheel.draw(); }
            return;
        }

        const MIN_DEGREES_PER_SEGMENT = 15;
        const totalMinimumDegrees = numSegments * MIN_DEGREES_PER_SEGMENT;

        if (totalMinimumDegrees >= 360) {
            const equalSize = 360 / numSegments;
            segments.forEach(seg => seg.size = equalSize);
        } else {
            const distributableDegrees = 360 - totalMinimumDegrees;
            const totalWeight = segments.reduce((acc, seg) => acc + seg.weight, 0);

            if (totalWeight > 0) {
                segments.forEach(seg => {
                    const weightedPortion = (seg.weight / totalWeight) * distributableDegrees;
                    seg.size = MIN_DEGREES_PER_SEGMENT + weightedPortion;
                });
            } else {
                const equalSize = 360 / numSegments;
                segments.forEach(seg => seg.size = equalSize);
            }
        }

        if (wheel) {
            wheel.numSegments = segments.length;
            wheel.segments = segments;
            wheel.updateSegmentSizes();
            wheel.draw(true);
        } else {
            wheel = new Winwheel({
                'canvasId': 'spin-canvas',
                'numSegments': segments.length,
                'segments': segments,
                'textFontSize': 22,
                'textFontFamily': 'Almarai, sans-serif',
                'textFontWeight': 'bold',
                'textFillStyle': '#ffffff',
                'textMargin': 15,
                'innerRadius': 35,
                'lineWidth': 4,
                'strokeStyle': '#1a1236',
                'animation': {
                    'type': 'spinToStop',
                    'duration': 8,
                    'spins': 10,
                    'callbackFinished': handleSpinFinished,
                    'easing': 'Power4.easeOut'
                }
            });
        }
    }

    function updateUI(newState) {
        if (!settings) return;

        userState = newState || { freeAttempts: 0, purchasedAttempts: 0, lastFreeUpdateTimestamp: 0 };
        if (ui.freeAttemptsText) ui.freeAttemptsText.textContent = `لديك ${userState.freeAttempts || 0} محاولات مجانية.`;

        const cooldownSeconds = (settings.cooldownHours || 24) * 3600;
        const timeSinceLastUpdate = Math.floor(Date.now() / 1000) - (userState.lastFreeUpdateTimestamp || 0);
        const timeRemaining = cooldownSeconds - timeSinceLastUpdate;

        if ((userState.freeAttempts || 0) > 0) {
            if (ui.spinTimerContainer) ui.spinTimerContainer.style.display = 'none';
            if (ui.spinBtn) ui.spinBtn.disabled = isSpinning; // لا تقم بتمكين الزر إذا كانت العجلة تدور
        } else {
            if (ui.spinBtn) ui.spinBtn.disabled = true;
            if (timeRemaining > 0) {
                if (ui.spinTimerContainer) ui.spinTimerContainer.style.display = 'block';
                startTimer(timeRemaining);
            } else {
                if (ui.spinTimerContainer) ui.spinTimerContainer.style.display = 'none';
            }
        }

        const purchasedCount = userState.purchasedAttempts || 0;
        if (ui.purchasedSpinsCard) ui.purchasedSpinsCard.style.display = purchasedCount > 0 ? 'block' : 'none';
        if (ui.purchasedAttemptsText) ui.purchasedAttemptsText.textContent = `لديك ${purchasedCount} محاولات مشتراة.`;
        if (ui.usePurchasedBtn) ui.usePurchasedBtn.disabled = (purchasedCount < 1) || isSpinning;
    }

    function startTimer(duration) {
        clearInterval(timerInterval);
        let timer = duration;
        timerInterval = setInterval(() => {
            if (--timer < 0) {
                clearInterval(timerInterval);
                if (ui.spinTimerContainer) ui.spinTimerContainer.style.display = 'none';
            } else {
                const h = Math.floor(timer / 3600).toString().padStart(2, '0');
                const m = Math.floor((timer % 3600) / 60).toString().padStart(2, '0');
                const s = Math.floor(timer % 60).toString().padStart(2, '0');
                if (ui.spinTimer) ui.spinTimer.textContent = `${h}:${m}:${s}`;
            }
        }, 1000);
    }

    function resetWheel() {
        if (!wheel) return;
        wheel.stopAnimation(false);
        wheel.rotationAngle = 0;
        wheel.draw();
        // <<< بداية التعديل: تصفير حالة الدوران وتحديث واجهة الأزرار >>>
        isSpinning = false;
        updateUI(userState);
        // <<< نهاية التعديل >>>
    }

    async function performSpin(attemptType, button) {
        if (!wheel || button.disabled || isSpinning) return;

        // <<< بداية التعديل: تحديث حالة الدوران وتعطيل الأزرار >>>
        isSpinning = true;
        ui.spinBtn.disabled = true;
        ui.usePurchasedBtn.disabled = true;
        // <<< نهاية التعديل >>>

        resetWheel(); // نترك هذه لضمان تصفير الزاوية قبل البدء
        button.disabled = true;

        const apiEndpoint = `/api/spin_wheel/initiate_spin/${attemptType}`;

        try {
            const response = await fetch(apiEndpoint, { method: 'POST' });
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || 'فشل في بدء الدوران من الخادم.');
            }

            const { prize, winningSegmentIndex } = data;
            wheel.spinResultPrize = prize;

            const stopAt = wheel.getRandomForSegment(winningSegmentIndex);
            wheel.animation.stopAngle = stopAt;
            if (ui.spinWheelModal) ui.spinWheelModal.classList.add('show');

            wheel.startAnimation();

        } catch (error) {
            Swal.fire({ icon: 'error', title: 'فشل!', text: error.message });
            resetWheel(); // إعادة تصفير في حالة الفشل
        }
    }

    async function handleSpinFinished(indicatedSegment) {
        const prizeWon = wheel.spinResultPrize;

        await Swal.fire({
            icon: 'success',
            title: 'مبروك!',
            html: `لقد فزت بـ <strong>${prizeWon.toLocaleString()}</strong> CC!`,
            confirmButtonText: 'رائع!'
        });

        if (ui.spinWheelModal) ui.spinWheelModal.classList.remove('show');
        resetWheel();
        delete wheel.spinResultPrize;
    }

    ui.spinBtn?.addEventListener('click', () => performSpin('free', ui.spinBtn));
    ui.usePurchasedBtn?.addEventListener('click', () => performSpin('purchased', ui.usePurchasedBtn));

    // <<< بداية الإضافة: معالج أحداث مخصص لنافذة العجلة >>>
    if (ui.spinWheelModal) {
        ui.spinWheelModal.addEventListener('click', (e) => {
            // الإغلاق عند الضغط على زر X
            if (e.target.classList.contains('custom-close-btn')) {
                if (isSpinning) {
                    resetWheel(); // أوقف الدوران وصفّر الحالة
                }
                ui.spinWheelModal.classList.remove('show');
                return;
            }
            // الإغلاق عند الضغط على الخلفية (فقط إذا كانت العجلة لا تدور)
            if (e.target === ui.spinWheelModal) {
                if (!isSpinning) {
                    ui.spinWheelModal.classList.remove('show');
                }
            }
        });
    }
    // <<< نهاية الإضافة >>>


    window.spinWheelApp = { reInit, updateUI };
});