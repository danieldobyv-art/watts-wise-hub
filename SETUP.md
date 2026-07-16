# AI-Enabled Energy Auditing System — Setup Guide

Live pipeline:

```
PZEM-004T v4  →  ESP32  →  Firebase Realtime Database  →  Web Dashboard
```

---

## 1. Folder structure

```
.
├── firmware/
│   └── esp32_pzem_firebase/
│       └── esp32_pzem_firebase.ino    ← ESP32 Arduino sketch
├── public/
│   └── dashboard/
│       ├── index.html                 ← Dashboard UI
│       ├── style.css
│       ├── script.js                  ← Live Firebase logic
│       └── config.js                  ← ⚙️  EDIT ME (single config file)
└── SETUP.md                           ← this file
```

You only ever edit **two** places to deploy the system:

1. `public/dashboard/config.js` — dashboard side
2. The top block of `firmware/esp32_pzem_firebase/esp32_pzem_firebase.ino` — device side

---

## 2. Hardware wiring — PZEM-004T v4 → ESP32

Use the **TTL (5-pin)** variant of the PZEM-004T v4.

| PZEM-004T v4 pin | ESP32 pin        | Notes                              |
| ---------------- | ---------------- | ---------------------------------- |
| `5V`             | `5V` (VIN/USB)   | Power. Do **not** use 3.3V.        |
| `GND`            | `GND`            | Common ground                      |
| `RX`             | `GPIO 17` (TX2)  | ESP32 transmits to PZEM RX         |
| `TX`             | `GPIO 16` (RX2)  | PZEM transmits to ESP32 RX         |

Mains side (**⚠ high voltage — do this with power off**):

- **L (Live)** wire passes through the CT clamp (100 A coil) — direction arrow on the coil points toward the load.
- **L** and **N** also connect to the PZEM voltage terminals to measure voltage.

```
   MAINS L ──┬────────── LOAD (appliances)
             │
           [CT 100A around L]  ── to PZEM current inputs
             │
   MAINS L ──┴─► PZEM V+       (voltage sense)
   MAINS N ────► PZEM V-       (voltage sense + reference)
```

GPIO pins used on the ESP32: **16 (RX2)** and **17 (TX2)**. All other GPIOs remain free.

---

## 3. Arduino IDE setup

1. **Install the ESP32 board package**
   - `File → Preferences → Additional Board URLs`, add:
     `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - `Tools → Board → Boards Manager…` → install **"esp32" by Espressif Systems**.
   - Select **Board: ESP32 Dev Module**, correct **Port**, `Upload Speed: 921600`.

2. **Install libraries** via `Sketch → Include Library → Manage Libraries…`:
   - **Firebase ESP Client** by Mobizt (v4.4.x or newer)
   - **PZEM-004T-v30** by Jakub Mandula (also drives v4 boards)
   - **ArduinoJson** by Benoit Blanchon (v6.x)

3. Open `firmware/esp32_pzem_firebase/esp32_pzem_firebase.ino` and fill the block at the top:

   ```cpp
   #define WIFI_SSID           "YOUR_WIFI_SSID"
   #define WIFI_PASSWORD       "YOUR_WIFI_PASSWORD"
   #define FIREBASE_API_KEY    "YOUR_FIREBASE_API_KEY"
   #define FIREBASE_DB_URL     "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com"
   #define FIREBASE_PROJECT_ID "YOUR_PROJECT_ID"
   ```

4. Upload. Open `Serial Monitor @ 115200 baud` — you should see live readings printed every 3 s.

---

## 4. Firebase setup

1. In the [Firebase Console](https://console.firebase.google.com/), open your project.
2. **Realtime Database → Create Database** (Singapore or `asia-southeast1` region is closest to PH). Start in **locked mode**.
3. **Project settings → General → Your apps → Web app** → copy the `apiKey`, `databaseURL`, and `projectId`.
4. **Authentication → Sign-in method → Anonymous → Enable**. The ESP32 signs in anonymously so the database rules can be authenticated instead of fully public.

### Database rules

Paste this under **Realtime Database → Rules**:

```json
{
  "rules": {
    "energy-monitor": {
      ".read": true,
      ".write": "auth != null"
    }
  }
}
```

- Public read → dashboard needs no login.
- Authenticated write → only your ESP32 (anonymous auth) can push data.

### Data structure written by the ESP32

```
energy-monitor
├── live
│   ├── voltage       (V)
│   ├── current       (A)
│   ├── power         (W)
│   ├── energy        (kWh, cumulative)
│   ├── frequency     (Hz)
│   ├── powerFactor
│   └── timestamp     (epoch ms)
└── history
    ├── hourly
    │   └── <YYYY-MM-DD>
    │       └── "0".."23"   (average Watts for that hour)
    └── daily
        └── <YYYY-MM-DD>    (total kWh consumed that day)
```

---

## 5. Dashboard setup

1. Open `public/dashboard/config.js` and fill in:

   ```js
   window.AIEAS_CONFIG = {
     firebase: {
       apiKey:      "…",
       databaseURL: "https://<project>-default-rtdb.firebaseio.com",
       projectId:   "…",
       authDomain:  "<project>.firebaseapp.com",
       appId:       "…",
     },
     electricityRatePhpPerKwh: 12.0,   // ← change your rate here
     auditThresholds: { excellent: 500, good: 1200, moderate: 1800 },
     paths: {
       live:   "energy-monitor/live",
       hourly: "energy-monitor/history/hourly",
       daily:  "energy-monitor/history/daily",
     },
   };
   ```

2. Serve the `public/dashboard/` folder. The project's Vite dev server already exposes it at `/dashboard/index.html` (and `/` redirects there). Any static server works too:

   ```bash
   npx serve public/dashboard
   ```

3. Load the dashboard — you should see:
   - **System Status: Online** in the sidebar
   - Live **Voltage / Current / Power / PF / Frequency** updating every ~3 s
   - **Current Power**, **AI Energy Audit**, **Estimated Monthly Bill** driven by live data
   - Hourly line chart filling in as the day progresses, weekly bar chart populated from `history/daily`
   - **AI Recommendations** regenerated on every sensor update

---

## 6. How the AI audit works

`script.js → buildRecommendations()` and `updateAudit()` analyze the latest live sample plus the running kWh totals and pick a status:

| Live power (W)        | Status              |
| --------------------- | ------------------- |
| `< excellent` (500)   | **Excellent**       |
| `< good` (1200)       | **Good**            |
| `< moderate` (1800)   | **Moderate**        |
| `≥ moderate` (1800)   | **High Consumption**|

Recommendations also react to power factor < 0.85, voltage outside 210–245 V, peak-hour heavy load (6 PM–9 PM), and month-to-date bill trend. Tune the thresholds in `config.js`.

---

## 7. Estimated monthly bill

```
Monthly Bill = Σ (daily kWh in current month) × electricityRatePhpPerKwh
```

Default rate is **₱12.00/kWh**. Change `electricityRatePhpPerKwh` in `config.js` — the dashboard updates instantly.

---

## 8. Troubleshooting

- **`[PZEM] Read failed (NaN)`** — check the 5 V supply and RX/TX wiring (they cross: PZEM TX → ESP32 RX2, PZEM RX → ESP32 TX2).
- **`[Firebase] sign-in error`** — enable **Anonymous** provider in Authentication.
- **Dashboard shows "Config missing"** — you forgot to edit `config.js`.
- **Dashboard shows "No live data"** — ESP32 hasn't written `/energy-monitor/live` yet; check the serial monitor.
- **Weekly chart is empty** — the daily bucket only appears after the ESP32 accumulates energy for a full day; it populates gradually.
