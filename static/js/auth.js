// --- START OF FILE static/js/auth.js ---
document.addEventListener('DOMContentLoaded', () => {
    if (!window.firebaseConfig || !window.firebaseConfig.apiKey) {
        console.error("Firebase config is not available. Auth will not work.");
        return;
    }

    if (!firebase.apps.length) {
        firebase.initializeApp(window.firebaseConfig);
    }
    const auth = firebase.auth();

    const authModal = document.getElementById('authModal');
    const loginBtn = document.getElementById('login-btn');
    const closeModalBtn = authModal?.querySelector('.custom-close-btn');
    const googleLoginBtn = document.getElementById('google-login-btn');
    const phoneLoginBtn = document.getElementById('phone-login-btn');

    if (!authModal) {
        return; 
    }

    const showModal = () => authModal.classList.add('show');
    const hideModal = () => authModal.classList.remove('show');

    loginBtn?.addEventListener('click', showModal);
    closeModalBtn?.addEventListener('click', hideModal);
    window.addEventListener('click', (e) => {
        if (e.target === authModal) hideModal();
    });

    async function verifyTokenOnServer(idToken) {
        const formData = new FormData();
        formData.append('id_token', idToken);
        
        Swal.fire({
            title: 'جاري التحقق...',
            text: 'الرجاء الانتظar.',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading() }
        });

        try {
            const response = await fetch('/verify_token', { method: 'POST', body: formData });
            const result = await response.json();

            if (response.ok && result.status === 'success') {
                await Swal.fire({
                    icon: 'success', title: 'تم تسجيل الدخول بنجاح!',
                    text: `مرحباً بك، ${result.user.name}`, timer: 1500, showConfirmButton: false
                });
                window.location.reload();
            } else {
                throw new Error(result.message || 'فشل التحقق من الخادم.');
            }
        } catch (error) {
            Swal.fire('خطأ!', error.message, 'error');
        }
    }

    googleLoginBtn.addEventListener('click', async () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            const result = await auth.signInWithPopup(provider);
            const user = result.user;
            if (user) {
                const idToken = await user.getIdToken(true);
                await verifyTokenOnServer(idToken);
            }
        } catch (error) {
            console.error("Google Sign-In Error:", error);
            if (error.code !== 'auth/popup-closed-by-user') {
                Swal.fire('خطأ في تسجيل الدخول', error.message, 'error');
            }
        }
    });

    phoneLoginBtn.addEventListener('click', () => {
        window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
            'size': 'invisible',
            'callback': (response) => {}
        });

        Swal.fire({
            title: 'أدخل رقم هاتفك', input: 'tel',
            inputLabel: 'سيتم إرسال رمز تحقق إلى هاتفك.',
            inputPlaceholder: '+9627xxxxxxxx', showCancelButton: true,
            confirmButtonText: 'إرسال الرمز', cancelButtonText: 'إلغاء',
            inputValidator: (value) => {
                if (!value || !/^\+[1-9]\d{1,14}$/.test(value)) {
                    return 'الرجاء إدخال رقم هاتف صحيح مع رمز الدولة (مثال: +962...)'
                }
            }
        }).then((result) => {
            if (result.isConfirmed) {
                const phoneNumber = result.value;
                const appVerifier = window.recaptchaVerifier;

                auth.signInWithPhoneNumber(phoneNumber, appVerifier)
                    .then((confirmationResult) => {
                        window.confirmationResult = confirmationResult;
                        Swal.fire({
                            title: 'أدخل الرمز', input: 'text',
                            inputLabel: `تم إرسال الرمز إلى ${phoneNumber}`,
                            inputPlaceholder: '123456', showCancelButton: true,
                            confirmButtonText: 'تحقق', cancelButtonText: 'إلغاء',
                            inputValidator: (value) => !value && 'يجب إدخال الرمز!'
                        }).then((codeResult) => {
                            if (codeResult.isConfirmed && codeResult.value) {
                                confirmationResult.confirm(codeResult.value).then(async (userCredential) => {
                                    const user = userCredential.user;
                                    if(user) {
                                        const idToken = await user.getIdToken(true);
                                        await verifyTokenOnServer(idToken);
                                    }
                                }).catch((error) => {
                                    Swal.fire('خطأ!', 'الرمز الذي أدخلته غير صحيح.', 'error');
                                });
                            }
                        });
                    }).catch((error) => {
                        console.error("Phone Sign-In Error:", error);
                        Swal.fire('خطأ!', 'فشل إرسال الرمز. قد يكون السبب استخدام رقم وهمي أو مشكلة في الشبكة.', 'error');
                        if (window.recaptchaVerifier) {
                            window.recaptchaVerifier.render().then(widgetId => {
                                if(typeof grecaptcha !== 'undefined') grecaptcha.reset(widgetId);
                            });
                        }
                    });
            }
        });
    });
});
// --- END OF FILE static/js/auth.js ---