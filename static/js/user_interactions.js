
document.addEventListener('DOMContentLoaded', () => {
    const userTableBody = document.getElementById('user-table-body');
    if (!userTableBody) return;

    // تعريف عناصر الواجهة
    const ui = {
        crawlModal: document.getElementById('crawlModal'),
        crawlNameInput: document.getElementById('crawl-name-input'),
        checkCrawlBtn: document.getElementById('check-crawl-btn'),
        crawlModalTitle: document.getElementById('crawl-modal-title'),
        crawlChartCanvas: document.getElementById('crawlChart'),
        crawlModalText: document.getElementById('crawl-modal-text'),
        nominateBtn: document.getElementById('nominate-btn'),
        reportBtn: document.getElementById('report-btn')
    };

    let allUsersCache = [];
    let crawlChartInstance = null;

    function exportInteractionFunctions() {
        window.interactionsApp = {
            init: initialize,
            updateUserCache: (users) => {
                allUsersCache = users;
            }
        };
    }

    function initialize() {
        setupEventListeners();
    }

    function setupEventListeners() {
        // <<< بداية التعديل: استثناء نافذة العجلة من الإغلاق التلقائي >>>
        document.querySelectorAll('.custom-modal:not(#spinWheelModal)').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // هذا الكود سيعمل على كل النوافذ ما عدا نافذة العجلة
                const modal = e.target.closest('.custom-modal');
                if (modal && (e.target === modal || e.target.classList.contains('custom-close-btn'))) {
                    modal.classList.remove('show');
                }
            });
        });
        // <<< نهاية التعديل >>>

        if (ui.checkCrawlBtn) ui.checkCrawlBtn.addEventListener('click', showCrawlCheckModal);
        if (ui.nominateBtn) ui.nominateBtn.addEventListener('click', handleNomination);
        if (ui.reportBtn) ui.reportBtn.addEventListener('click', handleReport);
    }

    async function showCrawlCheckModal() {
        const name = ui.crawlNameInput.value.trim();
        if (!name) {
            return Swal.fire('خطأ', 'الرجاء إدخال اسم لفحص النسبة.', 'warning');
        }

        const { value: formValues } = await Swal.fire({
            title: `كاشف الزواحف لـِ "${name}"`,
            html: `
                <p class="text-muted small">أجب عن الأسئلة التالية بصدق للحصول على أدق نسبة.</p>
                <input id="swal-age" type="number" class="swal2-input" placeholder="كم عمرك؟">
                <select id="swal-university" class="swal2-select">
                    <option value="" disabled selected>هل أنت من جامعة جرش؟</option>
                    <option value="yes">نعم</option>
                    <option value="no">لا</option>
                </select>
                <select id="swal-crawled-before" class="swal2-select">
                    <option value="" disabled selected>هل سبق لك أن زحفت؟</option>
                    <option value="yes">نعم، وبكل فخر</option>
                    <option value="maybe">ربما، لا أتذكر</option>
                    <option value="no">لا، مستحيل</option>
                </select>`,
            confirmButtonText: 'احسب نسبة الزحف!',
            focusConfirm: false,
            preConfirm: () => {
                const age = document.getElementById('swal-age').value;
                const university = document.getElementById('swal-university').value;
                const crawledBefore = document.getElementById('swal-crawled-before').value;

                if (!age || !university || !crawledBefore) {
                    Swal.showValidationMessage('الرجاء الإجابة على جميع الأسئلة');
                    return false;
                }
                return { age, university, crawledBefore };
            }
        });

        if (formValues) {
            handleCrawlCheck(name, formValues);
        }
    }

    function handleCrawlCheck(name, extraData) {
        const existingUser = allUsersCache.find(u => u.name.toLowerCase() === name.toLowerCase());
        let percentage, title, text, color;

        if (existingUser) {
            const maxPoints = Math.max(...allUsersCache.map(u => u.points || 0), 1);
            percentage = Math.min(Math.round(((existingUser.points || 0) / maxPoints) * 100), 100);
            title = `نتيجة الزاحف الأصلي: ${existingUser.name}`;
            text = `زاحف معتمد بنسبة 🦎 ${percentage}%. ولدَ زاحفاً و سيبقى زاحف محتل هذه اللوحة!`;
            color = '#8e44ad';
        } else {
            let hash = 0;
            for (let i = 0; i < name.length; i++) {
                hash = name.charCodeAt(i) + ((hash << 5) - hash);
                hash = hash & hash;
            }
            let basePercentage = (Math.abs(hash) % 70) + 1;

            if (extraData.university === 'yes') basePercentage += 15;
            if (extraData.crawledBefore === 'yes') basePercentage += 20;
            if (extraData.crawledBefore === 'maybe') basePercentage += 10;
            if (parseInt(extraData.age) < 18 || parseInt(extraData.age) > 25) basePercentage -= 5;

            percentage = Math.min(Math.max(basePercentage, 5), 100);

            title = `نتيجة فحص الزحف لـِ "${name}"`;
            if (percentage < 30) {
                text = `نسبة زحفك ${percentage}%. زاحف مبتدئ, أمامك طريق للتوبة!`;
                color = '#2ecc71';
            } else if (percentage < 50) {
                text = `نسبة زحفك ${percentage}%. زاحف الايزي، كلنا عارفين قصصك لا تحاول تتغير!`;
                color = '#f1c40f';
            } else if (percentage < 70) {
                text = `نسبة زحفك ${percentage}%. زاحف خرائي، بديت تغوص ولا عودة بعد اليوم!`;
                color = '#e67e22';
            } else {
                text = `نسبة زحفك ${percentage}%. خطر على المجتمع! الله يعوض عليها بشوال رز!`;
                color = '#e74c3c';
            }
        }

        ui.crawlModalTitle.textContent = "جاري الفحص...";
        ui.crawlModalText.textContent = "";
        if (crawlChartInstance) crawlChartInstance.destroy();
        ui.crawlModal.classList.add('show');

        const ctx = ui.crawlChartCanvas.getContext('2d');
        setTimeout(() => {
            ui.crawlModalTitle.textContent = title;
            ui.crawlModalText.textContent = text;
            ui.crawlModalText.style.color = color;
            crawlChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['نسبة الزحف', 'نسبة البراءة'],
                    datasets: [{ data: [percentage, 100 - percentage], backgroundColor: [color, 'rgba(255, 255, 255, 0.1)'], borderColor: 'var(--card-bg)', borderWidth: 4 }]
                },
                options: { animation: { animateRotate: true, duration: 2000 }, responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false }, tooltip: { enabled: false } } }
            });
        }, 1500);
    }

    async function handleApiInteraction(endpoint, payload, successMessage) {
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(payload)
            });
            const data = await res.json();
            if (res.ok && data.success) {
                Swal.fire('تم!', successMessage || data.message, 'success');
            } else {
                Swal.fire('خطأ!', data.message || 'فشل إرسال الطلب.', 'error');
            }
        } catch (e) {
            console.error("API Interaction error:", e);
            Swal.fire('خطأ!', 'فشل الاتصال بالخادم.', 'error');
        }
    }

    async function handleNomination() {
        const { value: nameToNominate } = await Swal.fire({
            title: 'رشح نفسك أو صديقك كزاحف',
            input: 'text',
            inputLabel: 'اكتب الاسم للترشيح',
            inputPlaceholder: 'الاسم المراد ترشيحه...',
            showCancelButton: true,
            confirmButtonText: 'إرسال الترشيح',
            cancelButtonText: 'إلغاء',
            inputValidator: (v) => (!v || v.trim().length === 0) && 'يجب كتابة اسم!'
        });
        if (nameToNominate) {
            handleApiInteraction('/api/nominate', { name: nameToNominate.trim() }, 'تم إرسال طلب الترشيح بنجاح!');
        }
    }

    async function handleReport() {
        if (!allUsersCache.length) return Swal.fire('لا يوجد زواحف للإبلاغ عنهم حالياً.', '', 'info');
        const userOptions = allUsersCache.reduce((obj, user) => { obj[user.name] = user.name; return obj; }, {});

        const result = await Swal.fire({
            title: 'الإبلاغ عن زاحف',
            html: `<label for="swal-reported-user" class="swal2-label" style="display: block; margin-bottom: .5em;">اختر الزاحف:</label> <select id="swal-reported-user" class="swal2-select" style="min-width: 200px; margin-bottom: 1em;"></select> <label for="swal-report-reason" class="swal2-label" style="display: block; margin-bottom: .5em;">سبب الإبلاغ:</label> <textarea id="swal-report-reason" class="swal2-textarea" placeholder="اشرح المشكلة أو سبب الإبلاغ..."></textarea>`,
            showCancelButton: true,
            confirmButtonText: 'إرسال البلاغ',
            cancelButtonText: 'إلغاء',
            didOpen: () => {
                const select = document.getElementById('swal-reported-user');
                Object.keys(userOptions).forEach(key => select.add(new Option(userOptions[key], key)));
                if (select.options.length > 0) select.selectedIndex = 0;
            },
            preConfirm: () => {
                const user = document.getElementById('swal-reported-user').value;
                const reason = document.getElementById('swal-report-reason').value;
                if (!user) { Swal.showValidationMessage('يجب اختيار زاحف للإبلاغ عنه!'); return false; }
                if (!reason) { Swal.showValidationMessage('يجب كتابة سبب البلاغ!'); return false; }
                return { reported_user: user, reason: reason.trim() };
            }
        });

        if (result.isConfirmed && result.value) {
            handleApiInteraction('/api/report', result.value, `تم إرسال بلاغك بخصوص ${result.value.reported_user}. شكراً لك.`);
        }
    }

    exportInteractionFunctions();
});
