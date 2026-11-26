/* ==============================================================================
 * VERNOVA — R-LAB SMART SORTING FACTORY
 * Firmware Kontrol Robotik ESP32 BLE GATT UART (Versi 2.1.0-BLE)
 * 
 * Board: ESP32 Dev Module / ESP32-WROOM-32 / NodeMCU-32S
 * Framework: Arduino ESP32 Core
 * 
 * Mengimplementasikan Nordic UART Service (NUS) melalui Bluetooth Low Energy (BLE):
 * - Service UUID: 6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 * - RX Char UUID: 6E400002-B5A3-F393-E0A9-E50E24DCCA9E (Tulis dari Web)
 * - TX Char UUID: 6E400003-B5A3-F393-E0A9-E50E24DCCA9E (Notifikasi ke Web)
 * ============================================================================== */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ESP32Servo.h>

#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

#define PIN_SERVO_FLAP    18
#define PIN_SERVO_ARM     19
#define PIN_LED_STATUS    2

#define PIN_SENSOR_MERAH  14
#define PIN_SENSOR_BIRU   13
#define PIN_SENSOR_KUNING 35
#define PIN_SENSOR_ARM    34

#define PIN_CONVEYOR_BELT 23 // Pin kontrol Motor DC Conveyor Belt (Relay / Driver MOSFET)

// Logika sensor: Active LOW (standar sensor optik / proximity IR pada ESP32)
#define SENSOR_ACTIVE_ARM     LOW
#define SENSOR_ACTIVE_MERAH   LOW
#define SENSOR_ACTIVE_BIRU    LOW
#define SENSOR_ACTIVE_KUNING  LOW

// Waktu debounce sensor (ms) untuk stabilitas sinyal optik
#define SENSOR_DEBOUNCE_MS    30

Servo servoFlap;
Servo servoArm;

BLEServer *pServer = NULL;
BLECharacteristic *pTxCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;
String currentMode = "Servo";

// Struktur data 4 sensor fisik
enum SensorIndex {
  IDX_MERAH = 0,
  IDX_BIRU,
  IDX_KUNING,
  IDX_ARM,
  TOTAL_SENSORS
};

struct SensorChannel {
  const char* name;
  uint8_t pin;
  uint8_t activeLevel;
  bool isInputPullup;
  bool lastRaw;
  bool debouncedPresent;
  unsigned long lastDebounceTime;
};

SensorChannel sensorChannels[TOTAL_SENSORS] = {
  { "MERAH",  PIN_SENSOR_MERAH,  SENSOR_ACTIVE_MERAH,  true,  false, false, 0 },
  { "BIRU",   PIN_SENSOR_BIRU,   SENSOR_ACTIVE_BIRU,   true,  false, false, 0 },
  { "KUNING", PIN_SENSOR_KUNING, SENSOR_ACTIVE_KUNING, false, false, false, 0 }, // GPIO 35 Input-only
  { "ARM",    PIN_SENSOR_ARM,    SENSOR_ACTIVE_ARM,    false, false, false, 0 }  // GPIO 34 Input-only
};

// Status State Machine Kontrol Conveyor & ARM
enum SortState {
  STATE_IDLE,
  STATE_BELT_MOVING,        // Belt berjalan membawa objek menuju area ARM
  STATE_ARM_EXECUTING,      // ARM memindahkan objek ke jalur tujuan
  STATE_WAIT_TARGET_SENSOR, // Menunggu sensor warna tujuan (GPIO 14, 35, 13)
  STATE_WAIT_ARM_CLEAR      // Menunggu sensor ARM (GPIO 34) tidak lagi mendeteksi objek
};

SortState currentState = STATE_IDLE;
String activeColor = "";
String activeMode = "Servo";
String activeTxId = "";
unsigned long stateTimer = 0;
bool targetConfirmed = false;
bool beltRunning = false;

void notifyBLE(String message) {
  if (deviceConnected && pTxCharacteristic) {
    pTxCharacteristic->setValue(message.c_str());
    pTxCharacteristic->notify();
    delay(15);
    Serial.print("[BLE TX] ");
    Serial.print(message);
    if (!message.endsWith("\n")) Serial.println();
  } else {
    // BLE belum terhubung, catat telemetri ke Serial Monitor
    Serial.print("[LOCAL TX] ");
    Serial.print(message);
    if (!message.endsWith("\n")) Serial.println();
  }
}

