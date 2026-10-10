#ifndef CONFIG_H
#define CONFIG_H

// Pin Definitions
#define BUZZER_PIN 23
#define LED_STATUS_PIN 2
#define SOS_BUTTON_PIN 4

// I2C Pins for MPU6050 & MAX30102
#define SDA_PIN 21
#define SCL_PIN 22

// OneWire Pin for DS18B20 Temperature Sensor
#define ONE_WIRE_BUS 18

// System Intervals (in milliseconds)
#define SENSOR_READ_INTERVAL 2000
#define HEARTBEAT_INTERVAL 5000

// Fall Detection Constants
#define ACCEL_THRESHOLD_HIGH 2.8   // High G impact threshold (~2.8g)
#define ACCEL_THRESHOLD_LOW 0.4    // Free-fall threshold (~0.4g)
#define GYRO_ANGLE_THRESHOLD 45.0  // Orientation tilt change threshold in degrees

// Device Identity
#define DEVICE_ID "ESP32_ALPHA_01"

#endif // CONFIG_H
