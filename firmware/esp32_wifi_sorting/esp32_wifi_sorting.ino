/* ==============================================================================
 * VERNOVA — R-LAB SMART SORTING FACTORY
 * Firmware ESP32 Wi-Fi HTTP REST API (Universal & Hardware-Decoupled)
 * 
 * Board: ESP32 DevKit V1 / NodeMCU-32S / ESP32-WROOM-32
 * Framework: Arduino IDE (ESP32 Arduino Core)
 * 
 * Fitur:
 * 1. Dual Wi-Fi Mode:
 *    - SoftAP Mode (Hotspot mandiri 'VERNOVA-ROBOT' IP: 192.168.4.1)
 *    - Station Mode (Opsional: sambung ke router Wi-Fi lokal / Lab Sekolah)
 * 2. HTTP REST API dengan Full CORS (Access-Control-Allow-Origin: *)
 *    - GET  /api/health & /api/status -> Status telemetri, RSSI, heap, uptime
 *    - POST /api/sort                 -> Perintah sortir warna (kuning, biru, merah)
 *    - POST /api/mode                 -> Konfigurasi mode aktuator (Servo / Arm)
 *    - POST /api/stop                 -> Emergency Stop & posisi aman aktuator
 *    - POST /api/test                 -> Safe Test Pulse (indikator / getaran)
 *    - OPTIONS (Semua path)           -> HTTP 204 No Content untuk browser preflight
 * 3. Pencegahan eksekusi ganda (Command deduplication via commandId)
 * 4. Pemisahan Total Lapisan Jaringan dan Pin Hardware:
 *    - Website TIDAK memaksakan GPIO tertentu sebagai syarat koneksi.
 *    - Konfigurasi pin diatur bebas pada blok #define di bawah ini.
 * ============================================================================== */

#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>

// =========================================================================
// 1. KONFIGURASI WI-FI (Sesuaikan jika diperlukan)
// =========================================================================
const char* AP_SSID = "VERNOVA-ROBOT";
const char* AP_PASS = "vernova123";      // Password AP (minimal 8 karakter)
const IPAddress AP_IP(192, 168, 4, 1);
const IPAddress AP_GW(192, 168, 4, 1);
const IPAddress AP_NET(255, 255, 255, 0);

// Opsional: Hubungkan ke Wi-Fi Router / Hotspot Handphone
const char* STA_SSID = "";               // Contoh: "Lab-Robotik"
const char* STA_PASS = "";               // Contoh: "passwordLab"

// =========================================================================
// 2. KONFIGURASI PIN HARDWARE (Dapat diubah sesuai rangkaian fisik Anda)
// Catatan: Website tidak mewajibkan pin tertentu. Pin diatur di sini.
// =========================================================================
#define PIN_SERVO_FLAP    18  // Servo pemilah jalur (Gate/Flap)
#define PIN_SERVO_ARM     19  // Servo lengan robot (Arm)
#define PIN_LED_STATUS    2   // LED onboard ESP32 (indikator status)

// =========================================================================
// 3. OBJEK & VARIABEL GLOBAL
// =========================================================================
WebServer server(80);
Servo servoFlap;
Servo servoArm;

String deviceId = "VERNOVA-ESP32-WIFI";
String currentMode = "servo";
String deviceState = "READY";
String lastCommandId = "";
unsigned long lastCommandTime = 0;

// =========================================================================
// 4. HELPER CORS & PREFLIGHT
// =========================================================================
void setCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Accept, X-Command-Id, X-Requested-With");
}

void handleOptions() {
  setCorsHeaders();
  server.send(204);
}

// =========================================================================
// 5. HANDLER ENDPOINT HTTP REST
// =========================================================================

// GET /api/health dan GET /api/status
void handleHealth() {
  setCorsHeaders();
  unsigned long uptimeSec = millis() / 1000;
  int rssi = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : -45;

  String json = "{";
  json += "\"ok\":true,";
  json += "\"deviceId\":\"" + deviceId + "\",";
  json += "\"deviceType\":\"ESP32\",";
  json += "\"firmwareVersion\":\"2.2.0\",";
  json += "\"state\":\"" + deviceState + "\",";
  json += "\"mode\":\"" + currentMode + "\",";
  json += "\"wifiRssi\":" + String(rssi) + ",";
  json += "\"freeHeap\":" + String(ESP.getFreeHeap()) + ",";
  json += "\"uptimeSec\":" + String(uptimeSec) + ",";
  json += "\"ip\":\"" + WiFi.softAPIP().toString() + "\"";
  json += "}";

  server.send(200, "application/json", json);
}

