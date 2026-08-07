/**
 * payments.js
 * Module 3 — Student Payments: multiple entries per student, running
 * balance preview, overpayment prevention, CRUD table, export.
 */

const Payments = (() => {
  const state = { page: 1, pageSize: 10, search: '', sortBy: 'CreatedAt', sortDir: 'desc' };
  let cache = [];
  let selectedStudent = null;
  let editingRow = null; // row object being edited, used to exclude it from "already paid" totals

  const PAYMENT_METHODS = ['Cash', 'UPI', 'Google Pay', 'PhonePe', 'Bank Transfer', 'Credit Card', 'Debit Card'];

  const exportColumns = [
    { key: 'Payment ID', label: 'Payment ID' },
    { key: 'Student ID', label: 'Student ID' },
    { key: 'Student Name', label: 'Student Name' },
    { key: 'Job Offer Date', label: 'Job Offer Date' },
    { key: 'Total Course Fee', label: 'Total Course Fee' },
    { key: 'Payment Received', label: 'Payment Received' },
    { key: 'Payment Method', label: 'Payment Method' },
    { key: 'Pending Amount', label: 'Pending Amount' },
    { key: 'Payment Date', label: 'Payment Date' }
  ];

  function populateMethodDropdown() {
    document.getElementById('payMethod').innerHTML = PAYMENT_METHODS.map(m => `<option value="${m}">${m}</option>`).join('');
  }

  async function load() {
    Utils.showLoading();
    try {
      const result = await Api.getPayments(state);
      cache = result.rows;
      renderTable(result.rows);
      Utils.wireSortableHeaders(document.getElementById('payTable'), state, (field, dir) => {
        state.sortBy = field; state.sortDir = dir; load();
      });
      Utils.renderPagination(document.getElementById('payPagination'), result, (page) => { state.page = page; load(); });
    } catch (err) {
      Utils.error(err.message);
    } finally {
      Utils.hideLoading();
    }
  }

  function renderTable(rows) {
    const tbody = document.getElementById('payTableBody');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">No payment records found.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(row => {
      const pending = Number(row['Pending Amount']) || 0;
      const pendingClass = pending > 0 ? 'text-danger' : 'text-success';
      return `
      <tr>
        <td>${Utils.escapeHtml(row['Payment ID'])}</td>
        <td><span class="fw-semibold text-primary">${Utils.escapeHtml(row['Student ID'])}</span></td>
        <td>${Utils.escapeHtml(row['Student Name'])}</td>
        <td>${Utils.formatCurrency(row['Total Course Fee'])}</td>
        <td>${Utils.formatCurrency(row['Payment Received'])}</td>
        <td class="${pendingClass} fw-semibold">${Utils.formatCurrency(pending)}</td>
        <td>${Utils.escapeHtml(row['Payment Method'])}</td>
        <td>${Utils.formatDate(row['Payment Date'])}</td>
        <td>
          <button class="btn-sm-icon edit" data-action="edit" data-row="${row._row}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-sm-icon delete" data-action="delete" data-row="${row._row}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', () => openEditModal(Number(btn.dataset.row))));
    tbody.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', () => deletePayment(Number(btn.dataset.row))));
  }

  function resetStudentPicker() {
    selectedStudent = null;
    document.getElementById('payStudentSearch').value = '';
    document.getElementById('payStudentSearch').readOnly = false;
    document.getElementById('payStudentName').value = '';
    document.getElementById('payStudentResults').innerHTML = '';
    updatePendingPreview(0, 0);
  }

  function updatePendingPreview(totalPaid, pendingBefore) {
    document.getElementById('payPendingPreview').textContent =
      `Already paid: ${Utils.formatCurrency(totalPaid)} · Pending before this payment: ${Utils.formatCurrency(pendingBefore)}`;
  }

  /** Sums existing payment rows for a student (excluding the row currently being edited, if any). */
  async function getStudentPaymentSummary(studentId) {
    const { rows } = await Api.getPayments({ search: studentId, page: 1, pageSize: 100000 });
    const matches = rows.filter(r => r['Student ID'] === studentId && (!editingRow || r._row !== editingRow._row));
    const totalPaid = matches.reduce((sum, r) => sum + (Number(r['Payment Received']) || 0), 0);
    let lastFee = 0, lastCreated = '';
    matches.forEach(r => {
      if (String(r['CreatedAt']) >= String(lastCreated)) { lastFee = Number(r['Total Course Fee']) || 0; lastCreated = r['CreatedAt']; }
    });
    return { totalPaid, lastFee, pendingBefore: Math.max(0, lastFee - totalPaid) };
  }

  function openAddModal() {
    document.getElementById('payModalTitle').textContent = 'Add Payment';
    document.getElementById('payForm').reset();
    document.getElementById('payRowHidden').value = '';
    editingRow = null;
    resetStudentPicker();
    populateMethodDropdown();
    document.getElementById('payDate').value = Utils.todayISO();
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

    selectedStudent = { 'Student ID': row['Student ID'], 'Student Name': row['Student Name'] };
    document.getElementById('payStudentSearch').value = `${row['Student ID']} — ${row['Student Name']}`;
    document.getElementById('payStudentSearch').readOnly = true;
    document.getElementById('payStudentName').value = row['Student Name'];
    document.getElementById('payJobOfferDate').value = row['Job Offer Date'] || '';
    document.getElementById('payTotalFee').value = row['Total Course Fee'];
    document.getElementById('payReceived').value = row['Payment Received'];
    document.getElementById('payMethod').value = row['Payment Method'];
    document.getElementById('payDate').value = row['Payment Date'] || Utils.todayISO();

    new bootstrap.Modal('#payModal').show();

    const summary = await getStudentPaymentSummary(row['Student ID']);
    updatePendingPreview(summary.totalPaid, summary.pendingBefore);
  }

  function wireStudentSearch() {
    const input = document.getElementById('payStudentSearch');
    const results = document.getElementById('payStudentResults');

    input.addEventListener('input', Utils.debounce(async (e) => {
      const query = e.target.value.trim();
      selectedStudent = null;
      document.getElementById('payStudentName').value = '';
      updatePendingPreview(0, 0);
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
            results.innerHTML = '';

            const summary = await getStudentPaymentSummary(student['Student ID']);
            updatePendingPreview(summary.totalPaid, summary.pendingBefore);
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

  async function handleSubmit(e) {
    e.preventDefault();
    const rowIndex = document.getElementById('payRowHidden').value;
    const isEdit = !!rowIndex;

    if (!isEdit && !selectedStudent) {
      Utils.error('Please select a student from the search results.');
      return;
    }

    const totalFee = Number(document.getElementById('payTotalFee').value);
    const received = Number(document.getElementById('payReceived').value);

    if (totalFee < 0) { Utils.error('Total Course Fee cannot be negative.'); return; }
    if (received <= 0) { Utils.error('Payment Received must be greater than zero.'); return; }

    const data = {
      'Job Offer Date': document.getElementById('payJobOfferDate').value,
      'Total Course Fee': totalFee,
      'Payment Received': received,
      'Payment Method': document.getElementById('payMethod').value,
      'Payment Date': document.getElementById('payDate').value
    };
    if (isEdit) data._row = Number(rowIndex);
    else data['Student ID'] = selectedStudent['Student ID'];

    const btn = document.getElementById('paySaveBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

    try {
      if (isEdit) {
        await Api.updatePayment(data);
        Utils.success('Payment updated successfully.');
      } else {
        await Api.savePayment(data);
        Utils.success('Payment recorded successfully.');
      }
      bootstrap.Modal.getInstance(document.getElementById('payModal'))?.hide();
      load();
    } catch (err) {
      Utils.error(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Save';
    }
  }

  async function deletePayment(rowIndex) {
    const ok = await Utils.confirmDialog({
      title: 'Delete this payment?',
      text: 'This payment entry will be permanently removed and balances will be recalculated.',
      confirmText: 'Delete',
      danger: true
    });
    if (!ok) return;

    Utils.showLoading();
    try {
      await Api.deletePayment(rowIndex);
      Utils.success('Payment deleted.');
      load();
    } catch (err) {
      Utils.error(err.message);
    } finally {
      Utils.hideLoading();
    }
  }

  async function fetchAllForExport() {
    const result = await Api.getPayments({ search: state.search, sortBy: state.sortBy, sortDir: state.sortDir, page: 1, pageSize: 100000 });
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
