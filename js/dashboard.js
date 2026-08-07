/**
 * dashboard.js
 * App shell: auth guard, sidebar navigation, theme toggle, logout, and the
 * Dashboard section itself (stat cards, charts, recent activity).
 * Also exposes `App` — a tiny router other module scripts (enquiries.js,
 * jobs.js, payments.js, reports.js) hook into via App.onSectionActivate().
 */

const App = (() => {
  const sectionTitles = {
    dashboard: ['Dashboard', "Overview of your institute's performance"],
    enquiries: ['Student Enquiries', 'Manage student enquiries and admissions'],
    jobs: ['Job Status', 'Track placement progress for every student'],
    payments: ['Payments', 'Record and track course fee payments'],
    reports: ['Reports', 'Filter and export institute-wide data'],
    settings: ['Settings', 'Account and appearance preferences']
  };

  const activateCallbacks = {};

  function onSectionActivate(name, fn) {
    activateCallbacks[name] = fn;
  }

  function showSection(name) {
    document.querySelectorAll('.app-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.sidebar-nav .nav-link').forEach(el => el.classList.remove('active'));

    document.getElementById('section-' + name)?.classList.add('active');
    document.querySelector(`.sidebar-nav .nav-link[data-section="${name}"]`)?.classList.add('active');

    const [title, subtitle] = sectionTitles[name] || ['', ''];
    document.getElementById('pageTitle').textContent = title;
    document.getElementById('pageSubtitle').textContent = subtitle;

    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarBackdrop').classList.remove('show');

    if (activateCallbacks[name]) activateCallbacks[name]();
  }

  function wireShell() {
    document.querySelectorAll('.sidebar-nav .nav-link[data-section]').forEach(link => {
      link.addEventListener('click', () => showSection(link.dataset.section));
    });

    document.getElementById('sidebarToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebarBackdrop').classList.toggle('show');
    });
    document.getElementById('sidebarBackdrop').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebarBackdrop').classList.remove('show');
    });

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      const ok = await Utils.confirmDialog({ title: 'Log out?', text: 'You will need to log in again to access the portal.', confirmText: 'Log out', danger: true });
      if (ok) Auth.logout();
    });

    wireTheme();
    wireUserInfo();
  }

  function wireTheme() {
    const stored = localStorage.getItem('ndr_theme');
    if (stored) document.documentElement.setAttribute('data-theme', stored);
    setThemeIcon();

    document.getElementById('themeToggle').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') ||
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
    document.getElementById('settingsLightBtn')?.addEventListener('click', () => applyTheme('light'));
    document.getElementById('settingsDarkBtn')?.addEventListener('click', () => applyTheme('dark'));

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('ndr_theme', theme);
      setThemeIcon();
    }
    function setThemeIcon() {
      const current = document.documentElement.getAttribute('data-theme') ||
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const icon = document.querySelector('#themeToggle i');
      if (icon) icon.className = current === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
  }

  function wireUserInfo() {
    const username = Auth.getUsername() || 'Admin';
    document.getElementById('userName').textContent = username;
    document.getElementById('userInitial').textContent = username.charAt(0).toUpperCase();
    document.getElementById('settingsUsername').textContent = username;

    const session = Auth.getSession();
    if (session) {
      document.getElementById('settingsExpiry').textContent = new Date(session.expiresAt).toLocaleString('en-IN');
    }
  }

  return { onSectionActivate, showSection, wireShell };
})();

/* ---------------- Dashboard section ---------------- */

