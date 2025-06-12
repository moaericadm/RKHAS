document.addEventListener('DOMContentLoaded', function () {
    // التأكد من أننا في صفحة الأدمن قبل تنفيذ أي شيء
    const adminTableBody = document.getElementById('admin-table-body');
    const addUserForm = document.getElementById('addUserForm');

    // إذا لم تكن العناصر موجودة، فهذا يعني أننا لسنا في صفحة الأدمن، لذا توقف
    if (!adminTableBody || !addUserForm) {
        return;
    }

    // دالة مساعدة لتنسيق الأرقام مع فواصل
    function formatNumber(num) {
        return new Intl.NumberFormat('en-US').format(num || 0);
    }

    async function refreshAdminTable() {
        try {
            const response = await fetch('/api/users');
            if (!response.ok) throw new Error(`Network response was not ok (${response.status})`);
            
            const users = await response.json();
            
            adminTableBody.innerHTML = ''; // مسح الجدول القديم
            if (users && users.length > 0) {
                users.forEach((user, index) => {
                    const row = `
                        <tr>
                            <th scope="row" class="align-middle">#${index + 1}</th>
                            <td class="align-middle">${user.name}</td>
                            <td class="text-center align-middle">
                                <button class="btn btn-outline-success btn-sm me-2" onclick="updatePoints('${user.name}', ${user.points + 1})">+</button>
                                <span class="fw-bold fs-5 mx-2">${formatNumber(user.points)}</span>
                                <button class="btn btn-outline-warning btn-sm ms-2" onclick="updatePoints('${user.name}', ${user.points - 1})">-</button>
                            </td>
                            <td class="text-center align-middle">
                                <i class="bi bi-hand-thumbs-up-fill text-primary"></i>
                                <span class="fw-bold ms-1">${formatNumber(user.likes)}</span>
                            </td>
                            <td class="text-center align-middle">
                                <button class="btn btn-danger btn-sm" onclick="confirmDelete('${user.name}')">حذف</button>
                            </td>
                        </tr>`;
                    adminTableBody.innerHTML += row;
                });
            } else {
                adminTableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">لا يوجد مستخدمين بعد.</td></tr>';
            }
        } catch (error) {
            console.error('Failed to fetch users:', error);
            Swal.fire('خطأ!', 'فشل تحديث قائمة المستخدمين.', 'error');
        }
    }

    addUserForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const formData = new FormData(addUserForm);
        const submitButton = addUserForm.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.innerHTML;
        submitButton.disabled = true;
        submitButton.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;

        try {
            const response = await fetch('/add', { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Server responded with an error');
            addUserForm.reset();
            await refreshAdminTable();
            Swal.fire('تم!', 'تمت إضافة المستخدم بنجاح.', 'success');
        } catch (error) {
            Swal.fire('خطأ!', 'فشل إضافة المستخدم.', 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
        }
    });

    window.updatePoints = async function(name, newPoints) {
        try {
            const formData = new FormData();
            formData.append('name', name);
            formData.append('points', newPoints);
            const response = await fetch('/add', { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Server responded with an error');
            await refreshAdminTable();
        } catch (error) {
            Swal.fire('خطأ!', 'فشل تحديث النقاط.', 'error');
        }
    }

    window.confirmDelete = function(name) {
        Swal.fire({
            title: `هل أنت متأكد من حذف ${name}؟`,
            text: "لا يمكن التراجع عن هذا الإجراء!",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'نعم، قم بالحذف!',
            cancelButtonText: 'إلغاء'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const response = await fetch(`/delete/${name}`, { method: 'POST' });
                    if (!response.ok) throw new Error('Server responded with an error');
                    await refreshAdminTable();
                    Swal.fire('تم الحذف!', 'تم حذف المستخدم بنجاح.', 'success');
                } catch (error) {
                    Swal.fire('خطأ!', 'فشل حذف المستخدم.', 'error');
                }
            }
        });
    }

    // استدعاء الدالة عند تحميل الصفحة لأول مرة
    refreshAdminTable();
});