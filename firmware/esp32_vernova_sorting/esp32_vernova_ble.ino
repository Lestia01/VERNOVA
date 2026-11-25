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

#define PIN_SERVO_FLAP 18
#define PIN_SERVO_ARM  19
#define PIN_LED_STATUS 2
#define PIN_SENSOR_VERIFY 21 // Pin sensor optik / proximity verifikasi fisik (Active LOW / Pull-up)

Servo servoFlap;
Servo servoArm;

BLEServer *pServer = NULL;
BLECharacteristic *pTxCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;
String currentMode = "Servo";
int lastSensorState = -1;

void notifyBLE(String message) {
  if (deviceConnected && pTxCharacteristic) {
    pTxCharacteristic->setValue(message.c_str());
    pTxCharacteristic->notify();
    delay(20);
    Serial.print("[BLE TX] ");
    Serial.print(message);
    if (!message.endsWith("\n")) Serial.println();
  }
}

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      digitalWrite(PIN_LED_STATUS, HIGH);
      Serial.println("[BLE] Web Client Connected!");
      notifyBLE("STATUS:READY\n");
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      digitalWrite(PIN_LED_STATUS, LOW);
      Serial.println("[BLE] Web Client Disconnected!");
    }
};

void executeSort(String color) {
  int flapAngle = 90;
  if (color == "kuning") flapAngle = 40;
  else if (color == "biru") flapAngle = 90;
  else if (color == "merah") flapAngle = 140;

  servoFlap.write(flapAngle);
  delay(150);

  if (currentMode == "Arm") {
    servoArm.write(120);
    delay(250);
    servoArm.write(20);
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
        String txId = "";
        
        int idIdx = rxValue.indexOf("\"id\":");
        if (idIdx == -1) idIdx = rxValue.indexOf("\"txId\":");
        if (idIdx != -1) {
          int startQ = rxValue.indexOf("\"", idIdx + 5);
          int endQ = rxValue.indexOf("\"", startQ + 1);
          if (startQ != -1 && endQ != -1) txId = rxValue.substring(startQ + 1, endQ);
        }

        if (rxValue.indexOf("kuning") != -1) color = "kuning";
        else if (rxValue.indexOf("biru") != -1) color = "biru";
        else if (rxValue.indexOf("merah") != -1) color = "merah";

        if (rxValue.indexOf("mechanism") != -1 || rxValue.indexOf("mech") != -1) {
          if (rxValue.indexOf("arm") != -1 || rxValue.indexOf("Arm") != -1) currentMode = "Arm";
          else currentMode = "Servo";

          notifyBLE("STATUS:READY\n");
          String ack = "{\"ok\":true,\"ack\":\"mechanism\",\"mechanism\":\"" + String(currentMode == "Arm" ? "arm" : "servo") + "\",\"status\":\"READY\",\"ready\":true,\"txId\":\"" + txId + "\"}\n";
          notifyBLE(ack);
        } else if (color != "") {
          executeSort(color);
          
          // 1. Notifikasi penyelesaian pergerakan servo
          notifyBLE("STATUS:SERVO_DONE\n");

          // 2. Evaluasi bukti sensor fisik
          int sensorVal = digitalRead(PIN_SENSOR_VERIFY);
          bool isObjectPresent = (sensorVal == LOW);

          if (isObjectPresent) {
            notifyBLE("SENSOR:OBJECT_PRESENT\n");
            String ack = "{\"ok\":true,\"ack\":\"sort\",\"color\":\"" + color + "\",\"status\":\"COMPLETED\",\"sensorVerified\":true,\"id\":\"" + txId + "\"}\n";
            notifyBLE(ack);
          } else {
            notifyBLE("SENSOR:OBJECT_ABSENT\n");
            notifyBLE("STATUS:COMPLETED_UNVERIFIED\n");
            String ack = "{\"ok\":true,\"ack\":\"sort\",\"color\":\"" + color + "\",\"status\":\"COMPLETED\",\"sensorVerified\":false,\"id\":\"" + txId + "\"}\n";
            notifyBLE(ack);
          }
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
          servoFlap.write(90);
          servoArm.write(20);
          notifyBLE("STATUS:STOPPED\n");
          String ack = "{\"ok\":true,\"ack\":\"stop\",\"status\":\"STOPPED\"}\n";
          notifyBLE(ack);
        }
      }
    }
};

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED_STATUS, OUTPUT);
  pinMode(PIN_SENSOR_VERIFY, INPUT_PULLUP);
  digitalWrite(PIN_LED_STATUS, LOW);

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  servoFlap.setPeriodHertz(50);
  servoArm.setPeriodHertz(50);
  servoFlap.attach(PIN_SERVO_FLAP, 500, 2400);
  servoArm.attach(PIN_SERVO_ARM, 500, 2400);
  servoFlap.write(90);
  servoArm.write(20);

  Serial.println("[VERNOVA] Memulai ESP32 BLE Sorting Server...");

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

  // Notifikasi real-time jika sensor fisik mendeteksi perubahan status objek
  if (deviceConnected) {
    int currentSensor = digitalRead(PIN_SENSOR_VERIFY);
    if (currentSensor != lastSensorState) {
      lastSensorState = currentSensor;
      if (currentSensor == LOW) {
        notifyBLE("SENSOR:OBJECT_PRESENT\n");
      } else {
        notifyBLE("SENSOR:OBJECT_ABSENT\n");
      }
    }
  }

  delay(10);
}
