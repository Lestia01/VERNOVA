/* ==============================================================================
 * VERNOVA — R-LAB SMART SORTING FACTORY
 * Firmware Kontrol Robotik ESP32 Wi-Fi HTTP REST API (Versi 2.1.0)
 * 
 * Board: ESP32 Dev Module / ESP32-WROOM-32 / NodeMCU-32S
 * Framework: Arduino ESP32 Core
 * 
 * Fitur:
 * 1. Dual Wi-Fi: SoftAP (Hotspot mandiri 'VERNOVA-ROBOT' IP: 192.168.4.1) & Station Mode
 * 2. HTTP REST API dengan full CORS (Access-Control-Allow-Origin: *)
 *    - GET  /api/status  -> Status telemetri, RSSI, heap, uptime
 *    - POST /api/sort    -> Perintah sortir warna (kuning, biru, merah)
 *    - POST /api/mode    -> Konfigurasi mode (Servo / Arm)
 *    - POST /api/stop    -> Emergency stop & reset servo ke posisi awal
 * 3. Kontrol aktuator servo PWM (Pin GPIO 18 untuk Flap/Gate, GPIO 19 untuk Arm)
 * ============================================================================== */

#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>

// ---------- Konfigurasi Wi-Fi ----------
const char* AP_SSID = "VERNOVA-ROBOT";
const char* AP_PASS = "vernova123";      // Kosongkan "" jika ingin open hotspot
const IPAddress AP_IP(192, 168, 4, 1);
const IPAddress AP_GW(192, 168, 4, 1);
const IPAddress AP_NET(255, 255, 255, 0);

// Opsional: Wi-Fi Station Mode (Router Lokal / Lab Sekolah)
const char* STA_SSID = "";               // Isi SSID router sekolah jika ada
const char* STA_PASS = "";               // Isi password router sekolah jika ada

// ---------- Konfigurasi Pin Hardware ----------
#define PIN_SERVO_FLAP 18  // Servo pemilah arah jalur (Bin 1 / 2 / 3)
#define PIN_SERVO_ARM  19  // Servo lengan pengangkat / penolak
#define PIN_LED_STATUS 2   // LED indikator onboard ESP32

// ---------- Objek & Variabel Global ----------
WebServer server(80);
Servo servoFlap;
Servo servoArm;

String deviceId = "VERNOVA-ESP32-01";
String currentMode = "Servo";
String deviceState = "READY"; // READY, BUSY, ERROR
unsigned long lastSortTime = 0;

// ---------- Helper: Pengaturan CORS Header ----------
void setCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Accept, X-Command-Id, X-Requested-With");
}

void handleOptions() {
  setCorsHeaders();
  server.send(204);
}

// ---------- Endpoint: GET /api/status ----------
void handleGetStatus() {
  setCorsHeaders();
  unsigned long uptimeSec = millis() / 1000;
  int rssi = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : -45;

  String json = "{";
  json += "\"ok\":true,";
  json += "\"deviceId\":\"" + deviceId + "\",";
  json += "\"firmwareVersion\":\"2.1.0\",";
  json += "\"state\":\"" + deviceState + "\",";
  json += "\"mode\":\"" + currentMode + "\",";
  json += "\"wifiRssi\":" + String(rssi) + ",";
  json += "\"freeHeap\":" + String(ESP.getFreeHeap()) + ",";
  json += "\"uptimeSec\":" + String(uptimeSec);
  json += "}";

  server.send(200, "application/json", json);
}

