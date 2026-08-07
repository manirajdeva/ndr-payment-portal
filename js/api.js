/**
 * api.js
 * Single point of contact with the Google Apps Script Web App.
 *
 * IMPORTANT: replace PRODUCTION_APP_SCRIPT_URL below with your deployed Web
 * App URL (Deploy > New deployment > Web app). See README.md for full steps.
 *
 * Every request is sent as POST with a text/plain body (a JSON string).
 * This keeps the request a CORS "simple request" so the browser does not
 * send an OPTIONS preflight, which Apps Script web apps cannot answer.
 *
 * On localhost/127.0.0.1 this automatically points at the zero-dependency
 * mock API in mock-server/server.js instead, so the whole app can be
 * clicked through without a Google account — see README.md "Local testing".
 */

const PRODUCTION_APP_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxXPv0ylbo6CRK2lt3xLahnDauEOoBRUr8jvdSujEMEh5EWAemBNCS-8JINudN86Cj0/exec';
const LOCAL_MOCK_API_URL = 'http://localhost:3001/exec';

const APP_SCRIPT_URL = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? LOCAL_MOCK_API_URL
  : PRODUCTION_APP_SCRIPT_URL;

const Api = (() => {
  async function call(action, params = {}) {
    const token = Auth.getToken();
    const body = Object.assign({ action, token }, params);

    let response;
    try {
      response = await fetch(APP_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
    } catch (networkErr) {
      throw new ApiError('NETWORK_ERROR', 'Unable to reach the server. Check your internet connection or the API URL in js/api.js.');
    }

    let json;
    try {
      json = await response.json();
    } catch (parseErr) {
      throw new ApiError('BAD_RESPONSE', 'Received an unexpected response from the server.');
    }

    if (!json.success) {
      const code = json.error?.code || 'UNKNOWN_ERROR';
      const message = json.error?.message || 'Something went wrong.';
      if (code === 'SESSION_EXPIRED') {
        Auth.clearSession();
        if (!location.pathname.endsWith('login.html')) {
          Utils.error('Your session has expired. Please log in again.');
          setTimeout(() => (location.href = 'login.html'), 1200);
        }
      }
      throw new ApiError(code, message);
    }
    return json.data;
  }

  return {
    login: (username, password) => call('login', { username, password }),
    logout: () => call('logout'),

    generateStudentID: () => call('generateStudentID'),
    getStudents: (opts) => call('getStudents', opts),
    addStudent: (data) => call('addStudent', { data }),
    updateStudent: (data) => call('updateStudent', { data }),
    deleteStudent: (studentId) => call('deleteStudent', { data: { 'Student ID': studentId } }),
    searchStudent: (query) => call('searchStudent', { query }),

    getJobStatus: (opts) => call('getJobStatus', opts),
    saveJobStatus: (data) => call('saveJobStatus', { data }),
    updateJobStatus: (data) => call('updateJobStatus', { data }),
    deleteJobStatus: (row) => call('deleteJobStatus', { data: { _row: row } }),

    getPayments: (opts) => call('getPayments', opts),
    savePayment: (data) => call('savePayment', { data }),
    updatePayment: (data) => call('updatePayment', { data }),
    deletePayment: (row) => call('deletePayment', { data: { _row: row } }),

    dashboardStats: () => call('dashboardStats'),
    reports: (filters) => call('reports', { data: filters })
  };
})();

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
