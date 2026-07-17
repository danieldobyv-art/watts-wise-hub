/* ============================================================
   AI Energy Auditing System — Central Configuration
   Fill in the values below. These are the ONLY values you
   should ever need to change to wire the dashboard to your
   Firebase project.
   ============================================================ */
window.AIEAS_CONFIG = {
  // ---- Firebase project ----
  firebase: {
    apiKey:      "YOUR_FIREBASE_API_KEY",
    databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
    projectId:   "YOUR_PROJECT_ID",
    // The following are optional but recommended for a complete
    // Firebase web config. They are not required for RTDB reads.
    authDomain:  "YOUR_PROJECT_ID.firebaseapp.com",
    appId:       "YOUR_FIREBASE_APP_ID",
  },

  // ---- Billing ----
  electricityRatePhpPerKwh: 12.0, // ₱ per kWh (Meralco-style default)

  // ---- AI audit thresholds (Watts) ----
  auditThresholds: {
    excellent: 500,   // < 500 W  -> Excellent
    good:      1200,  // < 1200 W -> Good
    moderate:  1800,  // < 1800 W -> Moderate, else High Consumption
  },

  // ---- Realtime Database paths ----
  paths: {
    live:    "live",
    hourly:  "history/hourly",  // optional — { "<YYYY-MM-DD>": { "0".."23": avgWatts } }
    daily:   "history/daily",   // optional — { "<YYYY-MM-DD>": kWh }
  },
};
