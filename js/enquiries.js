/**
 * enquiries.js
 * Module 1 — Student Enquiries: CRUD table with search, sort, pagination,
 * and CSV/Excel/PDF export.
 *
 * Add/Edit/Delete update the on-screen table immediately (optimistic UI)
 * instead of waiting for the Apps Script round trip, which typically takes
 * a couple of seconds. The real request still runs in the background;
 * if it fails, the optimistic change is rolled back and the form/data is
 * restored so nothing the user typed is lost.
 */

const Enquiries = (() => {
  const state = { page: 1, pageSize: 10, search: '', sortBy: 'CreatedAt', sortDir: 'desc' };
  let cache = [];
  let meta = { total: 0, page: 1, pageSize: 10, totalPages: 1 };
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
      meta = { total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages };
      renderTable(cache);
      renderPaginationBar();
      Utils.wireSortableHeaders(document.getElementById('enqTable'), state, (field, dir) => {
        state.sortBy = field; state.sortDir = dir; load();
      });
      loaded = true;
    } catch (err) {
      Utils.error(err.message);
    } finally {
      Utils.hideLoading();
    }
  }

  function renderPaginationBar() {
    Utils.renderPagination(document.getElementById('enqPagination'), meta, (page) => { state.page = page; load(); });
  }

  function renderTable(rows) {
    const tbody = document.getElementById('enqTableBody');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">No students found.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(row => `
      <tr class="${row._pending ? 'row-pending' : ''}">
        <td><span class="fw-semibold text-primary">${Utils.escapeHtml(row['Student ID'])}</span></td>
        <td>${Utils.escapeHtml(row['Student Name'])}</td>
        <td>${Utils.formatDate(row['Enquiry Date'])}</td>
        <td>${Utils.escapeHtml(row['Course'])}</td>
        <td>${Utils.escapeHtml(row['Qualification'] || '-')}</td>
        <td>${Utils.escapeHtml(row['Referred By'] || '-')}</td>
        <td>${Utils.escapeHtml(row['Mobile Number'])}</td>
        <td>${Utils.escapeHtml(row['Gmail'])}</td>
        <td>
          ${row._pending ? Utils.pendingIndicatorHtml() : `
            <button class="btn-sm-icon edit" data-action="edit" data-id="${Utils.escapeHtml(row['Student ID'])}" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-sm-icon delete" data-action="delete" data-id="${Utils.escapeHtml(row['Student ID'])}" title="Delete"><i class="fa-solid fa-trash"></i></button>
          `}
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
    fillForm(row);
    document.getElementById('enqModalTitle').textContent = 'Edit Student Enquiry';
    document.getElementById('enqStudentIdHidden').value = row['Student ID'];
    new bootstrap.Modal('#enqModal').show();
  }

  function fillForm(row) {
    document.getElementById('enqStudentIdDisplay').value = row['Student ID'] || 'Auto-generated on save';
    document.getElementById('enqDate').value = row['Enquiry Date'];
    document.getElementById('enqName').value = row['Student Name'];
    document.getElementById('enqCourse').value = row['Course'];
    document.getElementById('enqQualification').value = row['Qualification'] || '';
    document.getElementById('enqMobile').value = row['Mobile Number'];
    document.getElementById('enqEmail').value = row['Gmail'];
    document.getElementById('enqReferredBy').value = row['Referred By'] || '';
  }

  function readForm() {
    return {
      'Student Name': document.getElementById('enqName').value.trim(),
      'Enquiry Date': document.getElementById('enqDate').value,
      'Course': document.getElementById('enqCourse').value.trim(),
      'Qualification': document.getElementById('enqQualification').value,
      'Referred By': document.getElementById('enqReferredBy').value.trim(),
      'Gmail': document.getElementById('enqEmail').value.trim(),
      'Mobile Number': document.getElementById('enqMobile').value.trim()
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const data = readForm();
    if (!Utils.isValidMobile(data['Mobile Number'])) {
      Utils.error('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!Utils.isValidEmail(data['Gmail'])) {
      Utils.error('Please enter a valid email address.');
      return;
    }

    const studentId = document.getElementById('enqStudentIdHidden').value;
    if (studentId) {
      submitEdit(studentId, data);
    } else {
      submitAdd(data);
    }
  }

  /** Adds a placeholder row instantly, saves for real in the background, reconciles on response. */
  function submitAdd(data) {
    bootstrap.Modal.getInstance(document.getElementById('enqModal'))?.hide();

    // A brand-new row only belongs at the top of the *current* view when that
    // view is the default (no search/sort/page override) — otherwise we'd be
    // splicing it into a filtered or differently-sorted list where it doesn't
    // actually belong, so just confirm via toast instead of touching the table.
    const isDefaultView = !state.search && state.page === 1 && state.sortBy === 'CreatedAt' && state.sortDir === 'desc';

    const now = new Date().toISOString();
    const tempId = Utils.genTempId();
    const tempRow = Object.assign({ 'Student ID': 'Pending...', 'CreatedAt': now, 'UpdatedAt': now, _pending: true, _tempId: tempId }, data);

    if (isDefaultView) {
      cache = [tempRow, ...cache].slice(0, state.pageSize);
      meta = { ...meta, total: meta.total + 1, totalPages: Math.max(1, Math.ceil((meta.total + 1) / state.pageSize)) };
      renderTable(cache);
      renderPaginationBar();
    } else {
      Utils.info('Saving new student enquiry...');
    }

    Api.addStudent(data).then(saved => {
      if (isDefaultView) {
        const idx = cache.findIndex(r => r._tempId === tempId);
        if (idx !== -1) {
          cache[idx] = saved;
          renderTable(cache);
        }
      }
      Utils.success('Student enquiry added successfully.');
    }).catch(err => {
      if (isDefaultView) {
        const idx = cache.findIndex(r => r._tempId === tempId);
        if (idx !== -1) cache.splice(idx, 1);
        meta = { ...meta, total: Math.max(0, meta.total - 1), totalPages: Math.max(1, Math.ceil(Math.max(0, meta.total - 1) / state.pageSize)) };
        renderTable(cache);
        renderPaginationBar();
      }
      Utils.error(err.message);
      reopenModalWithData('Add Student Enquiry', '', data);
    });
  }

  /** Updates the row instantly, saves for real in the background, rolls back on failure. */
  function submitEdit(studentId, data) {
    bootstrap.Modal.getInstance(document.getElementById('enqModal'))?.hide();

    const idx = cache.findIndex(r => r['Student ID'] === studentId);
    const previous = idx !== -1 ? cache[idx] : null;
    const optimistic = Object.assign({}, previous, data, { 'Student ID': studentId, UpdatedAt: new Date().toISOString(), _pending: true });
    if (idx !== -1) {
      cache[idx] = optimistic;
      renderTable(cache);
    }

    const payload = Object.assign({ 'Student ID': studentId }, data);
    Api.updateStudent(payload).then(saved => {
      const i = cache.findIndex(r => r['Student ID'] === studentId);
      if (i !== -1) {
        cache[i] = Object.assign({}, cache[i], saved, { _pending: false });
        renderTable(cache);
      }
      Utils.success('Student updated successfully.');
    }).catch(err => {
      const i = cache.findIndex(r => r['Student ID'] === studentId);
      if (i !== -1 && previous) {
        cache[i] = previous;
        renderTable(cache);
      }
      Utils.error(err.message);
      reopenModalWithData('Edit Student Enquiry', studentId, data);
    });
  }

  function reopenModalWithData(title, studentId, data) {
    document.getElementById('enqModalTitle').textContent = title;
    document.getElementById('enqStudentIdHidden').value = studentId;
    fillForm(Object.assign({ 'Student ID': studentId }, data));
    new bootstrap.Modal('#enqModal').show();
  }

  async function deleteStudent(studentId) {
    const ok = await Utils.confirmDialog({
      title: 'Delete this student?',
      text: `This will permanently remove ${studentId} from Student Enquiries. This cannot be undone.`,
      confirmText: 'Delete',
      danger: true
    });
    if (!ok) return;

    const idx = cache.findIndex(r => r['Student ID'] === studentId);
    const previous = idx !== -1 ? cache[idx] : null;
    if (idx !== -1) {
      cache.splice(idx, 1);
      meta = { ...meta, total: Math.max(0, meta.total - 1), totalPages: Math.max(1, Math.ceil(Math.max(0, meta.total - 1) / state.pageSize)) };
      renderTable(cache);
      renderPaginationBar();
    }

    Api.deleteStudent(studentId).then(() => {
      Utils.success('Student deleted.');
    }).catch(err => {
      if (previous) {
        cache.splice(idx, 0, previous);
        meta = { ...meta, total: meta.total + 1, totalPages: Math.max(1, Math.ceil((meta.total + 1) / state.pageSize)) };
        renderTable(cache);
        renderPaginationBar();
      }
      Utils.error(err.message);
    });
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
