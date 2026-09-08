/**
 * settings.js
 * Settings section — User Management (admin only).
 *
 * Portal logins live in the backend `users` table and come in two roles:
 *   admin    — full access, including adding/removing other users
 *   employee — can view every section and add new records, but can never
 *              edit or delete anything, and cannot manage users
 * ('hr' is an older name for the same create-only permission set and is
 * still accepted at login; the UI only offers admin / employee.)
 *
 * Unlike the record tables this is a low-traffic screen, so it just
 * reloads the list after each change instead of doing optimistic UI.
 */

const Settings = (() => {
  let cache = [];
  let wired = false;

  const ACCESS_TEXT = {
    admin: 'Add, edit, delete, manage users',
    employee: 'Enquiries & Job Status: add/edit/delete · no Payments · no user management',
    hr: 'Enquiries & Job Status: add/edit/delete · no Payments · no user management',
    viewer: 'View only'
  };

  function roleLabel(role) {
    return role === 'hr' ? 'employee' : role;
  }

  async function load() {
    if (!Auth.isAdmin()) return; // the whole card is hidden for non-admins
    const tbody = document.getElementById('userTableBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Loading users...</td></tr>`;
    try {
      const { rows } = await Api.listUsers();
      cache = rows || [];
      renderTable(cache);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">${Utils.escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderTable(rows) {
    const tbody = document.getElementById('userTableBody');
    const me = Auth.getUsername();
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No users found.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(u => {
      const isMe = u.username === me;
      const idAttr = Utils.escapeHtml(String(u.id));
      return `
      <tr>
        <td class="fw-semibold">${Utils.escapeHtml(u.username)}${isMe ? ' <span class="text-muted fw-normal">(you)</span>' : ''}</td>
        <td>${Utils.escapeHtml(roleLabel(u.role))}</td>
        <td class="text-muted small">${Utils.escapeHtml(ACCESS_TEXT[u.role] || '—')}</td>
        <td class="text-muted small">${u.createdAt ? Utils.formatDate(u.createdAt) : '—'}</td>
        <td>
          <button class="btn-sm-icon edit" data-action="edit" data-id="${idAttr}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          ${isMe ? '' : `<button class="btn-sm-icon delete" data-action="delete" data-id="${idAttr}" title="Delete"><i class="fa-solid fa-trash"></i></button>`}
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', () => openEditModal(btn.dataset.id)));
    tbody.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', () => deleteUser(btn.dataset.id)));
  }

  function openAddModal() {
    document.getElementById('userModalTitle').textContent = 'Add User';
    document.getElementById('userForm').reset();
    document.getElementById('userIdHidden').value = '';
    document.getElementById('userUsername').readOnly = false;
    document.getElementById('userRole').value = 'employee';
    document.getElementById('userPasswordLabel').innerHTML = 'Password <span class="text-danger">*</span>';
    document.getElementById('userPasswordHint').textContent = 'At least 6 characters.';
    resetPasswordVisibility();
    new bootstrap.Modal('#userModal').show();
  }

  function openEditModal(id) {
    const user = cache.find(u => String(u.id) === String(id));
    if (!user) return;
    document.getElementById('userModalTitle').textContent = 'Edit User';
    document.getElementById('userForm').reset();
    document.getElementById('userIdHidden').value = user.id;
    document.getElementById('userUsername').value = user.username;
    document.getElementById('userUsername').readOnly = true; // renaming = a different login; add a new user instead
    document.getElementById('userRole').value = user.role === 'hr' ? 'employee' : user.role;
    document.getElementById('userPasswordLabel').textContent = 'New password';
    document.getElementById('userPasswordHint').textContent = 'Leave blank to keep the current password. At least 6 characters otherwise.';
    resetPasswordVisibility();
    new bootstrap.Modal('#userModal').show();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('userIdHidden').value;
    const username = document.getElementById('userUsername').value.trim();
    const role = document.getElementById('userRole').value;
    const password = document.getElementById('userPassword').value;

    if (!id && username.length < 3) { Utils.error('Username must be at least 3 characters.'); return; }
    if (!id && password.length < 6) { Utils.error('Password must be at least 6 characters.'); return; }
    if (id && password && password.length < 6) { Utils.error('Password must be at least 6 characters.'); return; }

    const btn = document.getElementById('userSaveBtn');
    btn.disabled = true;
    try {
      if (id) {
        const payload = { id: Number(id), role };
        if (password) payload.password = password;
        await Api.updateUser(payload);
        Utils.success('User updated.');
      } else {
        await Api.addUser({ username, role, password });
        Utils.success('User added.');
      }
      bootstrap.Modal.getInstance(document.getElementById('userModal'))?.hide();
      load();
    } catch (err) {
      Utils.error(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteUser(id) {
    const user = cache.find(u => String(u.id) === String(id));
    if (!user) return;
    const ok = await Utils.confirmDialog({
      title: 'Delete this user?',
      text: `${user.username} will no longer be able to log in. This cannot be undone.`,
      confirmText: 'Delete',
      danger: true
    });
    if (!ok) return;
    try {
      await Api.deleteUser(Number(id));
      Utils.success('User deleted.');
      load();
    } catch (err) {
      Utils.error(err.message);
    }
  }

  function wirePasswordToggle() {
    const btn = document.getElementById('userTogglePassword');
    const input = document.getElementById('userPassword');
    if (!btn || !input) return;
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.querySelector('i').className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
    });
  }

  /** Reset the password field back to hidden whenever the modal is (re)opened. */
  function resetPasswordVisibility() {
    const input = document.getElementById('userPassword');
    const icon = document.querySelector('#userTogglePassword i');
    if (input) input.type = 'password';
    if (icon) icon.className = 'fa-solid fa-eye';
  }

  function init() {
    if (wired) return;
    const addBtn = document.getElementById('userAddBtn');
    const form = document.getElementById('userForm');
    if (!addBtn || !form) return;
    addBtn.addEventListener('click', openAddModal);
    form.addEventListener('submit', handleSubmit);
    wirePasswordToggle();
    wired = true;
  }

  return { init, load };
})();

document.addEventListener('DOMContentLoaded', () => {
  Settings.init();
  App.onSectionActivate('settings', () => Settings.load());
});
