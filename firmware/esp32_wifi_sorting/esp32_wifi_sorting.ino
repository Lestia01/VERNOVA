/* ==============================================================================
 * VERNOVA — R-LAB SMART SORTING FACTORY
 * Firmware ESP32 Dual Connection (Wi-Fi HTTP REST + Bluetooth BLE UART)
 * 
 * Board: ESP32 DevKit V1 / NodeMCU-32S / ESP32-WROOM-32
 * Framework: Arduino IDE (ESP32 Arduino Core)
 * 
 * Fitur Komunikasi Terpadu:
 * 1. Dual Wi-Fi Mode:
 *    - SoftAP Mode (Hotspot mandiri 'VERNOVA-ROBOT' IP: 192.168.4.1)
 *    - Station Mode (Koneksi ke Wi-Fi Lab Sekolah / Hotspot)
 *    - HTTP REST API dengan Full CORS (Endpoints: /api/health, /api/status, /api/sort, /api/mode, /api/stop, /api/test)
 * 2. Bluetooth Low Energy (BLE) GATT UART:
 *    - Service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e (Nordic UART Service)
 *    - RX Char UUID: 6e400002-b5a3-f393-e0a9-e50e24dcca9e (Web Write)
 *    - TX Char UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e (ESP32 Notify)
 *    - Kompatibilitas 100% dengan format perintah teks micro:bit MakeCode BLE!
 * 3. Logika Sortir Terpadu & Pencegahan Eksekusi Ganda:
 *    - Wi-Fi dan Bluetooth berbagi logika aktuator dan sensor yang sama persis.
 *    - Command deduplication & status BUSY mencegah tabrakan eksekusi dua koneksi.
 *    - Motor conveyor mati otomatis saat idle, terputus, atau emergency stop.
 * ============================================================================== */

#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// =========================================================================
// 1. KONFIGURASI WI-FI & BLE
// =========================================================================
const char* AP_SSID = "VERNOVA-ROBOT";
const char* AP_PASS = "vernova123";      // Password AP (minimal 8 karakter)
const IPAddress AP_IP(192, 168, 4, 1);
const IPAddress AP_GW(192, 168, 4, 1);
const IPAddress AP_NET(255, 255, 255, 0);

// Opsional: Hubungkan ke Wi-Fi Router / Hotspot Handphone
const char* STA_SSID = "";               // Contoh: "Lab-Robotik"
const char* STA_PASS = "";               // Contoh: "passwordLab"

// BLE UUID Standar Nordic Semiconductor UART Service (NUS)
#define BLE_SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define BLE_CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e" // Write dari Web
#define BLE_CHARACTERISTIC_UUID_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e" // Notify ke Web

// =========================================================================
// 2. PEMETAAN PIN PERANGKAT KERAS (GPIO MAPPING RESMI)
// =========================================================================
#define PIN_SENSOR_MERAH    14  // Sensor warna merah
#define PIN_SENSOR_BIRU     13  // Sensor warna biru
#define PIN_SENSOR_KUNING   35  // Sensor warna kuning (Input-only pada ESP32)
#define PIN_SENSOR_ARM      34  // Sensor kehadiran objek area ARM (Input-only)

#define PIN_MOTOR_ENA       25  // Motor Conveyor ENA (Enable/PWM)
#define PIN_MOTOR_IN        26  // Motor Conveyor IN (Direction/Run)

#define PIN_SERVO_FLAP      18  // Servo 1: Pemilah jalur (Flap/Gate)
#define PIN_SERVO_ARM       19  // Servo 2: Lengan robot (Arm)
#define PIN_LED_STATUS      2   // LED indikator onboard ESP32

// Logika aktif sensor (Active LOW untuk sensor proximity/optik)
#define SENSOR_ACTIVE_LEVEL LOW
#define SENSOR_DEBOUNCE_MS  30

// =========================================================================
// 3. OBJEK & VARIABEL GLOBAL
// =========================================================================
WebServer server(80);
Servo servoFlap;
Servo servoArm;

