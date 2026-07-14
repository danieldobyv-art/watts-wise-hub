/* ============================================================
   AI Energy Auditing System — Dashboard Script
   All values are simulated. Replace generators with ESP32
   sensor data / API calls when the backend is available.
   ============================================================ */

// ---------- Utilities ----------
const $ = (id) => document.getElementById(id);
const rand = (min, max, dec = 1) => +(Math.random() * (max - min) + min).toFixed(dec);
const fmt = (n) => n.toLocaleString();

// ---------- Live date/time ----------
function updateClock() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  $('liveDate').textContent = dateStr;
  $('liveClock').textContent = timeStr;
  $('chartDate').textContent = dateStr;
  $('sidebarUpdated').textContent = `${dateStr}  ${timeStr}`;
}

// ---------- Sidebar (mobile) ----------
function initSidebar() {
  $('menuBtn').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
      el.classList.add('active');
      $('sidebar').classList.remove('open');
    });
  });
}

// ---------- Dark mode ----------
function initTheme() {
  const btn = $('themeToggle');
  const saved = localStorage.getItem('aieas-theme');
  if (saved === 'dark') document.body.classList.add('dark');
  syncThemeIcon();
  btn.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('aieas-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
    syncThemeIcon();
  });
}
function syncThemeIcon() {
  const icon = document.querySelector('#themeToggle i');
  icon.className = document.body.classList.contains('dark') ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
}

// ---------- Chart palette helpers ----------
function gradient(ctx, color) {
  const g = ctx.createLinearGradient(0, 0, 0, 260);
  g.addColorStop(0, color + 'aa');
  g.addColorStop(1, color + '05');
  return g;
}

// ---------- Today's hourly usage (line chart) ----------
let usageChart;
function buildUsageData() {
  // Simulate a residential day: low overnight, morning bump, evening peak
  const base = [180, 160, 150, 140, 140, 160, 260, 480, 620, 700, 780, 900,
                950, 880, 820, 900, 1050, 1250, 1450, 1500, 1300, 900, 600, 320];
  return base.map((v) => Math.round(v + rand(-60, 60, 0)));
}
function initUsageChart() {
  const ctx = $('usageChart').getContext('2d');
  const hours = Array.from({ length: 24 }, (_, i) => {
    const h = i % 12 || 12; return `${h} ${i < 12 ? 'AM' : 'PM'}`;
  });
  usageChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: hours,
      datasets: [{
        label: 'Power (W)',
        data: buildUsageData(),
        borderColor: '#22c55e',
        backgroundColor: gradient(ctx, '#22c55e'),
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: '#22c55e',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0d1f17', padding: 12, cornerRadius: 10,
          titleFont: { family: 'Poppins', weight: '600' },
          bodyFont: { family: 'Poppins' },
          callbacks: { label: (c) => ` ${fmt(c.parsed.y)} W` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#6b7a74', font: { family: 'Poppins', size: 11 } } },
        y: { grid: { color: '#eef2f0' }, ticks: { color: '#6b7a74', font: { family: 'Poppins', size: 11 },
              callback: (v) => v + ' W' } },
      },
    },
  });
}

// ---------- Weekly bar chart ----------
let weeklyChart;
function initWeeklyChart() {
  const ctx = $('weeklyChart').getContext('2d');
  const labels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }
  const data = [8.2, 7.6, 9.1, 8.7, 10.3, 9.8, 8.4];
  weeklyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'kWh',
        data,
        backgroundColor: '#22c55e',
        hoverBackgroundColor: '#16a34a',
        borderRadius: 8,
        maxBarThickness: 34,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0d1f17', padding: 10, cornerRadius: 10,
          callbacks: { label: (c) => ` ${c.parsed.y} kWh` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#6b7a74', font: { family: 'Poppins', size: 11 } } },
        y: { grid: { color: '#eef2f0' }, ticks: { color: '#6b7a74', font: { family: 'Poppins', size: 11 } } },
      },
    },
  });
}

