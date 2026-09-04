/**
 * api.js
 * Single point of contact with the backend API — same action-based JSON
 * contract whether that's the Google Apps Script Web App (apps-script/,
 * kept in the repo as a reference/fallback) or the TiDB-backed server
 * (tidb-server/, the current production backend; see tidb-server/README.md
 * to deploy your own).
 *
 * IMPORTANT: replace PRODUCTION_API_URL below with your deployed backend's
 * URL — the tidb-server Render URL (…/exec) once deployed, or an Apps
 * Script Web App URL (Deploy > New deployment > Web app) to fall back to
 * that instead.
 *
 * Every request is sent as POST with a text/plain body (a JSON string).
 * This keeps the request a CORS "simple request" so the browser does not
 * send an OPTIONS preflight, which Apps Script web apps cannot answer
 * (tidb-server answers it too, but simple requests skip it anyway).
 *
 * On localhost/127.0.0.1 this automatically points at the zero-dependency
 * mock API in mock-server/server.js instead, so the whole app can be
 * clicked through without any real backend — see README.md "Local
 * testing". Data added while pointed at the mock API lives only in that
 * Node process's memory — it is NOT written to TiDB or Google Sheets.
 *
 * To test a real backend from localhost instead of the mock, visit the
 * page once with ?api=live (the deployed PRODUCTION_API_URL) or
 * ?api=tidb (a tidb-server running locally on :4001 — see
 * tidb-server/README.md) in the URL, e.g.
 * http://localhost:5500/login.html?api=live — this is remembered on this
 * device until you visit with ?api=mock again. A console message on every
 * load states which backend is currently active.
 */

const PRODUCTION_API_URL = 'https://ndr-tidb-api.onrender.com/exec';
const LOCAL_MOCK_API_URL = 'http://localhost:3001/exec';
const LOCAL_TIDB_API_URL = 'http://localhost:4001/exec';

const FORCE_API_STORAGE_KEY = 'ndr_force_api';
const requestedApiMode = new URLSearchParams(location.search).get('api');
if (['live', 'mock', 'tidb'].includes(requestedApiMode)) {
  localStorage.setItem(FORCE_API_STORAGE_KEY, requestedApiMode);
}
const forcedApiMode = localStorage.getItem(FORCE_API_STORAGE_KEY);
const isLocalHost = ['localhost', '127.0.0.1'].includes(location.hostname);
const useMockApi = isLocalHost && forcedApiMode !== 'live' && forcedApiMode !== 'tidb';
const useLocalTidbApi = isLocalHost && forcedApiMode === 'tidb';

const APP_SCRIPT_URL = useMockApi ? LOCAL_MOCK_API_URL : (useLocalTidbApi ? LOCAL_TIDB_API_URL : PRODUCTION_API_URL);

if (isLocalHost) {
  console.info(
    useMockApi
      ? '[NDR EDTECH] Using the LOCAL MOCK backend — data is in-memory only and will NOT appear in TiDB. Add ?api=tidb (local tidb-server) or ?api=live (deployed backend) to switch.'
      : useLocalTidbApi
        ? '[NDR EDTECH] Using a LOCAL tidb-server on :4001 (forced via ?api=tidb). Add ?api=mock to switch back to the local mock.'
        : '[NDR EDTECH] Using the deployed PRODUCTION_API_URL backend (forced via ?api=live). Add ?api=mock to switch back to the local mock.'
  );
}

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
