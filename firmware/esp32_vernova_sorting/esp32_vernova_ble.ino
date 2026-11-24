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

Servo servoFlap;
Servo servoArm;

BLEServer *pServer = NULL;
BLECharacteristic *pTxCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;
String currentMode = "Servo";

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      digitalWrite(PIN_LED_STATUS, HIGH);
      Serial.println("[BLE] Web Client Connected!");
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
        if (rxValue.indexOf("kuning") != -1) color = "kuning";
        else if (rxValue.indexOf("biru") != -1) color = "biru";
        else if (rxValue.indexOf("merah") != -1) color = "merah";

        if (color != "") {
          executeSort(color);
          if (deviceConnected && pTxCharacteristic) {
            String ack = "{\"ok\":true,\"color\":\"" + color + "\",\"status\":\"COMPLETED\"}\n";
            pTxCharacteristic->setValue(ack.c_str());
            pTxCharacteristic->notify();
          }
        } else if (rxValue.indexOf("arm") != -1 || rxValue.indexOf("Arm") != -1) {
          currentMode = "Arm";
        } else if (rxValue.indexOf("servo") != -1 || rxValue.indexOf("Servo") != -1) {
          currentMode = "Servo";
        } else if (rxValue.indexOf("stop") != -1) {
          servoFlap.write(90);
          servoArm.write(20);
        }
      }
    }
};

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED_STATUS, OUTPUT);
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
  delay(10);
}
