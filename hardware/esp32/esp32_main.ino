/*
 * Alpha Squared - ESP32 IoT Smart Health & Emergency Detection System
 * Main Sketch with Physical SOS Push Button & Automatic Cellular Voice Call
 * 
 * Hardware Connections:
 * - SOS Push Button               -> GPIO 32 (Active LOW, Internal Pull-up)
 * - MAX30102 Heart Rate          -> I2C (SDA 21, SCL 22)
 * - DS18B20 Temperature           -> OneWire GPIO 4 (with 4.7k resistor)
 * - NEO-6M GPS Module             -> HardwareSerial2 (RX 16, TX 17)
 * - SIM800L Cellular GSM Module   -> HardwareSerial1 (RX 26, TX 27)
 * - MPU6050 Accelerometer/Gyro    -> I2C (SDA 21, SCL 22)
 * - Buzzer                        -> GPIO 23
 * - Status LED                    -> GPIO 2
 * 
 * Serial Monitor Commands:
 * - Enter 'E' or 'e': Trigger manual Emergency SMS & Voice Call Test.
 * - Enter 'H' or 'h': End/hang up active voice call (ATH).
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "config.h"
#include "wifi_config.h"
#include "sensors.h"
#include "fall_detection.h"

unsigned long lastSensorRead = 0;

void setup() {
    Serial.begin(115200);
    delay(500);

    Serial.println("=================================================");
    Serial.println(" ALPHA SQUARED - IoT SOS & HEALTH MONITORING    ");
    Serial.println("=================================================");

    pinMode(BUZZER_PIN, OUTPUT);
    pinMode(LED_STATUS_PIN, OUTPUT);

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
        Serial.println("\n[Wi-Fi] Wi-Fi connection standby. Local standalone / Cellular SMS mode active.");
        digitalWrite(LED_STATUS_PIN, LOW);
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

void sendVitalsToBackend(bool fall, bool sos) {
    SensorData biometrics = readBiometricSensors();

    Serial.printf("[Sensors] HR: %s (%s) | Temp: %s (%s) | GPS: %s | GSM: %s | Call: %s\n",
                  biometrics.hrValid ? String(biometrics.heartRate).c_str() : "N/A",
                  biometrics.hrStatus.c_str(),
                  biometrics.tempValid ? String(biometrics.temperature, 2).c_str() : "N/A",
                  biometrics.tempStatus.c_str(),
                  biometrics.gpsStatus.c_str(),
                  biometrics.gsmStatus.c_str(),
                  biometrics.lastCallStatus.c_str());

    if (WiFi.status() == WL_CONNECTED) {
        WiFiClientSecure client;
        client.setInsecure(); // Allows secure TLS connection without CA cert expiration issues

        HTTPClient http;
        String backendUrl = String(API_BASE_URL) + "/api/iot/data";
        
        if (!http.begin(client, backendUrl)) {
            Serial.println("[HTTP] Connection initialization to backend failed.");
            return;
        }

        http.addHeader("Content-Type", "application/json");
        http.addHeader("x-device-token", DEVICE_TOKEN);

        // Construct JSON telemetry payload compatible with Vercel API
        String payload = "{";
        payload += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
        
        // Temperature object
        payload += "\"temperature\":{";
        payload += "\"sensor_status\":\"" + biometrics.tempStatus + "\"";
        if (biometrics.tempValid) {
            payload += ",\"value\":" + String(biometrics.temperature, 2);
            payload += ",\"unit\":\"C\"";
        }
        payload += "},";

        // Heart Rate object
        payload += "\"heart_rate\":{";
        payload += "\"sensor_status\":\"" + biometrics.hrStatus + "\"";
        if (biometrics.hrValid) {
            payload += ",\"value\":" + String(biometrics.heartRate);
            payload += ",\"unit\":\"bpm\"";
        }
        payload += "},";

        // GPS object
        payload += "\"gps\":{";
        payload += "\"sensor_status\":\"" + biometrics.gpsStatus + "\"";
        if (biometrics.gpsFixValid) {
            payload += ",\"latitude\":" + String(biometrics.latitude, 7);
            payload += ",\"longitude\":" + String(biometrics.longitude, 7);
            payload += ",\"fix_valid\":true";
        } else {
            payload += ",\"fix_valid\":false";
        }
        payload += "},";

        // SIM800L status object with call state
        payload += "\"sim800l\":{";
        payload += "\"status\":\"" + biometrics.gsmStatus + "\",";
        payload += "\"last_sms_status\":\"" + biometrics.lastSmsStatus + "\",";
        payload += "\"last_call_status\":\"" + biometrics.lastCallStatus + "\",";
        payload += "\"last_sos_time\":\"" + biometrics.lastSosTime + "\"";
        payload += "},";

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

void loop() {
    unsigned long currentMillis = millis();
    SensorData biometrics = readBiometricSensors();

    // Non-blocking GSM call duration monitor & response parser
    processGsmTasks();

    // Check Serial Monitor commands (Key 'E' for Emergency Test, 'H' to Hang up)
    checkSerialCommands(biometrics);

    // 1. Check Physical SOS Push Button Press (GPIO 32, Active LOW with Debounce)
    bool sosButtonPressed = handleDebouncedButtonPress();
    if (sosButtonPressed) {
        Serial.println("\n🚨 PHYSICAL SOS PUSH BUTTON PRESSED!");
        triggerLocalAlarm();
        triggerEmergencySMS(EMERGENCY_PHONE_NUMBER, "Physical SOS Button Pressed", biometrics);
        initiateEmergencyCall(EMERGENCY_PHONE_NUMBER);
        sendVitalsToBackend(false, true);
    }

    // 2. Check Fall Detection IMU
    bool fallDetected = checkFallDetected();
    if (fallDetected) {
        Serial.println("\n⚠️ FALL DETECTED BY ACCELEROMETER!");
        triggerLocalAlarm();
        triggerEmergencySMS(EMERGENCY_PHONE_NUMBER, "Fall Impact Detected", biometrics);
        initiateEmergencyCall(EMERGENCY_PHONE_NUMBER);
        sendVitalsToBackend(true, false);
    }

    // 3. Periodic Telemetry Ingestion (Every 10 Seconds)
    if (currentMillis - lastSensorRead >= SENSOR_READ_INTERVAL) {
        lastSensorRead = currentMillis;
        sendVitalsToBackend(fallDetected, sosButtonPressed);
    }
}
