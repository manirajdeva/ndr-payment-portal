/**
 * Code.gs
 * Entry points for the web app. The frontend sends every request as an
 * HTTP POST with a text/plain body (to keep requests CORS "simple" and
 * avoid the OPTIONS preflight that Apps Script web apps cannot answer).
 * doGet is kept only as a convenience for manual testing in a browser.
 */

var ACTIONS = {
  login: action_login,
  logout: action_logout,
  generateStudentID: action_generateStudentID,
  getStudents: action_getStudents,
  addStudent: action_addStudent,
  updateStudent: action_updateStudent,
  deleteStudent: action_deleteStudent,
  searchStudent: action_searchStudent,
  getJobStatus: action_getJobStatus,
  saveJobStatus: action_saveJobStatus,
  updateJobStatus: action_updateJobStatus,
  deleteJobStatus: action_deleteJobStatus,
  getPayments: action_getPayments,
  savePayment: action_savePayment,
  updatePayment: action_updatePayment,
  deletePayment: action_deletePayment,
  dashboardStats: action_dashboardStats,
  reports: action_reports
};

function doPost(e) {
  return handleRequest_(parseRequestParams_(e));
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (!params.action) {
    return jsonOutput_({ success: true, message: 'NDR EDTECH Student Portal API is running.' });
  }
  return handleRequest_(params);
}

function parseRequestParams_(e) {
  try {
    if (e && e.postData && e.postData.contents) {
      var body = JSON.parse(e.postData.contents);
      return body || {};
    }
  } catch (parseErr) {
    // fall through to query params
  }
  return (e && e.parameter) || {};
}

function handleRequest_(params) {
  try {
    var action = params.action;
    if (!action || !ACTIONS.hasOwnProperty(action)) {
      throw new AppError_('UNKNOWN_ACTION', 'Unknown action: ' + action);
    }
    var result = ACTIONS[action](params);
    return jsonOutput_(successResponse_(result));
  } catch (err) {
    return jsonOutput_(errorResponse_(err));
  }
}
