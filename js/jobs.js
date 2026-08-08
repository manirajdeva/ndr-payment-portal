/**
 * jobs.js
 * Module 2 — Job Status: linked to an existing student via search-select,
 * which auto-populates Student Name + Course. CRUD table with search,
 * sort, pagination, and export.
 *
 * Add/Edit/Delete update the on-screen table immediately (optimistic UI)
 * instead of waiting for the Apps Script round trip. The real request still
 * runs in the background; if it fails, the change is rolled back and the
 * form is restored so nothing the user picked/typed is lost.
 */

const Jobs = (() => {
  const state = { page: 1, pageSize: 10, search: '', course: '', dateFrom: '', dateTo: '', sortBy: 'CreatedAt', sortDir: 'desc' };
  let cache = [];
  let meta = { total: 0, page: 1, pageSize: 10, totalPages: 1 };
  let selectedStudent = null;

  const JOB_STATUS_OPTIONS = [
    'Pending', 'Training', 'Interview Scheduled', 'Interview Cleared',
    'Selected', 'Offer Received', 'Joined', 'Rejected'
  ];

  const statusColors = {
    'Pending': '#94a3b8', 'Training': '#38bdf8', 'Interview Scheduled': '#a78bfa',
    'Interview Cleared': '#22d3ee', 'Selected': '#1e5eff', 'Offer Received': '#0ea5e9',
    'Joined': '#16a34a', 'Rejected': '#dc2626'
  };

  const exportColumns = [
    { key: 'Student ID', label: 'Student ID' },
    { key: 'Student Name', label: 'Student Name' },
    { key: 'Course', label: 'Course' },
    { key: 'Job Status', label: 'Job Status' },
    { key: 'Organization', label: 'Organization' },
    { key: 'Office Joining Date', label: 'Office Joining Date' },
    { key: 'Job Joining Date', label: 'Job Joining Date' }
  ];

  function populateStatusDropdown() {
    const select = document.getElementById('jobStatus');
    select.innerHTML = JOB_STATUS_OPTIONS.map(s => `<option value="${s}">${s}</option>`).join('');
  }

  async function load() {
    Utils.showLoading();
    try {
      const result = await Api.getJobStatus(state);
      cache = result.rows;
      meta = { total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages };
      renderTable(cache);
      renderPaginationBar();
      Utils.wireSortableHeaders(document.getElementById('jobTable'), state, (field, dir) => {
        state.sortBy = field; state.sortDir = dir; load();
      });
    } catch (err) {
      Utils.error(err.message);
    } finally {
      Utils.hideLoading();
    }
  }

  function renderPaginationBar() {
    Utils.renderPagination(document.getElementById('jobPagination'), meta, (page) => { state.page = page; load(); });
  }

  function statusBadge(status) {
    const color = statusColors[status] || '#94a3b8';
    return `<span class="badge-status" style="background:${color}22; color:${color};">${Utils.escapeHtml(status)}</span>`;
  }

  function renderTable(rows) {
    const tbody = document.getElementById('jobTableBody');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No job status records found.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(row => `
      <tr class="${row._pending ? 'row-pending' : ''}">
        <td><span class="fw-semibold text-primary">${Utils.escapeHtml(row['Student ID'])}</span></td>
        <td>${Utils.escapeHtml(row['Student Name'])}</td>
        <td>${Utils.escapeHtml(row['Course'])}</td>
        <td>${statusBadge(row['Job Status'])}</td>
        <td>${Utils.escapeHtml(row['Organization'] || '-')}</td>
        <td>${Utils.formatDate(row['Office Joining Date'])}</td>
        <td>${Utils.formatDate(row['Job Joining Date'])}</td>
        <td>
          ${row._pending ? Utils.pendingIndicatorHtml() : `
            <button class="btn-sm-icon edit" data-action="edit" data-row="${row._row}" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-sm-icon delete" data-action="delete" data-row="${row._row}" title="Delete"><i class="fa-solid fa-trash"></i></button>
          `}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', () => openEditModal(Number(btn.dataset.row))));
    tbody.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', () => deleteJob(Number(btn.dataset.row))));
  }

  function resetStudentPicker() {
    selectedStudent = null;
    document.getElementById('jobStudentSearch').value = '';
    document.getElementById('jobStudentSearch').readOnly = false;
    document.getElementById('jobStudentName').value = '';
    document.getElementById('jobCourse').value = '';
    document.getElementById('jobStudentResults').innerHTML = '';
  }

  function openAddModal() {
    document.getElementById('jobModalTitle').textContent = 'Add Job Status';
    document.getElementById('jobForm').reset();
    document.getElementById('jobRowHidden').value = '';
    resetStudentPicker();
    populateStatusDropdown();
    new bootstrap.Modal('#jobModal').show();
  }

  function openEditModal(rowIndex) {
    const row = cache.find(r => r._row === rowIndex);
    if (!row) return;
    populateStatusDropdown();
    fillForm(row);
    document.getElementById('jobModalTitle').textContent = 'Edit Job Status';
    document.getElementById('jobRowHidden').value = rowIndex;
    new bootstrap.Modal('#jobModal').show();
  }

  /** Fills the form (and student picker) from a row-like object; used for edit and for restoring after a failed save. */
  function fillForm(row) {
    selectedStudent = { 'Student ID': row['Student ID'], 'Student Name': row['Student Name'], 'Course': row['Course'] };
    document.getElementById('jobStudentSearch').value = `${row['Student ID']} — ${row['Student Name']}`;
    document.getElementById('jobStudentSearch').readOnly = true; // student link can't change on edit
    document.getElementById('jobStudentName').value = row['Student Name'];
    document.getElementById('jobCourse').value = row['Course'];
    document.getElementById('jobStatus').value = row['Job Status'];
    document.getElementById('jobOrganization').value = row['Organization'] || '';
    document.getElementById('jobOfficeJoiningDate').value = row['Office Joining Date'] || '';
    document.getElementById('jobJoiningDate').value = row['Job Joining Date'] || '';
  }

  function readForm() {
    return {
      'Job Status': document.getElementById('jobStatus').value,
      'Organization': document.getElementById('jobOrganization').value.trim(),
      'Office Joining Date': document.getElementById('jobOfficeJoiningDate').value,
      'Job Joining Date': document.getElementById('jobJoiningDate').value
    };
  }

  function wireStudentSearch() {
    const input = document.getElementById('jobStudentSearch');
    const results = document.getElementById('jobStudentResults');

    input.addEventListener('input', Utils.debounce(async (e) => {
      const query = e.target.value.trim();
      selectedStudent = null;
      document.getElementById('jobStudentName').value = '';
      document.getElementById('jobCourse').value = '';
      if (!query) { results.innerHTML = ''; return; }

      try {
        const { rows } = await Api.searchStudent(query);
        if (!rows.length) {
          results.innerHTML = `<div class="list-group-item small text-muted">No matching students</div>`;
          return;
        }
        results.innerHTML = rows.map(s => `
          <button type="button" class="list-group-item list-group-item-action small" data-id="${Utils.escapeHtml(s['Student ID'])}">
            <strong>${Utils.escapeHtml(s['Student ID'])}</strong> — ${Utils.escapeHtml(s['Student Name'])} <span class="text-muted">(${Utils.escapeHtml(s['Course'])})</span>
          </button>
        `).join('');
        results.querySelectorAll('button[data-id]').forEach(btn => {
          btn.addEventListener('click', () => {
            const student = rows.find(r => r['Student ID'] === btn.dataset.id);
            selectedStudent = student;
            input.value = `${student['Student ID']} — ${student['Student Name']}`;
            document.getElementById('jobStudentName').value = student['Student Name'];
            document.getElementById('jobCourse').value = student['Course'];
            results.innerHTML = '';
          });
        });
      } catch (err) {
        Utils.error(err.message);
      }
    }));

    document.addEventListener('click', (e) => {
      if (!results.contains(e.target) && e.target !== input) results.innerHTML = '';
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    const rowIndex = document.getElementById('jobRowHidden').value;
    const isEdit = !!rowIndex;

    if (!isEdit && !selectedStudent) {
      Utils.error('Please select a student from the search results.');
      return;
    }

    const data = readForm();
    if (isEdit) {
      submitEdit(Number(rowIndex), data);
    } else {
      submitAdd(selectedStudent, data);
    }
  }

  function submitAdd(student, data) {
    bootstrap.Modal.getInstance(document.getElementById('jobModal'))?.hide();

    const isDefaultView = !state.search && state.page === 1 && state.sortBy === 'CreatedAt' && state.sortDir === 'desc';
    const now = new Date().toISOString();
    const tempId = Utils.genTempId();
    const tempRow = Object.assign({
      'Student ID': student['Student ID'], 'Student Name': student['Student Name'], 'Course': student['Course'],
      'CreatedAt': now, 'UpdatedAt': now, _pending: true, _tempId: tempId
    }, data);

    if (isDefaultView) {
      cache = [tempRow, ...cache].slice(0, state.pageSize);
      meta = { ...meta, total: meta.total + 1, totalPages: Math.max(1, Math.ceil((meta.total + 1) / state.pageSize)) };
      renderTable(cache);
      renderPaginationBar();
    } else {
      Utils.info('Saving job status...');
    }

    const payload = Object.assign({ 'Student ID': student['Student ID'] }, data);
    Api.saveJobStatus(payload).then(saved => {
      if (isDefaultView) {
        const idx = cache.findIndex(r => r._tempId === tempId);
        if (idx !== -1) {
          cache[idx] = Object.assign({ 'Student ID': student['Student ID'], 'Student Name': student['Student Name'], 'Course': student['Course'] }, saved);
          renderTable(cache);
        }
      }
      Utils.success('Job status added successfully.');
    }).catch(err => {
      if (isDefaultView) {
        const idx = cache.findIndex(r => r._tempId === tempId);
        if (idx !== -1) cache.splice(idx, 1);
        meta = { ...meta, total: Math.max(0, meta.total - 1), totalPages: Math.max(1, Math.ceil(Math.max(0, meta.total - 1) / state.pageSize)) };
        renderTable(cache);
        renderPaginationBar();
      }
      Utils.error(err.message);
      reopenModalWithData('Add Job Status', '', student, data);
    });
  }

  function submitEdit(rowIndex, data) {
    bootstrap.Modal.getInstance(document.getElementById('jobModal'))?.hide();

    const idx = cache.findIndex(r => r._row === rowIndex);
    const previous = idx !== -1 ? cache[idx] : null;
    if (idx !== -1) {
      cache[idx] = Object.assign({}, previous, data, { UpdatedAt: new Date().toISOString(), _pending: true });
      renderTable(cache);
    }

    const payload = Object.assign({ _row: rowIndex }, data);
    Api.updateJobStatus(payload).then(saved => {
      const i = cache.findIndex(r => r._row === rowIndex);
      if (i !== -1) {
        cache[i] = Object.assign({}, cache[i], saved, { _pending: false });
        renderTable(cache);
      }
      Utils.success('Job status updated successfully.');
    }).catch(err => {
      const i = cache.findIndex(r => r._row === rowIndex);
      if (i !== -1 && previous) {
        cache[i] = previous;
        renderTable(cache);
      }
      Utils.error(err.message);
      reopenModalWithData('Edit Job Status', rowIndex, previous || {}, data);
    });
  }

  function reopenModalWithData(title, rowIndex, student, data) {
    document.getElementById('jobModalTitle').textContent = title;
    document.getElementById('jobRowHidden').value = rowIndex;
    populateStatusDropdown();
    fillForm(Object.assign({}, student, data));
    if (!rowIndex) document.getElementById('jobStudentSearch').readOnly = false; // re-allow picking a different student on Add retry
    new bootstrap.Modal('#jobModal').show();
  }

  async function deleteJob(rowIndex) {
    const ok = await Utils.confirmDialog({
      title: 'Delete this record?',
      text: 'This job status entry will be permanently removed.',
      confirmText: 'Delete',
      danger: true
    });
    if (!ok) return;

    const idx = cache.findIndex(r => r._row === rowIndex);
    const previous = idx !== -1 ? cache[idx] : null;
    if (idx !== -1) {
      cache.splice(idx, 1);
      meta = { ...meta, total: Math.max(0, meta.total - 1), totalPages: Math.max(1, Math.ceil(Math.max(0, meta.total - 1) / state.pageSize)) };
      renderTable(cache);
      renderPaginationBar();
    }

    Api.deleteJobStatus(rowIndex).then(() => {
      Utils.success('Record deleted.');
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
    const result = await Api.getJobStatus({
      search: state.search, course: state.course, dateFrom: state.dateFrom, dateTo: state.dateTo,
      sortBy: state.sortBy, sortDir: state.sortDir, page: 1, pageSize: 100000
    });
    return result.rows;
  }

  function wireEvents() {
    document.getElementById('jobAddBtn').addEventListener('click', openAddModal);
    document.getElementById('jobForm').addEventListener('submit', handleSubmit);
    wireStudentSearch();

    document.getElementById('jobSearch').addEventListener('input', Utils.debounce((e) => {
      state.search = e.target.value;
      state.page = 1;
      load();
    }));

    Utils.populateCourseSelect('jobCourseFilter', 'All courses');
    document.getElementById('jobCourseFilter').addEventListener('change', (e) => {
      state.course = e.target.value;
      state.page = 1;
      load();
    });
    document.getElementById('jobDateFrom').addEventListener('change', (e) => {
      state.dateFrom = e.target.value;
      state.page = 1;
      load();
    });
    document.getElementById('jobDateTo').addEventListener('change', (e) => {
      state.dateTo = e.target.value;
      state.page = 1;
      load();
    });

    document.getElementById('jobExportCsv').addEventListener('click', async () => {
      Utils.showLoading();
      try { Utils.exportCSV(await fetchAllForExport(), exportColumns, 'job_status'); }
      finally { Utils.hideLoading(); }
    });
    document.getElementById('jobExportExcel').addEventListener('click', async () => {
      Utils.showLoading();
      try { Utils.exportExcel(await fetchAllForExport(), exportColumns, 'job_status'); }
      finally { Utils.hideLoading(); }
    });
    document.getElementById('jobExportPdf').addEventListener('click', async () => {
      Utils.showLoading();
      try { Utils.exportPDF(await fetchAllForExport(), exportColumns, 'job_status', 'Job Status'); }
      finally { Utils.hideLoading(); }
    });
  }

  function init() {
    wireEvents();
  }

  return { init, load, JOB_STATUS_OPTIONS };
})();

document.addEventListener('DOMContentLoaded', () => {
  Jobs.init();
  App.onSectionActivate('jobs', () => Jobs.load());
});
