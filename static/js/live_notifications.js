// --- START OF FILE static/js/live_notifications.js ---

document.addEventListener('firebase-ready', () => {

    const currentUserID = firebase.auth()?.currentUser?.uid;

    const loadTimestamp = Math.floor(Date.now() / 1000);
    const db = firebase.database();

    const ALLOWED_NOTIFICATION_TYPES = {
        'activity_log': ['like', 'gift', 'purchase'],
        'investment_log': ['invest', 'sell']
    };

    // <<< بداية التعديل: تعريف الأفاتار الافتراضي لكي نستخدمه إذا لم يكن هناك أفاتار في السجل >>>
    const DEFAULT_AVATAR_URI = "data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cccccc'%3e%3cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3e%3c/svg%3e";
    // <<< نهاية التعديل >>>

    const showLiveNotification = (htmlContent, color) => {
        Toastify({
            // <<< بداية التعديل: سنرسل الـ HTML كاملاً هنا >>>
            node: htmlContent,
            // <<< نهاية التعديل >>>
            duration: 5500,
            newWindow: true,
            close: true,
            gravity: "bottom",
            position: "left",
            style: {
                background: color,
                borderRadius: "8px",
                boxShadow: "0 5px 15px rgba(0,0,0,0.3)"
            },
            stopOnFocus: true,
            escapeMarkup: false
        }).showToast();
    };

    const setupLogListener = (logPath, processor) => {
        const logRef = db.ref(logPath).orderByChild('timestamp').startAt(loadTimestamp);
        logRef.on('child_added', snapshot => {
            const log = snapshot.val();

            if (!log) return;
            const logUserID = log.user_id || log.investor_id;
            if (!logUserID) return;
            if (currentUserID && logUserID === currentUserID) return;

            const logType = log.type || log.action;
            const allowedTypes = ALLOWED_NOTIFICATION_TYPES[logPath];

            if (allowedTypes && allowedTypes.includes(logType)) {
                processor(log);
            } else if (log.type === 'gift' && log.text && log.text.includes('عجلة الحظ')) {
                processor(log);
            }
        });
    };

    // <<< بداية التعديل: إنشاء عقدة HTML للإشعار >>>
    const createNotificationNode = (log) => {
        const avatarUrl = log.user_avatar || log.investor_avatar || DEFAULT_AVATAR_URI;
        const userName = log.user_name || log.investor_name || "مستخدم";
        let messageText = '';

        if (log.text) { // For activity_log
            messageText = log.text;
        } else if (log.action === 'invest') { // For investment_log
            messageText = `${userName} استثمر في ${log.target_name}!`;
        } else if (log.action === 'sell') {
            messageText = `${userName} باع أسهمه في ${log.target_name}.`;
        }

        // إزالة اسم المستخدم من بداية النص إذا كان موجوداً لتجنب التكرار
        const namePattern = new RegExp(`^'${userName}'\\s*`);
        messageText = messageText.replace(namePattern, '');

        const node = document.createElement('div');
        node.className = 'd-flex align-items-center p-2';
        node.innerHTML = `
            <img src="${avatarUrl}" style="width: 32px; height: 32px; border-radius: 50%; margin-inline-end: 10px; border: 2px solid rgba(255,255,255,0.5);">
            <div>
                <strong class="d-block">${userName}</strong>
                <span>${messageText}</span>
            </div>
        `;
        return node;
    }
    // <<< نهاية التعديل >>>


    const processActivityLog = (log) => {
        const node = createNotificationNode(log);
        let color = 'linear-gradient(to right, #e83e8c, #dc3545)'; // Default to pink/red for likes
        if (log.type === 'gift' && log.text.includes('عجلة الحظ')) {
            color = 'linear-gradient(to right, #ffc107, #fd7e14)'; // Gold for wheel wins
        }
        showLiveNotification(node, color);
    };

    const processInvestmentLog = (log) => {
        const node = createNotificationNode(log);
        // <<< بداية التعديل: تغيير اللون إلى الأحمر >>>
        const color = 'linear-gradient(to right, #d32f2f, #b71c1c)';
        // <<< نهاية التعديل >>>
        showLiveNotification(node, color);
    };

    setupLogListener('activity_log', processActivityLog);
    setupLogListener('investment_log', processInvestmentLog);
});

// --- END OF FILE static/js/live_notifications.js ---