// ---------- Endpoint: POST /api/sort ----------
void handlePostSort() {
  setCorsHeaders();
  if (server.method() != HTTP_POST) {
    server.send(405, "application/json", "{\"ok\":false,\"error\":\"Method Not Allowed\"}");
    return;
  }

  String body = server.arg("plain");
  // Parsing parameter sederhana dari JSON
  String color = "";
  String commandId = "CMD_" + String(millis());

  int colorIdx = body.indexOf("\"color\":");
  if (colorIdx != -1) {
    int startQ = body.indexOf("\"", colorIdx + 8);
    int endQ = body.indexOf("\"", startQ + 1);
    if (startQ != -1 && endQ != -1) {
      color = body.substring(startQ + 1, endQ);
      color.toLowerCase();
    }
  }

  int idIdx = body.indexOf("\"commandId\":");
  if (idIdx != -1) {
    int startQ = body.indexOf("\"", idIdx + 12);
    int endQ = body.indexOf("\"", startQ + 1);
    if (startQ != -1 && endQ != -1) {
      commandId = body.substring(startQ + 1, endQ);
    }
  }

  if (color != "kuning" && color != "biru" && color != "merah") {
    server.send(400, "application/json", "{\"ok\":false,\"error\":\"Warna tidak valid. Wajib: kuning, biru, atau merah.\"}");
    return;
  }

  // Eksekusi pergerakan servo
  deviceState = "BUSY";
  digitalWrite(PIN_LED_STATUS, HIGH);

  int flapAngle = 90; // Default Netral
  if (color == "kuning") {
    flapAngle = 40;  // Bin 1: Kuning
  } else if (color == "biru") {
    flapAngle = 90;  // Bin 2: Biru
  } else if (color == "merah") {
    flapAngle = 140; // Bin 3: Merah
  }

  servoFlap.write(flapAngle);
  delay(120);

  // Jika mode ARM, lakukan gerakan dorong
  if (currentMode == "Arm") {
    servoArm.write(120);
    delay(250);
    servoArm.write(20);
  }

  digitalWrite(PIN_LED_STATUS, LOW);
  deviceState = "READY";
  lastSortTime = millis();

  // Kembalikan respons acknowledgment JSON
  String resp = "{";
  resp += "\"ok\":true,";
  resp += "\"commandId\":\"" + commandId + "\",";
  resp += "\"color\":\"" + color + "\",";
  resp += "\"mode\":\"" + currentMode + "\",";
  resp += "\"status\":\"COMMAND_RECEIVED\",";
  resp += "\"executionStatus\":\"confirmed_esp32_wifi\",";
  resp += "\"deviceId\":\"" + deviceId + "\",";
  resp += "\"message\":\"Perintah sortir " + color + " selesai dieksekusi.\"";
  resp += "}";

  server.send(200, "application/json", resp);
}

// ---------- Endpoint: POST /api/mode ----------
void handlePostMode() {
  setCorsHeaders();
  String body = server.arg("plain");
  if (body.indexOf("Arm") != -1 || body.indexOf("arm") != -1) {
    currentMode = "Arm";
  } else {
    currentMode = "Servo";
  }
  server.send(200, "application/json", "{\"ok\":true,\"mode\":\"" + currentMode + "\"}");
}

// ---------- Endpoint: POST /api/stop ----------
void handlePostStop() {
  setCorsHeaders();
  deviceState = "READY";
  servoFlap.write(90); // Posisi netral
  servoArm.write(20);  // Posisi rest
  digitalWrite(PIN_LED_STATUS, LOW);
  server.send(200, "application/json", "{\"ok\":true,\"status\":\"STOPPED\",\"message\":\"Emergency stop dieksekusi.\"}");
}

// ---------- Setup Program ----------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED_STATUS, OUTPUT);
  digitalWrite(PIN_LED_STATUS, LOW);

  // Inisialisasi Servo PWM ESP32
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  servoFlap.setPeriodHertz(50);
  servoArm.setPeriodHertz(50);
  servoFlap.attach(PIN_SERVO_FLAP, 500, 2400);
  servoArm.attach(PIN_SERVO_ARM, 500, 2400);
  servoFlap.write(90);
  servoArm.write(20);

  Serial.println("\n[VERNOVA] Memulai ESP32 Wi-Fi Smart Sorting Robot...");

  // 1. Aktifkan Mode Hotspot SoftAP (Mandiri)
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(AP_IP, AP_GW, AP_NET);
  WiFi.softAP(AP_SSID, AP_PASS);

  Serial.print("[Wi-Fi SoftAP Aktif] SSID: ");
  Serial.println(AP_SSID);
  Serial.print("[Wi-Fi SoftAP IP]   : http://");
  Serial.println(WiFi.softAPIP());

  // 2. Hubungkan ke Router jika SSID terisi
  if (String(STA_SSID).length() > 0) {
    WiFi.begin(STA_SSID, STA_PASS);
    Serial.print("[Wi-Fi STA] Menghubungkan ke: ");
    Serial.println(STA_SSID);
  }

  // 3. Daftarkan Endpoint Web Server REST API
  server.on("/api/status", HTTP_GET, handleGetStatus);
  server.on("/api/sort", HTTP_POST, handlePostSort);
  server.on("/api/mode", HTTP_POST, handlePostMode);
  server.on("/api/stop", HTTP_POST, handlePostStop);

  // OPTIONS handler untuk preflight CORS request browser
  server.on("/api/status", HTTP_OPTIONS, handleOptions);
  server.on("/api/sort", HTTP_OPTIONS, handleOptions);
  server.on("/api/mode", HTTP_OPTIONS, handleOptions);
  server.on("/api/stop", HTTP_OPTIONS, handleOptions);

  server.begin();
  Serial.println("[HTTP REST Server] Aktif di port 80. Siap menerima instruksi!");
}

// ---------- Loop Utama ----------
void loop() {
  server.handleClient();
  delay(2);
}
