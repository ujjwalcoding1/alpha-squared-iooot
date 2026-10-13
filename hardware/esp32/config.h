#ifndef CONFIG_H
#define CONFIG_H

// =========================================================================
// Alpha Squared IoT - ESP32 Firmware Pinout & Hardware Configuration
// =========================================================================

// 1. Digital Output Pins
#define BUZZER_PIN 23
#define LED_STATUS_PIN 2

// 2. SOS Push Button Input Pin (GPIO 32 - Safe Input with Internal Pull-Up, Active LOW)
#define SOS_BUTTON_PIN 32

// 3. I2C Bus Pins (MAX30102 Heart Rate Sensor & MPU6050 Accelerometer)
#define SDA_PIN 21
#define SCL_PIN 22

// 4. OneWire Data Pin (DS18B20 Digital Temperature Sensor)
#define DS18B20_PIN 4

// 5. NEO-6M GPS Module HardwareSerial2 Pins (Baud: 9600)
#define GPS_RX_PIN 16
#define GPS_TX_PIN 17

// 6. SIM800L GSM Module HardwareSerial1 Pins (Baud: 9600)
#define GSM_RX_PIN 26
#define GSM_TX_PIN 27

// 7. System Intervals & Debounce Constants (in milliseconds)
#define SENSOR_READ_INTERVAL 10000     // 10-second telemetry reporting interval
#define EMERGENCY_COOLDOWN_MS 30000    // 30-second cooldown between emergency triggers
#define DEBOUNCE_DELAY_MS 50           // 50ms software debounce for push button
#define VOICE_CALL_DURATION_MS 20000   // 20-second max duration for automated emergency voice call

// 8. Device Identity Guard
#ifndef DEVICE_ID
#define DEVICE_ID "ALPHA-001"
#endif

#endif // CONFIG_H
