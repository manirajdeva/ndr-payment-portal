/**
 * jobs.js
 * Module 2 — Job Status: linked to an existing student via search-select,
 * which auto-populates Student Name + Course. CRUD table with search,
 * sort, pagination, and export.
 */

const Jobs = (() => {
  const state = { page: 1, pageSize: 10, search: '', sortBy: 'CreatedAt', sortDir: 'desc' };
  let cache = [];
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
      renderTable(result.rows);
      Utils.wireSortableHeaders(document.getElementById('jobTable'), state, (field, dir) => {
        state.sortBy = field; state.sortDir = dir; load();
      });
      Utils.renderPagination(document.getElementById('jobPagination'), result, (page) => { state.page = page; load(); });
    } catch (err) {
      Utils.error(err.message);
    } finally {
      Utils.hideLoading();
    }
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
      <tr>
        <td><span class="fw-semibold text-primary">${Utils.escapeHtml(row['Student ID'])}</span></td>
        <td>${Utils.escapeHtml(row['Student Name'])}</td>
        <td>${Utils.escapeHtml(row['Course'])}</td>
        <td>${statusBadge(row['Job Status'])}</td>
        <td>${Utils.escapeHtml(row['Organization'] || '-')}</td>
        <td>${Utils.formatDate(row['Office Joining Date'])}</td>
        <td>${Utils.formatDate(row['Job Joining Date'])}</td>
        <td>
          <button class="btn-sm-icon edit" data-action="edit" data-row="${row._row}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-sm-icon delete" data-action="delete" data-row="${row._row}" title="Delete"><i class="fa-solid fa-trash"></i></button>
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
    document.getElementById('jobModalTitle').textContent = 'Edit Job Status';
    document.getElementById('jobRowHidden').value = rowIndex;
    populateStatusDropdown();

    selectedStudent = { 'Student ID': row['Student ID'], 'Student Name': row['Student Name'], 'Course': row['Course'] };
    document.getElementById('jobStudentSearch').value = `${row['Student ID']} — ${row['Student Name']}`;
    document.getElementById('jobStudentSearch').readOnly = true; // student link can't change on edit
    document.getElementById('jobStudentName').value = row['Student Name'];
    document.getElementById('jobCourse').value = row['Course'];
    document.getElementById('jobStatus').value = row['Job Status'];
    document.getElementById('jobOrganization').value = row['Organization'] || '';
    document.getElementById('jobOfficeJoiningDate').value = row['Office Joining Date'] || '';
    document.getElementById('jobJoiningDate').value = row['Job Joining Date'] || '';

    new bootstrap.Modal('#jobModal').show();
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

  async function handleSubmit(e) {
    e.preventDefault();
    const rowIndex = document.getElementById('jobRowHidden').value;
    const isEdit = !!rowIndex;

    if (!isEdit && !selectedStudent) {
      Utils.error('Please select a student from the search results.');
      return;
    }

    const data = {
      'Job Status': document.getElementById('jobStatus').value,
      'Organization': document.getElementById('jobOrganization').value.trim(),
      'Office Joining Date': document.getElementById('jobOfficeJoiningDate').value,
      'Job Joining Date': document.getElementById('jobJoiningDate').value
    };
    if (isEdit) data._row = Number(rowIndex);
    else data['Student ID'] = selectedStudent['Student ID'];

    const btn = document.getElementById('jobSaveBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

    try {
      if (isEdit) {
        await Api.updateJobStatus(data);
        Utils.success('Job status updated successfully.');
      } else {
        await Api.saveJobStatus(data);
        Utils.success('Job status added successfully.');
      }
      bootstrap.Modal.getInstance(document.getElementById('jobModal'))?.hide();
      load();
    } catch (err) {
      Utils.error(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Save';
    }
  }

  async function deleteJob(rowIndex) {
    const ok = await Utils.confirmDialog({
      title: 'Delete this record?',
      text: 'This job status entry will be permanently removed.',
      confirmText: 'Delete',
      danger: true
    });
    if (!ok) return;

    Utils.showLoading();
    try {
      await Api.deleteJobStatus(rowIndex);
      Utils.success('Record deleted.');
      load();
    } catch (err) {
      Utils.error(err.message);
    } finally {
      Utils.hideLoading();
    }
  }

  async function fetchAllForExport() {
    const result = await Api.getJobStatus({ search: state.search, sortBy: state.sortBy, sortDir: state.sortDir, page: 1, pageSize: 100000 });
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