// POST /api/sort
void handleSort() {
  setCorsHeaders();
  if (server.method() == HTTP_OPTIONS) {
    server.send(204);
    return;
  }
  if (server.method() != HTTP_POST) {
    server.send(405, "application/json", "{\"ok\":false,\"error\":\"Method Not Allowed\"}");
    return;
  }

  String body = server.arg("plain");
  String color = "";
  String mode = currentMode;
  String commandId = "";

  // Parser JSON sederhana tanpa dependensi eksternal
  int cIdx = body.indexOf("\"color\":");
  if (cIdx != -1) {
    int start = body.indexOf("\"", cIdx + 8) + 1;
    int end = body.indexOf("\"", start);
    if (start > 0 && end > start) color = body.substring(start, end);
  }

  int mIdx = body.indexOf("\"mode\":");
  if (mIdx != -1) {
    int start = body.indexOf("\"", mIdx + 7) + 1;
    int end = body.indexOf("\"", start);
    if (start > 0 && end > start) mode = body.substring(start, end);
  }

  int idIdx = body.indexOf("\"commandId\":");
  if (idIdx != -1) {
    int start = body.indexOf("\"", idIdx + 12) + 1;
    int end = body.indexOf("\"", start);
    if (start > 0 && end > start) commandId = body.substring(start, end);
  }

  color.toLowerCase();
  color.trim();

  // Validasi warna
  if (color != "kuning" && color != "biru" && color != "merah") {
    server.send(400, "application/json", "{\"ok\":false,\"error\":\"Warna tidak valid. Harus kuning, biru, atau merah.\"}");
    return;
  }

  // Deduplication: cegah eksekusi berulang jika commandId sama dalam 2.5 detik
  unsigned long now = millis();
  if (commandId.length() > 0 && commandId == lastCommandId && (now - lastCommandTime < 2500)) {
    String dupJson = "{\"ok\":true,\"suppressed\":true,\"commandId\":\"" + commandId + "\",\"message\":\"Command already processed\"}";
    server.send(200, "application/json", dupJson);
    return;
  }

  lastCommandId = commandId;
  lastCommandTime = now;
  deviceState = "SORTING";

  // Indikator aktif LED
  digitalWrite(PIN_LED_STATUS, HIGH);

  // Eksekusi Aktuator Fisik Sesuai Warna & Mode
  unsigned long tStart = millis();

  if (mode == "arm") {
    // Mode Lengan Robot: Aktuasi lengan servo
    if (color == "kuning") {
      servoArm.write(45);
      delay(400);
      servoArm.write(90);
    } else if (color == "biru") {
      servoArm.write(135);
      delay(400);
      servoArm.write(90);
    } else if (color == "merah") {
      servoArm.write(175);
      delay(400);
      servoArm.write(90);
    }
  } else {
    // Mode Servo Flap (Jalur)
    if (color == "kuning") {
      servoFlap.write(35);
      delay(350);
      servoFlap.write(90);
    } else if (color == "biru") {
      servoFlap.write(90);
      delay(300);
    } else if (color == "merah") {
      servoFlap.write(145);
      delay(350);
      servoFlap.write(90);
    }
  }

  digitalWrite(PIN_LED_STATUS, LOW);
  deviceState = "READY";
  unsigned long durationMs = millis() - tStart;

  String respJson = "{";
  respJson += "\"ok\":true,";
  respJson += "\"commandId\":\"" + commandId + "\",";
  respJson += "\"color\":\"" + color + "\",";
  respJson += "\"mode\":\"" + mode + "\",";
  respJson += "\"status\":\"COMPLETED\",";
  respJson += "\"executionStatus\":\"confirmed_esp32_wifi\",";
  respJson += "\"durationMs\":" + String(durationMs);
  respJson += "}";

  server.send(200, "application/json", respJson);
}

// POST /api/mode
void handleMode() {
  setCorsHeaders();
  if (server.method() == HTTP_OPTIONS) { server.send(204); return; }
  if (server.method() != HTTP_POST) {
    server.send(405, "application/json", "{\"ok\":false,\"error\":\"Method Not Allowed\"}");
    return;
  }

  String body = server.arg("plain");
  int mIdx = body.indexOf("\"mode\":");
  if (mIdx != -1) {
    int start = body.indexOf("\"", mIdx + 7) + 1;
    int end = body.indexOf("\"", start);
    if (start > 0 && end > start) {
      currentMode = body.substring(start, end);
      currentMode.toLowerCase();
    }
  }

  server.send(200, "application/json", "{\"ok\":true,\"mode\":\"" + currentMode + "\"}");
}