// Mengirim status seluruh sensor (misal saat Web Client baru terhubung)
void sendAllSensorStates() {
  for (int i = 0; i < TOTAL_SENSORS; i++) {
    String msg = "SENSOR:" + String(sensorChannels[i].name) + ":" + (sensorChannels[i].debouncedPresent ? "OBJECT_PRESENT\n" : "OBJECT_ABSENT\n");
    notifyBLE(msg);
  }
}

// Membaca dan memfilter pembacaan seluruh sensor dengan debounce
void updateSensors() {
  unsigned long now = millis();
  for (int i = 0; i < TOTAL_SENSORS; i++) {
    int rawRead = digitalRead(sensorChannels[i].pin);
    bool isPresent = (rawRead == sensorChannels[i].activeLevel);

    if (isPresent != sensorChannels[i].lastRaw) {
      sensorChannels[i].lastRaw = isPresent;
      sensorChannels[i].lastDebounceTime = now;
    }

    if ((now - sensorChannels[i].lastDebounceTime) >= SENSOR_DEBOUNCE_MS) {
      if (sensorChannels[i].debouncedPresent != isPresent) {
        sensorChannels[i].debouncedPresent = isPresent;
        
        // Kirim notifikasi identitas sensor spesifik ke website
        String msg = "SENSOR:" + String(sensorChannels[i].name) + ":" + (isPresent ? "OBJECT_PRESENT\n" : "OBJECT_ABSENT\n");
        notifyBLE(msg);

        // Kirim notifikasi umum untuk kompatibilitas
        if (isPresent) {
          notifyBLE("SENSOR:OBJECT_PRESENT\n");
        } else {
          // Hanya kirim absent jika semua sensor tujuan absent
          bool anyPresent = false;
          for (int j = 0; j < TOTAL_SENSORS; j++) {
            if (sensorChannels[j].debouncedPresent) anyPresent = true;
          }
          if (!anyPresent) notifyBLE("SENSOR:OBJECT_ABSENT\n");
        }
      }
    }
  }
}

bool isSensorArmTriggered() {
  return sensorChannels[IDX_ARM].debouncedPresent;
}

bool isTargetSensorTriggered(String color) {
  if (color == "merah") return sensorChannels[IDX_MERAH].debouncedPresent;
  if (color == "kuning") return sensorChannels[IDX_KUNING].debouncedPresent;
  if (color == "biru") return sensorChannels[IDX_BIRU].debouncedPresent;
  return false;
}

void setBeltRunning(bool run) {
  beltRunning = run;
  digitalWrite(PIN_CONVEYOR_BELT, run ? HIGH : LOW);
  if (run) {
    notifyBLE("STATUS:BELT_RESUMED\n");
  } else {
    notifyBLE("STATUS:BELT_STOPPED\n");
  }
}

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      digitalWrite(PIN_LED_STATUS, HIGH);
      Serial.println("[BLE] Web Client Connected!");
      notifyBLE("STATUS:READY\n");
      // Kirim status awal seluruh sensor saat baru terhubung
      sendAllSensorStates();
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      digitalWrite(PIN_LED_STATUS, LOW);
      setBeltRunning(false);
      currentState = STATE_IDLE;
      Serial.println("[BLE] Web Client Disconnected!");
    }
};

void startSortingCycle(String color, String mode, String txId) {
  activeColor = color;
  activeMode = (mode == "Arm" || mode == "arm") ? "Arm" : "Servo";
  currentMode = activeMode;
  activeTxId = txId;
  targetConfirmed = false;
  stateTimer = millis();

  Serial.println("[SORT START] Color: " + activeColor + " | Mode: " + activeMode + " | TX: " + activeTxId);

  if (activeMode == "Arm") {
    // Mode ARM:
    // 1. Belt berjalan membawa objek menuju area ARM
    // 2. Status stage dipancarkan ke website
    notifyBLE("STAGE:BELT_MOVING\n");
    setBeltRunning(true);
    currentState = STATE_BELT_MOVING;
  } else {
    // Mode Servo:
    int flapAngle = 90;
    if (activeColor == "kuning") flapAngle = 40;
    else if (activeColor == "biru") flapAngle = 90;
    else if (activeColor == "merah") flapAngle = 140;

    servoFlap.write(flapAngle);
    setBeltRunning(true);
    currentState = STATE_WAIT_TARGET_SENSOR;
  }
}

class MyCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      String rxValue = pCharacteristic->getValue().c_str();
      rxValue.trim();

      if (rxValue.length() > 0) {
        Serial.print("[BLE RX] ");
        Serial.println(rxValue);

        // Parsing JSON atau String sederhana
        String color = "";
        String mode = "";
        String txId = "";
        
        int idIdx = rxValue.indexOf("\"id\":");
        if (idIdx == -1) idIdx = rxValue.indexOf("\"txId\":");
        if (idIdx != -1) {
          int startQ = rxValue.indexOf("\"", idIdx + 5);
          int endQ = rxValue.indexOf("\"", startQ + 1);
          if (startQ != -1 && endQ != -1) txId = rxValue.substring(startQ + 1, endQ);
        }

        // Deteksi 6 kelas kanonik: merah_arm, merah_servo, biru_arm, biru_servo, kuning_arm, kuning_servo
        if (rxValue.indexOf("merah_arm") != -1) { color = "merah"; mode = "Arm"; }
        else if (rxValue.indexOf("merah_servo") != -1) { color = "merah"; mode = "Servo"; }
        else if (rxValue.indexOf("biru_arm") != -1) { color = "biru"; mode = "Arm"; }
        else if (rxValue.indexOf("biru_servo") != -1) { color = "biru"; mode = "Servo"; }
        else if (rxValue.indexOf("kuning_arm") != -1) { color = "kuning"; mode = "Arm"; }
        else if (rxValue.indexOf("kuning_servo") != -1) { color = "kuning"; mode = "Servo"; }
        else {
          if (rxValue.indexOf("kuning") != -1) color = "kuning";
          else if (rxValue.indexOf("biru") != -1) color = "biru";
          else if (rxValue.indexOf("merah") != -1) color = "merah";

          if (rxValue.indexOf("\"mode\":\"Arm\"") != -1 || rxValue.indexOf("\"mode\":\"arm\"") != -1 || rxValue.indexOf("arm") != -1) {
            mode = "Arm";
          } else {
            mode = currentMode;
          }
        }

        if (rxValue.indexOf("mechanism") != -1 || rxValue.indexOf("mech") != -1) {
          if (rxValue.indexOf("arm") != -1 || rxValue.indexOf("Arm") != -1) currentMode = "Arm";
          else currentMode = "Servo";

          notifyBLE("STATUS:READY\n");
          String ack = "{\"ok\":true,\"ack\":\"mechanism\",\"mechanism\":\"" + String(currentMode == "Arm" ? "arm" : "servo") + "\",\"status\":\"READY\",\"ready\":true,\"txId\":\"" + txId + "\"}\n";
          notifyBLE(ack);
        } else if (color != "") {
          if (currentState != STATE_IDLE) {
            Serial.println("[WARN] Sistem sedang sibuk memproses objek, perintah diabaikan.");
            return;
          }
          startSortingCycle(color, mode, txId);
        } else if (rxValue.indexOf("arm") != -1 || rxValue.indexOf("Arm") != -1) {
          currentMode = "Arm";
          notifyBLE("STATUS:READY\n");
          String ack = "{\"ok\":true,\"ack\":\"mode\",\"mode\":\"Arm\",\"status\":\"READY\"}\n";
          notifyBLE(ack);
        } else if (rxValue.indexOf("servo") != -1 || rxValue.indexOf("Servo") != -1) {
          currentMode = "Servo";
          notifyBLE("STATUS:READY\n");
          String ack = "{\"ok\":true,\"ack\":\"mode\",\"mode\":\"Servo\",\"status\":\"READY\"}\n";
          notifyBLE(ack);
        } else if (rxValue.indexOf("stop") != -1) {
          setBeltRunning(false);
          servoFlap.write(90);
          servoArm.write(20);
          currentState = STATE_IDLE;
          notifyBLE("STATUS:STOPPED\n");
          String ack = "{\"ok\":true,\"ack\":\"stop\",\"status\":\"STOPPED\"}\n";
          notifyBLE(ack);
        }
      }
    }
};

