/**
 * Reports.gs
 * Builds a combined Student + Job Status + Payments view, filterable by
 * date range, course, job status, payment status, and organization.
 * The frontend exports the returned rows to Excel/PDF/CSV.
 */

function action_reports(params) {
  requireSession_(params);
  var filters = params.data || {};

  var students = readAllRows_(getSheet_(SHEET_NAMES.ENQUIRIES));
  var jobs = readAllRows_(getSheet_(SHEET_NAMES.JOBS));
  var payments = readAllRows_(getSheet_(SHEET_NAMES.PAYMENTS));

  var latestJob = latestPerStudent_(jobs);
  var paymentAgg = {};
  payments.forEach(function (p) {
    var id = p['Student ID'];
    if (!paymentAgg[id]) paymentAgg[id] = { received: 0, fee: 0, lastDate: '', lastCreated: '' };
    paymentAgg[id].received += Number(p['Payment Received']) || 0;
    if (String(p['CreatedAt']) >= String(paymentAgg[id].lastCreated)) {
      paymentAgg[id].fee = Number(p['Total Course Fee']) || 0;
      paymentAgg[id].lastCreated = p['CreatedAt'];
    }
    if (String(p['Payment Date']) >= String(paymentAgg[id].lastDate)) {
      paymentAgg[id].lastDate = p['Payment Date'];
    }
  });

  var rows = students.map(function (s) {
    var job = latestJob[s['Student ID']] || {};
    var pay = paymentAgg[s['Student ID']] || { received: 0, fee: 0, lastDate: '' };
    var pending = round2_(Math.max(0, pay.fee - pay.received));
    var paymentStatus = 'No Payment';
    if (pay.fee > 0 || pay.received > 0) {
      if (pending <= 0 && pay.received > 0) paymentStatus = 'Paid';
      else if (pay.received > 0) paymentStatus = 'Partial';
      else paymentStatus = 'Pending';
    }

    return {
      'Student ID': s['Student ID'],
      'Student Name': s['Student Name'],
      'Enquiry Date': s['Enquiry Date'],
      'Course': s['Course'],
      'Mobile Number': s['Mobile Number'],
      'Gmail': s['Gmail'],
      'Job Status': job['Job Status'] || 'Pending',
      'Organization': job['Organization'] || '',
      'Total Course Fee': pay.fee,
      'Payment Received': round2_(pay.received),
      'Pending Amount': pending,
      'Payment Status': paymentStatus,
      'Last Payment Date': pay.lastDate || ''
    };
  });

  if (filters.dateFrom) {
    rows = rows.filter(function (r) { return r['Enquiry Date'] >= filters.dateFrom; });
  }
  if (filters.dateTo) {
    rows = rows.filter(function (r) { return r['Enquiry Date'] <= filters.dateTo; });
  }
  if (filters.course) {
    rows = rows.filter(function (r) { return r['Course'] === filters.course; });
  }
  if (filters.jobStatus) {
    rows = rows.filter(function (r) { return r['Job Status'] === filters.jobStatus; });
  }
  if (filters.paymentStatus) {
    rows = rows.filter(function (r) { return r['Payment Status'] === filters.paymentStatus; });
  }
  if (filters.organization) {
    var org = String(filters.organization).toLowerCase();
    rows = rows.filter(function (r) { return String(r['Organization']).toLowerCase().indexOf(org) !== -1; });
  }

  return { rows: rows, total: rows.length };
}
