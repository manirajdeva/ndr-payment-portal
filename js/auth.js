/**
 * auth.js
 * Session storage (sessionStorage, cleared when the browser tab closes)
 * plus the login/logout flows and a guard used by every protected page.
 */

const Auth = (() => {
  const KEY = 'ndr_session';

  function saveSession({ token, username, role, expiresAt }) {
    sessionStorage.setItem(KEY, JSON.stringify({ token, username, role, expiresAt }));
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session.expiresAt || session.expiresAt < Date.now()) {
        clearSession();
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  function getToken() {
    return getSession()?.token || null;
  }

  function getUsername() {
    return getSession()?.username || null;
  }

  function getRole() {
    return getSession()?.role || null;
  }

  function isAdmin() {
    return getRole() === 'admin';
  }

  function clearSession() {
    sessionStorage.removeItem(KEY);
  }

  function isLoggedIn() {
    return !!getSession();
  }

  /** Call at the top of every protected page. Redirects to login if needed. */
  function guardPage() {
    if (!isLoggedIn()) {
      location.href = 'login.html';
      return false;
    }
    return true;
  }

  /** Periodically checks for expiry so an idle tab still gets redirected. */
  function watchSessionExpiry() {
    setInterval(() => {
      if (!isLoggedIn()) {
        location.href = 'login.html?expired=1';
      }
    }, 30000);
  }

  async function logout() {
    try { await Api.logout(); } catch { /* best-effort */ }
    clearSession();
    location.href = 'login.html';
  }

  return { saveSession, getSession, getToken, getUsername, getRole, isAdmin, clearSession, isLoggedIn, guardPage, watchSessionExpiry, logout };
})();
