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

    // A single, centralized initialization function
    function reInit(newSettings) {
        if (!newSettings || !newSettings.prizes || newSettings.prizes.length === 0) {
            console.warn("Spin wheel settings are missing or invalid. Wheel disabled.");
            if (ui.spinWheelCard) ui.spinWheelCard.style.display = 'none';
            if (ui.purchasedSpinsCard) ui.purchasedSpinsCard.style.display = 'none';
            return;
        }

        settings = newSettings;
        if (ui.spinWheelCard) ui.spinWheelCard.style.display = settings.enabled ? 'block' : 'none';

        const segments = settings.prizes.map(p => ({
            'fillStyle': getRandomColor(),
            'text': p.value.toString(),
            'value': p.value,
            'weight': Number(p.weight) || 1
        }));

        const numSegments = segments.length;
        if (numSegments === 0) {
            if (wheel) { wheel.numSegments = 0; wheel.draw(); }
            return;
        }

        // --- NEW SIZING ALGORITHM TO PREVENT TINY SEGMENTS ---
        const MIN_DEGREES_PER_SEGMENT = 15;
        const totalMinimumDegrees = numSegments * MIN_DEGREES_PER_SEGMENT;

        if (totalMinimumDegrees >= 360) {
            // If minimums take up the whole wheel, just make all segments equal.
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
                // Fallback if all weights are 0, make them equal.
                const equalSize = 360 / numSegments;
                segments.forEach(seg => seg.size = equalSize);
            }
        }
        // --- END OF NEW SIZING ALGORITHM ---

        if (wheel) {
            // If wheel exists, just update its properties
            wheel.numSegments = segments.length;
            wheel.segments = segments;
            wheel.updateSegmentSizes();
            wheel.draw(true);
        } else {
            // Create the wheel for the first time
            wheel = new Winwheel({
                'canvasId': 'spin-canvas',
                'numSegments': segments.length,
                'segments': segments,
                'textFontSize': 24,
                'textFontFamily': 'Almarai, sans-serif',
                'textFontWeight': 'bold',
                'textFillStyle': '#ffffff',
                'textMargin': 15,
                'innerRadius': 30,
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

    // A single, centralized function to update all UI elements
    function updateUI(newState) {
        if (!settings) return; // Don't do anything if settings aren't loaded

        userState = newState || { freeAttempts: 0, purchasedAttempts: 0, lastFreeUpdateTimestamp: 0 };

        // Handle Free Spins UI
        if (ui.freeAttemptsText) ui.freeAttemptsText.textContent = `لديك ${userState.freeAttempts || 0} محاولات مجانية.`;

        const cooldownSeconds = (settings.cooldownHours || 24) * 3600;
        const timeSinceLastUpdate = Math.floor(Date.now() / 1000) - (userState.lastFreeUpdateTimestamp || 0);
        const timeRemaining = cooldownSeconds - timeSinceLastUpdate;

        if ((userState.freeAttempts || 0) > 0) {
            if (ui.spinTimerContainer) ui.spinTimerContainer.style.display = 'none';
            if (ui.spinBtn) ui.spinBtn.disabled = false;
        } else {
            if (ui.spinBtn) ui.spinBtn.disabled = true;
            if (timeRemaining > 0) {
                if (ui.spinTimerContainer) ui.spinTimerContainer.style.display = 'block';
                startTimer(timeRemaining);
            } else {
                if (ui.spinTimerContainer) ui.spinTimerContainer.style.display = 'none';
                // User might need a page refresh or API call to get new spins
            }
        }

        // Handle Purchased Spins UI
        const purchasedCount = userState.purchasedAttempts || 0;
        if (ui.purchasedSpinsCard) ui.purchasedSpinsCard.style.display = purchasedCount > 0 ? 'block' : 'none';
        if (ui.purchasedAttemptsText) ui.purchasedAttemptsText.textContent = `لديك ${purchasedCount} محاولات مشتراة.`;
        if (ui.usePurchasedBtn) ui.usePurchasedBtn.disabled = purchasedCount < 1;
    }

    function startTimer(duration) {
        clearInterval(timerInterval);
        let timer = duration;
        timerInterval = setInterval(() => {
            if (--timer < 0) {
                clearInterval(timerInterval);
                if (ui.spinTimerContainer) ui.spinTimerContainer.style.display = 'none';
                if (ui.spinBtn) ui.spinBtn.disabled = false;
                // Maybe trigger a state check API call here
            } else {
                const h = Math.floor(timer / 3600).toString().padStart(2, '0');
                const m = Math.floor((timer % 3600) / 60).toString().padStart(2, '0');
                const s = Math.floor(timer % 60).toString().padStart(2, '0');
                if (ui.spinTimer) ui.spinTimer.textContent = `${h}:${m}:${s}`;
            }
        }, 1000);
    }

    // <<< --- التعديل الجذري هنا --- >>>
    async function performSpin(attemptType, button) {
        if (!wheel || button.disabled) return;

        button.disabled = true;
        const apiEndpoint = `/api/spin_wheel/initiate_spin/${attemptType}`;

        try {
            // Step 1: Call server to get the winning prize and segment
            const response = await fetch(apiEndpoint, { method: 'POST' });
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || 'فشل في بدء الدوران من الخادم.');
            }

            // Step 2: Server has confirmed the prize. Now we animate.
            const { prize, winningSegmentIndex } = data;

            // Store the confirmed prize to be shown in the final popup.
            wheel.spinResultPrize = prize;

            // Calculate a random angle *within* the server-specified winning segment.
            const stopAt = wheel.getRandomForSegment(winningSegmentIndex);

            wheel.animation.stopAngle = stopAt;
            if (ui.spinWheelModal) ui.spinWheelModal.classList.add('show');

            wheel.startAnimation();

        } catch (error) {
            Swal.fire({ icon: 'error', title: 'فشل!', text: error.message });
            button.disabled = false; // Re-enable button on failure
        }
    }

    async function handleSpinFinished(indicatedSegment) {
        // The prize has already been determined and awarded by the server.
        // This function is now just for showing the result and cleaning up.

        const prizeWon = wheel.spinResultPrize;

        await Swal.fire({
            icon: 'success',
            title: 'مبروك!',
            html: `لقد فزت بـ <strong>${prizeWon.toLocaleString()}</strong> CC!`,
            confirmButtonText: 'رائع!'
        });

        if (ui.spinWheelModal) ui.spinWheelModal.classList.remove('show');
        resetButtons();
        wheel.stopAnimation(false);
        wheel.rotationAngle = 0;
        wheel.draw();

        // Clear the stored prize after showing it
        delete wheel.spinResultPrize;
    }
    // <<< --- نهاية التعديل الجذري --- >>>

    function resetButtons() {
        // This function will be called by updateUI now, which is triggered by the database listener
        // But we can call it manually after a spin for immediate feedback.
        if (!userState) return;
        if (ui.spinBtn) ui.spinBtn.disabled = (userState.freeAttempts || 0) < 1;
        if (ui.usePurchasedBtn) ui.usePurchasedBtn.disabled = (userState.purchasedAttempts || 0) < 1;
    }

    function getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    ui.spinBtn?.addEventListener('click', () => performSpin('free', ui.spinBtn));
    ui.usePurchasedBtn?.addEventListener('click', () => performSpin('purchased', ui.usePurchasedBtn));

    // Expose functions to be called from user_view.js
    window.spinWheelApp = { reInit, updateUI };
});