// ---------- Sparkline in "Current Power" card ----------
let sparkChart;
function initSpark() {
  const ctx = $('sparkPower').getContext('2d');
  sparkChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array.from({ length: 12 }, (_, i) => i),
      datasets: [{
        data: Array.from({ length: 12 }, () => rand(1100, 1400, 0)),
        borderColor: '#22c55e', borderWidth: 2, tension: 0.4,
        pointRadius: 0, fill: true,
        backgroundColor: gradient(ctx, '#22c55e'),
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
}

// ---------- AI Recommendations ----------
const RECS = [
  { t: 'warn',  text: 'Reduce electricity usage between 6 PM – 9 PM (peak hours).' },
  { t: 'info',  text: 'Consumption increased 4.2% compared to yesterday.' },
  { t: 'good',  text: 'Power usage is within the efficient range today.' },
  { t: 'warn',  text: 'Avoid running multiple high-load devices simultaneously.' },
  { t: 'good',  text: 'Estimated monthly bill is below your neighborhood average.' },
  { t: 'alert', text: 'Standby power detected overnight — unplug idle devices.' },
  { t: 'info',  text: 'Shifting laundry to off-peak hours could save ₱120/month.' },
];
const ICONS = {
  warn:  'fa-solid fa-triangle-exclamation',
  info:  'fa-solid fa-circle-info',
  good:  'fa-solid fa-circle-check',
  alert: 'fa-solid fa-bolt',
};
function renderRecs() {
  const pool = [...RECS].sort(() => Math.random() - 0.5).slice(0, 4);
  $('recList').innerHTML = pool.map((r) => `
    <li class="rec-item ${r.t}">
      <div class="rec-icon"><i class="${ICONS[r.t]}"></i></div>
      <p>${r.text}</p>
    </li>`).join('');
}

// ---------- Live electrical parameters ----------
function updateLiveParams() {
  const voltage = rand(220, 235);
  const current = rand(4.8, 6.2, 2);
  const power = Math.round(voltage * current * rand(0.92, 0.98, 2));
  const pf = rand(0.92, 0.99, 2);
  const freq = rand(59.8, 60.2, 2);

  animateNumber('pVolt', voltage, 0);
  $('pCurr').textContent = current;
  animateNumber('pPow', power, 0);
  $('pPF').textContent = pf;
  $('pFreq').textContent = freq;

  // Update top "Current Power" metric
  $('metricPower').innerHTML = `${fmt(power)} <small>W</small>`;

  // Update sparkline
  const arr = sparkChart.data.datasets[0].data;
  arr.shift(); arr.push(power);
  sparkChart.update('none');

  // Update today chart's current hour
  const hr = new Date().getHours();
  usageChart.data.datasets[0].data[hr] = power;
  usageChart.update('none');

  updateEfficiency(power, pf);
  updateAudit(power);
}

// ---------- Efficiency score + AI audit status ----------
function updateEfficiency(power, pf) {
  // Simulated score: high PF + moderate power = better score
  let score = Math.round(pf * 100 - Math.max(0, (power - 1200) / 20));
  score = Math.max(45, Math.min(99, score));

  $('effScore').textContent = score;
  $('effRingVal').textContent = score;
  const ring = $('effRing');
  ring.style.setProperty('--val', score);

  let color = 'var(--green-500)', note = 'Excellent efficiency rating';
  if (score < 60) { color = 'var(--red-500)'; note = 'Low efficiency — review usage'; }
  else if (score < 80) { color = 'var(--amber-500)'; note = 'Moderate efficiency — room to improve'; }
  ring.style.setProperty('--ring-color', color);
  $('effNote').textContent = note;
}

function updateAudit(power) {
  const el = $('auditStatus'), note = $('auditNote'), circle = $('auditCircle');
  circle.classList.remove('moderate', 'high');
  let status = 'Normal', msg = 'No unusual consumption detected', icon = 'fa-regular fa-face-smile', color = 'var(--green-600)';

  if (power > 1600) {
    status = 'High Consumption'; msg = 'Unusual spike detected — investigate loads';
    icon = 'fa-solid fa-triangle-exclamation'; color = 'var(--red-500)';
    circle.classList.add('high');
  } else if (power > 1350) {
    status = 'Moderate'; msg = 'Slightly above baseline for this hour';
    icon = 'fa-solid fa-gauge-high'; color = 'var(--amber-500)';
    circle.classList.add('moderate');
  } else if (power < 500) {
    status = 'Excellent'; msg = 'Low, efficient consumption';
    icon = 'fa-regular fa-face-grin-stars';
  }
  el.textContent = status;
  el.style.color = color;
  note.textContent = msg;
  circle.querySelector('i').className = icon;
}

// ---------- Smooth number animation ----------
function animateNumber(id, target, decimals = 0) {
  const el = $(id);
  const start = parseFloat(el.textContent.replace(/,/g, '')) || 0;
  const diff = target - start;
  const steps = 20; let i = 0;
  clearInterval(el._anim);
  el._anim = setInterval(() => {
    i++;
    const v = start + (diff * i) / steps;
    el.textContent = decimals ? v.toFixed(decimals) : fmt(Math.round(v));
    if (i >= steps) clearInterval(el._anim);
  }, 20);
}

// ---------- Bootstrap ----------
function init() {
  updateClock();
  initSidebar();
  initTheme();
  initSpark();
  initUsageChart();
  initWeeklyChart();
  renderRecs();
  updateLiveParams();

  setInterval(updateClock, 1000);
  setInterval(updateLiveParams, 3000);
  setInterval(renderRecs, 15000);
}

document.addEventListener('DOMContentLoaded', init);
