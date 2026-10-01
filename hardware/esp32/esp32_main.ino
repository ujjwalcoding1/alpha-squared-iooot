/*
 * Alpha Squared - ESP32 IoT Smart Health & Emergency Detection System
 * Main Sketch
 * 
 * Hardware Connections:
 * - MAX30102 Heart Rate & SpO2 -> I2C (SDA 21, SCL 22)
 * - MPU6050 Accelerometer/Gyro  -> I2C (SDA 21, SCL 22)
 * - SOS Button                  -> Pin 4 (Pull-up)
 * - Buzzer                      -> Pin 23
 * - Status LED                  -> Pin 2
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include "config.h"
#include "wifi_config.h"
#include "sensors.h"
#include "fall_detection.h"

unsigned long lastSensorRead = 0;
unsigned long lastHeartbeat = 0;

void setup() {
    Serial.begin(115200);
    delay(500);

    Serial.println("==========================================");
    Serial.println(" ALPHA SQUARED - IoT EMERGENCY DETECTION  ");
    Serial.println("==========================================");

    pinMode(BUZZER_PIN, OUTPUT);
    pinMode(LED_STATUS_PIN, OUTPUT);
    pinMode(SOS_BUTTON_PIN, INPUT_PULLUP);

    initSensors();
    initFallDetection();

    // Connect to Wi-Fi
    Serial.print("[Wi-Fi] Connecting to: ");
    Serial.println(WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 10) {
        delay(500);
        Serial.print(".");
        digitalWrite(LED_STATUS_PIN, !digitalRead(LED_STATUS_PIN));
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[Wi-Fi] Connected successfully!");
        Serial.print("[Wi-Fi] IP Address: ");
        Serial.println(WiFi.localIP());
        digitalWrite(LED_STATUS_PIN, HIGH);
    } else {
        Serial.println("\n[Wi-Fi] Connection failed! Running in local standalone mode.");
        digitalWrite(LED_STATUS_PIN, LOW);
    }
}

void loop() {
    unsigned long currentMillis = millis();

    // 1. Check SOS Button Press (Active LOW)
    bool sosPressed = (digitalRead(SOS_BUTTON_PIN) == LOW);
    if (sosPressed) {
        Serial.println("🚨 SOS BUTTON PRESSED MANUAL EMERGENCY!");
        triggerLocalAlarm();
        sendVitalsToFirebase(true, true);
        delay(2000); // Debounce delay
    }

    // 2. Check Fall Detection IMU
    bool fallDetected = checkFallDetected();
    if (fallDetected) {
        Serial.println("⚠️ FALL DETECTED BY ACCELEROMETER!");
        triggerLocalAlarm();
        sendVitalsToFirebase(true, false);
        delay(2000);
    }

    // 3. Periodic Sensor Readings and Sync
    if (currentMillis - lastSensorRead >= SENSOR_READ_INTERVAL) {
        lastSensorRead = currentMillis;
        sendVitalsToFirebase(fallDetected, sosPressed);
    }
}

void triggerLocalAlarm() {
    for (int i = 0; i < 3; i++) {
        digitalWrite(BUZZER_PIN, HIGH);
        delay(100);
        digitalWrite(BUZZER_PIN, LOW);
        delay(100);
    }
}

void sendVitalsToFirebase(bool fall, bool sos) {
    SensorData biometrics = readBiometricSensors();

    Serial.printf("[Sensors] HR: %d BPM | SpO2: %d%% | Temp: %.1f °C | Fall: %s | SOS: %s\n",
                  biometrics.heartRate, biometrics.spo2, biometrics.temperature,
                  fall ? "YES" : "NO", sos ? "YES" : "NO");

    if (WiFi.status() == WL_CONNECTED) {
        HTTPClient http;
        String firebaseUrl = String(FIREBASE_HOST) + "healthMonitoring/currentVitals.json";
        
        http.begin(firebaseUrl);
        http.addHeader("Content-Type", "application/json");

        // Construct JSON Payload
        String payload = "{";
        payload += "\"heartRate\":" + String(biometrics.heartRate) + ",";
        payload += "\"spo2\":" + String(biometrics.spo2) + ",";
        payload += "\"temperature\":" + String(biometrics.temperature) + ",";
        payload += "\"fallDetected\":" + String(fall ? "true" : "false") + ",";
        payload += "\"sos\":" + String(sos ? "true" : "false") + ",";
        payload += "\"latitude\":" + String(DEFAULT_LATITUDE, 6) + ",";
        payload += "\"longitude\":" + String(DEFAULT_LONGITUDE, 6) + ",";
        payload += "\"timestamp\":" + String(millis());
        payload += "}";

        int httpResponseCode = http.PUT(payload);
        if (httpResponseCode > 0) {
            // Updated successfully
        } else {
            Serial.printf("[Firebase] HTTP PUT failed, error: %s\n", http.errorToString(httpResponseCode).c_str());
        }
        http.end();

        // Update Device Heartbeat Status
        String deviceUrl = String(FIREBASE_HOST) + "healthMonitoring/device.json";
        http.begin(deviceUrl);
        http.addHeader("Content-Type", "application/json");
        String devicePayload = "{\"deviceId\":\"" + String(DEVICE_ID) + "\",\"online\":true,\"lastSeen\":" + String(millis()) + "}";
        http.PUT(devicePayload);
        http.end();
    }
}
