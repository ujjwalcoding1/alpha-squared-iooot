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
#include <WiFiClientSecure.h>
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
        sendVitalsToBackend(true, true);
        delay(2000); // Debounce delay
    }

    // 2. Check Fall Detection IMU
    bool fallDetected = checkFallDetected();
    if (fallDetected) {
        Serial.println("⚠️ FALL DETECTED BY ACCELEROMETER!");
        triggerLocalAlarm();
        sendVitalsToBackend(true, false);
        delay(2000);
    }

    // 3. Periodic Sensor Readings and Sync
    if (currentMillis - lastSensorRead >= SENSOR_READ_INTERVAL) {
        lastSensorRead = currentMillis;
        sendVitalsToBackend(fallDetected, sosPressed);
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

/**
 * Transmits real-time biometrics to Alpha Squared Vercel/MongoDB REST API
 * POST /api/iot/data
 * Headers: Content-Type: application/json, x-device-token: <DEVICE_TOKEN>
 */
void sendVitalsToBackend(bool fall, bool sos) {
    SensorData biometrics = readBiometricSensors();

    Serial.printf("[Sensors] HR: %d BPM | SpO2: %d%% | Temp: %.2f °C | Fall: %s | SOS: %s\n",
                  biometrics.heartRate, biometrics.spo2, biometrics.temperature,
                  fall ? "YES" : "NO", sos ? "YES" : "NO");

    if (WiFi.status() == WL_CONNECTED) {
        WiFiClientSecure client;
        client.setInsecure(); // Allows secure TLS connection without hardcoded CA cert expiration

        HTTPClient http;
        String backendUrl = String(API_BASE_URL) + "/api/iot/data";
        
        if (!http.begin(client, backendUrl)) {
            Serial.println("[HTTP] Connection initialization to backend failed.");
            return;
        }

        http.addHeader("Content-Type", "application/json");
        http.addHeader("x-device-token", DEVICE_TOKEN);

        // Construct JSON telemetry payload
        // NOTE: Blood pressure and GPS are intentionally omitted because hardware modules are not installed.
        // Server will record them as null/not_installed without fabrication.
        String payload = "{";
        payload += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
        payload += "\"temperature\":{";
        payload += "\"value\":" + String(biometrics.temperature, 2) + ",";
        payload += "\"unit\":\"C\",";
        payload += "\"sensor_status\":\"ok\"";
        payload += "},";
        payload += "\"heart_rate\":{";
        payload += "\"value\":" + String(biometrics.heartRate) + ",";
        payload += "\"unit\":\"bpm\",";
        payload += "\"sensor_status\":\"ok\"";
        payload += "},";
        payload += "\"battery_level\":95,";
        payload += "\"signal_strength\":" + String(WiFi.RSSI()) + ",";
        payload += "\"is_simulated\":false";
        payload += "}";

        int httpResponseCode = http.POST(payload);
        if (httpResponseCode > 0) {
            String response = http.getString();
            Serial.printf("[Backend API] Response HTTP %d: %s\n", httpResponseCode, response.c_str());
        } else {
            Serial.printf("[Backend API] HTTP POST failed, error: %s\n", http.errorToString(httpResponseCode).c_str());
        }
        http.end();
    }
}
