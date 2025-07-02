document.addEventListener('firebase-ready', () => {
    // نتأكد أننا في الصفحة الصحيحة قبل تشغيل الكود
    const gameCard = document.getElementById('stock-prediction-game-card');
    if (!gameCard) return;

    const ui = {
        card: gameCard,
        body: document.getElementById('stock-game-body'),
        startSection: document.getElementById('stock-game-start-section'),
        playSection: document.getElementById('stock-game-play-section'),
        continueSection: document.getElementById('stock-game-continue-section'),

        betAmountInput: document.getElementById('stock-game-bet-amount'),
        startBtn: document.getElementById('stock-game-start-btn'),

        avatar: document.getElementById('stock-game-avatar'),
        name: document.getElementById('stock-game-name'),
        upBtn: document.getElementById('stock-game-up-btn'),
        downBtn: document.getElementById('stock-game-down-btn'),
        currentBet: document.getElementById('stock-game-current-bet'),

        winningsDisplay: document.getElementById('stock-game-winnings'),
        doubleBtn: document.getElementById('stock-game-double-btn'),
        cashoutBtn: document.getElementById('stock-game-cashout-btn')
    };

    const DEFAULT_AVATAR_URI = "data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236c757d'%3e%3cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3e%3c/svg%3e";

    let gameState = {
        active: false,
        initialBet: 0,
        currentWinnings: 0,
        crawlerName: null
    };

    function switchUiState(state) {
        ui.startSection.classList.toggle('d-none', state !== 'start');
        ui.playSection.classList.toggle('d-none', state !== 'play');
        ui.continueSection.classList.toggle('d-none', state !== 'continue');
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

    function resetGame() {
        gameState = { active: false, initialBet: 0, currentWinnings: 0, crawlerName: null };
        ui.betAmountInput.disabled = false;
        ui.startBtn.disabled = false;
        switchUiState('start');
    }

    async function handleStartGame() {
        const betAmount = parseInt(ui.betAmountInput.value, 10);
        if (isNaN(betAmount) || betAmount <= 0) {
            Swal.fire('خطأ', 'الرجاء إدخال مبلغ رهان صحيح.', 'warning');
            return;
        }

        ui.startBtn.disabled = true;
        ui.betAmountInput.disabled = true;

        try {
            const data = await apiCall('/api/stock_game/start', { bet_amount: betAmount });

            gameState.active = true;
            gameState.initialBet = betAmount;
            gameState.currentWinnings = betAmount; // يبدأ الرهان بالمبلغ الأولي
            gameState.crawlerName = data.crawler.name;

            ui.avatar.src = data.crawler.avatar_url || DEFAULT_AVATAR_URI;
            ui.name.textContent = data.crawler.name;
            ui.currentBet.textContent = `${gameState.currentWinnings.toLocaleString()} SP`;

            switchUiState('play');

        } catch (error) {
            resetGame();
        }
    }

    async function handleGuess(guess) {
        if (!gameState.active) return;

        ui.upBtn.disabled = true;
        ui.downBtn.disabled = true;

        try {
            const data = await apiCall('/api/stock_game/play', { guess: guess });

            if (data.result === 'win') {
                gameState.currentWinnings = data.winnings;
                ui.winningsDisplay.textContent = data.winnings.toLocaleString();
                switchUiState('continue');
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'توقع خاطئ!',
                    text: `للأسف، لقد خسرت رهانك البالغ ${gameState.currentWinnings.toLocaleString()} SP.`,
                    confirmButtonText: 'حاول مرة أخرى'
                });
                resetGame();
            }
        } catch (error) {
            resetGame();
        } finally {
            ui.upBtn.disabled = false;
            ui.downBtn.disabled = false;
        }
    }

    function handleDoubleDown() {
        // لا نحتاج لطلب API هنا، فقط نعود لشاشة اللعب
        // سيتم استخدام قيمة الأرباح الحالية كرهان جديد تلقائياً في `handleGuess`
        ui.currentBet.textContent = `${gameState.currentWinnings.toLocaleString()} SP`;
        switchUiState('play');
    }

    async function handleCashOut() {
        ui.cashoutBtn.disabled = true;
        ui.doubleBtn.disabled = true;

        try {
            const data = await apiCall('/api/stock_game/cashout', {});
            Swal.fire({
                icon: 'success',
                title: 'مبروك!',
                text: data.message
            });
        } catch (error) {
            // Error is already shown by apiCall
        } finally {
            resetGame();
            ui.cashoutBtn.disabled = false;
            ui.doubleBtn.disabled = false;
        }
    }

    // ربط الأحداث
    ui.startBtn.addEventListener('click', handleStartGame);
    ui.upBtn.addEventListener('click', () => handleGuess('up'));
    ui.downBtn.addEventListener('click', () => handleGuess('down'));
    ui.doubleBtn.addEventListener('click', handleDoubleDown);
    ui.cashoutBtn.addEventListener('click', handleCashOut);

    // التحقق من إعدادات اللعبة من الخادم
    firebase.database().ref('site_settings/stock_prediction_game').on('value', (snapshot) => {
        const settings = snapshot.val();
        if (settings && settings.is_enabled) {
            ui.card.style.display = 'block';
        } else {
            ui.card.style.display = 'none';
        }
    });

    // إعادة تعيين اللعبة عند إعادة تحميل الصفحة لتجنب الحالات العالقة
    resetGame();
});