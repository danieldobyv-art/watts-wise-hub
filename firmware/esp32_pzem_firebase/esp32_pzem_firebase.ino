/* ============================================================
   AI-Enabled Energy Auditing System — ESP32 Firmware
   Hardware : ESP32 + PZEM-004T v4 (100A, TTL UART variant)
   Cloud    : Firebase Realtime Database
   Interval : Uploads live values every 3 seconds
              Rolls up hourly averages + daily energy totals
   ------------------------------------------------------------
   REQUIRED ARDUINO LIBRARIES (Library Manager):
     - Firebase ESP Client        by Mobizt   (v4.4.x+)
     - PZEM-004T-v30              by Jakub Mandula
                                  (works with v3 & v4 PZEM boards)
     - ArduinoJson                by Benoit Blanchon   (v6.x)
     - NTPClient                  by Fabrice Weinberg  (optional)
   BOARD:
     - Install "esp32 by Espressif Systems" from the Boards Manager
     - Select any ESP32 Dev Module and the correct COM port
   ============================================================ */

#include <WiFi.h>
#include <time.h>
#include <PZEM004Tv30.h>
#include <Firebase_ESP_Client.h>
#include <addons/TokenHelper.h>   // provided by Firebase-ESP-Client
#include <addons/RTDBHelper.h>

// ------------------------------------------------------------
// 1) EDIT ONLY THIS BLOCK — the rest of the file needs no changes
// ------------------------------------------------------------
#define WIFI_SSID           "YOUR_WIFI_SSID"
#define WIFI_PASSWORD       "YOUR_WIFI_PASSWORD"

#define FIREBASE_API_KEY    "YOUR_FIREBASE_API_KEY"
#define FIREBASE_DB_URL     "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com"
#define FIREBASE_PROJECT_ID "YOUR_PROJECT_ID"

// Upload cadence
static const uint32_t UPLOAD_INTERVAL_MS = 3000;

// PZEM-004T v4 UART pins (change if you wire differently)
#define PZEM_RX_PIN 16   // ESP32 GPIO16 (RX2)  <-  PZEM TX
#define PZEM_TX_PIN 17   // ESP32 GPIO17 (TX2)  ->  PZEM RX
#define PZEM_SERIAL Serial2

// Timezone for hourly bucketing (Philippines = UTC+8)
static const long   GMT_OFFSET_SEC     = 8 * 3600;
static const int    DAYLIGHT_OFFSET_SEC = 0;
// ------------------------------------------------------------

// PZEM instance on hardware UART2
PZEM004Tv30 pzem(PZEM_SERIAL, PZEM_RX_PIN, PZEM_TX_PIN);

// Firebase objects
FirebaseData   fbdo;
FirebaseAuth   fbAuth;
FirebaseConfig fbConfig;

// Rollup accumulators for the current hour
struct HourAcc {
  int    hour     = -1;      // 0..23
  char   dateKey[11] = {0};  // "YYYY-MM-DD"
  double sumWatts = 0.0;
  uint32_t samples = 0;
};
HourAcc hourAcc;

// Track last known energy reading so we can compute daily deltas
double lastEnergyKwh = -1.0;
char   lastDayKey[11] = {0};

// -------- Wi-Fi ------------------------------------------------
void connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] Connected: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[WiFi] Failed — will retry in main loop");
  }
}

// -------- Time / NTP -------------------------------------------
void syncTime() {
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC,
             "pool.ntp.org", "time.google.com", "time.nist.gov");
  struct tm t;
  uint32_t start = millis();
  while (!getLocalTime(&t, 500) && millis() - start < 10000) {
    Serial.println("[Time] Waiting for NTP sync...");
  }
  if (getLocalTime(&t)) {
    Serial.printf("[Time] Synced: %04d-%02d-%02d %02d:%02d:%02d\n",
      t.tm_year + 1900, t.tm_mon + 1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec);
  }
}

// -------- Firebase ---------------------------------------------
void initFirebase() {
  fbConfig.api_key      = FIREBASE_API_KEY;
  fbConfig.database_url = FIREBASE_DB_URL;

  // Anonymous sign-in — enable Anonymous provider in Firebase Auth
  if (Firebase.signUp(&fbConfig, &fbAuth, "", "")) {
    Serial.println("[Firebase] Anonymous sign-in OK");
  } else {
    Serial.printf("[Firebase] Sign-in error: %s\n", fbConfig.signer.signupError.message.c_str());
  }
  fbConfig.token_status_callback = tokenStatusCallback;

  Firebase.begin(&fbConfig, &fbAuth);
  Firebase.reconnectWiFi(true);
  fbdo.setResponseSize(4096);
}

// -------- PZEM read (with basic recovery) ----------------------
struct Reading {
  bool   ok;
  float  voltage;   // V
  float  current;   // A
  float  power;     // W
  float  energy;    // kWh
  float  frequency; // Hz
  float  pf;        // 0..1
};

