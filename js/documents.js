/**
 * documents.js
 * Module 4 — Documents: previous-employment documents collected from a
 * student, linked to an existing student via search-select (same Student ID
 * as every other module), which auto-populates Student Name. CRUD table with
 * search, sort, pagination, and export.
 *
 * Two fields are not free-form: "Processed Date" is stamped by the backend
 * with the server's current date when the record is created (the form shows
 * it read-only and never sends it), and Form 16 / PF are plain booleans.
 *
 * Add/Edit/Delete update the on-screen table immediately (optimistic UI)
 * instead of waiting for the backend round trip. The real request still
 * runs in the background; if it fails, the change is rolled back and the
 * form is restored so nothing the user picked/typed is lost.
 */

const Documents = (() => {
  const state = { page: 1, pageSize: 10, search: '', dateFrom: '', dateTo: '', sortBy: 'CreatedAt', sortDir: 'desc' };
  let cache = [];
  let meta = { total: 0, page: 1, pageSize: 10, totalPages: 1 };
  let selectedStudent = null;

  const exportColumns = [
    { key: 'Student ID', label: 'Student ID' },
    { key: 'Student Name', label: 'Student Name' },
    { key: 'Organization Name', label: 'Organization Name' },
    { key: 'No of Years', label: 'No of Years' },
    { key: 'Employee Role', label: 'Employee Role' },
    { key: 'Doc Start Date', label: 'Doc Start Date' },
    { key: 'Doc End Date', label: 'Doc End Date' },
    { key: 'Form 16', label: 'Form 16' },
    { key: 'PF', label: 'PF' },
    { key: 'Processed Date', label: 'Processed Date' },
    { key: 'Given By', label: 'Given By' }
  ];

  async function load() {
    Utils.showLoading();
    try {
      const result = await Api.getDocuments(state);
      cache = result.rows;
      meta = { total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages };
      renderTable(cache);
      renderPaginationBar();
      Utils.wireSortableHeaders(document.getElementById('docTable'), state, (field, dir) => {
        state.sortBy = field; state.sortDir = dir; load();
      });
    } catch (err) {
      Utils.error(err.message);
    } finally {
      Utils.hideLoading();
    }
  }

  function renderPaginationBar() {
    Utils.renderPagination(document.getElementById('docPagination'), meta, (page) => { state.page = page; load(); });
  }

  function yesNoBadge(value) {
    const color = value ? '#16a34a' : '#94a3b8';
    return `<span class="badge-status" style="background:${color}22; color:${color};">${value ? 'Yes' : 'No'}</span>`;
  }

  function renderTable(rows) {
    const tbody = document.getElementById('docTableBody');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="12" class="text-center text-muted py-4">No document records found.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(row => `
      <tr class="${row._pending ? 'row-pending' : ''}">
        <td><span class="fw-semibold text-primary">${Utils.escapeHtml(row['Student ID'])}</span></td>
        <td>${Utils.escapeHtml(row['Student Name'])}</td>
        <td>${Utils.escapeHtml(row['Organization Name'] || '-')}</td>
        <td>${Number(row['No of Years']) || 0}</td>
        <td>${Utils.escapeHtml(row['Employee Role'] || '-')}</td>
        <td>${Utils.formatDate(row['Doc Start Date'])}</td>
        <td>${Utils.formatDate(row['Doc End Date'])}</td>
        <td>${yesNoBadge(row['Form 16'])}</td>
        <td>${yesNoBadge(row['PF'])}</td>
        <td>${Utils.formatDate(row['Processed Date'])}</td>
        <td>${Utils.escapeHtml(row['Given By'] || '-')}</td>
        <td>
          ${row._pending ? Utils.pendingIndicatorHtml() : Auth.canCreate() ? `
            <button class="btn-sm-icon edit" data-action="edit" data-row="${row._row}" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-sm-icon delete" data-action="delete" data-row="${row._row}" title="Delete"><i class="fa-solid fa-trash"></i></button>
          ` : '<span class="text-muted">-</span>'}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', () => openEditModal(Number(btn.dataset.row))));
    tbody.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', () => deleteDocument(Number(btn.dataset.row))));
  }

  function resetStudentPicker() {
    selectedStudent = null;
    document.getElementById('docStudentSearch').value = '';
    document.getElementById('docStudentSearch').readOnly = false;
    document.getElementById('docStudentName').value = '';
    document.getElementById('docStudentResults').innerHTML = '';
  }

  function openAddModal() {
    document.getElementById('docModalTitle').textContent = 'Add Document';
    document.getElementById('docForm').reset();
    document.getElementById('docRowHidden').value = '';
    resetStudentPicker();
    // Read-only preview of what the backend will stamp on save.
    document.getElementById('docProcessedDate').value = Utils.todayISO();
    new bootstrap.Modal('#docModal').show();
  }

  function openEditModal(rowIndex) {
    const row = cache.find(r => r._row === rowIndex);
    if (!row) return;
    fillForm(row);
    document.getElementById('docModalTitle').textContent = 'Edit Document';
    document.getElementById('docRowHidden').value = rowIndex;
    new bootstrap.Modal('#docModal').show();
  }

  /** Fills the form (and student picker) from a row-like object; used for edit and for restoring after a failed save. */
  function fillForm(row) {
    selectedStudent = { 'Student ID': row['Student ID'], 'Student Name': row['Student Name'] };
    document.getElementById('docStudentSearch').value = `${row['Student ID']} — ${row['Student Name']}`;
    document.getElementById('docStudentSearch').readOnly = true; // student link can't change on edit
    document.getElementById('docStudentName').value = row['Student Name'];
    document.getElementById('docOrgName').value = row['Organization Name'] || '';
    document.getElementById('docNoOfYears').value = row['No of Years'] != null ? row['No of Years'] : '';
    document.getElementById('docEmpRole').value = row['Employee Role'] || '';
    document.getElementById('docStartDate').value = row['Doc Start Date'] || '';
    document.getElementById('docEndDate').value = row['Doc End Date'] || '';
    document.getElementById('docForm16').checked = !!row['Form 16'];
    document.getElementById('docPf').checked = !!row['PF'];
    document.getElementById('docProcessedDate').value = row['Processed Date'] || Utils.todayISO();
    document.getElementById('docGivenBy').value = row['Given By'] || '';
  }

  /** 'Processed Date' is intentionally absent — the backend owns it. */
  function readForm() {
    return {
      'Organization Name': document.getElementById('docOrgName').value.trim(),
      'No of Years': document.getElementById('docNoOfYears').value,
      'Employee Role': document.getElementById('docEmpRole').value.trim(),
      'Doc Start Date': document.getElementById('docStartDate').value,
      'Doc End Date': document.getElementById('docEndDate').value,
      'Form 16': document.getElementById('docForm16').checked,
      'PF': document.getElementById('docPf').checked,
      'Given By': document.getElementById('docGivenBy').value.trim()
    };
  }

  function wireStudentSearch() {
    const input = document.getElementById('docStudentSearch');
    const results = document.getElementById('docStudentResults');

    input.addEventListener('input', Utils.debounce(async (e) => {
      const query = e.target.value.trim();
      selectedStudent = null;
      document.getElementById('docStudentName').value = '';
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
            document.getElementById('docStudentName').value = student['Student Name'];
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
    const rowIndex = document.getElementById('docRowHidden').value;
    const isEdit = !!rowIndex;

    if (!isEdit && !selectedStudent) {
      Utils.error('Please select a student from the search results.');
      return;
    }

    const data = readForm();
    // Mirrors the backend guard, so an obvious mistake is caught before the round trip.
    if (data['Doc Start Date'] && data['Doc End Date'] && data['Doc End Date'] < data['Doc Start Date']) {
      Utils.error('Doc end date cannot be before the doc start date.');
      return;
    }

    if (isEdit) {
      submitEdit(Number(rowIndex), data);
    } else {
      submitAdd(selectedStudent, data);
    }
  }

  function submitAdd(student, data) {
    bootstrap.Modal.getInstance(document.getElementById('docModal'))?.hide();

    const isDefaultView = !state.search && state.page === 1 && state.sortBy === 'CreatedAt' && state.sortDir === 'desc';
    const now = new Date().toISOString();
    const tempId = Utils.genTempId();
    const tempRow = Object.assign({
      'Student ID': student['Student ID'], 'Student Name': student['Student Name'],
      'Processed Date': Utils.todayISO(), // the backend stamps the authoritative value
      'CreatedAt': now, 'UpdatedAt': now, _pending: true, _tempId: tempId
    }, data);

    if (isDefaultView) {
      cache = [tempRow, ...cache].slice(0, state.pageSize);
      meta = { ...meta, total: meta.total + 1, totalPages: Math.max(1, Math.ceil((meta.total + 1) / state.pageSize)) };
      renderTable(cache);
      renderPaginationBar();
    } else {
      Utils.info('Saving document...');
    }

    const payload = Object.assign({ 'Student ID': student['Student ID'] }, data);
    Api.saveDocument(payload).then(saved => {
      if (isDefaultView) {
        const idx = cache.findIndex(r => r._tempId === tempId);
        if (idx !== -1) {
          cache[idx] = Object.assign({ 'Student ID': student['Student ID'], 'Student Name': student['Student Name'] }, saved);
          renderTable(cache);
        }
      }
      Utils.success('Document added successfully.');
    }).catch(err => {
      if (isDefaultView) {
        const idx = cache.findIndex(r => r._tempId === tempId);
        if (idx !== -1) cache.splice(idx, 1);
        meta = { ...meta, total: Math.max(0, meta.total - 1), totalPages: Math.max(1, Math.ceil(Math.max(0, meta.total - 1) / state.pageSize)) };
        renderTable(cache);
        renderPaginationBar();
      }
      Utils.error(err.message);
      reopenModalWithData('Add Document', '', student, data);
    });
  }

  function submitEdit(rowIndex, data) {
    bootstrap.Modal.getInstance(document.getElementById('docModal'))?.hide();

    const idx = cache.findIndex(r => r._row === rowIndex);
    const previous = idx !== -1 ? cache[idx] : null;
    if (idx !== -1) {
      cache[idx] = Object.assign({}, previous, data, { UpdatedAt: new Date().toISOString(), _pending: true });
      renderTable(cache);
    }

    const payload = Object.assign({ _row: rowIndex }, data);
    Api.updateDocument(payload).then(saved => {
      const i = cache.findIndex(r => r._row === rowIndex);
      if (i !== -1) {
        cache[i] = Object.assign({}, cache[i], saved, { _pending: false });
        renderTable(cache);
      }
      Utils.success('Document updated successfully.');
    }).catch(err => {
      const i = cache.findIndex(r => r._row === rowIndex);
      if (i !== -1 && previous) {
        cache[i] = previous;
        renderTable(cache);
      }
      Utils.error(err.message);
      reopenModalWithData('Edit Document', rowIndex, previous || {}, data);
    });
  }

  function reopenModalWithData(title, rowIndex, student, data) {
    document.getElementById('docModalTitle').textContent = title;
    document.getElementById('docRowHidden').value = rowIndex;
    fillForm(Object.assign({}, student, data));
    if (!rowIndex) document.getElementById('docStudentSearch').readOnly = false; // re-allow picking a different student on Add retry
    new bootstrap.Modal('#docModal').show();
  }

  async function deleteDocument(rowIndex) {
    const ok = await Utils.confirmDialog({
      title: 'Delete this record?',
      text: 'This document entry will be permanently removed.',
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

    Api.deleteDocument(rowIndex).then(() => {
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

  /** Booleans export as readable Yes/No rather than true/false. */
  async function fetchAllForExport() {
    const result = await Api.getDocuments({
      search: state.search, dateFrom: state.dateFrom, dateTo: state.dateTo,
      sortBy: state.sortBy, sortDir: state.sortDir, page: 1, pageSize: 100000
    });
    return result.rows.map(row => Object.assign({}, row, {
      'Form 16': row['Form 16'] ? 'Yes' : 'No',
      'PF': row['PF'] ? 'Yes' : 'No'
    }));
  }

  function wireEvents() {
    document.getElementById('docAddBtn').addEventListener('click', openAddModal);
    document.getElementById('docForm').addEventListener('submit', handleSubmit);
    wireStudentSearch();

    document.getElementById('docSearch').addEventListener('input', Utils.debounce((e) => {
      state.search = e.target.value;
      state.page = 1;
      load();
    }));

    document.getElementById('docDateFrom').addEventListener('change', (e) => {
      state.dateFrom = e.target.value;
      state.page = 1;
      load();
    });
    document.getElementById('docDateTo').addEventListener('change', (e) => {
      state.dateTo = e.target.value;
      state.page = 1;
      load();
    });

    document.getElementById('docExportCsv').addEventListener('click', async () => {
      Utils.showLoading();
      try { Utils.exportCSV(await fetchAllForExport(), exportColumns, 'documents'); }
      finally { Utils.hideLoading(); }
    });
    document.getElementById('docExportExcel').addEventListener('click', async () => {
      Utils.showLoading();
      try { Utils.exportExcel(await fetchAllForExport(), exportColumns, 'documents'); }
      finally { Utils.hideLoading(); }
    });
    document.getElementById('docExportPdf').addEventListener('click', async () => {
      Utils.showLoading();
      try { Utils.exportPDF(await fetchAllForExport(), exportColumns, 'documents', 'Documents'); }
      finally { Utils.hideLoading(); }
    });
  }

  function init() {
    wireEvents();
  }

  return { init, load };
})();

document.addEventListener('DOMContentLoaded', () => {
  Documents.init();
  App.onSectionActivate('documents', () => Documents.load());
});