BLEServer *pBleServer = NULL;
BLECharacteristic *pBleTxChar = NULL;
bool bleConnected = false;
bool oldBleConnected = false;

String deviceId = "VERNOVA-ESP32";
String currentMode = "servo";     // "servo" atau "arm"
String deviceState = "READY";     // "READY", "BUSY", "ERROR", "STOPPED"
String lastCommandId = "";
unsigned long lastCommandTime = 0;
bool motorRunning = false;

// Debounce state 4 sensor fisik
struct SensorChannel {
  const char* name;
  uint8_t pin;
  bool isInputPullup;
  bool lastRaw;
  bool debouncedPresent;
  unsigned long lastDebounceTime;
};

SensorChannel sensors[4] = {
  { "MERAH",  PIN_SENSOR_MERAH,  true,  false, false, 0 },
  { "BIRU",   PIN_SENSOR_BIRU,   true,  false, false, 0 },
  { "KUNING", PIN_SENSOR_KUNING, false, false, false, 0 },
  { "ARM",    PIN_SENSOR_ARM,    false, false, false, 0 }
};

// =========================================================================
// 4. KONTROL MOTOR & AKTUATOR AMAN
// =========================================================================
void setMotorRunning(bool run) {
  motorRunning = run;
  if (run) {
    digitalWrite(PIN_MOTOR_ENA, HIGH);
    digitalWrite(PIN_MOTOR_IN, HIGH);
  } else {
    digitalWrite(PIN_MOTOR_ENA, LOW);
    digitalWrite(PIN_MOTOR_IN, LOW);
  }
}

void notifyBLE(String message) {
  if (bleConnected && pBleTxChar) {
    pBleTxChar->setValue(message.c_str());
    pBleTxChar->notify();
    delay(10);
  }
  Serial.print("[BLE TX] ");
  Serial.print(message);
  if (!message.endsWith("\n")) Serial.println();
}

// =========================================================================
// 5. LOGIKA SORTIR TERPADU (SHARED ENGINE WI-FI & BLE)
// =========================================================================
bool executeSorting(String color, String mode, String commandId, String transportSource) {
  color.toLowerCase();
  color.trim();

  // Validasi warna
  if (color != "kuning" && color != "biru" && color != "merah") {
    Serial.println("[ERR] Warna tidak valid: " + color);
    return false;
  }

  // Deduplikasi perintah
  unsigned long now = millis();
  if (commandId != "" && commandId == lastCommandId && (now - lastCommandTime) < 1200) {
    Serial.println("[WARN] Perintah duplikat ditekan (" + commandId + ")");
    return true;
  }

  // Tolak jika sedang sibuk menjalankan perintah sebelumnya
  if (deviceState == "BUSY") {
    Serial.println("[WARN] Robot sedang BUSY memproses sortir.");
    return false;
  }

  deviceState = "BUSY";
  lastCommandId = commandId;
  lastCommandTime = now;
  digitalWrite(PIN_LED_STATUS, HIGH);

  Serial.println("[SORT] Memulai sortir " + color + " (Mode: " + mode + ") via " + transportSource);

  // 1. Jalankan conveyor belt membawa objek
  setMotorRunning(true);
  notifyBLE("STATUS:BELT_MOVING\n");

  // 2. Tentukan sudut Flap Servo 1
  int flapAngle = 90; // Netral
  if (color == "kuning") flapAngle = 40;
  else if (color == "biru") flapAngle = 90;
  else if (color == "merah") flapAngle = 140;

  servoFlap.write(flapAngle);
  delay(150);

  // 3. Jika mode ARM, lakukan aksi gerakan dorong Servo 2
  if (mode == "arm" || currentMode == "arm") {
    notifyBLE("STATUS:ARM_WORKING\n");
    servoArm.write(120);
    delay(250);
    servoArm.write(20);
    delay(150);
    notifyBLE("STATUS:SERVO_DONE\n");
  }

  // 4. Selesaikan siklus sortir & hentikan motor
  delay(300);
  setMotorRunning(false);

  deviceState = "READY";
  digitalWrite(PIN_LED_STATUS, LOW);

  // Format respons balik identik dengan protokol micro:bit MakeCode!
  String colorUpper = color;
  colorUpper.toUpperCase();
  notifyBLE("DONE:" + colorUpper + "\n");
  notifyBLE("STATUS:READY\n");

  Serial.println("[SORT] Selesai sortir " + color + " (" + commandId + ")");
  return true;
}