Reading readPZEM() {
  Reading r{false, 0, 0, 0, 0, 0, 0};
  r.voltage   = pzem.voltage();
  r.current   = pzem.current();
  r.power     = pzem.power();
  r.energy    = pzem.energy();
  r.frequency = pzem.frequency();
  r.pf        = pzem.pf();

  // PZEM lib returns NAN on comms failure
  if (isnan(r.voltage) || isnan(r.current) || isnan(r.power) ||
      isnan(r.energy)  || isnan(r.frequency) || isnan(r.pf)) {
    Serial.println("[PZEM] Read failed (NaN) — check wiring / power to sensor");
    return r;
  }
  r.ok = true;
  return r;
}

// -------- Helpers ----------------------------------------------
void makeDateKey(char* out, size_t n, const struct tm& t) {
  snprintf(out, n, "%04d-%02d-%02d", t.tm_year + 1900, t.tm_mon + 1, t.tm_mday);
}

uint64_t epochMillis() {
  time_t now = time(nullptr);
  return (uint64_t)now * 1000ULL;
}

// -------- Upload one live reading ------------------------------
void uploadLive(const Reading& r) {
  FirebaseJson j;
  j.set("voltage",     r.voltage);
  j.set("current",     r.current);
  j.set("power",       r.power);
  j.set("energy",      r.energy);
  j.set("frequency",   r.frequency);
  j.set("powerFactor", r.pf);
  j.set("timestamp",   (double)epochMillis());

  if (!Firebase.RTDB.setJSON(&fbdo, "/energy-monitor/live", &j)) {
    Serial.printf("[Firebase] live write failed: %s\n", fbdo.errorReason().c_str());
  }
}

// -------- Rollups ----------------------------------------------
void updateRollups(const Reading& r) {
  struct tm t;
  if (!getLocalTime(&t)) return;

  char dateKey[11];
  makeDateKey(dateKey, sizeof(dateKey), t);

  // ---- Hourly average (Watts) ----
  if (hourAcc.hour != t.tm_hour || strcmp(hourAcc.dateKey, dateKey) != 0) {
    // Flush previous hour before rolling over
    if (hourAcc.samples > 0 && hourAcc.hour >= 0) {
      float avg = (float)(hourAcc.sumWatts / hourAcc.samples);
      String path = String("/energy-monitor/history/hourly/") + hourAcc.dateKey + "/" + hourAcc.hour;
      if (!Firebase.RTDB.setFloat(&fbdo, path.c_str(), avg)) {
        Serial.printf("[Firebase] hourly write failed: %s\n", fbdo.errorReason().c_str());
      }
    }
    hourAcc.hour = t.tm_hour;
    strncpy(hourAcc.dateKey, dateKey, sizeof(hourAcc.dateKey));
    hourAcc.sumWatts = 0;
    hourAcc.samples  = 0;
  }
  hourAcc.sumWatts += r.power;
  hourAcc.samples  += 1;

  // Write running hourly average frequently so the dashboard updates smoothly
  if (hourAcc.samples % 4 == 0) {
    float avg = (float)(hourAcc.sumWatts / hourAcc.samples);
    String path = String("/energy-monitor/history/hourly/") + dateKey + "/" + t.tm_hour;
    Firebase.RTDB.setFloat(&fbdo, path.c_str(), avg);
  }

  // ---- Daily energy total (kWh, from PZEM cumulative energy) ----
  // PZEM v4 reports lifetime energy since last reset. We derive per-day usage
  // by tracking the delta between readings and adding it to today's bucket.
  if (lastEnergyKwh >= 0.0) {
    double delta = (double)r.energy - lastEnergyKwh;
    // Guard against sensor reset / rollback
    if (delta < 0) delta = 0;
    if (delta > 0) {
      String path = String("/energy-monitor/history/daily/") + dateKey;
      // Read-modify-write (RTDB has no atomic increment for floats via this client)
      if (Firebase.RTDB.getFloat(&fbdo, path.c_str())) {
        float cur = fbdo.floatData();
        Firebase.RTDB.setFloat(&fbdo, path.c_str(), cur + (float)delta);
      } else {
        Firebase.RTDB.setFloat(&fbdo, path.c_str(), (float)delta);
      }
    }
  }
  lastEnergyKwh = r.energy;
  strncpy(lastDayKey, dateKey, sizeof(lastDayKey));
}

// -------- Arduino lifecycle ------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== AI Energy Auditing System — ESP32 boot ===");

  connectWiFi();
  syncTime();
  initFirebase();
}

void loop() {
  static uint32_t lastUpload = 0;
  uint32_t now = millis();

  // Reconnect Wi-Fi if dropped
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Lost — reconnecting");
    connectWiFi();
    return;
  }

  if (now - lastUpload >= UPLOAD_INTERVAL_MS) {
    lastUpload = now;

    Reading r = readPZEM();
    if (!r.ok) return;

    Serial.printf("[PZEM] V=%.1fV  I=%.2fA  P=%.0fW  E=%.3fkWh  f=%.2fHz  PF=%.2f\n",
                  r.voltage, r.current, r.power, r.energy, r.frequency, r.pf);

    if (Firebase.ready()) {
      uploadLive(r);
      updateRollups(r);
    } else {
      Serial.println("[Firebase] Not ready — skipping upload");
    }
  }
}