void runStateMachine() {
  switch (currentState) {
    case STATE_IDLE:
      break;

    case STATE_BELT_MOVING:
      if (activeMode == "Arm") {
        if (isSensorArmTriggered()) {
          // Ketika sensor ARM GPIO 34 mendeteksi objek, belt berhenti
          setBeltRunning(false);
          notifyBLE("STATUS:OBJECT_DETECTED\n");
          currentState = STATE_ARM_EXECUTING;
          stateTimer = millis();
        } else if (millis() - stateTimer > 15000) {
          // Timeout keselamatan belt jika objek macet sebelum sensor ARM
          setBeltRunning(false);
          notifyBLE("STATUS:TIMEOUT\n");
          notifyBLE("STATUS:COMPLETED_UNVERIFIED\n");
          currentState = STATE_IDLE;
        }
      } else {
        // Mode Servo biasa
        currentState = STATE_WAIT_TARGET_SENSOR;
        stateTimer = millis();
      }
      break;

    case STATE_ARM_EXECUTING:
      notifyBLE("STATUS:ARM_WORKING\n");
      // Atur jalur flap pemilah
      if (activeColor == "kuning") servoFlap.write(40);
      else if (activeColor == "biru") servoFlap.write(90);
      else if (activeColor == "merah") servoFlap.write(140);
      delay(150);

      // ARM menjalankan proses mengambil dan memindahkan objek menuju jalur/wadah
      servoArm.write(120);
      delay(250);
      servoArm.write(20);

      notifyBLE("STATUS:SERVO_DONE\n");
      currentState = STATE_WAIT_TARGET_SENSOR;
      stateTimer = millis();
      break;

    case STATE_WAIT_TARGET_SENSOR:
      // Sensor warna tujuan: Merah=GPIO 14, Kuning=GPIO 35, Biru=GPIO 13
      if (isTargetSensorTriggered(activeColor)) {
        targetConfirmed = true;
        notifyBLE("STATUS:TARGET_DETECTED\n");
        String colorUpper = activeColor;
        colorUpper.toUpperCase();
        notifyBLE("SENSOR:" + colorUpper + ":OBJECT_PRESENT\n");
        notifyBLE("SENSOR:OBJECT_PRESENT\n");

        if (activeMode == "Servo") {
          // Pada mode Servo, konfirmasi target langsung menyelesaikan siklus sortir
          int targetPin = (activeColor == "kuning") ? 35 : ((activeColor == "biru") ? 13 : 14);
          String ack = "{\"ok\":true,\"ack\":\"sort\",\"color\":\"" + activeColor + "\",\"mode\":\"" + activeMode + "\",\"status\":\"VERIFIED\",\"sensorVerified\":true,\"sensor\":\"" + colorUpper + "\",\"targetPin\":" + String(targetPin) + ",\"id\":\"" + activeTxId + "\"}\n";
          notifyBLE(ack);
          currentState = STATE_IDLE;
        } else {
          // Pada mode ARM, wajib menunggu sampai GPIO 34 clear sebelum belt berjalan kembali
          currentState = STATE_WAIT_ARM_CLEAR;
          stateTimer = millis();
        }
      } else if (millis() - stateTimer > 5000) {
        targetConfirmed = false;
        String colorUpper = activeColor;
        colorUpper.toUpperCase();
        notifyBLE("SENSOR:" + colorUpper + ":OBJECT_ABSENT\n");
        notifyBLE("STATUS:COMPLETED_UNVERIFIED\n");

        if (activeMode == "Servo") {
          int targetPin = (activeColor == "kuning") ? 35 : ((activeColor == "biru") ? 13 : 14);
          String ack = "{\"ok\":true,\"ack\":\"sort\",\"color\":\"" + activeColor + "\",\"mode\":\"" + activeMode + "\",\"status\":\"COMPLETED_UNVERIFIED\",\"sensorVerified\":false,\"sensor\":\"" + colorUpper + "\",\"targetPin\":" + String(targetPin) + ",\"id\":\"" + activeTxId + "\"}\n";
          notifyBLE(ack);
          currentState = STATE_IDLE;
        } else {
          currentState = STATE_WAIT_ARM_CLEAR;
          stateTimer = millis();
        }
      }
      break;

    case STATE_WAIT_ARM_CLEAR:
      // ATURAN PENGENDALIAN BELT:
      // - Sensor GPIO 34 mengendalikan kondisi berhenti dan mulai kembali pada belt.
      // - Jika GPIO 34 masih mendeteksi objek, belt harus tetap berhenti, meskipun sensor warna tujuan sudah mendeteksi objek.
      // - Jika sensor warna tujuan sudah mendeteksi objek tetapi GPIO 34 masih mendeteksi objek, tunggu sampai GPIO 34 tidak lagi mendeteksi objek sebelum menjalankan belt.
      // - Jangan menjalankan belt hanya berdasarkan timer atau karena gerakan ARM selesai.
      if (!isSensorArmTriggered()) {
        // Objek sudah benar-benar meninggalkan sensor ARM GPIO 34
        String colorUpper = activeColor;
        colorUpper.toUpperCase();
        int targetPin = (activeColor == "kuning") ? 35 : ((activeColor == "biru") ? 13 : 14);

        if (targetConfirmed) {
          String ack = "{\"ok\":true,\"ack\":\"sort\",\"color\":\"" + activeColor + "\",\"mode\":\"" + activeMode + "\",\"status\":\"VERIFIED\",\"sensorVerified\":true,\"sensor\":\"" + colorUpper + "\",\"targetPin\":" + String(targetPin) + ",\"id\":\"" + activeTxId + "\"}\n";
          notifyBLE(ack);
        } else {
          String ack = "{\"ok\":true,\"ack\":\"sort\",\"color\":\"" + activeColor + "\",\"mode\":\"" + activeMode + "\",\"status\":\"COMPLETED_UNVERIFIED\",\"sensorVerified\":false,\"sensor\":\"" + colorUpper + "\",\"targetPin\":" + String(targetPin) + ",\"id\":\"" + activeTxId + "\"}\n";
          notifyBLE(ack);
        }

        // Belt baru berjalan kembali ketika sensor ARM GPIO 34 sudah tidak mendeteksi objek
        setBeltRunning(true);
        currentState = STATE_IDLE;
        delay(100);
      }
      break;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED_STATUS, OUTPUT);
  pinMode(PIN_CONVEYOR_BELT, OUTPUT);
  digitalWrite(PIN_LED_STATUS, LOW);
  digitalWrite(PIN_CONVEYOR_BELT, LOW);

  // Inisialisasi 4 sensor fisik sesuai karakteristik hardware ESP32
  pinMode(PIN_SENSOR_MERAH, INPUT_PULLUP);
  pinMode(PIN_SENSOR_BIRU, INPUT_PULLUP);
  pinMode(PIN_SENSOR_KUNING, INPUT); // GPIO 35 input-only tanpa internal pullup
  pinMode(PIN_SENSOR_ARM, INPUT);    // GPIO 34 input-only tanpa internal pullup

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  servoFlap.setPeriodHertz(50);
  servoArm.setPeriodHertz(50);
  servoFlap.attach(PIN_SERVO_FLAP, 500, 2400);
  servoArm.attach(PIN_SERVO_ARM, 500, 2400);
  servoFlap.write(90);
  servoArm.write(20);

  Serial.println("[VERNOVA] Memulai ESP32 BLE Sorting Server dengan Kontrol Conveyor, ARM & 4 Sensor Fisik...");

  BLEDevice::init("VERNOVA-ESP32");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pTxCharacteristic = pService->createCharacteristic(
                        CHARACTERISTIC_UUID_TX,
                        BLECharacteristic::PROPERTY_NOTIFY
                      );
  pTxCharacteristic->addDescriptor(new BLE2902());

  BLECharacteristic *pRxCharacteristic = pService->createCharacteristic(
                                           CHARACTERISTIC_UUID_RX,
                                           BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
                                         );
  pRxCharacteristic->setCallbacks(new MyCallbacks());

  pService->start();
  pServer->getAdvertising()->start();
  Serial.println("[BLE Server] Advertising aktif ('VERNOVA-ESP32'). Siap dihubungkan dari Chrome/Edge!");
}

void loop() {
  // Menghidupkan ulang advertising jika koneksi terputus
  if (!deviceConnected && oldDeviceConnected) {
    delay(500);
    pServer->startAdvertising();
    Serial.println("[BLE] Mulai advertising ulang...");
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }

  // Pembaruan dan filtering debounce seluruh sensor fisik (tetap berjalan meski BLE terputus)
  updateSensors();

  // Eksekusi State Machine kontrol conveyor belt dan lengan robotik ARM
  runStateMachine();

  delay(5);
}