void executeEmergencyStop() {
  setMotorRunning(false);
  servoFlap.write(90);
  servoArm.write(20);
  deviceState = "STOPPED";
  digitalWrite(PIN_LED_STATUS, LOW);

  Serial.println("[EMERGENCY STOP] Motor dimatikan, servo ke posisi aman.");
  notifyBLE("ACK:STOPPED\n");
  notifyBLE("STATUS:STOPPED\n");
}

void executeModeCommand(String modeName) {
  modeName.toLowerCase();
  modeName.trim();
  if (modeName == "arm") {
    currentMode = "arm";
    notifyBLE("ACK:ARM:READY\n");
  } else {
    currentMode = "servo";
    notifyBLE("ACK:SERVO:READY\n");
  }
  Serial.println("[MODE] Mode aktif diubah ke: " + currentMode);
}

void executeTestPulse() {
  digitalWrite(PIN_LED_STATUS, HIGH);
  delay(200);
  digitalWrite(PIN_LED_STATUS, LOW);
  notifyBLE("ACK:TEST:OK\n");
  Serial.println("[TEST PULSE] Acknowledged");
}

// =========================================================================
// 6. UPDATE & TELEMETRI SENSOR FISIK
// =========================================================================
void updateSensors() {
  unsigned long now = millis();
  for (int i = 0; i < 4; i++) {
    int rawRead = digitalRead(sensors[i].pin);
    bool isPresent = (rawRead == SENSOR_ACTIVE_LEVEL);

    if (isPresent != sensors[i].lastRaw) {
      sensors[i].lastRaw = isPresent;
      sensors[i].lastDebounceTime = now;
    }

    if ((now - sensors[i].lastDebounceTime) >= SENSOR_DEBOUNCE_MS) {
      if (sensors[i].debouncedPresent != isPresent) {
        sensors[i].debouncedPresent = isPresent;
        
        // Emisi pesan identik micro:bit: SENSOR:<NAME>:OBJECT_PRESENT
        String msg = "SENSOR:" + String(sensors[i].name) + ":" + (isPresent ? "OBJECT_PRESENT\n" : "OBJECT_ABSENT\n");
        notifyBLE(msg);

        if (isPresent) {
          notifyBLE("SENSOR:OBJECT_PRESENT\n");
        } else {
          bool any = false;
          for (int j = 0; j < 4; j++) if (sensors[j].debouncedPresent) any = true;
          if (!any) notifyBLE("SENSOR:OBJECT_ABSENT\n");
        }
      }
    }
  }
}

// =========================================================================
// 7. HANDLER HTTP REST API (WI-FI)
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

void handleHealth() {
  setCorsHeaders();
  unsigned long uptimeSec = millis() / 1000;
  int rssi = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : -45;

  String json = "{";
  json += "\"ok\":true,";
  json += "\"deviceId\":\"" + deviceId + "\",";
  json += "\"deviceType\":\"ESP32\",";
  json += "\"firmwareVersion\":\"2.3.0-DUAL\",";
  json += "\"state\":\"" + deviceState + "\",";
  json += "\"mode\":\"" + currentMode + "\",";
  json += "\"wifiRssi\":" + String(rssi) + ",";
  json += "\"freeHeap\":" + String(ESP.getFreeHeap()) + ",";
  json += "\"uptimeSec\":" + String(uptimeSec) + ",";
  json += "\"ip\":\"" + (WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : WiFi.softAPIP().toString()) + "\",";
  json += "\"bleActive\":" + String(bleConnected ? "true" : "false");
  json += "}";

  server.send(200, "application/json", json);
}

