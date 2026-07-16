/* ============================================================
   AI Energy Auditing System — Dashboard (Live Firebase Data)
   Data flow:
     PZEM-004T v4  →  ESP32  →  Firebase Realtime Database  →  this dashboard
   All configurable values live in config.js (window.AIEAS_CONFIG).
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, get, child,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Load config synchronously via a plain <script> tag would be cleaner, but
// with modules we import the global set by config.js. We include config.js
// via a <script> tag in index.html — but to keep index.html tidy we load it
// here dynamically so it's available before we init Firebase.
await new Promise((resolve, reject) => {
  const s = document.createElement("script");
  s.src = "config.js";
  s.onload = resolve;
  s.onerror = () => reject(new Error("Failed to load config.js"));
  document.head.appendChild(s);
});

const CFG = window.AIEAS_CONFIG;
if (!CFG) throw new Error("AIEAS_CONFIG missing — check config.js");

// ---------- Utilities ----------
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmt2 = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayKey = () => new Date().toISOString().slice(0, 10);       // YYYY-MM-DD
const monthKey = () => new Date().toISOString().slice(0, 7);        // YYYY-MM

// ---------- Live clock ----------
function updateClock() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  $('liveDate').textContent = dateStr;
  $('liveClock').textContent = timeStr;
  $('chartDate').textContent = dateStr;
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

// ---------- Chart helpers ----------
function gradient(ctx, color) {
  const g = ctx.createLinearGradient(0, 0, 0, 260);
  g.addColorStop(0, color + 'aa');
  g.addColorStop(1, color + '05');
  return g;
}

// ---------- Charts ----------
let usageChart, weeklyChart, sparkChart;

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
        data: new Array(24).fill(null),
        borderColor: '#22c55e',
        backgroundColor: gradient(ctx, '#22c55e'),
        borderWidth: 2.5, fill: true, tension: 0.4,
        pointRadius: 3, pointHoverRadius: 6,
        pointBackgroundColor: '#22c55e',
        pointBorderColor: '#fff', pointBorderWidth: 2,
        spanGaps: true,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0d1f17', padding: 12, cornerRadius: 10,
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

function initWeeklyChart() {
  const ctx = $('weeklyChart').getContext('2d');
  const labels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }
  weeklyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'kWh', data: new Array(7).fill(0),
        backgroundColor: '#22c55e', hoverBackgroundColor: '#16a34a',
        borderRadius: 8, maxBarThickness: 34,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0d1f17', padding: 10, cornerRadius: 10,
          callbacks: { label: (c) => ` ${fmt2(c.parsed.y)} kWh` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#6b7a74', font: { family: 'Poppins', size: 11 } } },
        y: { grid: { color: '#eef2f0' }, ticks: { color: '#6b7a74', font: { family: 'Poppins', size: 11 } } },
      },
    },
  });
}

function initSpark() {
  const ctx = $('sparkPower').getContext('2d');
  sparkChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array.from({ length: 20 }, (_, i) => i),
      datasets: [{
        data: [],
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

// ---------- AI Recommendations (derived from live values) ----------
const ICONS = {
  warn:  'fa-solid fa-triangle-exclamation',
  info:  'fa-solid fa-circle-info',
  good:  'fa-solid fa-circle-check',
  alert: 'fa-solid fa-bolt',
};

function buildRecommendations(live, todayKwh, monthKwh) {
  const recs = [];
  const p = live?.power ?? 0;
  const pf = live?.powerFactor ?? 1;
  const v = live?.voltage ?? 230;
  const hour = new Date().getHours();
  const T = CFG.auditThresholds;

  if (p > T.moderate) {
    recs.push({ t: 'alert', text: `High load detected (${fmt(p)} W). Turn off non-essential appliances now.` });
  } else if (p > T.good) {
    recs.push({ t: 'warn', text: `Consumption is elevated (${fmt(p)} W). Consider staggering heavy appliances.` });
  } else if (p < T.excellent) {
    recs.push({ t: 'good', text: `Excellent — current draw is only ${fmt(p)} W.` });
  } else {
    recs.push({ t: 'good', text: `Power usage is within an efficient range (${fmt(p)} W).` });
  }

  if (pf && pf < 0.85) {
    recs.push({ t: 'warn', text: `Low power factor (${fmt2(pf)}). Inductive loads may be running inefficiently.` });
  }
  if (v && (v < 210 || v > 245)) {
    recs.push({ t: 'alert', text: `Voltage out of nominal range (${fmt(v)} V). Check main supply.` });
  }
  if (hour >= 18 && hour <= 21 && p > T.good) {
    recs.push({ t: 'warn', text: 'You are consuming heavily during peak hours (6 PM – 9 PM). Shift loads to off-peak to save.' });
  }
  if (todayKwh > 0) {
    const projMonth = todayKwh * 30;
    recs.push({ t: 'info', text: `At today's pace (${fmt2(todayKwh)} kWh), monthly usage would reach ~${fmt2(projMonth)} kWh.` });
  }
  if (monthKwh > 0) {
    const bill = monthKwh * CFG.electricityRatePhpPerKwh;
    recs.push({ t: 'info', text: `Month-to-date bill: ₱${fmt2(bill)} at ₱${fmt2(CFG.electricityRatePhpPerKwh)}/kWh.` });
  }

  return recs.slice(0, 5);
}

function renderRecs(recs) {
  if (!recs.length) {
    $('recList').innerHTML = `<li class="rec-item info">
      <div class="rec-icon"><i class="${ICONS.info}"></i></div>
      <p>Waiting for live sensor data…</p></li>`;
    return;
  }
  $('recList').innerHTML = recs.map((r) => `
    <li class="rec-item ${r.t}">
      <div class="rec-icon"><i class="${ICONS[r.t]}"></i></div>
      <p>${r.text}</p>
    </li>`).join('');
}

// ---------- AI Audit ----------
function updateAudit(power) {
  const el = $('auditStatus'), note = $('auditNote'), circle = $('auditCircle');
  circle.classList.remove('moderate', 'high');
  const T = CFG.auditThresholds;
  let status, msg, icon, color;

  if (power > T.moderate) {
    status = 'High Consumption';
    msg = 'Consistently high load — investigate running appliances.';
    icon = 'fa-solid fa-triangle-exclamation';
    color = 'var(--red-500)';
    circle.classList.add('high');
  } else if (power > T.good) {
    status = 'Moderate';
    msg = 'Slightly above efficient range for this hour.';
    icon = 'fa-solid fa-gauge-high';
    color = 'var(--amber-500)';
    circle.classList.add('moderate');
  } else if (power < T.excellent) {
    status = 'Excellent';
    msg = 'Low, efficient consumption.';
    icon = 'fa-regular fa-face-grin-stars';
    color = 'var(--green-600)';
  } else {
    status = 'Good';
    msg = 'Consumption is within a healthy range.';
    icon = 'fa-regular fa-face-smile';
    color = 'var(--green-600)';
  }

  el.textContent = status;
  el.style.color = color;
  note.textContent = msg;
  circle.querySelector('i').className = icon;
}

// ---------- Live parameter rendering ----------
function renderLive(live) {
  if (!live) return;
  const { voltage = 0, current = 0, power = 0, powerFactor = 0, frequency = 0, timestamp } = live;

  $('pVolt').textContent = fmt(voltage);
  $('pCurr').textContent = fmt2(current);
  $('pPow').textContent  = fmt(power);
  $('pPF').textContent   = fmt2(powerFactor);
  $('pFreq').textContent = fmt2(frequency);

  $('metricPower').innerHTML = `${fmt(power)} <small>W</small>`;

  // Sparkline
  const arr = sparkChart.data.datasets[0].data;
  arr.push(power);
  if (arr.length > 20) arr.shift();
  sparkChart.update('none');

  // Update the current hour in today's chart with the latest reading
  const hr = new Date().getHours();
  usageChart.data.datasets[0].data[hr] = power;
  usageChart.update('none');

  updateAudit(power);

  const ts = timestamp ? new Date(timestamp) : new Date();
  const dateStr = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('sidebarUpdated').textContent = `${dateStr}  ${timeStr}`;
}

// ---------- Firebase ----------
function setConn(online, text) {
  $('connText').textContent = text;
  $('connDot').style.background = online ? 'var(--green-600)' : 'var(--red-500)';
}

let lastLive = null;
let lastTodayKwh = 0;
let lastMonthKwh = 0;

function initFirebase() {
  const cfg = CFG.firebase;
  if (!cfg?.databaseURL || cfg.databaseURL.includes('YOUR_PROJECT_ID')) {
    setConn(false, 'Config missing');
    renderRecs([]);
    console.warn('Fill in public/dashboard/config.js with your Firebase project credentials.');
    return;
  }

  let app, db;
  try {
    app = initializeApp({
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain,
      databaseURL: cfg.databaseURL,
      projectId: cfg.projectId,
      appId: cfg.appId,
    });
    db = getDatabase(app);
  } catch (err) {
    console.error('Firebase init failed:', err);
    setConn(false, 'Firebase init failed');
    return;
  }

  // Live values
  const liveRef = ref(db, CFG.paths.live);
  onValue(liveRef, (snap) => {
    const live = snap.val();
    if (!live) { setConn(false, 'No live data'); return; }
    setConn(true, 'Online');
    lastLive = live;
    renderLive(live);
    renderRecs(buildRecommendations(live, lastTodayKwh, lastMonthKwh));
  }, (err) => {
    console.error('Live read failed:', err);
    setConn(false, 'Connection lost');
  });

  // Today's hourly history
  const hourlyRef = ref(db, `${CFG.paths.hourly}/${todayKey()}`);
  onValue(hourlyRef, (snap) => {
    const hours = snap.val() || {};
    const data = new Array(24).fill(null);
    for (let h = 0; h < 24; h++) {
      if (hours[h] != null) data[h] = Number(hours[h]);
    }
    // Preserve current-hour live reading if available
    const curHr = new Date().getHours();
    if (lastLive?.power != null) data[curHr] = lastLive.power;
    usageChart.data.datasets[0].data = data;
    usageChart.update('none');

    // Peak hour
    let peakHr = -1, peakVal = -Infinity;
    data.forEach((v, i) => { if (v != null && v > peakVal) { peakVal = v; peakHr = i; } });
    $('peakTime').textContent = peakHr >= 0
      ? `${(peakHr % 12) || 12}:00 ${peakHr < 12 ? 'AM' : 'PM'}`
      : '—';
  });

  // Daily history — last 7 days for weekly chart + today's/month kWh
  const dailyRef = ref(db, CFG.paths.daily);
  onValue(dailyRef, (snap) => {
    const daily = snap.val() || {};

    // Weekly bar chart (last 7 days including today)
    const labels = [], values = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      values.push(Number(daily[key] || 0));
    }
    weeklyChart.data.labels = labels;
    weeklyChart.data.datasets[0].data = values;
    weeklyChart.update('none');

    // Today
    const tKwh = Number(daily[todayKey()] || 0);
    lastTodayKwh = tKwh;
    $('todayKwh').textContent = fmt2(tKwh);

    // Month-to-date
    const mk = monthKey();
    const mKwh = Object.entries(daily)
      .filter(([k]) => k.startsWith(mk))
      .reduce((sum, [, v]) => sum + Number(v || 0), 0);
    lastMonthKwh = mKwh;
    $('monthKwh').textContent = fmt2(mKwh);

    // Bill
    const rate = CFG.electricityRatePhpPerKwh;
    const bill = mKwh * rate;
    $('metricBill').textContent = `₱${fmt2(bill)}`;
    $('billRate').textContent = `₱${fmt2(rate)}`;
    $('billKwh').textContent  = fmt2(mKwh);

    // Recommendations depend on aggregates
    if (lastLive) renderRecs(buildRecommendations(lastLive, lastTodayKwh, lastMonthKwh));
  });
}

// ---------- Bootstrap ----------
function init() {
  updateClock();
  setInterval(updateClock, 1000);
  initSidebar();
  initTheme();
  initSpark();
  initUsageChart();
  initWeeklyChart();
  renderRecs([]);
  initFirebase();
}

init();
