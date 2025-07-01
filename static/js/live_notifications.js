// --- START OF FILE static/js/live_notifications.js ---

document.addEventListener('firebase-ready', () => {
    const auth = firebase.auth();
    const db = firebase.database();

    let listenerAttached = false;

    // <<< بداية التعديل: إضافة نظام إدارة قائمة الانتظار >>>
    const notificationQueue = []; // مصفوفة لتخزين الإشعارات المنتظرة
    let activeNotifications = 0;  // عداد للإشعارات المعروضة حالياً
    const MAX_ACTIVE_NOTIFICATIONS = 2; // الحد الأقصى للإشعارات
    // <<< نهاية التعديل >>>


    // الأفاتار الافتراضي
    const DEFAULT_AVATAR_URI = "data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cccccc'%3e%3cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3e%3c/svg%3e";

    const createNotificationNode = (log) => {
        const avatarUrl = log.user_avatar || DEFAULT_AVATAR_URI;
        const userName = log.user_name || "مستخدم";
        let messageText = log.text || 'قام بنشاط جديد.';

        const node = document.createElement('div');
        node.className = 'd-flex align-items-center p-2';
        node.style.fontFamily = "'Almarai', sans-serif";
        node.style.fontSize = "14px";
        node.innerHTML = `
            <img src="${avatarUrl}" style="width: 40px; height: 40px; border-radius: 50%; margin-inline-end: 12px; border: 2px solid rgba(255,255,255,0.7);">
            <div>
                <strong class="d-block" style="font-size: 15px; margin-bottom: 2px;">${userName}</strong>
                <span>${messageText}</span>
            </div>
        `;
        return node;
    };


    // <<< بداية التعديل: تعديل دالة العرض لتكون جزءاً من نظام الانتظار >>>
    const processQueue = () => {
        // إذا كانت هناك إشعارات في الانتظار وهناك مكان فارغ على الشاشة
        if (notificationQueue.length > 0 && activeNotifications < MAX_ACTIVE_NOTIFICATIONS) {
            // أخذ أول إشعار من القائمة
            const log = notificationQueue.shift();

            // زيادة عداد الإشعارات النشطة
            activeNotifications++;

            const notificationNode = createNotificationNode(log);

            Toastify({
                node: notificationNode,
                duration: 5000,
                newWindow: true,
                close: true,
                gravity: "top",
                position: "left",
                stopOnFocus: true,
                escapeMarkup: false,
                style: {
                    background: "linear-gradient(to right, #1f274a, #0b021d)",
                    borderRadius: "10px",
                    border: "1px solid rgba(159, 122, 234, 0.3)",
                    boxShadow: "0 8px 25px rgba(11, 2, 29, 0.5)",
                    backdropFilter: "blur(10px)"
                },
                // الأهم: دالة تُستدعى عند إغلاق الإشعار
                callback: () => {
                    activeNotifications--; // إنقاص عداد الإشعارات النشطة
                    processQueue(); // محاولة عرض الإشعار التالي من القائمة
                }
            }).showToast();
        }
    };

    const showLiveNotification = (log) => {
        // بدلاً من العرض المباشر، يتم إضافة الإشعار إلى قائمة الانتظار
        notificationQueue.push(log);
        // ثم محاولة معالجة القائمة
        processQueue();
    };
    // <<< نهاية التعديل >>>

    auth.onAuthStateChanged((user) => {
        if (user && !listenerAttached) {
            listenerAttached = true;
            const currentUserID = user.uid;

            // تم تصحيح هذا المسار مسبقاً وهو صحيح
            const feedRef = db.ref('live_feed');
            feedRef.orderByChild('timestamp').startAt(Math.floor(Date.now() / 1000))
                .on('child_added', snapshot => {
                    const log = snapshot.val();
                    if (log && log.user_id !== currentUserID) {
                        showLiveNotification(log);
                    }
                }, (error) => {
                    console.error("Firebase Read Error on live_feed:", error);
                    listenerAttached = false;
                });

            console.log("Live notification listener is active on /live_feed.");

        } else if (!user) {
            listenerAttached = false;
        }
    });
});

// --- END OF FILE static/js/live_notifications.js ---