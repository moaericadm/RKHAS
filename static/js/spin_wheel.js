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
        spinWheelModalElement: document.getElementById('spinWheelModal'),
        spinCanvas: document.getElementById('spin-canvas')
    };

    const spinWheelModal = ui.spinWheelModalElement ? new bootstrap.Modal(ui.spinWheelModalElement) : null;

    let wheel, settings, userState, timerInterval;
    let isSpinning = false;

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
            if (ui.spinBtn) ui.spinBtn.disabled = isSpinning;
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
        isSpinning = false;
        updateUI(userState);
    }

    // *** بداية التعديل: تعديل دالة بدء الدوران ***
    async function performSpin(attemptType, button) {
        if (!wheel || button.disabled || isSpinning) return;

        isSpinning = true;
        ui.spinBtn.disabled = true;
        ui.usePurchasedBtn.disabled = true;

        button.disabled = true;

        // الخطوة 1: طلب بدء الدوران من الخادم
        const apiEndpoint = `/api/spin_wheel/initiate_spin/${attemptType}`;
        try {
            const response = await fetch(apiEndpoint, { method: 'POST' });
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || 'فشل في بدء الدوران من الخادم.');
            }

            if (spinWheelModal) {
                spinWheelModal.show();
            }

            // إعادة تصفير العجلة قبل الدوران الفعلي
            resetWheel();
            isSpinning = true; // إعادة تفعيل القفل بعد التصفير
            ui.spinBtn.disabled = true;
            ui.usePurchasedBtn.disabled = true;


            const winningSegmentIndex = data.winningSegmentIndex;
            const stopAt = wheel.getRandomForSegment(winningSegmentIndex);

            wheel.animation.stopAngle = stopAt;
            wheel.startAnimation();

        } catch (error) {
            Swal.fire({ icon: 'error', title: 'فشل!', text: error.message });
            resetWheel(); // إعادة تصفير في حالة الفشل
        }
    }
    // *** نهاية التعديل ***

    // *** بداية التعديل: تعديل دالة انتهاء الدوران ***
    async function handleSpinFinished(indicatedSegment) {
        const prizeWon = indicatedSegment.text; // القيمة موجودة كنص في الشريحة

        // الخطوة 2: المطالبة بالجائزة من الخادم
        try {
            const response = await fetch('/api/spin_wheel/claim_prize', { method: 'POST' });
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || "فشل المطالبة بالجائزة.");
            }

            await Swal.fire({
                icon: 'success',
                title: 'مبروك!',
                html: `لقد فزت بـ <strong>${parseInt(prizeWon).toLocaleString()}</strong> CC!`,
                confirmButtonText: 'رائع!'
            });

        } catch (error) {
            console.error("Claim prize error:", error);
            Swal.fire('خطأ!', 'حدث خطأ أثناء إضافة الجائزة إلى محفظتك.', 'error');
        } finally {
            if (spinWheelModal) {
                spinWheelModal.hide();
            }
            resetWheel();
        }
    }
    // *** نهاية التعديل ***


    ui.spinBtn?.addEventListener('click', () => performSpin('free', ui.spinBtn));
    ui.usePurchasedBtn?.addEventListener('click', () => performSpin('purchased', ui.usePurchasedBtn));

    if (ui.spinWheelModalElement) {
        ui.spinWheelModalElement.addEventListener('click', (e) => {
            if (e.target.classList.contains('custom-close-btn')) {
                if (isSpinning) {
                    resetWheel();
                }
                if (spinWheelModal) spinWheelModal.hide();
                return;
            }
            if (e.target === ui.spinWheelModalElement) {
                if (!isSpinning) {
                    if (spinWheelModal) spinWheelModal.hide();
                }
            }
        });
    }

    window.spinWheelApp = { reInit, updateUI };
});