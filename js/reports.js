/**
 * reports.js
 * Filterable, exportable report combining enquiries + job status + payments.
 */

const Reports = (() => {
  let currentRows = [];

  const exportColumns = [
    { key: 'Student ID', label: 'Student ID' },
    { key: 'Student Name', label: 'Student Name' },
    { key: 'Enquiry Date', label: 'Enquiry Date' },
    { key: 'Course', label: 'Course' },
    { key: 'Mobile Number', label: 'Mobile Number' },
    { key: 'Job Status', label: 'Job Status' },
    { key: 'Organization', label: 'Organization' },
    { key: 'Total Course Fee', label: 'Total Course Fee' },
    { key: 'Payment Received', label: 'Payment Received' },
    { key: 'Pending Amount', label: 'Pending Amount' },
    { key: 'Payment Status', label: 'Payment Status' }
  ];

  function populateJobStatusDropdown() {
    const select = document.getElementById('rptJobStatus');
    const options = (window.Jobs && Jobs.JOB_STATUS_OPTIONS) || [];
    select.innerHTML = '<option value="">All</option>' + options.map(s => `<option>${s}</option>`).join('');
  }

  function currentFilters() {
    return {
      dateFrom: document.getElementById('rptDateFrom').value,
      dateTo: document.getElementById('rptDateTo').value,
      course: document.getElementById('rptCourse').value.trim(),
      organization: document.getElementById('rptOrganization').value.trim(),
      jobStatus: document.getElementById('rptJobStatus').value,
      paymentStatus: document.getElementById('rptPaymentStatus').value
    };
  }

  async function generate() {
    Utils.showLoading();
    try {
      const { rows, total } = await Api.reports(currentFilters());
      currentRows = rows;
      document.getElementById('rptCount').textContent = total;
      renderTable(rows);
    } catch (err) {
      Utils.error(err.message);
    } finally {
      Utils.hideLoading();
    }
  }

  function renderTable(rows) {
    const tbody = document.getElementById('rptTableBody');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted py-4">No records match the selected filters.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${Utils.escapeHtml(r['Student ID'])}</td>
        <td>${Utils.escapeHtml(r['Student Name'])}</td>
        <td>${Utils.formatDate(r['Enquiry Date'])}</td>
        <td>${Utils.escapeHtml(r['Course'])}</td>
        <td>${Utils.escapeHtml(r['Mobile Number'])}</td>
        <td>${Utils.escapeHtml(r['Job Status'])}</td>
        <td>${Utils.escapeHtml(r['Organization'] || '-')}</td>
        <td>${Utils.formatCurrency(r['Total Course Fee'])}</td>
        <td>${Utils.formatCurrency(r['Payment Received'])}</td>
        <td>${Utils.formatCurrency(r['Pending Amount'])}</td>
        <td>${Utils.escapeHtml(r['Payment Status'])}</td>
      </tr>
    `).join('');
  }

  function wireEvents() {
    document.getElementById('reportFilterForm').addEventListener('submit', (e) => {
      e.preventDefault();
      generate();
    });
    document.getElementById('rptResetBtn').addEventListener('click', () => {
      document.getElementById('reportFilterForm').reset();
      generate();
    });
    document.getElementById('rptExportCsv').addEventListener('click', () => Utils.exportCSV(currentRows, exportColumns, 'report'));
    document.getElementById('rptExportExcel').addEventListener('click', () => Utils.exportExcel(currentRows, exportColumns, 'report'));
    document.getElementById('rptExportPdf').addEventListener('click', () => Utils.exportPDF(currentRows, exportColumns, 'report', 'NDR EDTECH Report'));
  }

  function init() {
    populateJobStatusDropdown();
    wireEvents();
  }

  return { init, generate };
})();

document.addEventListener('DOMContentLoaded', () => {
  Reports.init();
  App.onSectionActivate('reports', () => Reports.generate());
});
