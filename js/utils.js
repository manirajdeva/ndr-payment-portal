/**
 * utils.js
 * Shared helpers: toasts, dialogs, formatting, validation, export, pagination UI.
 */

const Utils = (() => {
  function toast(icon, title) {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon,
      title,
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true
    });
  }

  function success(title) { toast('success', title); }
  function error(title) { toast('error', title || 'Something went wrong'); }
  function info(title) { toast('info', title); }

  async function confirmDialog({ title, text, confirmText = 'Yes, proceed', danger = false }) {
    const result = await Swal.fire({
      title,
      text,
      icon: danger ? 'warning' : 'question',
      showCancelButton: true,
      confirmButtonText: confirmText,
      cancelButtonText: 'Cancel',
      confirmButtonColor: danger ? '#dc2626' : '#1e5eff',
      cancelButtonColor: '#94a1c7',
      reverseButtons: true
    });
    return result.isConfirmed;
  }

  function showLoading(message = 'Loading...') {
    let overlay = document.getElementById('globalLoadingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'globalLoadingOverlay';
      overlay.className = 'loading-overlay';
      overlay.innerHTML = '<div class="loading-spinner"></div>';
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
  }

  function hideLoading() {
    const overlay = document.getElementById('globalLoadingOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatCurrency(value) {
    const n = Number(value) || 0;
    return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function timeAgo(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 30) return days + 'd ago';
    return formatDate(value);
  }

  function debounce(fn, delay = 350) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  }

  function isValidMobile(mobile) {
    return /^[6-9]\d{9}$/.test(String(mobile || '').trim());
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str === undefined || str === null ? '' : String(str);
    return div.innerHTML;
  }

  /** Client-side placeholder id for a row added optimistically, before the server confirms it. */
  function genTempId() {
    return '_pending_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  /** Renders the "Saving..." cell shown in a row's Actions column while it's unconfirmed. */
  function pendingIndicatorHtml() {
    return `<span class="pending-indicator"><span class="spinner-border spinner-border-sm"></span> Saving...</span>`;
  }

  /** Renders a pagination bar into `container` and wires page clicks to `onPageChange`. */
  function renderPagination(container, { page, totalPages, total, pageSize }, onPageChange) {
    if (!container) return;
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(total, page * pageSize);

    let buttons = '';
    const maxButtons = 5;
    let from = Math.max(1, page - Math.floor(maxButtons / 2));
    let to = Math.min(totalPages, from + maxButtons - 1);
    from = Math.max(1, to - maxButtons + 1);

    buttons += `<button data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;
    for (let p = from; p <= to; p++) {
      buttons += `<button data-page="${p}" class="${p === page ? 'active' : ''}">${p}</button>`;
    }
    buttons += `<button data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>`;

    container.innerHTML = `
      <div>Showing <strong>${start}-${end}</strong> of <strong>${total}</strong> records</div>
      <div class="page-btns">${buttons}</div>
    `;

    container.querySelectorAll('button[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = Number(btn.dataset.page);
        if (p >= 1 && p <= totalPages) onPageChange(p);
      });
    });
  }

  /** Wires clickable sortable <th data-sort="Field"> headers. */
  function wireSortableHeaders(table, currentSort, onSortChange) {
    table.querySelectorAll('th[data-sort]').forEach(th => {
      const field = th.dataset.sort;
      const icon = document.createElement('i');
      icon.className = 'fa-solid fa-sort';
      if (field === currentSort.sortBy) {
        icon.className = currentSort.sortDir === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
      }
      th.querySelector('i')?.remove();
      th.appendChild(icon);
      th.onclick = () => {
        let dir = 'asc';
        if (field === currentSort.sortBy) dir = currentSort.sortDir === 'asc' ? 'desc' : 'asc';
        onSortChange(field, dir);
      };
    });
  }

  /* ---------------- Export helpers ---------------- */

  function exportCSV(rows, columns, filename) {
    const header = columns.map(c => `"${c.label}"`).join(',');
    const lines = rows.map(row =>
      columns.map(c => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const csv = [header, ...lines].join('\n');
    downloadBlob(csv, filename + '.csv', 'text/csv;charset=utf-8;');
  }

  function exportExcel(rows, columns, filename) {
    const data = rows.map(row => {
      const obj = {};
      columns.forEach(c => { obj[c.label] = row[c.key]; });
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, filename + '.xlsx');
  }

  function exportPDF(rows, columns, filename, title) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' });
    doc.setFontSize(14);
    doc.text(title || filename, 14, 16);
    doc.autoTable({
      startY: 22,
      head: [columns.map(c => c.label)],
      body: rows.map(row => columns.map(c => String(row[c.key] ?? ''))),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 94, 255] }
    });
    doc.save(filename + '.pdf');
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return {
    toast, success, error, info, confirmDialog, showLoading, hideLoading,
    todayISO, formatDate, formatDateTime, formatCurrency, timeAgo, debounce,
    isValidEmail, isValidMobile, escapeHtml, genTempId, pendingIndicatorHtml, renderPagination, wireSortableHeaders,
    exportCSV, exportExcel, exportPDF
  };
})();
