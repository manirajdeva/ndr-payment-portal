/**
 * payments.js
 * Module 3 — Student Payments: multiple entries per student, running
 * balance preview, overpayment prevention, CRUD table, export.
 *
 * Add/Edit/Delete update the on-screen table immediately (optimistic UI)
 * instead of waiting for the Apps Script round trip. The real request still
 * runs in the background and is the final word on validity (e.g.
 * overpayment) — if it's rejected, the change is rolled back and the form
 * is restored so nothing the user typed is lost.
 */

const Payments = (() => {
  const state = { page: 1, pageSize: 10, search: '', course: '', dateFrom: '', dateTo: '', latestOnly: false, sortBy: 'CreatedAt', sortDir: 'desc' };
  let cache = [];
  let meta = { total: 0, page: 1, pageSize: 10, totalPages: 1 };
  let selectedStudent = null;
  let editingRow = null; // row object being edited, used to exclude it from "already paid" totals

  const PAYMENT_METHODS = ['Cash', 'UPI', 'Google Pay', 'PhonePe', 'Bank Transfer', 'Credit Card', 'Debit Card'];
  // What the payment was for. Payments saved before this field existed show
  // blank here; the dropdown starts empty so editing one never guesses a value.
  const PAYMENT_TYPES = ['Training', 'Process', 'Documents'];

  const exportColumns = [
    { key: 'Payment ID', label: 'Payment ID' },
    { key: 'Student ID', label: 'Student ID' },
    { key: 'Student Name', label: 'Student Name' },
    { key: 'Course', label: 'Course' },
    { key: 'Installment No', label: 'Installment No' },
    { key: 'Job Offer Date', label: 'Job Offer Date' },
    { key: 'Total Course Fee', label: 'Total Course Fee' },
    { key: 'Payment Received', label: 'Payment Received' },
    { key: 'Payment Method', label: 'Payment Method' },
    { key: 'Payment Type', label: 'Payment Type' },
    { key: 'Pending Amount', label: 'Pending Amount' },
    { key: 'Payment Date', label: 'Payment Date' }
  ];

  function populateMethodDropdown() {
    document.getElementById('payMethod').innerHTML = PAYMENT_METHODS.map(m => `<option value="${m}">${m}</option>`).join('');
    document.getElementById('payType').innerHTML =
      `<option value="">Select payment type</option>` + PAYMENT_TYPES.map(t => `<option value="${t}">${t}</option>`).join('');
  }

  async function load() {
    Utils.showLoading();
    try {
      const result = await Api.getPayments(state);
      cache = result.rows;
      meta = { total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages };
      renderTable(cache);
      renderPaginationBar();
      Utils.wireSortableHeaders(document.getElementById('payTable'), state, (field, dir) => {
        state.sortBy = field; state.sortDir = dir; load();
      });
    } catch (err) {
      Utils.error(err.message);
    } finally {
      Utils.hideLoading();
    }
  }

  function renderPaginationBar() {
    Utils.renderPagination(document.getElementById('payPagination'), meta, (page) => { state.page = page; load(); });
  }

  function renderTable(rows) {
    const tbody = document.getElementById('payTableBody');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="12" class="text-center text-muted py-4">No payment records found.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(row => {
      const pending = Number(row['Pending Amount']) || 0;
      const pendingClass = pending > 0 ? 'text-danger' : 'text-success';
      return `
      <tr class="${row._pending ? 'row-pending' : ''}">
        <td>${Utils.escapeHtml(row['Payment ID'])}</td>
        <td><a href="#" class="fw-semibold text-primary" data-action="viewStudent" data-student="${Utils.escapeHtml(row['Student ID'])}">${Utils.escapeHtml(row['Student ID'])}</a></td>
        <td>${Utils.escapeHtml(row['Student Name'])}</td>
        <td>${Utils.escapeHtml(row['Course'])}</td>
        <td>${row['_pending'] ? '' : Utils.escapeHtml(row['Installment No'])}</td>
        <td>${Utils.formatCurrency(row['Total Course Fee'])}</td>
        <td>${Utils.formatCurrency(row['Payment Received'])}</td>
        <td class="${pendingClass} fw-semibold">${Utils.formatCurrency(pending)}</td>
        <td>${Utils.escapeHtml(row['Payment Method'])}</td>
        <td>${Utils.escapeHtml(row['Payment Type'] || '-')}</td>
        <td>${Utils.formatDate(row['Payment Date'])}</td>
        <td>
          ${row._pending ? Utils.pendingIndicatorHtml() : Auth.isAdmin() ? `
            <button class="btn-sm-icon edit" data-action="edit" data-row="${row._row}" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-sm-icon delete" data-action="delete" data-row="${row._row}" title="Delete"><i class="fa-solid fa-trash"></i></button>
          ` : '<span class="text-muted">-</span>'}
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', () => openEditModal(Number(btn.dataset.row))));
    tbody.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', () => deletePayment(Number(btn.dataset.row))));
    tbody.querySelectorAll('[data-action="viewStudent"]').forEach(link => link.addEventListener('click', (e) => {
      e.preventDefault();
      openStudentPaymentsModal(link.dataset.student, link.closest('tr').querySelector('td:nth-child(3)').textContent);
    }));
  }

  async function openStudentPaymentsModal(studentId, studentName) {
    document.getElementById('studentPaymentsModalTitle').textContent = `Payment History — ${studentId}${studentName ? ' · ' + studentName : ''}`;
    const tbody = document.getElementById('studentPaymentsModalBody');
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">Loading...</td></tr>`;
    new bootstrap.Modal('#studentPaymentsModal').show();

    try {
      const { rows } = await Api.getPayments({ search: studentId, page: 1, pageSize: 100000 });
      const matches = rows
        .filter(r => r['Student ID'] === studentId)
        .sort((a, b) => (Number(a['Installment No']) || 0) - (Number(b['Installment No']) || 0));

      if (!matches.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No payments found for this student.</td></tr>`;
        return;
      }

      tbody.innerHTML = matches.map(row => {
        const pending = Number(row['Pending Amount']) || 0;
        const pendingClass = pending > 0 ? 'text-danger' : 'text-success';
        return `
        <tr>
          <td>${Utils.escapeHtml(row['Installment No'])}</td>
          <td>${Utils.escapeHtml(row['Payment ID'])}</td>
          <td>${Utils.formatCurrency(row['Total Course Fee'])}</td>
          <td>${Utils.formatCurrency(row['Payment Received'])}</td>
          <td class="${pendingClass} fw-semibold">${Utils.formatCurrency(pending)}</td>
          <td>${Utils.escapeHtml(row['Payment Method'])}</td>
          <td>${Utils.escapeHtml(row['Payment Type'] || '-')}</td>
          <td>${Utils.formatDate(row['Payment Date'])}</td>
        </tr>`;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-4">${Utils.escapeHtml(err.message)}</td></tr>`;
    }
  }

  function resetStudentPicker() {
    selectedStudent = null;
    document.getElementById('payStudentSearch').value = '';
    document.getElementById('payStudentSearch').readOnly = false;
    document.getElementById('payStudentName').value = '';
    document.getElementById('payCourse').value = '';
    document.getElementById('payStudentResults').innerHTML = '';
    updatePendingPreview(0, 0);
    applyPaymentTypeRule('', true);
  }

  let currentSummary = { totalPaid: 0, pendingBefore: 0 };

  function updatePendingPreview(totalPaid, pendingBefore) {
    currentSummary = { totalPaid, pendingBefore };
    document.getElementById('payPendingPreview').textContent =
      `Already paid: ${Utils.formatCurrency(totalPaid)} · Pending before this payment: ${Utils.formatCurrency(pendingBefore)}`;
  }

  /**
   * Sums existing payment rows for a student. `totalPaid` excludes the row
   * currently being edited (if any); `inheritedType` and `firstRow` are
   * computed over all of them, since the first installment's Payment Type
   * governs every later one — mirroring the same rule on the backend.
   */
  async function getStudentPaymentSummary(studentId) {
    const { rows } = await Api.getPayments({ search: studentId, page: 1, pageSize: 100000 });
    const all = rows.filter(r => r['Student ID'] === studentId);
    const matches = all.filter(r => !editingRow || r._row !== editingRow._row);
    const totalPaid = matches.reduce((sum, r) => sum + (Number(r['Payment Received']) || 0), 0);
    let lastFee = 0, lastCreated = '';
    matches.forEach(r => {
      if (String(r['CreatedAt']) >= String(lastCreated)) { lastFee = Number(r['Total Course Fee']) || 0; lastCreated = r['CreatedAt']; }
    });

    const inOrder = all.slice().sort((a, b) =>
      (Number(a['Installment No']) || 0) - (Number(b['Installment No']) || 0) || a._row - b._row);
    const governing = inOrder.find(r => r['Payment Type']);

    return {
      totalPaid, lastFee, pendingBefore: Math.max(0, lastFee - totalPaid),
      firstRow: inOrder.length ? inOrder[0]._row : null,
      inheritedType: governing ? governing['Payment Type'] : ''
    };
  }

  /**
   * Payment Type is chosen once, on a student's first installment; later
   * installments inherit it and show it locked. `inheritedType` empty means
   * this is the first payment (or the student's older ones predate the
   * field), so the admin picks it here.
   */
  function applyPaymentTypeRule(inheritedType, editable) {
    const select = document.getElementById('payType');
    const hint = document.getElementById('payTypeHint');
    if (inheritedType && !editable) {
      select.value = inheritedType;
      select.disabled = true;
      hint.textContent = 'Set on this student\u2019s first installment \u2014 later installments inherit it.';
      hint.classList.remove('d-none');
    } else {
      select.disabled = false;
      hint.classList.toggle('d-none', !editable);
      if (editable) hint.textContent = 'Applies to every installment for this student.';
    }
  }

  function openAddModal() {
    document.getElementById('payModalTitle').textContent = 'Add Payment';
    document.getElementById('payForm').reset();
    document.getElementById('payRowHidden').value = '';
    editingRow = null;
    resetStudentPicker();
    populateMethodDropdown();
    document.getElementById('payDate').value = Utils.todayISO();
    applyPaymentTypeRule('', true); // until a student is picked, assume a first payment
    new bootstrap.Modal('#payModal').show();
  }

  async function openEditModal(rowIndex) {
    const row = cache.find(r => r._row === rowIndex);
    if (!row) return;
    editingRow = row;
    document.getElementById('payModalTitle').textContent = 'Edit Payment';
    document.getElementById('payForm').reset();
    document.getElementById('payRowHidden').value = rowIndex;
    populateMethodDropdown();
    fillForm(row);

    new bootstrap.Modal('#payModal').show();

    const summary = await getStudentPaymentSummary(row['Student ID']);
    updatePendingPreview(summary.totalPaid, summary.pendingBefore);
    applyPaymentTypeRule(row['Payment Type'] || summary.inheritedType, summary.firstRow === row._row);
  }

  /** Fills the form (and student picker) from a row-like object; used for edit and for restoring after a failed save. */
  function fillForm(row) {
    selectedStudent = { 'Student ID': row['Student ID'], 'Student Name': row['Student Name'], 'Course': row['Course'] };
    document.getElementById('payStudentSearch').value = `${row['Student ID']} — ${row['Student Name']}`;
    document.getElementById('payStudentSearch').readOnly = true;
    document.getElementById('payStudentName').value = row['Student Name'];
    document.getElementById('payCourse').value = row['Course'] || '';
    document.getElementById('payJobOfferDate').value = row['Job Offer Date'] || '';
    document.getElementById('payTotalFee').value = row['Total Course Fee'];
    document.getElementById('payReceived').value = row['Payment Received'];
    document.getElementById('payMethod').value = row['Payment Method'];
    document.getElementById('payType').value = row['Payment Type'] || '';
    document.getElementById('payDate').value = row['Payment Date'] || Utils.todayISO();
  }

  function readForm() {
    return {
      'Job Offer Date': document.getElementById('payJobOfferDate').value,
      'Total Course Fee': Number(document.getElementById('payTotalFee').value),
      'Payment Received': Number(document.getElementById('payReceived').value),
      'Payment Method': document.getElementById('payMethod').value,
      'Payment Type': document.getElementById('payType').value,
      'Payment Date': document.getElementById('payDate').value
    };
  }

  function wireStudentSearch() {
    const input = document.getElementById('payStudentSearch');
    const results = document.getElementById('payStudentResults');

    input.addEventListener('input', Utils.debounce(async (e) => {
      const query = e.target.value.trim();
      selectedStudent = null;
      document.getElementById('payStudentName').value = '';
      document.getElementById('payCourse').value = '';
      updatePendingPreview(0, 0);
      applyPaymentTypeRule('', true);
      if (!query) { results.innerHTML = ''; return; }

      try {
        const { rows } = await Api.searchStudent(query);
        if (!rows.length) {
          results.innerHTML = `<div class="list-group-item small text-muted">No matching students</div>`;
          return;
        }
        results.innerHTML = rows.map(s => `
          <button type="button" class="list-group-item list-group-item-action small" data-id="${Utils.escapeHtml(s['Student ID'])}">
            <strong>${Utils.escapeHtml(s['Student ID'])}</strong> — ${Utils.escapeHtml(s['Student Name'])}
          </button>
        `).join('');
        results.querySelectorAll('button[data-id]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const student = rows.find(r => r['Student ID'] === btn.dataset.id);
            selectedStudent = student;
            input.value = `${student['Student ID']} — ${student['Student Name']}`;
            document.getElementById('payStudentName').value = student['Student Name'];
            document.getElementById('payCourse').value = student['Course'] || '';
            results.innerHTML = '';

            const summary = await getStudentPaymentSummary(student['Student ID']);
            updatePendingPreview(summary.totalPaid, summary.pendingBefore);
            applyPaymentTypeRule(summary.inheritedType, false);
            if (summary.lastFee > 0 && !document.getElementById('payTotalFee').value) {
              document.getElementById('payTotalFee').value = summary.lastFee;
            }
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
    const rowIndex = document.getElementById('payRowHidden').value;
    const isEdit = !!rowIndex;

    if (!isEdit && !selectedStudent) {
      Utils.error('Please select a student from the search results.');
      return;
    }

    const data = readForm();
    if (data['Total Course Fee'] < 0) { Utils.error('Total Course Fee cannot be negative.'); return; }
    if (data['Payment Received'] <= 0) { Utils.error('Payment Received must be greater than zero.'); return; }

    if (isEdit) {
      submitEdit(Number(rowIndex), selectedStudent, data);
    } else {
      submitAdd(selectedStudent, data);
    }
  }

  function submitAdd(student, data) {
    bootstrap.Modal.getInstance(document.getElementById('payModal'))?.hide();

    const isDefaultView = !state.search && state.page === 1 && state.sortBy === 'CreatedAt' && state.sortDir === 'desc';
    const now = new Date().toISOString();
    const tempId = Utils.genTempId();
    // Pending shown here is a best-effort client estimate from currentSummary; the server
    // recomputes it authoritatively on save and can reject the payment as an overpayment.
    const estimatedPending = Math.max(0, data['Total Course Fee'] - (currentSummary.totalPaid + data['Payment Received']));

    const tempRow = Object.assign({
      'Payment ID': 'Pending...', 'Student ID': student['Student ID'], 'Student Name': student['Student Name'], 'Course': student['Course'],
      'Pending Amount': estimatedPending, 'CreatedAt': now, _pending: true, _tempId: tempId
    }, data);

    if (isDefaultView) {
      cache = [tempRow, ...cache].slice(0, state.pageSize);
      meta = { ...meta, total: meta.total + 1, totalPages: Math.max(1, Math.ceil((meta.total + 1) / state.pageSize)) };
      renderTable(cache);
      renderPaginationBar();
    } else {
      Utils.info('Saving payment...');
    }

    const payload = Object.assign({ 'Student ID': student['Student ID'] }, data);
    Api.savePayment(payload).then(saved => {
      if (isDefaultView) {
        const idx = cache.findIndex(r => r._tempId === tempId);
        if (idx !== -1) {
          cache[idx] = saved;
          renderTable(cache);
        }
      }
      Utils.success('Payment recorded successfully.');
    }).catch(err => {
      if (isDefaultView) {
        const idx = cache.findIndex(r => r._tempId === tempId);
        if (idx !== -1) cache.splice(idx, 1);
        meta = { ...meta, total: Math.max(0, meta.total - 1), totalPages: Math.max(1, Math.ceil(Math.max(0, meta.total - 1) / state.pageSize)) };
        renderTable(cache);
        renderPaginationBar();
      }
      Utils.error(err.message);
      reopenModalWithData('Add Payment', '', student, data);
    });
  }

  function submitEdit(rowIndex, student, data) {
    bootstrap.Modal.getInstance(document.getElementById('payModal'))?.hide();

    const idx = cache.findIndex(r => r._row === rowIndex);
    const previous = idx !== -1 ? cache[idx] : null;
    if (idx !== -1) {
      const estimatedPending = Math.max(0, data['Total Course Fee'] - (currentSummary.totalPaid + data['Payment Received']));
      cache[idx] = Object.assign({}, previous, data, { 'Pending Amount': estimatedPending, _pending: true });
      renderTable(cache);
    }

    const payload = Object.assign({ _row: rowIndex }, data);
    Api.updatePayment(payload).then(saved => {
      const i = cache.findIndex(r => r._row === rowIndex);
      if (i !== -1) {
        cache[i] = Object.assign({}, cache[i], saved, { _pending: false });
        renderTable(cache);
      }
      Utils.success('Payment updated successfully.');
    }).catch(err => {
      const i = cache.findIndex(r => r._row === rowIndex);
      if (i !== -1 && previous) {
        cache[i] = previous;
        renderTable(cache);
      }
      Utils.error(err.message);
      reopenModalWithData('Edit Payment', rowIndex, previous || student, data);
    });
  }

  function reopenModalWithData(title, rowIndex, student, data) {
    editingRow = rowIndex ? cache.find(r => r._row === rowIndex) || null : null;
    document.getElementById('payModalTitle').textContent = title;
    document.getElementById('payRowHidden').value = rowIndex;
    populateMethodDropdown();
    fillForm(Object.assign({}, student, data));
    if (!rowIndex) document.getElementById('payStudentSearch').readOnly = false; // re-allow picking a different student on Add retry
    new bootstrap.Modal('#payModal').show();
    getStudentPaymentSummary(student['Student ID']).then(summary => updatePendingPreview(summary.totalPaid, summary.pendingBefore));
  }

  async function deletePayment(rowIndex) {
    const ok = await Utils.confirmDialog({
      title: 'Delete this payment?',
      text: 'This payment entry will be permanently removed and balances will be recalculated.',
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

    Api.deletePayment(rowIndex).then(() => {
      Utils.success('Payment deleted.');
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
    const result = await Api.getPayments({
      search: state.search, course: state.course, dateFrom: state.dateFrom, dateTo: state.dateTo, latestOnly: state.latestOnly,
      sortBy: state.sortBy, sortDir: state.sortDir, page: 1, pageSize: 100000
    });
    return result.rows;
  }

  function wireEvents() {
    document.getElementById('payAddBtn').addEventListener('click', openAddModal);
    document.getElementById('payForm').addEventListener('submit', handleSubmit);
    wireStudentSearch();

    document.getElementById('paySearch').addEventListener('input', Utils.debounce((e) => {
      state.search = e.target.value;
      state.page = 1;
      load();
    }));

    Utils.populateCourseSelect('payCourseFilter', 'All courses');
    document.getElementById('payCourseFilter').addEventListener('change', (e) => {
      state.course = e.target.value;
      state.page = 1;
      load();
    });
    document.getElementById('payDateFrom').addEventListener('change', (e) => {
      state.dateFrom = e.target.value;
      state.page = 1;
      load();
    });
    document.getElementById('payDateTo').addEventListener('change', (e) => {
      state.dateTo = e.target.value;
      state.page = 1;
      load();
    });
    document.getElementById('payLatestOnly').addEventListener('change', (e) => {
      state.latestOnly = e.target.checked;
      state.page = 1;
      load();
    });

    document.getElementById('payExportCsv').addEventListener('click', async () => {
      Utils.showLoading();
      try { Utils.exportCSV(await fetchAllForExport(), exportColumns, 'student_payments'); }
      finally { Utils.hideLoading(); }
    });
    document.getElementById('payExportExcel').addEventListener('click', async () => {
      Utils.showLoading();
      try { Utils.exportExcel(await fetchAllForExport(), exportColumns, 'student_payments'); }
      finally { Utils.hideLoading(); }
    });
    document.getElementById('payExportPdf').addEventListener('click', async () => {
      Utils.showLoading();
      try { Utils.exportPDF(await fetchAllForExport(), exportColumns, 'student_payments', 'Student Payments'); }
      finally { Utils.hideLoading(); }
    });
  }

  function init() {
    wireEvents();
  }

  return { init, load };
})();

document.addEventListener('DOMContentLoaded', () => {
  Payments.init();
  App.onSectionActivate('payments', () => Payments.load());
});
