/**
 * enquiries.js
 * Module 1 — Student Enquiries: CRUD table with search, sort, pagination,
 * and CSV/Excel/PDF export.
 */

const Enquiries = (() => {
  const state = { page: 1, pageSize: 10, search: '', sortBy: 'CreatedAt', sortDir: 'desc' };
  let cache = [];
  let loaded = false;

  const exportColumns = [
    { key: 'Student ID', label: 'Student ID' },
    { key: 'Student Name', label: 'Student Name' },
    { key: 'Enquiry Date', label: 'Enquiry Date' },
    { key: 'Course', label: 'Course' },
    { key: 'Qualification', label: 'Qualification' },
    { key: 'Referred By', label: 'Referred By' },
    { key: 'Gmail', label: 'Email' },
    { key: 'Mobile Number', label: 'Mobile Number' }
  ];

  async function load() {
    Utils.showLoading();
    try {
      const result = await Api.getStudents(state);
      cache = result.rows;
      renderTable(result.rows);
      Utils.wireSortableHeaders(document.getElementById('enqTable'), state, (field, dir) => {
        state.sortBy = field; state.sortDir = dir; load();
      });
      Utils.renderPagination(document.getElementById('enqPagination'), result, (page) => { state.page = page; load(); });
      loaded = true;
    } catch (err) {
      Utils.error(err.message);
    } finally {
      Utils.hideLoading();
    }
  }

  function renderTable(rows) {
    const tbody = document.getElementById('enqTableBody');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">No students found.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(row => `
      <tr>
        <td><span class="fw-semibold text-primary">${Utils.escapeHtml(row['Student ID'])}</span></td>
        <td>${Utils.escapeHtml(row['Student Name'])}</td>
        <td>${Utils.formatDate(row['Enquiry Date'])}</td>
        <td>${Utils.escapeHtml(row['Course'])}</td>
        <td>${Utils.escapeHtml(row['Qualification'] || '-')}</td>
        <td>${Utils.escapeHtml(row['Referred By'] || '-')}</td>
        <td>${Utils.escapeHtml(row['Mobile Number'])}</td>
        <td>${Utils.escapeHtml(row['Gmail'])}</td>
        <td>
          <button class="btn-sm-icon edit" data-action="edit" data-id="${Utils.escapeHtml(row['Student ID'])}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-sm-icon delete" data-action="delete" data-id="${Utils.escapeHtml(row['Student ID'])}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', () => openEditModal(btn.dataset.id)));
    tbody.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', () => deleteStudent(btn.dataset.id)));
  }

  function openAddModal() {
    document.getElementById('enqModalTitle').textContent = 'Add Student Enquiry';
    document.getElementById('enqForm').reset();
    document.getElementById('enqStudentIdHidden').value = '';
    document.getElementById('enqStudentIdDisplay').value = 'Auto-generated on save';
    document.getElementById('enqDate').value = Utils.todayISO();
    new bootstrap.Modal('#enqModal').show();
  }

  function openEditModal(studentId) {
    const row = cache.find(r => r['Student ID'] === studentId);
    if (!row) return;
    document.getElementById('enqModalTitle').textContent = 'Edit Student Enquiry';
    document.getElementById('enqStudentIdHidden').value = row['Student ID'];
    document.getElementById('enqStudentIdDisplay').value = row['Student ID'];
    document.getElementById('enqDate').value = row['Enquiry Date'];
    document.getElementById('enqName').value = row['Student Name'];
    document.getElementById('enqCourse').value = row['Course'];
    document.getElementById('enqQualification').value = row['Qualification'] || '';
    document.getElementById('enqMobile').value = row['Mobile Number'];
    document.getElementById('enqEmail').value = row['Gmail'];
    document.getElementById('enqReferredBy').value = row['Referred By'] || '';
    new bootstrap.Modal('#enqModal').show();
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const mobile = document.getElementById('enqMobile').value.trim();
    const email = document.getElementById('enqEmail').value.trim();

    if (!Utils.isValidMobile(mobile)) {
      Utils.error('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!Utils.isValidEmail(email)) {
      Utils.error('Please enter a valid email address.');
      return;
    }

    const isEdit = !!document.getElementById('enqStudentIdHidden').value;
    const data = {
      'Student Name': document.getElementById('enqName').value.trim(),
      'Enquiry Date': document.getElementById('enqDate').value,
      'Course': document.getElementById('enqCourse').value.trim(),
      'Qualification': document.getElementById('enqQualification').value,
      'Referred By': document.getElementById('enqReferredBy').value.trim(),
      'Gmail': email,
      'Mobile Number': mobile
    };
    if (isEdit) data['Student ID'] = document.getElementById('enqStudentIdHidden').value;

    const btn = document.getElementById('enqSaveBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

    try {
      if (isEdit) {
        await Api.updateStudent(data);
        Utils.success('Student updated successfully.');
      } else {
        await Api.addStudent(data);
        Utils.success('Student enquiry added successfully.');
      }
      bootstrap.Modal.getInstance(document.getElementById('enqModal'))?.hide();
      load();
    } catch (err) {
      Utils.error(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Save';
    }
  }

  async function deleteStudent(studentId) {
    const ok = await Utils.confirmDialog({
      title: 'Delete this student?',
      text: `This will permanently remove ${studentId} from Student Enquiries. This cannot be undone.`,
      confirmText: 'Delete',
      danger: true
    });
    if (!ok) return;

    Utils.showLoading();
    try {
      await Api.deleteStudent(studentId);
      Utils.success('Student deleted.');
      load();
    } catch (err) {
      Utils.error(err.message);
    } finally {
      Utils.hideLoading();
    }
  }

  async function fetchAllForExport() {
    const result = await Api.getStudents({ search: state.search, sortBy: state.sortBy, sortDir: state.sortDir, page: 1, pageSize: 100000 });
    return result.rows;
  }

  function wireEvents() {
    document.getElementById('enqAddBtn').addEventListener('click', openAddModal);
    document.getElementById('enqForm').addEventListener('submit', handleSubmit);

    document.getElementById('enqSearch').addEventListener('input', Utils.debounce((e) => {
      state.search = e.target.value;
      state.page = 1;
      load();
    }));

    document.getElementById('enqExportCsv').addEventListener('click', async () => {
      Utils.showLoading();
      try { Utils.exportCSV(await fetchAllForExport(), exportColumns, 'student_enquiries'); }
      finally { Utils.hideLoading(); }
    });
    document.getElementById('enqExportExcel').addEventListener('click', async () => {
      Utils.showLoading();
      try { Utils.exportExcel(await fetchAllForExport(), exportColumns, 'student_enquiries'); }
      finally { Utils.hideLoading(); }
    });
    document.getElementById('enqExportPdf').addEventListener('click', async () => {
      Utils.showLoading();
      try { Utils.exportPDF(await fetchAllForExport(), exportColumns, 'student_enquiries', 'Student Enquiries'); }
      finally { Utils.hideLoading(); }
    });
  }

  function init() {
    wireEvents();
  }

  return { init, load, get isLoaded() { return loaded; } };
})();

document.addEventListener('DOMContentLoaded', () => {
  Enquiries.init();
  App.onSectionActivate('enquiries', () => Enquiries.load());
});