void handleSort() {
  setCorsHeaders();
  if (server.method() == HTTP_OPTIONS) { server.send(204); return; }
  if (server.method() != HTTP_POST) {
    server.send(405, "application/json", "{\"ok\":false,\"error\":\"Method Not Allowed\"}");
    return;
  }

  String body = server.arg("plain");
  String color = "";
  String mode = currentMode;
  String commandId = "CMD_" + String(millis());

  // Parser JSON sederhana
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

  bool ok = executeSorting(color, mode, commandId, "Wi-Fi HTTP");
  if (!ok) {
    server.send(400, "application/json", "{\"ok\":false,\"error\":\"Gagal mengeksekusi sortir atau perangkat sibuk.\"}");
    return;
  }

  String resp = "{\"ok\":true,\"color\":\"" + color + "\",\"mode\":\"" + mode + "\",\"commandId\":\"" + commandId + "\",\"status\":\"COMPLETED\"}";
  server.send(200, "application/json", resp);
}

void handleMode() {
  setCorsHeaders();
  if (server.method() == HTTP_OPTIONS) { server.send(204); return; }
  String body = server.arg("plain");
  String mode = "servo";
  if (body.indexOf("arm") != -1) mode = "arm";
  executeModeCommand(mode);
  server.send(200, "application/json", "{\"ok\":true,\"mode\":\"" + currentMode + "\"}");
}

void handleStop() {
  setCorsHeaders();
  if (server.method() == HTTP_OPTIONS) { server.send(204); return; }
  executeEmergencyStop();
  server.send(200, "application/json", "{\"ok\":true,\"status\":\"STOPPED\"}");
}

void handleTest() {
  setCorsHeaders();
  if (server.method() == HTTP_OPTIONS) { server.send(204); return; }
  executeTestPulse();
  server.send(200, "application/json", "{\"ok\":true,\"message\":\"Test pulse acknowledged\"}");
}

// =========================================================================
// 8. CALLBACKS BLE GATT (BLUETOOTH)
// =========================================================================
class ServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    bleConnected = true;
    digitalWrite(PIN_LED_STATUS, HIGH);
    Serial.println("[BLE] Client terhubung!");
    notifyBLE("STATUS:READY\n");
  }

  void onDisconnect(BLEServer* pServer) {
    bleConnected = false;
    digitalWrite(PIN_LED_STATUS, LOW);
    setMotorRunning(false);
    Serial.println("[BLE] Client terputus!");
  }
};

class CharCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) {
    String rx = pChar->getValue().c_str();
    rx.trim();
    if (rx.length() == 0) return;

    Serial.println("[BLE RX] " + rx);

    // Format Perintah Identik micro:bit MakeCode!
    if (rx == "kuning" || rx == "sort:kuning" || rx.indexOf("kuning") != -1) {
      executeSorting("kuning", currentMode, "CMD_BLE_" + String(millis()), "BLE UART");
    } else if (rx == "biru" || rx == "sort:biru" || rx.indexOf("biru") != -1) {
      executeSorting("biru", currentMode, "CMD_BLE_" + String(millis()), "BLE UART");
    } else if (rx == "merah" || rx == "sort:merah" || rx.indexOf("merah") != -1) {
      executeSorting("merah", currentMode, "CMD_BLE_" + String(millis()), "BLE UART");
    } else if (rx == "arm" || rx == "mech:arm") {
      executeModeCommand("arm");
    } else if (rx == "servo" || rx == "mech:servo") {
      executeModeCommand("servo");
    } else if (rx == "stop") {
      executeEmergencyStop();
    } else if (rx == "test") {
      executeTestPulse();
    }
  }
};

