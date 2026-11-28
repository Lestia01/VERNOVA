/* ==============================================================================
 * VERNOVA — R-LAB SMART SORTING FACTORY
 * Firmware ESP32 Dual Connection (Wi-Fi HTTP REST + Bluetooth BLE UART)
 * 
 * Board: ESP32 DevKit V1 / NodeMCU-32S / ESP32-WROOM-32
 * Framework: Arduino IDE (ESP32 Arduino Core 2.x & 3.x Compatible)
 * 
 * Fitur Komunikasi Terpadu & Diagnostik Telemetri Sensor:
 * 1. Dual Wi-Fi Mode:
 *    - SoftAP Mode (Hotspot mandiri 'VERNOVA-ROBOT' IP: 192.168.4.1)
 *    - Station Mode (Koneksi ke Wi-Fi Lab Sekolah / Hotspot)
 *    - HTTP REST API dengan Full CORS (/api/health, /api/status, /api/sort, /api/mode, /api/stop, /api/test)
 * 2. Bluetooth Low Energy (BLE) Nordic UART Service (NUS):
 *    - Service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
 *    - RX Char UUID: 6e400002-b5a3-f393-e0a9-e50e24dcca9e (Web Write)
 *    - TX Char UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e (ESP32 Notify)
 *    - MTU 517 didukung untuk transmisi data cepat tanpa terpotong
 * 3. Telemetri Sensor Fisik Berdasarkan MakeCode micro:bit & Nilai Mentah (ADC):
 *    - Sensor Merah (GPIO 14, digital active LOW)
 *    - Sensor Biru  (GPIO 13, digital active LOW)
 *    - Sensor Kuning (GPIO 35, analog ADC: range 50 < value <= 400)
 *    - Sensor Arm    (GPIO 34, analog ADC: value < 600)
 *    - Emisi JSON satu baris \n: {"type":"sensor_update",...} & {"type":"sensor_state",...}
 *    - Emisi Fallback Teks: "merah", "kuning", "biru", "arm", "kosong" (sendTextLine)
 *    - Emisi Format micro:bit: SENSOR:<NAME>:OBJECT_PRESENT, STATUS:..., DONE:...
 * 4. Sinkronisasi Koneksi Aman:
 *    - Snapshot telemetri dikirim otomatis 600ms pasca-koneksi (setelah browser startNotifications)
 *    - Menanggapi perintah kueri "get_sensors" / "status" secara langsung
 *    - Heartbeat berkala 1500ms mengirim nilai mentah sensor untuk kalibrasi real-time di web
 * 5. Kontrol Aktuator Aman:
 *    - Kecepatan PWM Motor: Mode Servo = 200/255, Mode Arm = 150/255
 *    - Sudut Servo Flap: Standby 90°, Sortir 30° (atau 40°/90°/140° per warna)
 *    - Sudut Servo Arm: Standby 90°, Push 180°
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
#define PIN_SENSOR_MERAH    14  // Sensor warna merah (Digital active LOW)
#define PIN_SENSOR_BIRU     13  // Sensor warna biru (Digital active LOW)
#define PIN_SENSOR_KUNING   35  // Sensor warna kuning (Analog ADC, Input-only)
#define PIN_SENSOR_ARM      34  // Sensor objek arm belt (Analog ADC, Input-only)

#define PIN_MOTOR_ENA       25  // Motor Conveyor ENA (Enable/PWM)
#define PIN_MOTOR_IN        26  // Motor Conveyor IN (Direction/Run)

#define PIN_SERVO_FLAP      18  // Servo 1: Pemilah jalur (Flap)
#define PIN_SERVO_ARM       19  // Servo 2: Lengan robot (Arm)
#define PIN_LED_STATUS      2   // LED indikator onboard ESP32

// Mode pin sensor digital: INPUT aman untuk modul komparator LM393 push-pull/pullup eksternal
#define SENSOR_DIGITAL_MODE INPUT

// =========================================================================
// 3. PARAMETER AKTUATOR & KALIBRASI SENSOR
// =========================================================================
// Kecepatan PWM Motor (0 - 255)
#define PWM_SPEED_SERVO     200 // Kecepatan mode servo: 200 dari 255
#define PWM_SPEED_ARM       150 // Kecepatan mode arm: 150 dari 255

// Sudut Gerakan Servo
#define SERVO_STANDBY_ANGLE      90  // Standby servo flap (90 derajat)
#define SERVO_SORT_ANGLE         30  // Sudut sortir umum (30 derajat)
#define SERVO_ARM_STANDBY_ANGLE  90  // Standby servo lengan robot (90 derajat)
#define SERVO_ARM_PUSH_ANGLE    180  // Gerakan dorong mode arm (180 derajat)

// Sudut spesifik flap jalur warna
#define SERVO_FLAP_KUNING        40
#define SERVO_FLAP_BIRU          90
#define SERVO_FLAP_MERAH        140

// Kalibrasi Threshold Sensor Analog (ESP32 ADC 12-bit: 0 - 4095)
int thresholdKuningMin = 50;     // Deteksi kuning jika: value > 50 && value <= 400
int thresholdKuningMax = 400;
int thresholdArmMax    = 600;    // Deteksi arm jika: value < 600

#define SENSOR_DEBOUNCE_MS      30   // Debounce filter (ms)
#define HEARTBEAT_INTERVAL_MS   1500 // Interval heartbeat telemetri sensor ke web (1.5s)

// =========================================================================
// 4. OBJEK & VARIABEL GLOBAL
// =========================================================================
WebServer server(80);
Servo servoFlap;
Servo servoArm;

BLEServer *pBleServer = NULL;
BLECharacteristic *pBleTxChar = NULL;
bool bleConnected = false;
bool oldBleConnected = false;
bool pendingInitialSync = false;
unsigned long bleConnectTimestamp = 0;

String deviceId = "VERNOVA-ESP32";
String currentMode = "servo";     // "servo" atau "arm"
String deviceState = "READY";     // "READY", "BUSY", "ERROR", "STOPPED"
String lastCommandId = "";
unsigned long lastCommandTime = 0;
bool motorRunning = false;

// Struktur State Sensor
struct SensorData {
  bool detected;
  int rawValue;
  bool lastRawDetected;
  unsigned long lastDebounceTime;
};

SensorData sensorMerah  = { false, 1, false, 0 };
SensorData sensorBiru   = { false, 1, false, 0 };
SensorData sensorKuning = { false, 4095, false, 0 };
SensorData sensorArm    = { false, 4095, false, 0 };

unsigned long lastHeartbeatTime = 0;

// =========================================================================
// 5. KONTROL MOTOR & AKTUATOR AMAN (CORE 2.x & 3.x COMPATIBLE)
// =========================================================================
void setMotorRunning(bool run, int customPwm = -1) {
  motorRunning = run;
  if (run) {
    int pwm = (customPwm >= 0) ? customPwm : (currentMode == "arm" ? PWM_SPEED_ARM : PWM_SPEED_SERVO);
    pwm = constrain(pwm, 0, 255);
    analogWrite(PIN_MOTOR_ENA, pwm);
    digitalWrite(PIN_MOTOR_IN, HIGH);
  } else {
    analogWrite(PIN_MOTOR_ENA, 0);
    digitalWrite(PIN_MOTOR_IN, LOW);
  }
}

// Fungsi pengiriman notifikasi BLE aman dengan newline delimiter
void notifyBLE(String message) {
  if (!message.endsWith("\n")) {
    message += "\n";
  }
  if (bleConnected && pBleTxChar) {
    pBleTxChar->setValue(message.c_str());
    pBleTxChar->notify();
    delay(10); // Memberi jeda bagi BLE stack untuk transmisi paket
  }
  Serial.print("[BLE TX NOTIFY] ");
  Serial.print(message);
}

// Kompatibilitas fungsi sendTextLine untuk MakeCode micro:bit
void sendTextLine(String text) {
  notifyBLE(text);
}

// =========================================================================
// 6. TELEMETRI SENSOR JSON & TEKS
// =========================================================================
void sendSensorUpdate(const char* name, bool detected, int rawValue) {
  unsigned long ts = millis();

  // 1. JSON Telemetri Standar (Satu Baris \n)
  String json = "{\"type\":\"sensor_update\",\"sensor\":\"" + String(name) +
                "\",\"detected\":" + (detected ? "true" : "false") +
                ",\"value\":" + String(rawValue) +
                ",\"timestamp\":" + String(ts) + "}\n";
  notifyBLE(json);

  // 2. Format Teks Kompatibel MakeCode micro:bit
  String nameUpper = String(name);
  nameUpper.toUpperCase();
  String legacy = "SENSOR:" + nameUpper + ":" + (detected ? "OBJECT_PRESENT\n" : "OBJECT_ABSENT\n");
  notifyBLE(legacy);

  // 3. Fallback nama warna langsung (merah, kuning, biru, arm, kosong)
  if (detected) {
    sendTextLine(String(name));
  } else {
    bool any = sensorMerah.detected || sensorBiru.detected || sensorKuning.detected || sensorArm.detected;
    if (!any) sendTextLine("kosong");
  }
}

void sendFullSensorState() {
  unsigned long ts = millis();

  // JSON State Lengkap termasuk status deteksi DAN nilai mentah ADC untuk kalibrasi UI
  String json = "{\"type\":\"sensor_state\",\"mode\":\"" + currentMode + "\",\"sensors\":{";
  json += "\"merah\":" + String(sensorMerah.detected ? "true" : "false") + ",";
  json += "\"biru\":" + String(sensorBiru.detected ? "true" : "false") + ",";
  json += "\"kuning\":" + String(sensorKuning.detected ? "true" : "false") + ",";
  json += "\"arm\":" + String(sensorArm.detected ? "true" : "false");
  json += "},\"rawValues\":{";
  json += "\"merah\":" + String(sensorMerah.rawValue) + ",";
  json += "\"biru\":" + String(sensorBiru.rawValue) + ",";
  json += "\"kuning\":" + String(sensorKuning.rawValue) + ",";
  json += "\"arm\":" + String(sensorArm.rawValue);
  json += "},\"timestamp\":" + String(ts) + "}\n";
  notifyBLE(json);

  bool anyDetected = sensorMerah.detected || sensorBiru.detected || sensorKuning.detected || sensorArm.detected;
  notifyBLE(anyDetected ? "SENSOR:OBJECT_PRESENT\n" : "SENSOR:OBJECT_ABSENT\n");

  // Fallback teks ringkas warna
  if (sensorMerah.detected) sendTextLine("merah");
  else if (sensorBiru.detected) sendTextLine("biru");
  else if (sensorKuning.detected) sendTextLine("kuning");
  else if (sensorArm.detected) sendTextLine("arm");
  else sendTextLine("kosong");
}

void printSensorDebug(const char* name, int raw, bool detected) {
  Serial.print("[SENSOR READ] ");
  Serial.print(name);
  Serial.print(" raw=");
  Serial.print(raw);
  Serial.print(" detected=");
  Serial.println(detected ? "true" : "false");
}

// =========================================================================
// 7. PEMBACAAN & DEBOUNCE SENSOR FISIK
// =========================================================================
void updateSensors() {
  unsigned long now = millis();
  bool stateChanged = false;

  // 1. Sensor Merah (GPIO 14, Digital Active LOW)
  int rawM = digitalRead(PIN_SENSOR_MERAH);
  bool detM = (rawM == LOW);
  sensorMerah.rawValue = rawM;
  if (detM != sensorMerah.lastRawDetected) {
    sensorMerah.lastRawDetected = detM;
    sensorMerah.lastDebounceTime = now;
  }
  if ((now - sensorMerah.lastDebounceTime) >= SENSOR_DEBOUNCE_MS) {
    if (sensorMerah.detected != detM) {
      sensorMerah.detected = detM;
      stateChanged = true;
      printSensorDebug("merah", rawM, detM);
      sendSensorUpdate("merah", detM, rawM);
    }
  }

  // 2. Sensor Biru (GPIO 13, Digital Active LOW)
  int rawB = digitalRead(PIN_SENSOR_BIRU);
  bool detB = (rawB == LOW);
  sensorBiru.rawValue = rawB;
  if (detB != sensorBiru.lastRawDetected) {
    sensorBiru.lastRawDetected = detB;
    sensorBiru.lastDebounceTime = now;
  }
  if ((now - sensorBiru.lastDebounceTime) >= SENSOR_DEBOUNCE_MS) {
    if (sensorBiru.detected != detB) {
      sensorBiru.detected = detB;
      stateChanged = true;
      printSensorDebug("biru", rawB, detB);
      sendSensorUpdate("biru", detB, rawB);
    }
  }

  // 3. Sensor Kuning (GPIO 35, Analog ADC: 50 < value <= 400)
  int rawK = analogRead(PIN_SENSOR_KUNING);
  bool detK = (rawK > thresholdKuningMin && rawK <= thresholdKuningMax);
  sensorKuning.rawValue = rawK;
  if (detK != sensorKuning.lastRawDetected) {
    sensorKuning.lastRawDetected = detK;
    sensorKuning.lastDebounceTime = now;
  }
  if ((now - sensorKuning.lastDebounceTime) >= SENSOR_DEBOUNCE_MS) {
    if (sensorKuning.detected != detK) {
      sensorKuning.detected = detK;
      stateChanged = true;
      printSensorDebug("kuning", rawK, detK);
      sendSensorUpdate("kuning", detK, rawK);
    }
  }

  // 4. Sensor Arm (GPIO 34, Analog ADC: value < 600)
  int rawA = analogRead(PIN_SENSOR_ARM);
  bool detA = (rawA < thresholdArmMax);
  sensorArm.rawValue = rawA;
  if (detA != sensorArm.lastRawDetected) {
    sensorArm.lastRawDetected = detA;
    sensorArm.lastDebounceTime = now;
  }
  if ((now - sensorArm.lastDebounceTime) >= SENSOR_DEBOUNCE_MS) {
    if (sensorArm.detected != detA) {
      sensorArm.detected = detA;
      stateChanged = true;
      printSensorDebug("arm", rawA, detA);
      sendSensorUpdate("arm", detA, rawA);
    }
  }

  // Jika ada perubahan pada salah satu sensor, perbarui state keseluruhan
  if (stateChanged) {
    sendFullSensorState();
  }

  // Heartbeat berkala (setiap 1.5 detik) untuk memperbarui nilai mentah dan sinkronisasi UI
  if (now - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatTime = now;
    if (bleConnected) {
      sendFullSensorState();
      Serial.printf("[SENSOR HEARTBEAT] M:%s(%d) B:%s(%d) K:%s(%d) ARM:%s(%d)\n",
                    sensorMerah.detected ? "ON" : "OFF", sensorMerah.rawValue,
                    sensorBiru.detected ? "ON" : "OFF", sensorBiru.rawValue,
                    sensorKuning.detected ? "ON" : "OFF", sensorKuning.rawValue,
                    sensorArm.detected ? "ON" : "OFF", sensorArm.rawValue);
    }
  }
}

// =========================================================================
// 8. LOGIKA SORTIR TERPADU (SHARED ENGINE WI-FI & BLE)
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

  // Mode Arm vs Mode Servo
  bool isArmMode = (mode == "arm" || currentMode == "arm");

  if (isArmMode) {
    // -------------------------------------------------------------
    // ALUR SORTIR MODE ARM
    // -------------------------------------------------------------
    // 1. Jalankan conveyor belt dengan PWM ARM (150/255)
    setMotorRunning(true, PWM_SPEED_ARM);
    notifyBLE("STATUS:BELT_MOVING\n");

    // Pastikan Flap pada posisi standby (90 derajat)
    servoFlap.write(SERVO_STANDBY_ANGLE);

    // Tunggu kehadiran objek di sensor arm (GPIO 34) dengan batas waktu 4 detik
    unsigned long waitStart = millis();
    bool armSensorTriggered = false;
    while (millis() - waitStart < 4000) {
      updateSensors();
      if (sensorArm.detected) {
        armSensorTriggered = true;
        break;
      }
      delay(10);
    }

    if (armSensorTriggered) {
      notifyBLE("STATUS:OBJECT_DETECTED\n");
      notifyBLE("{\"type\":\"status_update\",\"stage\":\"OBJECT_DETECTED\",\"sensor\":\"arm\"}\n");
      Serial.println("[ARM] Objek terdeteksi di sensor arm GPIO 34!");
    }

    // 2. Hentikan motor sejenak agar objek siap didorong
    setMotorRunning(false);
    notifyBLE("STATUS:ARM_WORKING\n");
    delay(100);

    // 3. Servo 2 (Lengan Robot) bergerak mendorong ke 180 derajat
    servoArm.write(SERVO_ARM_PUSH_ANGLE);
    delay(400);

    // Kembalikan ke posisi standby
    servoArm.write(SERVO_ARM_STANDBY_ANGLE);
    delay(250);
    notifyBLE("STATUS:SERVO_DONE\n");

    // 4. Lanjutkan belt untuk membersihkan jalur
    setMotorRunning(true, PWM_SPEED_ARM);
    notifyBLE("STATUS:BELT_RESUMED\n");
    notifyBLE("{\"type\":\"status_update\",\"stage\":\"BELT_RESUMED\"}\n");
    delay(400);
    setMotorRunning(false);

  } else {
    // -------------------------------------------------------------
    // ALUR SORTIR MODE SERVO (FLAP)
    // -------------------------------------------------------------
    // 1. Jalankan conveyor belt dengan PWM SERVO (200/255)
    setMotorRunning(true, PWM_SPEED_SERVO);
    notifyBLE("STATUS:BELT_MOVING\n");

    // 2. Tentukan sudut Flap Servo 1
    int flapAngle = SERVO_STANDBY_ANGLE;
    if (color == "kuning") flapAngle = SERVO_FLAP_KUNING;
    else if (color == "biru") flapAngle = SERVO_FLAP_BIRU;
    else if (color == "merah") flapAngle = SERVO_FLAP_MERAH;

    servoFlap.write(flapAngle);
    delay(350);

    // Kembalikan flap ke standby setelah objek terarah
    servoFlap.write(SERVO_STANDBY_ANGLE);
    delay(200);

    // 3. Selesaikan siklus sortir & hentikan motor
    setMotorRunning(false);
  }

  deviceState = "READY";
  digitalWrite(PIN_LED_STATUS, LOW);

  // Format respons balik identik dengan protokol micro:bit MakeCode & NUS UART!
  if (isArmMode) {
    sendTextLine("STATUS mode=arm motor=off message=sort_arm_" + color + "_done");
    if (color == "biru") {
      sendTextLine("STATUS mode=arm motor=on message=arm_object_biru_pass_through");
    } else {
      sendTextLine("STATUS mode=arm motor=off message=arm_object_" + color + "_detected_motor_stopped");
    }
  } else {
    sendTextLine("STATUS mode=servo motor=on message=sort_servo_" + color + "_done");
  }

  String colorUpper = color;
  colorUpper.toUpperCase();
  notifyBLE("DONE:" + colorUpper + "\n");
  notifyBLE("STATUS:READY\n");

  Serial.println("[SORT] Selesai sortir " + color + " (" + commandId + ")");
  return true;
}

void executeEmergencyStop() {
  setMotorRunning(false);
  servoFlap.write(SERVO_STANDBY_ANGLE);
  servoArm.write(SERVO_ARM_STANDBY_ANGLE);
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
  sendFullSensorState();
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
// 9. HANDLER HTTP REST API (WI-FI)
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
  json += "\"firmwareVersion\":\"2.4.1-DUAL\",";
  json += "\"state\":\"" + deviceState + "\",";
  json += "\"mode\":\"" + currentMode + "\",";
  json += "\"wifiRssi\":" + String(rssi) + ",";
  json += "\"freeHeap\":" + String(ESP.getFreeHeap()) + ",";
  json += "\"uptimeSec\":" + String(uptimeSec) + ",";
  json += "\"ip\":\"" + (WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : WiFi.softAPIP().toString()) + "\",";
  json += "\"bleActive\":" + String(bleConnected ? "true" : "false") + ",";
  json += "\"sensors\":{";
  json += "\"merah\":{\"detected\":" + String(sensorMerah.detected ? "true" : "false") + ",\"raw\":" + String(sensorMerah.rawValue) + "},";
  json += "\"biru\":{\"detected\":" + String(sensorBiru.detected ? "true" : "false") + ",\"raw\":" + String(sensorBiru.rawValue) + "},";
  json += "\"kuning\":{\"detected\":" + String(sensorKuning.detected ? "true" : "false") + ",\"raw\":" + String(sensorKuning.rawValue) + "},";
  json += "\"arm\":{\"detected\":" + String(sensorArm.detected ? "true" : "false") + ",\"raw\":" + String(sensorArm.rawValue) + "}";
  json += "}";
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
  int cmdIdx = body.indexOf("\"command\":");
  if (cmdIdx != -1) {
    int start = body.indexOf("\"", cmdIdx + 10) + 1;
    int end = body.indexOf("\"", start);
    if (start > 0 && end > start) {
      String fullCmd = body.substring(start, end);
      Serial.println("[HTTP POST /api/sort] Command: " + fullCmd);
    }
  }

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

  // Fallback parsing jika payload dikirim format teks
  if (color == "") {
    if (body.indexOf("kuning") != -1) color = "kuning";
    else if (body.indexOf("biru") != -1) color = "biru";
    else if (body.indexOf("merah") != -1) color = "merah";
  }
  if (body.indexOf("arm") != -1) mode = "arm";
  else if (body.indexOf("servo") != -1) mode = "servo";

  Serial.println("[HTTP POST /api/sort] Color: " + color + ", Mode: " + mode + " -> (" + color + " " + mode + ")");

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
// 10. CALLBACKS BLE GATT (BLUETOOTH)
// =========================================================================
class ServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    bleConnected = true;
    pendingInitialSync = true;
    bleConnectTimestamp = millis();
    digitalWrite(PIN_LED_STATUS, HIGH);
    Serial.println("[BLE CONN] Client terhubung. Menunggu kesiapan browser (startNotifications)...");
  }

  void onDisconnect(BLEServer* pServer) {
    bleConnected = false;
    pendingInitialSync = false;
    digitalWrite(PIN_LED_STATUS, LOW);
    setMotorRunning(false);
    Serial.println("[BLE CONN] Client terputus!");
  }
};

class CharCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) {
    String rx = pChar->getValue().c_str();
    rx.trim();
    if (rx.length() == 0) return;

    Serial.println("[BLE RX] " + rx);

    // Kueri Status / Snapshot Telemetri dari Web
    if (rx == "get_sensors" || rx == "status" || rx == "sensors" || rx == "query") {
      Serial.println("[BLE RX Query] Permintaan telemetri sensor diterima dari web. Mengirim snapshot...");
      sendFullSensorState();
      return;
    }

    String rxNorm = rx;
    rxNorm.toLowerCase();
    rxNorm.replace("_", " ");

    // 1. Ekstrak Warna (merah, kuning, biru)
    String targetColor = "";
    if (rxNorm.indexOf("kuning") != -1) targetColor = "kuning";
    else if (rxNorm.indexOf("biru") != -1) targetColor = "biru";
    else if (rxNorm.indexOf("merah") != -1) targetColor = "merah";

    // 2. Ekstrak Mekanisme/Mode (servo atau arm)
    String targetMode = currentMode;
    if (rxNorm.indexOf("arm") != -1) {
      targetMode = "arm";
      currentMode = "arm";
    } else if (rxNorm.indexOf("servo") != -1) {
      targetMode = "servo";
      currentMode = "servo";
    }

    // 3. Eksekusi Berdasarkan Perintah
    if (targetColor != "") {
      executeSorting(targetColor, targetMode, "CMD_BLE_" + String(millis()), "BLE UART");
    } else if (rxNorm == "arm" || rxNorm == "mech arm" || rxNorm == "mech:arm") {
      executeModeCommand("arm");
    } else if (rxNorm == "servo" || rxNorm == "mech servo" || rxNorm == "mech:servo") {
      executeModeCommand("servo");
    } else if (rxNorm == "stop") {
      executeEmergencyStop();
    } else if (rxNorm == "test") {
      executeTestPulse();
    }
  }
};

// =========================================================================
// 11. SETUP & LOOP UTAMA
// =========================================================================
void setup() {
  Serial.begin(115200);
  delay(100);

  Serial.println("\n==============================================");
  Serial.println("  VERNOVA — ESP32 Dual Connection (Wi-Fi + BLE)");
  Serial.println("  Firmware Sensor & Actuator v2.4.1 (Diagnostik)");
  Serial.println("==============================================");

  // Konfigurasi Pin Digital Aktuator
  pinMode(PIN_LED_STATUS, OUTPUT);
  pinMode(PIN_MOTOR_ENA, OUTPUT);
  pinMode(PIN_MOTOR_IN, OUTPUT);
  setMotorRunning(false);
  digitalWrite(PIN_LED_STATUS, LOW);

  // Konfigurasi 4 Sensor Fisik
  pinMode(PIN_SENSOR_MERAH, SENSOR_DIGITAL_MODE);
  pinMode(PIN_SENSOR_BIRU, SENSOR_DIGITAL_MODE);
  pinMode(PIN_SENSOR_KUNING, INPUT); // GPIO 35 input-only (ADC)
  pinMode(PIN_SENSOR_ARM, INPUT);    // GPIO 34 input-only (ADC)

  // Konfigurasi PWM Servo ESP32
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  servoFlap.setPeriodHertz(50);
  servoArm.setPeriodHertz(50);
  servoFlap.attach(PIN_SERVO_FLAP, 500, 2400);
  servoArm.attach(PIN_SERVO_ARM, 500, 2400);
  servoFlap.write(SERVO_STANDBY_ANGLE);
  servoArm.write(SERVO_ARM_STANDBY_ANGLE);

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
  BLEDevice::setMTU(517); // Negosiasi MTU 517 byte agar paket JSON telemetri tidak terfragmentasi

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

  // Kirim snapshot telemetri sensor awal setelah browser selesai melakukan startNotifications (~600ms)
  if (pendingInitialSync && (millis() - bleConnectTimestamp >= 600)) {
    pendingInitialSync = false;
    Serial.println("[BLE] Browser siap. Mengirimkan snapshot telemetri sensor awal...");
    sendFullSensorState();
  }

  // Update pembacaan sensor fisik dengan debounce & emisi telemetri
  updateSensors();

  delay(2);
}