const Dashboard = (() => {
  let charts = {};

  const statConfig = [
    { key: 'totalStudents', label: 'Total Students', icon: 'fa-users', bg: 'bg-grad-blue' },
    { key: 'newEnquiries', label: 'New Enquiries (This Month)', icon: 'fa-user-plus', bg: 'bg-grad-cyan' },
    { key: 'studentsJoined', label: 'Students Joined', icon: 'fa-briefcase', bg: 'bg-grad-green' },
    { key: 'studentsPlaced', label: 'Students Placed', icon: 'fa-award', bg: 'bg-grad-purple' },
    { key: 'pendingPlacements', label: 'Pending Placements', icon: 'fa-hourglass-half', bg: 'bg-grad-orange' },
    { key: 'totalPayments', label: 'Total Payments', icon: 'fa-indian-rupee-sign', bg: 'bg-grad-green', currency: true },
    { key: 'pendingPayments', label: 'Pending Payments', icon: 'fa-triangle-exclamation', bg: 'bg-grad-red', currency: true },
    { key: 'todaysEnquiries', label: "Today's Enquiries", icon: 'fa-calendar-day', bg: 'bg-grad-blue' }
  ];

  async function load() {
    const row = document.getElementById('statCardsRow');
    row.innerHTML = statConfig.map(() => skeletonCard()).join('');

    try {
      const stats = await Api.dashboardStats();
      renderStatCards(stats);
      renderAdmissionsChart(stats.monthlyAdmissions);
      renderRevenueChart(stats.monthlyRevenue);
      renderPlacementChart(stats.placementStatistics);
      renderRecentActivities(stats.recentActivities);
    } catch (err) {
      Utils.error(err.message);
    }
  }

  function skeletonCard() {
    return `<div class="col-6 col-lg-3"><div class="stat-card"><div class="stat-icon bg-grad-blue"><i class="fa-solid fa-spinner fa-spin"></i></div><div><div class="stat-value">-</div><div class="stat-label">Loading...</div></div></div></div>`;
  }

  function renderStatCards(stats) {
    const row = document.getElementById('statCardsRow');
    row.innerHTML = statConfig.map(cfg => {
      const raw = stats[cfg.key] ?? 0;
      const value = cfg.currency ? Utils.formatCurrency(raw) : raw;
      return `
        <div class="col-6 col-lg-3">
          <div class="stat-card">
            <div class="stat-icon ${cfg.bg}"><i class="fa-solid ${cfg.icon}"></i></div>
            <div>
              <div class="stat-value">${value}</div>
              <div class="stat-label">${cfg.label}</div>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  function monthLabel(ym) {
    const [y, m] = ym.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  }

  function renderAdmissionsChart(series) {
    const ctx = document.getElementById('admissionsChart');
    charts.admissions?.destroy();
    charts.admissions = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: series.map(s => monthLabel(s.month)),
        datasets: [{ label: 'Enquiries', data: series.map(s => s.value), backgroundColor: '#1e5eff', borderRadius: 6 }]
      },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }

  function renderRevenueChart(series) {
    const ctx = document.getElementById('revenueChart');
    charts.revenue?.destroy();
    charts.revenue = new Chart(ctx, {
      type: 'line',
      data: {
        labels: series.map(s => monthLabel(s.month)),
        datasets: [{
          label: 'Revenue',
          data: series.map(s => s.value),
          borderColor: '#0ea5e9',
          backgroundColor: 'rgba(14,165,233,0.15)',
          fill: true,
          tension: 0.35
        }]
      },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }

  function renderPlacementChart(counts) {
    const ctx = document.getElementById('placementChart');
    const labels = Object.keys(counts);
    const colors = ['#94a3b8', '#38bdf8', '#a78bfa', '#22d3ee', '#4ade80', '#1e5eff', '#16a34a', '#dc2626'];
    charts.placement?.destroy();
    charts.placement = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: labels.map(l => counts[l]), backgroundColor: colors }] },
      options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } } }
    });
  }

  function renderRecentActivities(activities) {
    const container = document.getElementById('recentActivitiesList');
    if (!activities.length) {
      container.innerHTML = '<p class="text-muted small mb-0">No recent activity yet.</p>';
      return;
    }
    container.innerHTML = activities.map(a => `
      <div class="d-flex align-items-start gap-3 py-2 border-bottom">
        <div class="stat-icon bg-grad-blue" style="width:36px;height:36px;font-size:0.85rem;">
          <i class="fa-solid ${Utils.escapeHtml(a.icon)}"></i>
        </div>
        <div class="flex-grow-1">
          <div class="small">${Utils.escapeHtml(a.text)}</div>
          <div class="text-muted" style="font-size:0.72rem;">${Utils.timeAgo(a.at)}</div>
        </div>
      </div>
    `).join('');
  }

  return { load };
})();

document.addEventListener('DOMContentLoaded', () => {
  if (!Auth.guardPage()) return;
  Auth.watchSessionExpiry();

  App.wireShell();
  App.onSectionActivate('dashboard', Dashboard.load);
  App.showSection('dashboard');
});