// =========================================================================
// 9. SETUP & LOOP UTAMA
// =========================================================================
void setup() {
  Serial.begin(115200);
  delay(100);

  Serial.println("\n==============================================");
  Serial.println("  VERNOVA — ESP32 Dual Connection (Wi-Fi + BLE)");
  Serial.println("==============================================");

  // Konfigurasi Pin Digital
  pinMode(PIN_LED_STATUS, OUTPUT);
  pinMode(PIN_MOTOR_ENA, OUTPUT);
  pinMode(PIN_MOTOR_IN, OUTPUT);
  setMotorRunning(false);
  digitalWrite(PIN_LED_STATUS, LOW);

  // Konfigurasi 4 Sensor Fisik
  pinMode(PIN_SENSOR_MERAH, INPUT_PULLUP);
  pinMode(PIN_SENSOR_BIRU, INPUT_PULLUP);
  pinMode(PIN_SENSOR_KUNING, INPUT); // GPIO 35 input-only
  pinMode(PIN_SENSOR_ARM, INPUT);    // GPIO 34 input-only

  // Konfigurasi PWM Servo ESP32
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  servoFlap.setPeriodHertz(50);
  servoArm.setPeriodHertz(50);
  servoFlap.attach(PIN_SERVO_FLAP, 500, 2400);
  servoArm.attach(PIN_SERVO_ARM, 500, 2400);
  servoFlap.write(90);
  servoArm.write(20);

  // 1. Inisialisasi Wi-Fi (SoftAP + Opsional Station)
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(AP_IP, AP_GW, AP_NET);
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.println("[Wi-Fi AP] Hotspot aktif: " + String(AP_SSID));
  Serial.println("[Wi-Fi AP] Alamat IP: http://" + WiFi.softAPIP().toString());

  if (String(STA_SSID).length() > 0) {
    Serial.println("[Wi-Fi STA] Menghubungkan ke: " + String(STA_SSID));
    WiFi.begin(STA_SSID, STA_PASS);
  }

  // 2. Setup Server HTTP REST
  server.on("/api/health", HTTP_GET, handleHealth);
  server.on("/api/status", HTTP_GET, handleHealth);
  server.on("/api/sort", HTTP_POST, handleSort);
  server.on("/api/mode", HTTP_POST, handleMode);
  server.on("/api/stop", HTTP_POST, handleStop);
  server.on("/api/test", HTTP_POST, handleTest);
  server.onNotFound(handleOptions);
  server.begin();
  Serial.println("[HTTP Server] Port 80 aktif!");

  // 3. Inisialisasi Bluetooth BLE Nordic UART Service (NUS)
  BLEDevice::init("VERNOVA-ESP32");
  pBleServer = BLEDevice::createServer();
  pBleServer->setCallbacks(new ServerCallbacks());

  BLEService *pBleService = pBleServer->createService(BLE_SERVICE_UUID);

  pBleTxChar = pBleService->createCharacteristic(
                 BLE_CHARACTERISTIC_UUID_TX,
                 BLECharacteristic::PROPERTY_NOTIFY
               );
  pBleTxChar->addDescriptor(new BLE2902());

  BLECharacteristic *pBleRxChar = pBleService->createCharacteristic(
                                    BLE_CHARACTERISTIC_UUID_RX,
                                    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
                                  );
  pBleRxChar->setCallbacks(new CharCallbacks());

  pBleService->start();
  pBleServer->getAdvertising()->start();
  Serial.println("[BLE Server] Advertising 'VERNOVA-ESP32' aktif!");
  Serial.println("[SIAP] ESP32 siap menerima koneksi Wi-Fi maupun Bluetooth!\n");
}

void loop() {
  // Tangani HTTP Client Wi-Fi
  server.handleClient();

  // Tangani Re-advertising BLE jika terputus
  if (!bleConnected && oldBleConnected) {
    delay(500);
    pBleServer->startAdvertising();
    Serial.println("[BLE] Mulai advertising ulang...");
    oldBleConnected = bleConnected;
  }
  if (bleConnected && !oldBleConnected) {
    oldBleConnected = bleConnected;
  }

  // Update pembacaan sensor fisik dengan debounce
  updateSensors();

  delay(2);
}
