/**
 * Dashboard.gs
 * Aggregates numbers across all three sheets for the dashboard cards,
 * charts, and recent-activity feed.
 */

function action_dashboardStats(params) {
  requireSession_(params);

  var students = readAllRows_(getSheet_(SHEET_NAMES.ENQUIRIES));
  var jobs = readAllRows_(getSheet_(SHEET_NAMES.JOBS));
  var payments = readAllRows_(getSheet_(SHEET_NAMES.PAYMENTS));

  var today = todayStr_();
  var thisMonth = monthKey_(today);

  var todaysEnquiries = students.filter(function (s) { return s['Enquiry Date'] === today; }).length;
  var newEnquiries = students.filter(function (s) { return monthKey_(s['Enquiry Date']) === thisMonth; }).length;

  var latestJobByStudent = latestPerStudent_(jobs);
  var placedStatuses = ['Selected', 'Offer Received', 'Joined'];
  var studentsJoined = 0, studentsPlaced = 0, rejected = 0;
  var placementCounts = {};
  JOB_STATUS_OPTIONS.forEach(function (s) { placementCounts[s] = 0; });

  Object.keys(latestJobByStudent).forEach(function (id) {
    var status = latestJobByStudent[id]['Job Status'];
    if (placementCounts.hasOwnProperty(status)) placementCounts[status]++;
    if (status === 'Joined') studentsJoined++;
    if (placedStatuses.indexOf(status) !== -1) studentsPlaced++;
    if (status === 'Rejected') rejected++;
  });
  var pendingPlacements = Math.max(0, students.length - studentsPlaced - rejected);

  var totalPayments = 0;
  var paymentsByStudent = {};
  payments.forEach(function (p) {
    totalPayments += Number(p['Payment Received']) || 0;
    var id = p['Student ID'];
    if (!paymentsByStudent[id]) paymentsByStudent[id] = { received: 0, fee: 0, lastCreated: '' };
    paymentsByStudent[id].received += Number(p['Payment Received']) || 0;
    if (String(p['CreatedAt']) >= String(paymentsByStudent[id].lastCreated)) {
      paymentsByStudent[id].fee = Number(p['Total Course Fee']) || 0;
      paymentsByStudent[id].lastCreated = p['CreatedAt'];
    }
  });
  var pendingPayments = 0;
  Object.keys(paymentsByStudent).forEach(function (id) {
    var rec = paymentsByStudent[id];
    pendingPayments += Math.max(0, round2_(rec.fee - rec.received));
  });

  return {
    totalStudents: students.length,
    newEnquiries: newEnquiries,
    studentsJoined: studentsJoined,
    studentsPlaced: studentsPlaced,
    pendingPlacements: pendingPlacements,
    totalPayments: round2_(totalPayments),
    pendingPayments: round2_(pendingPayments),
    todaysEnquiries: todaysEnquiries,
    recentActivities: buildRecentActivities_(students, jobs, payments),
    monthlyAdmissions: monthlySeries_(students, 'Enquiry Date', null),
    monthlyRevenue: monthlySeries_(payments, 'Payment Date', 'Payment Received'),
    placementStatistics: placementCounts
  };
}

function latestPerStudent_(jobRows) {
  var map = {};
  jobRows.forEach(function (row) {
    var id = row['Student ID'];
    var existing = map[id];
    if (!existing || String(row['UpdatedAt'] || row['CreatedAt']) >= String(existing['UpdatedAt'] || existing['CreatedAt'])) {
      map[id] = row;
    }
  });
  return map;
}

function buildRecentActivities_(students, jobs, payments) {
  var activities = [];
  students.forEach(function (s) {
    activities.push({
      type: 'Enquiry',
      icon: 'fa-user-plus',
      text: 'New enquiry from ' + s['Student Name'] + ' (' + s['Student ID'] + ')',
      at: s['CreatedAt'] || s['Enquiry Date']
    });
  });
  jobs.forEach(function (j) {
    activities.push({
      type: 'Job Status',
      icon: 'fa-briefcase',
      text: j['Student Name'] + ' (' + j['Student ID'] + ') marked as ' + j['Job Status'],
      at: j['UpdatedAt'] || j['CreatedAt']
    });
  });
  payments.forEach(function (p) {
    activities.push({
      type: 'Payment',
      icon: 'fa-indian-rupee-sign',
      text: p['Student Name'] + ' (' + p['Student ID'] + ') paid ' + p['Payment Received'] + ' via ' + p['Payment Method'],
      at: p['CreatedAt']
    });
  });
  activities.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  return activities.slice(0, 15);
}

function monthlySeries_(rows, dateField, sumField) {
  var buckets = {};
  var months = last6Months_();
  months.forEach(function (m) { buckets[m] = 0; });
  rows.forEach(function (row) {
    var key = monthKey_(row[dateField]);
    if (key === null || !buckets.hasOwnProperty(key)) return;
    buckets[key] += sumField ? (Number(row[sumField]) || 0) : 1;
  });
  return months.map(function (m) { return { month: m, value: round2_(buckets[m]) }; });
}

function last6Months_() {
  var months = [];
  var d = new Date();
  for (var i = 5; i >= 0; i--) {
    var dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(Utilities.formatDate(dt, Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM'));
  }
  return months;
}
