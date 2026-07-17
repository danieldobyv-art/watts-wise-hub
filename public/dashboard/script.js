/* ============================================================
   AI Energy Auditing System — Dashboard (Live Firebase Data)
   Data flow:
     PZEM-004T v4  →  ESP32  →  Firebase Realtime Database  →  this dashboard

   Firebase RTDB schema (as written by the ESP32):
     /live
       ├── voltage      (V)
       ├── current      (A)
       ├── power        (W)
       ├── energy       (kWh, cumulative since PZEM reset)
       ├── frequency    (Hz)
       ├── powerFactor
       └── timestamp    (ms since epoch, optional)
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const CFG = window.AIEAS_CONFIG;
if (!CFG) throw new Error("AIEAS_CONFIG missing — check config.js");

// ---------- Utilities ----------
const $ = (id) => document.getElementById(id);
const NO_DATA = "No Data";
const isNum = (v) => v !== null && v !== undefined && !Number.isNaN(Number(v));
const num = (v, d = 0) => (isNum(v) ? Number(v) : d);
const fmt  = (v) => (isNum(v) ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) : NO_DATA);
const fmt2 = (v) => (isNum(v) ? Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : NO_DATA);
const todayKey = () => new Date().toISOString().slice(0, 10);
const monthKey = () => new Date().toISOString().slice(0, 7);

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

// ---------- AI Recommendations ----------
const ICONS = {
  warn:  'fa-solid fa-triangle-exclamation',
  info:  'fa-solid fa-circle-info',
  good:  'fa-solid fa-circle-check',
  alert: 'fa-solid fa-bolt',
};

function buildRecommendations(live, todayKwh, monthKwh) {
  const recs = [];
  const p = num(live?.power, 0);
  const pf = num(live?.powerFactor, 1);
  const v = num(live?.voltage, 230);
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

  if (!isNum(power)) {
    el.textContent = NO_DATA;
    el.style.color = 'var(--muted, #6b7a74)';
    note.textContent = 'Waiting for live data from Firebase…';
    circle.querySelector('i').className = 'fa-regular fa-face-meh';
    return;
  }

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

// ---------- Baselines for today / month kWh from cumulative live.energy ----------
function getBaseline(storageKey, currentEnergy) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw != null) {
      const n = Number(raw);
      // If PZEM was reset, cumulative dropped below baseline → reset baseline.
      if (Number.isFinite(n) && currentEnergy >= n) return n;
    }
  } catch {}
  localStorage.setItem(storageKey, String(currentEnergy));
  return currentEnergy;
}

// ---------- Live parameter rendering ----------
function renderLive(live) {
  if (!live || typeof live !== 'object') {
    console.warn('[AIEAS] No live payload received');
    $('pVolt').textContent = NO_DATA;
    $('pCurr').textContent = NO_DATA;
    $('pPow').textContent  = NO_DATA;
    $('pPF').textContent   = NO_DATA;
    $('pFreq').textContent = NO_DATA;
    $('metricPower').innerHTML = `${NO_DATA}`;
    $('todayKwh').textContent = NO_DATA;
    $('monthKwh').textContent = NO_DATA;
    $('metricBill').textContent = NO_DATA;
    updateAudit(null);
    return;
  }

  const { voltage, current, power, powerFactor, frequency, energy, timestamp } = live;

  console.log('[AIEAS] Values received:', {
    voltage, current, power, powerFactor, frequency, energy, timestamp,
  });

  $('pVolt').textContent = fmt(voltage);
  $('pCurr').textContent = fmt2(current);
  $('pPow').textContent  = fmt(power);
  $('pPF').textContent   = fmt2(powerFactor);
  $('pFreq').textContent = fmt2(frequency);

  $('metricPower').innerHTML = isNum(power) ? `${fmt(power)} <small>W</small>` : NO_DATA;

  // Sparkline + current-hour usage chart
  if (isNum(power)) {
    const arr = sparkChart.data.datasets[0].data;
    arr.push(Number(power));
    if (arr.length > 20) arr.shift();
    sparkChart.update('none');

    const hr = new Date().getHours();
    usageChart.data.datasets[0].data[hr] = Number(power);
    usageChart.update('none');
  }

  updateAudit(isNum(power) ? Number(power) : null);

  // Energy-derived cards (today / month / bill) from cumulative live.energy
  if (isNum(energy)) {
    const e = Number(energy);
    const dayBase = getBaseline(`aieas-energy-base-${todayKey()}`, e);
    const monBase = getBaseline(`aieas-energy-base-${monthKey()}`, e);
    const tKwh = Math.max(0, e - dayBase);
    const mKwh = Math.max(0, e - monBase);

    $('todayKwh').textContent = fmt2(tKwh);
    $('monthKwh').textContent = fmt2(mKwh);

    const rate = CFG.electricityRatePhpPerKwh;
    $('metricBill').textContent = `₱${fmt2(mKwh * rate)}`;
    $('billRate').textContent = `₱${fmt2(rate)}`;
    $('billKwh').textContent  = fmt2(mKwh);

    renderRecs(buildRecommendations(live, tKwh, mKwh));
  } else {
    $('todayKwh').textContent = NO_DATA;
    $('monthKwh').textContent = NO_DATA;
    $('metricBill').textContent = NO_DATA;
    renderRecs(buildRecommendations(live, 0, 0));
  }

  const ts = timestamp ? new Date(Number(timestamp)) : new Date();
  const dateStr = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('sidebarUpdated').textContent = `${dateStr}  ${timeStr}`;
}

// ---------- Firebase ----------
function setConn(online, text) {
  $('connText').textContent = text;
  $('connDot').style.background = online ? 'var(--green-600)' : 'var(--red-500)';
}

function initFirebase() {
  const cfg = CFG.firebase;
  if (!cfg?.databaseURL || cfg.databaseURL.includes('YOUR_PROJECT_ID') || cfg.apiKey?.includes('YOUR_')) {
    setConn(false, 'Config missing');
    renderLive(null);
    console.error('[AIEAS] Firebase config missing — edit public/dashboard/config.js with your project credentials.');
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
    console.log('[AIEAS] Firebase connected:', cfg.databaseURL);
  } catch (err) {
    console.error('[AIEAS] Firebase init failed:', err);
    setConn(false, 'Firebase init failed');
    return;
  }

  const path = CFG.paths.live;
  const liveRef = ref(db, path);
  console.log(`[AIEAS] Subscribing to /${path} …`);

  onValue(liveRef, (snap) => {
    const live = snap.val();
    console.log('[AIEAS] Data received from /' + path + ':', live);
    if (!live) {
      setConn(false, 'No live data');
      renderLive(null);
      return;
    }
    setConn(true, 'Online');
    renderLive(live);
  }, (err) => {
    console.error('[AIEAS] Firebase read error:', err);
    setConn(false, 'Connection lost');
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