// POST /api/stop (Emergency Stop)
void handleStop() {
  setCorsHeaders();
  if (server.method() == HTTP_OPTIONS) { server.send(204); return; }

  // Kembalikan seluruh servo ke posisi aman
  servoFlap.write(90);
  servoArm.write(90);
  digitalWrite(PIN_LED_STATUS, LOW);
  deviceState = "READY";

  server.send(200, "application/json", "{\"ok\":true,\"status\":\"STOPPED\",\"message\":\"Aktuator dikembalikan ke posisi netral\"}");
}

// POST /api/test (Test Pulse)
void handleTest() {
  setCorsHeaders();
  if (server.method() == HTTP_OPTIONS) { server.send(204); return; }

  // Berikan indikasi kedipan LED dan getaran kecil servo
  digitalWrite(PIN_LED_STATUS, HIGH);
  servoFlap.write(100);
  delay(150);
  servoFlap.write(90);
  digitalWrite(PIN_LED_STATUS, LOW);

  server.send(200, "application/json", "{\"ok\":true,\"status\":\"PULSE_ACK\",\"message\":\"Test pulse sukses\"}");
}

// Handler rute tidak dikenal / CORS preflight fallback
void handleNotFound() {
  setCorsHeaders();
  if (server.method() == HTTP_OPTIONS) {
    server.send(204);
  } else {
    server.send(404, "application/json", "{\"ok\":false,\"error\":\"Endpoint Not Found\"}");
  }
}

// =========================================================================
// 6. SETUP & LOOP UTAMA
// =========================================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[VERNOVA] Memulai Firmware ESP32 Wi-Fi Smart Sorting Factory...");

  // Inisialisasi Pin Indikator
  pinMode(PIN_LED_STATUS, OUTPUT);
  digitalWrite(PIN_LED_STATUS, LOW);

  // Inisialisasi Servo PWM (ESP32Servo library)
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  servoFlap.setPeriodHertz(50);
  servoArm.setPeriodHertz(50);
  servoFlap.attach(PIN_SERVO_FLAP, 500, 2400);
  servoArm.attach(PIN_SERVO_ARM, 500, 2400);

  // Posisi netral aman
  servoFlap.write(90);
  servoArm.write(90);

  // 1. Jalankan Wi-Fi SoftAP (Hotspot mandiri)
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(AP_IP, AP_GW, AP_NET);
  bool apSuccess = WiFi.softAP(AP_SSID, AP_PASS);

  if (apSuccess) {
    Serial.print("[Wi-Fi AP] Hotspot aktif: ");
    Serial.println(AP_SSID);
    Serial.print("[Wi-Fi AP] Alamat IP: http://");
    Serial.println(WiFi.softAPIP());
  } else {
    Serial.println("[Wi-Fi AP] Gagal memulai SoftAP!");
  }

  // 2. Hubungkan ke Wi-Fi Station (jika SSID diisi)
  if (String(STA_SSID).length() > 0) {
    Serial.print("[Wi-Fi STA] Menghubungkan ke ");
    Serial.println(STA_SSID);
    WiFi.begin(STA_SSID, STA_PASS);
    unsigned long startConn = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startConn < 8000) {
      delay(300);
      Serial.print(".");
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("\n[Wi-Fi STA] Terhubung! IP: http://");
      Serial.println(WiFi.localIP());
    } else {
      Serial.println("\n[Wi-Fi STA] Timeout. Berjalan pada mode SoftAP.");
    }
  }

  // 3. Daftarkan Endpoint Web Server
  server.on("/api/health", HTTP_GET, handleHealth);
  server.on("/api/status", HTTP_GET, handleHealth);
  server.on("/api/sort", HTTP_POST, handleSort);
  server.on("/api/mode", HTTP_POST, handleMode);
  server.on("/api/stop", HTTP_POST, handleStop);
  server.on("/api/test", HTTP_POST, handleTest);

  // OPTIONS handler untuk seluruh rute
  server.on("/api/health", HTTP_OPTIONS, handleOptions);
  server.on("/api/status", HTTP_OPTIONS, handleOptions);
  server.on("/api/sort", HTTP_OPTIONS, handleOptions);
  server.on("/api/mode", HTTP_OPTIONS, handleOptions);
  server.on("/api/stop", HTTP_OPTIONS, handleOptions);
  server.on("/api/test", HTTP_OPTIONS, handleOptions);

  server.onNotFound(handleNotFound);

  // 4. Mulai Web Server
  server.begin();
  Serial.println("[HTTP] Server REST API siap melayani permintaan dari website VERNOVA.");
  digitalWrite(PIN_LED_STATUS, HIGH);
  delay(300);
  digitalWrite(PIN_LED_STATUS, LOW);
}

void loop() {
  server.handleClient();
  delay(2); // Menjaga stabilitas task scheduler ESP32
}
