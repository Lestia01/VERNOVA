/**
 * ==============================================================================
 * VERNOVA — Test Suite: ESP32 Dual Connection (Wi-Fi + BLE) & micro:bit Compatibility
 * 
 * Pengujian komprehensif sesuai 10 ketentuan wajib:
 * 1. micro:bit BLE tetap bekerja seperti sebelumnya.
 * 2. ESP32 Wi-Fi dapat terhubung dan bertukar data.
 * 3. ESP32 Bluetooth BLE dapat terhubung dan bertukar data.
 * 4. Perintah sortir dari website memiliki struktur dan makna yang sama pada semua koneksi.
 * 5. Data sensor dan status dapat diterima website.
 * 6. Mode AUTO dan MANUAL tetap bekerja.
 * 7. Teachable Machine dan YOLO tetap menggunakan dispatcher yang sama (dispatchSortingCommand).
 * 8. Perpindahan adapter tidak menghasilkan perintah ganda (deduplikasi & graceful switch).
 * 9. Virtual Hardware (Mode Simulasi) tetap berfungsi untuk ketiga opsi.
 * 10. Emergency stop dan penanganan koneksi terputus tetap berfungsi.
 * ==============================================================================
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEVICE_TYPES,
  CONNECTION_TYPES,
  CONNECTION_STATES,
  OPERATING_MODES,
  VALID_COLORS,
  VALID_MODES,
  NORDIC_UART_SERVICE_UUID,
  MicrobitBLEAdapter,
  ESP32WiFiAdapter,
  ESP32BLEAdapter,
  DeviceConnectionManager
} = require('../assets/js/device-manager.js');

test('VERNOVA — ESP32 Dual Connection & Multi-Device Verification', async (t) => {

  // 1. micro:bit BLE tetap bekerja seperti sebelumnya
  await t.test('1. micro:bit BLE tetap bekerja normal dengan Nordic UART', async () => {
    const mbit = new MicrobitBLEAdapter({ simulationMode: true });
    assert.equal(mbit.deviceType, DEVICE_TYPES.MICROBIT);
    assert.equal(mbit.connectionType, CONNECTION_TYPES.BLE);

    const conn = await mbit.connect();
    assert.equal(conn.ok, true);
    assert.equal(conn.simulated, true);

    const sortRes = await mbit.sendSortingCommand({ color: 'kuning', mode: 'Servo' });
    assert.equal(sortRes.ok, true);
    assert.equal(sortRes.color, 'kuning');
    assert.equal(sortRes.executionStatus, 'simulated_microbit_ble');

    const stopRes = await mbit.sendEmergencyStop();
    assert.equal(stopRes.ok, true);
    assert.equal(stopRes.status, 'STOPPED');
  });

  // 2. ESP32 Wi-Fi dapat terhubung dan bertukar data
  await t.test('2. ESP32 Wi-Fi dapat terhubung dan bertukar data', async () => {
    const espWifi = new ESP32WiFiAdapter({ host: 'http://172.25.15.108', simulationMode: true });
    assert.equal(espWifi.deviceType, DEVICE_TYPES.ESP32);
    assert.equal(espWifi.connectionType, CONNECTION_TYPES.WIFI);
    assert.equal(espWifi.host, 'http://172.25.15.108');

    const conn = await espWifi.connect();
    assert.equal(conn.ok, true);
    assert.equal(conn.telemetry.deviceId, 'VERNOVA-ESP32-SIM');

    const sortRes = await espWifi.sendSortingCommand({ color: 'merah', mode: 'Servo' });
    assert.equal(sortRes.ok, true);
    assert.equal(sortRes.color, 'merah');
    assert.equal(sortRes.executionStatus, 'simulated_esp32_wifi');
  });

  // 3. ESP32 Bluetooth BLE dapat terhubung dan bertukar data
  await t.test('3. ESP32 Bluetooth BLE dapat terhubung dan bertukar data', async () => {
    const espBle = new ESP32BLEAdapter({ simulationMode: true });
    assert.equal(espBle.deviceType, DEVICE_TYPES.ESP32_BLE);
    assert.equal(espBle.connectionType, CONNECTION_TYPES.BLE);

    const conn = await espBle.connect();
    assert.equal(conn.ok, true);
    assert.equal(conn.telemetry.deviceId, 'VERNOVA-ESP32-BLE-SIM');
    assert.equal(conn.telemetry.protocol, 'NORDIC-UART-STRING');

    const sortRes = await espBle.sendSortingCommand({ color: 'biru', mode: 'Arm' });
    assert.equal(sortRes.ok, true);
    assert.equal(sortRes.color, 'biru');
    assert.equal(sortRes.mode, 'Arm');
    assert.equal(sortRes.executionStatus, 'simulated_esp32_ble');
  });

  // 4. Perintah sortir dari website memiliki struktur dan makna yang sama pada semua koneksi
  await t.test('4. Kontrak perintah sortir identik di seluruh koneksi (micro:bit, ESP32 Wi-Fi, ESP32 BLE)', async () => {
    const mbit = new MicrobitBLEAdapter({ simulationMode: true });
    const espWifi = new ESP32WiFiAdapter({ simulationMode: true });
    const espBle = new ESP32BLEAdapter({ simulationMode: true });

    for (const color of ['kuning', 'biru', 'merah']) {
      const resMbit = await mbit.sendSortingCommand({ color, mode: 'Servo' });
      const resWifi = await espWifi.sendSortingCommand({ color, mode: 'Servo' });
      const resBle = await espBle.sendSortingCommand({ color, mode: 'Servo' });

      assert.equal(resMbit.ok, true);
      assert.equal(resWifi.ok, true);
      assert.equal(resBle.ok, true);

      assert.equal(resMbit.color, color);
      assert.equal(resWifi.color, color);
      assert.equal(resBle.color, color);

      assert.equal(resMbit.mode, 'Servo');
      assert.equal(resWifi.mode, 'Servo');
      assert.equal(resBle.mode, 'Servo');
    }
  });

  // 5. Data sensor dan status dapat diterima website
  await t.test('5. Telemetri data sensor fisik dan tahapan status diterima oleh website', async () => {
    const espBle = new ESP32BLEAdapter({ simulationMode: true });
    const receivedEvents = [];

    espBle.onStatusChange((ev) => {
      receivedEvents.push(ev);
    });

    // Simulasikan pesan sensor identik micro:bit
    espBle.receiveMockData('SENSOR:MERAH:OBJECT_PRESENT\n');
    assert.equal(espBle.getSensorState().objectPresent, true);
    assert.equal(espBle.getSensorState().channels['MERAH'], 'OBJECT_PRESENT');

    espBle.receiveMockData('STATUS:OBJECT_DETECTED\n');
    assert.ok(receivedEvents.some(e => e.stage === 'OBJECT_DETECTED'));

    espBle.receiveMockData('STATUS:BELT_STOPPED\n');
    assert.ok(receivedEvents.some(e => e.stage === 'BELT_STOPPED'));

    espBle.receiveMockData('SENSOR:OBJECT_ABSENT\n');
    assert.equal(espBle.getSensorState().objectPresent, false);
  });

  // 6. Mode AUTO dan MANUAL tetap bekerja
  await t.test('6. Mode AUTO dan MANUAL tetap bekerja pada DeviceConnectionManager', async () => {
    const manager = new DeviceConnectionManager({ simulationMode: true });
    assert.equal(manager.getOperatingMode(), OPERATING_MODES.AUTO);

    manager.setOperatingMode('MANUAL');
    assert.equal(manager.getOperatingMode(), OPERATING_MODES.MANUAL);

    // Pengiriman manual via sendManualSort
    const manRes = await manager.sendManualSort({ color: 'biru', mode: 'Servo' });
    assert.equal(manRes.ok, true);
    assert.equal(manRes.color, 'biru');

    manager.setOperatingMode('AUTO');
    assert.equal(manager.getOperatingMode(), OPERATING_MODES.AUTO);
  });

  // 7. Teachable Machine dan YOLO tetap menggunakan dispatcher yang sama
  await t.test('7. AI Engines (Teachable Machine & YOLO) menggunakan dispatchSortingCommand terpadu', async () => {
    const manager = new DeviceConnectionManager({ simulationMode: true });

    // Simulasi deteksi Teachable Machine (TM)
    const tmDetection = { color: 'kuning', mode: 'Servo', objectType: 'CYLINDER_CAP' };
    const tmRes = await manager.dispatchSortingCommand(tmDetection);
    assert.equal(tmRes.ok, true);
    assert.equal(tmRes.color, 'kuning');

    // Ganti perangkat ke ESP32 Wi-Fi
    manager.switchDevice('ESP32');
    const yoloDetection = { color: 'merah', mode: 'Arm', objectType: 'CYLINDER_CAP', force: true };
    const yoloRes = await manager.dispatchSortingCommand(yoloDetection);
    assert.equal(yoloRes.ok, true);
    assert.equal(yoloRes.color, 'merah');
    assert.equal(yoloRes.mode, 'Arm');
    assert.equal(yoloRes.command, 'merah arm');
    assert.equal(yoloRes.executionStatus, 'simulated_esp32_wifi');

    // Ganti perangkat ke ESP32 BLE
    manager.switchDevice('ESP32_BLE');
    const bleDetection = { color: 'biru', mode: 'Servo', force: true };
    const bleRes = await manager.dispatchSortingCommand(bleDetection);
    assert.equal(bleRes.ok, true);
    assert.equal(bleRes.color, 'biru');
    assert.equal(bleRes.mode, 'Servo');
    assert.equal(bleRes.command, 'biru servo');
    assert.equal(bleRes.executionStatus, 'simulated_esp32_ble');

    // Uji manual sort dengan mechanism: 'arm' pada ESP32 BLE
    const manualArmRes = await manager.sendManualSort({ color: 'merah', mechanism: 'arm' });
    assert.equal(manualArmRes.ok, true);
    assert.equal(manualArmRes.color, 'merah');
    assert.equal(manualArmRes.mode, 'Arm');
    assert.equal(manualArmRes.command, 'merah arm');

    // Uji manual sort dengan mechanism: 'servo' pada ESP32 BLE
    const manualServoRes = await manager.sendManualSort({ color: 'merah', mechanism: 'servo' });
    assert.equal(manualServoRes.ok, true);
    assert.equal(manualServoRes.color, 'merah');
    assert.equal(manualServoRes.mode, 'Servo');
    assert.equal(manualServoRes.command, 'merah servo');
  });

  // 8. Perpindahan adapter tidak menghasilkan perintah ganda & graceful disconnect
  await t.test('8. Perpindahan adapter memutus sesi sebelumnya & deduplikasi debounce bekerja', async () => {
    const manager = new DeviceConnectionManager({
      deviceType: DEVICE_TYPES.MICROBIT,
      simulationMode: true,
      debounceMs: 500
    });

    // 1. Eksekusi pertama
    const first = await manager.dispatchSortingCommand({ color: 'kuning' });
    assert.equal(first.ok, true);

    // 2. Eksekusi kedua cepat -> ditekan debounce
    const dup = await manager.dispatchSortingCommand({ color: 'kuning' });
    assert.equal(dup.ok, false);
    assert.equal(dup.suppressed, true);

    // 3. Pindah ke ESP32 Wi-Fi
    let disconnectedOld = false;
    manager.getActiveAdapter().disconnect = async () => { disconnectedOld = true; };

    manager.switchDevice('ESP32');
    assert.equal(manager.config.deviceType, DEVICE_TYPES.ESP32);
    assert.equal(manager.config.connectionType, CONNECTION_TYPES.WIFI);
    assert.equal(disconnectedOld, true);

    // 4. Pindah ke ESP32 BLE
    manager.switchDevice('ESP32_BLE');
    assert.equal(manager.config.deviceType, DEVICE_TYPES.ESP32_BLE);
    assert.equal(manager.config.connectionType, CONNECTION_TYPES.BLE);
    assert.equal(manager.getActiveAdapter().deviceType, DEVICE_TYPES.ESP32_BLE);
  });

  // 9. Virtual Hardware (Mode Simulasi) tetap berfungsi
  await t.test('9. Virtual Hardware (Simulation Mode) bekerja pada semua adapter', async () => {
    const manager = new DeviceConnectionManager({ simulationMode: true });

    assert.equal(manager.isSimulated(), true);
    assert.equal(manager.microbitAdapter.simulationMode, true);
    assert.equal(manager.esp32Adapter.simulationMode, true);
    assert.equal(manager.esp32BleAdapter.simulationMode, true);

    manager.setSimulation(false);
    assert.equal(manager.isSimulated(), false);
    assert.equal(manager.microbitAdapter.simulationMode, false);
    assert.equal(manager.esp32Adapter.simulationMode, false);
    assert.equal(manager.esp32BleAdapter.simulationMode, false);

    manager.setSimulation(true);
    assert.equal(manager.isSimulated(), true);
  });

  // 10. Emergency stop dan penanganan koneksi terputus tetap berfungsi
  await t.test('10. Emergency Stop terkirim ke adapter aktif & status terputus tertangani', async () => {
    const manager = new DeviceConnectionManager({ simulationMode: true });

    // micro:bit emergency stop
    const stopMbit = await manager.dispatchEmergencyStop();
    assert.equal(stopMbit.ok, true);
    assert.equal(stopMbit.status, 'STOPPED');

    // ESP32 Wi-Fi emergency stop
    manager.switchDevice('ESP32');
    const stopWifi = await manager.dispatchEmergencyStop();
    assert.equal(stopWifi.ok, true);
    assert.equal(stopWifi.status, 'STOPPED');

    // ESP32 BLE emergency stop
    manager.switchDevice('ESP32_BLE');
    const stopBle = await manager.dispatchEmergencyStop();
    assert.equal(stopBle.ok, true);
    assert.equal(stopBle.status, 'STOPPED');

    // Disconnect tertib
    const disRes = await manager.disconnect();
    assert.equal(disRes.ok, true);
    assert.equal(manager.getActiveAdapter().status, CONNECTION_STATES.DISCONNECTED);
  });

  // 11. Parsing Telemetri Sensor JSON & Penyimpanan Nilai Mentah Kalibrasi
  await t.test('11. Telemetri JSON sensor_update & sensor_state diparsing dan menyimpan raw value', async () => {
    const espBle = new ESP32BLEAdapter({ simulationMode: true });
    const receivedEvents = [];

    espBle.onStatusChange((ev) => {
      receivedEvents.push(ev);
    });

    // Kirim telemetri sensor digital (merah & biru)
    espBle.receiveMockData('{"type":"sensor_update","sensor":"merah","detected":true,"value":0,"timestamp":1000}\n');
    assert.equal(espBle.getSensorState().sensors.merah, true);
    assert.equal(espBle.getSensorState().rawValues.merah, 0);
    assert.equal(espBle.getSensorState().objectPresent, true);

    espBle.receiveMockData('{"type":"sensor_update","sensor":"biru","detected":false,"value":1,"timestamp":1010}\n');
    assert.equal(espBle.getSensorState().sensors.biru, false);
    assert.equal(espBle.getSensorState().rawValues.biru, 1);

    // Kirim telemetri sensor analog (kuning: ADC 12-bit & arm: ADC 12-bit)
    espBle.receiveMockData('{"type":"sensor_update","sensor":"kuning","detected":true,"value":285,"timestamp":1020}\n');
    assert.equal(espBle.getSensorState().sensors.kuning, true);
    assert.equal(espBle.getSensorState().rawValues.kuning, 285);

    espBle.receiveMockData('{"type":"sensor_update","sensor":"arm","detected":true,"value":150,"timestamp":1030}\n');
    assert.equal(espBle.getSensorState().sensors.arm, true);
    assert.equal(espBle.getSensorState().rawValues.arm, 150);

    // Kirim status gabungan sensor_state
    espBle.receiveMockData('{"type":"sensor_state","mode":"arm","sensors":{"merah":false,"biru":false,"kuning":true,"arm":false}}\n');
    assert.equal(espBle.getSensorState().mode, 'arm');
    assert.equal(espBle.getSensorState().sensors.merah, false);
    assert.equal(espBle.getSensorState().sensors.kuning, true);
    assert.equal(espBle.getSensorState().objectPresent, true);

    // Pastikan tidak ada transaksi sortir palsu yang terpicu oleh sensor update
    assert.ok(receivedEvents.every(e => e.type === 'sensor_telemetry' || e.type === 'sensor_state' || !e.type));
  });

  // 12. Rekonstruksi Paket BLE Terfragmentasi (MTU Chunk Reassembly)
  await t.test('12. Rekonstruksi paket BLE terfragmentasi (MTU Chunk Reassembly) berbasis newline', async () => {
    const espBle = new ESP32BLEAdapter({ simulationMode: true });
    const receivedEvents = [];

    espBle.onStatusChange((ev) => {
      receivedEvents.push(ev);
    });

    // Simulasikan pesan JSON yang terpecah menjadi 3 chunk BLE berukuran ~20 byte
    espBle.receiveMockData('{"type":"sensor_upda');
    assert.equal(receivedEvents.length, 0); // Belum ada newline, masih dalam buffer

    espBle.receiveMockData('te","sensor":"merah"');
    assert.equal(receivedEvents.length, 0); // Masih dalam buffer

    espBle.receiveMockData(',"detected":true,"value":0}\n');
    // Sekarang newline ditemukan -> pesan harus diproses!
    assert.equal(receivedEvents.length, 1);
    assert.equal(receivedEvents[0].type, 'sensor_telemetry');
    assert.equal(receivedEvents[0].sensor, 'merah');
    assert.equal(receivedEvents[0].detected, true);
    assert.equal(espBle.getSensorState().sensors.merah, true);

    // Simulasikan pesan status terfragmentasi
    espBle.receiveMockData('STATUS:OBJECT_');
    assert.equal(receivedEvents.length, 1);

    espBle.receiveMockData('DETECTED\n');
    assert.equal(receivedEvents.length, 2);
    assert.equal(receivedEvents[1].type, 'stage_update');
    assert.equal(receivedEvents[1].stage, 'OBJECT_DETECTED');
  });

  // 13. Fallback Parsing Token Warna Sederhana (merah, kuning, biru, arm, kosong)
  await t.test('13. Parsing token warna sederhana (merah, kuning, biru, arm, kosong) tanpa crash', async () => {
    const espBle = new ESP32BLEAdapter({ simulationMode: true });
    const receivedEvents = [];

    espBle.onStatusChange((ev) => {
      receivedEvents.push(ev);
    });

    // Simulasi firmware mengirim "merah\n"
    espBle.receiveMockData('merah\n');
    assert.equal(espBle.getSensorState().sensors.merah, true);
    assert.equal(espBle.getSensorState().objectPresent, true);
    assert.equal(receivedEvents.some(e => e.type === 'sensor_telemetry' && e.sensor === 'merah'), true);

    // Simulasi firmware mengirim "kuning\n"
    espBle.receiveMockData('kuning\n');
    assert.equal(espBle.getSensorState().sensors.kuning, true);
    assert.equal(espBle.getSensorState().sensors.merah, false); // Sensor warna berganti
    assert.equal(espBle.getSensorState().objectPresent, true);

    // Simulasi firmware mengirim "kosong\n"
    espBle.receiveMockData('kosong\n');
    assert.equal(espBle.getSensorState().objectPresent, false);
    assert.equal(espBle.getSensorState().sensors.kuning, false);
    assert.equal(espBle.getSensorState().state, 'OBJECT_ABSENT');
    assert.equal(receivedEvents.some(e => e.type === 'sensor_telemetry' && e.sensor === 'all' && e.detected === false), true);
  });

  // 14. Penanganan Buffer Tanpa Newline (Auto-Flush Timer)
  await t.test('14. Penanganan data tanpa newline diproses via auto-flush buffer', async () => {
    const espBle = new ESP32BLEAdapter({ simulationMode: true });
    const receivedEvents = [];

    espBle.onStatusChange((ev) => {
      receivedEvents.push(ev);
    });

    // Kirim data JSON tanpa \n (simulasi firmware yang tidak membubuhkan newline)
    espBle.receiveMockData('{"type":"sensor_update","sensor":"biru","detected":true,"value":0}');
    
    // Karena merupakan JSON lengkap, auto-flush langsung mengeksekusinya
    assert.equal(espBle.getSensorState().sensors.biru, true);
    assert.equal(espBle.getSensorState().objectPresent, true);
    assert.equal(receivedEvents.length, 1);
  });

  // 15. Penanganan Payload Tidak Valid / Corrupt JSON Tanpa Crash
  await t.test('15. Payload JSON rusak/corrupt tidak menyebabkan crash sistem', async () => {
    const espBle = new ESP32BLEAdapter({ simulationMode: true });
    const receivedEvents = [];

    espBle.onStatusChange((ev) => {
      receivedEvents.push(ev);
    });

    // Kirim JSON corrupt / terpotong rusak
    espBle.receiveMockData('{type:invalid_json_corrupted\n');
    // Sistem tetap hidup, menerima pesan sebagai rawText tanpa melempar unhandled error
    assert.equal(receivedEvents.length, 1);
    assert.ok(receivedEvents[0].rawText.includes('invalid_json_corrupted'));

    // Kirim JSON normal setelahnya untuk memastikan parser tetap berfungsi normal
    espBle.receiveMockData('{"type":"sensor_update","sensor":"merah","detected":true,"value":0}\n');
    assert.equal(espBle.getSensorState().sensors.merah, true);
  });

  // 16. Verifikasi Disconnect dan Pembersihan Listener/Buffer
  await t.test('16. Disconnect membersihkan buffer dan state secara tertib', async () => {
    const espBle = new ESP32BLEAdapter({ simulationMode: true });
    espBle._rxBuffer = 'sisa_data_tidak_selesai';
    
    await espBle.disconnect();
    assert.equal(espBle._rxBuffer, '');
    assert.equal(espBle.hasReceivedPhysicalData, false);
    assert.equal(espBle.status, CONNECTION_STATES.DISCONNECTED);
  });

  // 17. Parsing Status Selesai Sortir Format MakeCode ESP32 (STATUS mode=... message=...)
  await t.test('17. Parsing status selesai sortir MakeCode (sort_servo_kuning_done & arm_object_kuning)', async () => {
    const espBle = new ESP32BLEAdapter({ simulationMode: true });
    const receivedEvents = [];

    espBle.onStatusChange((ev) => {
      receivedEvents.push(ev);
    });

    // Simulasi respons aktual dari sketch Arduino pengguna saat sortir kuning selesai
    espBle.receiveMockData('STATUS mode=servo motor=on message=sort_servo_kuning_done\n');
    const sortDoneEvent = receivedEvents.find(e => e.type === 'sort_completed' && e.color === 'kuning');
    assert.ok(sortDoneEvent, 'Harus mendeteksi sort_completed untuk kuning');
    assert.equal(sortDoneEvent.verified, true);
    assert.equal(espBle.getSensorState().mode, 'servo');

    // Simulasi respons mode arm saat objek terdeteksi di sensor arm
    espBle.receiveMockData('STATUS mode=arm motor=off message=arm_object_kuning_detected_motor_stopped\n');
    const armDoneEvent = receivedEvents.find(e => e.type === 'sort_completed' && e.stage.includes('detected_motor_stopped'));
    assert.ok(armDoneEvent, 'Harus mendeteksi sort_completed saat sensor arm mendeteksi objek');
    assert.equal(armDoneEvent.color, 'kuning');
    assert.equal(armDoneEvent.verified, true);
    assert.equal(espBle.getSensorState().mode, 'arm');
  });

  // 18. Verifikasi sendSortingCommand dengan Konfirmasi Sensor/Done
  await t.test('18. sendSortingCommand terverifikasi fisik saat sensor atau status selesai diterima', async () => {
    const espBle = new ESP32BLEAdapter({ simulationMode: false });
    // Mock write BLE
    espBle._writeBLECommand = async () => true;

    // Simulasikan kedatangan pesan status selesai dari Arduino setelah 50ms
    setTimeout(() => {
      espBle.receiveMockData('STATUS mode=servo motor=on message=sort_servo_kuning_done\n');
    }, 50);

    const res = await espBle.sendSortingCommand({ color: 'kuning', mode: 'Servo' });
    assert.equal(res.ok, true);
    assert.equal(res.verified, true);
    assert.equal(res.sensorVerified, true);
    assert.equal(res.statusCategory, 'verified');
    assert.equal(res.color, 'kuning');
  });

});
