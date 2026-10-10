/*
 * Alpha Squared - Single Integrated ESP32 Arduino Sketch
 * File: AlphaSquared_ESP32.ino
 * 
 * Target Board: ESP32 DevKit
 * 
 * Hardware Connections:
 * - Physical SOS Push Button      -> GPIO 32 (Input with Internal Pull-up, Active LOW)
 * - DS18B20 Temperature Sensor    -> OneWire GPIO 4 (with 4.7k resistor to 3.3V)
 * - MAX30102 Heart Rate Sensor    -> I2C SDA (GPIO 21), SCL (GPIO 22)
 * - NEO-6M GPS Module             -> HardwareSerial2: ESP32 RX2 (GPIO 16) -> GPS TX, ESP32 TX2 (GPIO 17) -> GPS RX
 * - SIM800L 2G GSM Module         -> HardwareSerial1: ESP32 RX1 (GPIO 26) -> GSM TX, ESP32 TX1 (GPIO 27) -> GSM RX
 * - Status LED                    -> GPIO 2 (Onboard LED)
 * - Piezo Siren / Buzzer          -> GPIO 23
 * 
 * Serial Monitor Controls (115200 baud):
 * - Enter 'E' or 'e': Trigger manual test Emergency SMS & Voice Call
 * - Enter 'H' or 'h': End/hang up active voice call (ATH)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <TinyGPS++.h>
#include "MAX30105.h"
#include "heartRate.h"

// =========================================================================
// 1. CONFIGURATION & PLACEHOLDERS (Edit for your local Wi-Fi & Contact)
// =========================================================================
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

#define API_BASE_URL "https://alpha-squared-iooot.vercel.app"
#define DEVICE_ID "ALPHA-001"
#define DEVICE_TOKEN "alphadev_alpha001_secret_token_2026"

// Emergency Contact Number in E.164 international format
#define EMERGENCY_PHONE_NUMBER "+919876543210"

// =========================================================================
// 2. HARDWARE PIN DEFINITIONS & SYSTEM TIMINGS
// =========================================================================
#define BUZZER_PIN 23
#define LED_STATUS_PIN 2
#define SOS_BUTTON_PIN 32

#define SDA_PIN 21
#define SCL_PIN 22
#define DS18B20_PIN 4

#define GPS_RX_PIN 16
#define GPS_TX_PIN 17
#define GSM_RX_PIN 26
#define GSM_TX_PIN 27

#define SENSOR_READ_INTERVAL 10000   // 10-second telemetry reporting interval
#define EMERGENCY_COOLDOWN_MS 30000  // 30-second cooldown between emergency triggers
#define DEBOUNCE_DELAY_MS 50         // 50ms software debounce
#define VOICE_CALL_DURATION_MS 20000 // 20-second max call duration cap

// =========================================================================
// 3. HARDWARE SERIAL INSTANCES & SENSOR DRIVERS
// =========================================================================
HardwareSerial gpsSerial(2);  // RX: GPIO 16, TX: GPIO 17
HardwareSerial gsmSerial(1);  // RX: GPIO 26, TX: GPIO 27

OneWire oneWire(DS18B20_PIN);
DallasTemperature tempSensor(&oneWire);
TinyGPSPlus gpsDriver;
MAX30105 particleSensor;

bool max30102Available = false;
long lastBeatMs = 0;

// =========================================================================
// 4. DATA STRUCTURES & SYSTEM STATE TRACKERS
// =========================================================================
struct SensorData {
    float temperature;
    bool tempValid;
    String tempStatus; // "ok", "disconnected"

    int heartRate;
    bool hrValid;
    String hrStatus; // "ok", "disconnected"

    float latitude;
    float longitude;
    bool gpsFixValid;
    String gpsStatus; // "ok", "no_fix"

    String gsmStatus;      // "ready", "error", "unavailable"
    String lastSmsStatus;   // "submitted", "failed", "none"
    String lastSmsTime;
    String lastCallStatus;  // "idle", "dialing", "active", "ended", "failed"
    String lastSosTime;
};

static unsigned long lastSmsTimeMs = 0;
static String currentSmsStatus = "none";
static String currentSmsTimestamp = "";

static String currentCallStatus = "idle";
static unsigned long callStartTimeMs = 0;
static String lastSosTimestamp = "";
static String currentGsmStatus = "unknown";

// Debounce state trackers
static int lastButtonState = HIGH;
static int stableButtonState = HIGH;
static unsigned long lastDebounceTime = 0;

unsigned long lastSensorRead = 0;

// Function declarations
void initSensors();
bool handleDebouncedButtonPress();
SensorData readBiometricSensors();
bool triggerEmergencySMS(const String& phoneNumber, const String& reason, const SensorData& data);
bool initiateEmergencyCall(const String& phoneNumber);
void endVoiceCall();
void processGsmTasks();
void triggerLocalAlarm();
void sendVitalsToBackend(bool fall, bool sos);
void checkSerialCommands(SensorData& data);

// Initialize Sensors & Peripherals
void initSensors() {
    Serial.println("\n[Sensors] Initializing Hardware Subsystems...");
    pinMode(SOS_BUTTON_PIN, INPUT_PULLUP);

    // 1. Initialize DS18B20 Temperature Sensor
    tempSensor.begin();
    int tempCount = tempSensor.getDeviceCount();
    Serial.printf("[Sensors] DS18B20 Temperature Sensors Found: %d\n", tempCount);

    // 2. Initialize I2C Bus & MAX30102 Sensor
    Wire.begin(SDA_PIN, SCL_PIN);
    Serial.println("[Sensors] I2C Bus initialized on SDA 21, SCL 22.");

    if (particleSensor.begin(Wire, I2C_SPEED_FAST)) {
        particleSensor.setup(); // Configure MAX30102 with default settings
        particleSensor.setPulseAmplitudeRed(0x0A);
        particleSensor.setPulseAmplitudeGreen(0);
        max30102Available = true;
        Serial.println("[Sensors] ✅ MAX30102 Pulse Oximeter initialized.");
    } else {
        max30102Available = false;
        Serial.println("[Sensors] ⚠️ MAX30102 not detected on I2C bus.");
    }

    // 3. Initialize NEO-6M GPS HardwareSerial2
    gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
    Serial.println("[Sensors] NEO-6M GPS Serial2 initialized at 9600 baud.");

    // 4. Initialize SIM800L GSM HardwareSerial1
    gsmSerial.begin(9600, SERIAL_8N1, GSM_RX_PIN, GSM_TX_PIN);
    Serial.println("[Sensors] SIM800L GSM Serial1 initialized at 9600 baud.");

    delay(300);
}

// Debounced button press edge detection
bool handleDebouncedButtonPress() {
    int reading = digitalRead(SOS_BUTTON_PIN);

    if (reading != lastButtonState) {
        lastDebounceTime = millis();
    }
    lastButtonState = reading;

    if ((millis() - lastDebounceTime) >= DEBOUNCE_DELAY_MS) {
        if (reading != stableButtonState) {
            stableButtonState = reading;
            if (stableButtonState == LOW) { // Active LOW press transition
                return true;
            }
        }
    }
    return false;
}

// Read sensors without blocking GSM calls
SensorData readBiometricSensors() {
    SensorData data;
    data.tempValid = false;
    data.tempStatus = "disconnected";
    data.temperature = 0.0;

    data.hrValid = false;
    data.hrStatus = "disconnected";
    data.heartRate = 0;

    data.gpsFixValid = false;
    data.gpsStatus = "no_fix";
    data.latitude = 0.0;
    data.longitude = 0.0;

    data.gsmStatus = currentGsmStatus;
    data.lastSmsStatus = currentSmsStatus;
    data.lastSmsTime = currentSmsTimestamp;
    data.lastCallStatus = currentCallStatus;
    data.lastSosTime = lastSosTimestamp;

    // 1. Read DS18B20 Temperature
    tempSensor.requestTemperatures();
    float tC = tempSensor.getTempCByIndex(0);
    if (tC != DEVICE_DISCONNECTED_C && tC > -20.0 && tC < 65.0 && tC != 85.0) {
        data.temperature = tC;
        data.tempValid = true;
        data.tempStatus = "ok";
    } else {
        data.tempValid = false;
        data.tempStatus = "disconnected";
    }

    // 2. Read MAX30102 Pulse Sensor
    if (max30102Available) {
        long irValue = particleSensor.getIR();
        if (irValue > 50000) {
            if (checkForBeat(irValue)) {
                long delta = millis() - lastBeatMs;
                lastBeatMs = millis();
                int bpm = Math.round(60 / (delta / 1000.0));
                if (bpm >= 40 && bpm <= 220) {
                    data.heartRate = bpm;
                    data.hrValid = true;
                    data.hrStatus = "ok";
                }
            }
        } else {
            data.hrValid = false;
            data.hrStatus = "disconnected";
        }
    }

    // 3. Non-blocking GPS Serial Parsing
    while (gpsSerial.available() > 0) {
        gpsDriver.encode(gpsSerial.read());
    }

    if (gpsDriver.location.isValid() && gpsDriver.location.age() < 10000) {
        data.latitude = gpsDriver.location.lat();
        data.longitude = gpsDriver.location.lng();
        data.gpsFixValid = true;
        data.gpsStatus = "ok";
    } else {
        data.gpsFixValid = false;
        data.gpsStatus = "no_fix";
    }

    return data;
}

// Trigger Emergency Cellular SMS
bool triggerEmergencySMS(const String& phoneNumber, const String& reason, const SensorData& data) {
    unsigned long now = millis();
    if (lastSmsTimeMs > 0 && (now - lastSmsTimeMs < EMERGENCY_COOLDOWN_MS)) {
        Serial.printf("[SIM800L] SMS Cooldown active (%lu ms remaining). Alert suppressed.\n",
                      EMERGENCY_COOLDOWN_MS - (now - lastSmsTimeMs));
        return false;
    }

    Serial.println("\n[SIM800L] 🚨 Constructing Emergency Cellular SMS...");
    Serial.printf("[SIM800L] Recipient: %s | Reason: %s\n", phoneNumber.c_str(), reason.c_str());

    String message = "🚨 EMERGENCY ALERT: Patient ALPHA-001!\n";
    message += "Reason: " + reason + "\n";

    if (data.tempValid) {
        message += "Temp: " + String(data.temperature, 1) + " C\n";
    } else {
        message += "Temp: Sensor Unavailable\n";
    }

    if (data.hrValid) {
        message += "Heart Rate: " + String(data.heartRate) + " BPM\n";
    } else {
        message += "Heart Rate: Sensor Unavailable\n";
    }

    if (data.gpsFixValid) {
        message += "Location: https://maps.google.com/?q=" + String(data.latitude, 6) + "," + String(data.longitude, 6);
    } else {
        message += "Location: GPS Fix Unavailable";
    }

    // Send AT Commands to SIM800L
    gsmSerial.println("AT+CMGF=1");
    delay(200);

    gsmSerial.print("AT+CMGS=\"");
    gsmSerial.print(phoneNumber);
    gsmSerial.println("\"");

    // Non-blocking prompt wait for '>' character
    unsigned long promptStart = millis();
    bool promptReceived = false;
    while (millis() - promptStart < 2000) {
        if (gsmSerial.available()) {
            char c = gsmSerial.read();
            if (c == '>') {
                promptReceived = true;
                break;
            }
        }
        delay(10);
    }

    if (!promptReceived) {
        Serial.println("[SIM800L] ❌ SMS prompt '>' timed out.");
        currentSmsStatus = "failed";
        lastSmsTimeMs = now;
        return false;
    }

    gsmSerial.print(message);
    delay(100);
    gsmSerial.write(26); // Ctrl+Z to submit SMS

    // Wait for submission confirmation (+CMGS: or OK)
    unsigned long confirmStart = millis();
    bool submitted = false;
    String response = "";
    while (millis() - confirmStart < 5000) {
        while (gsmSerial.available()) {
            response += (char)gsmSerial.read();
        }
        if (response.indexOf("+CMGS:") != -1 || response.indexOf("OK") != -1) {
            submitted = true;
            break;
        }
        delay(50);
    }

    if (submitted) {
        Serial.println("[SIM800L] ✅ Emergency SMS submitted successfully!");
        currentSmsStatus = "submitted";
    } else {
        Serial.printf("[SIM800L] ❌ SMS submission failed or unconfirmed. GSM Response: %s\n", response.c_str());
        currentSmsStatus = "failed";
    }

    lastSmsTimeMs = now;
    currentSmsTimestamp = String(now / 1000) + "s_uptime";
    lastSosTimestamp = currentSmsTimestamp;
    return submitted;
}

// Initiate Emergency Voice Call
bool initiateEmergencyCall(const String& phoneNumber) {
    if (phoneNumber.length() < 5) {
        Serial.println("[SIM800L] ❌ Invalid emergency phone number for voice call.");
        currentCallStatus = "failed";
        return false;
    }

    Serial.printf("[SIM800L] 📞 Initiating Outgoing Emergency Voice Call to: %s\n", phoneNumber.c_str());
    String dialCmd = "ATD" + phoneNumber + ";";
    gsmSerial.println(dialCmd);

    currentCallStatus = "dialing";
    callStartTimeMs = millis();
    lastSosTimestamp = String(callStartTimeMs / 1000) + "s_uptime";
    return true;
}

// Hang up active voice call
void endVoiceCall() {
    Serial.println("[SIM800L] 🛑 Ending Voice Call (Sending ATH)...");
    gsmSerial.println("ATH");
    currentCallStatus = "ended";
}

// Non-blocking GSM task monitor & auto-hangup
void processGsmTasks() {
    while (gsmSerial.available() > 0) {
        String line = gsmSerial.readStringUntil('\n');
        line.trim();
        if (line.length() == 0) continue;

        if (line.indexOf("OK") != -1 && currentGsmStatus == "unknown") {
            currentGsmStatus = "ready";
        }

        if (line.indexOf("BUSY") != -1 || line.indexOf("NO CARRIER") != -1 || line.indexOf("NO DIALTONE") != -1 || line.indexOf("NO ANSWER") != -1) {
            Serial.println("[SIM800L] Call ended by remote party or line busy.");
            currentCallStatus = "ended";
        } else if (line.indexOf("VOICE CALL: BEGIN") != -1) {
            currentCallStatus = "active";
        } else if (line.indexOf("ERROR") != -1 && currentCallStatus == "dialing") {
            currentCallStatus = "failed";
        }
    }

    // Auto hang-up after maximum voice call duration cap (20s)
    if ((currentCallStatus == "dialing" || currentCallStatus == "active") && (millis() - callStartTimeMs > VOICE_CALL_DURATION_MS)) {
        Serial.println("[SIM800L] Max voice call duration reached (20s). Auto hanging up...");
        endVoiceCall();
    }
}

// Audible Siren Alarm
void triggerLocalAlarm() {
    for (int i = 0; i < 3; i++) {
        digitalWrite(BUZZER_PIN, HIGH);
        delay(100);
        digitalWrite(BUZZER_PIN, LOW);
        delay(100);
    }
}

// Telemetry POST Request to Vercel API Endpoint
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
        
        // TLS Verification Note:
        // For production deployments with pinned Root CA certs, replace setInsecure() with:
        // client.setCACert(root_ca_pem);
        // For serverless domains (*.vercel.app with rotating SSL certs), setInsecure() allows TLS encryption without hardcoding expiring CA certs.
        client.setInsecure();

        HTTPClient http;
        String backendUrl = String(API_BASE_URL) + "/api/iot/data";

        if (!http.begin(client, backendUrl)) {
            Serial.println("[HTTP] Connection initialization to backend failed.");
            return;
        }

        http.addHeader("Content-Type", "application/json");
        http.addHeader("x-device-token", DEVICE_TOKEN);

        String payload = "{";
        payload += "\"device_id\":\"" + String(DEVICE_ID) + "\",";

        payload += "\"temperature\":{";
        payload += "\"sensor_status\":\"" + biometrics.tempStatus + "\"";
        if (biometrics.tempValid) {
            payload += ",\"value\":" + String(biometrics.temperature, 2);
            payload += ",\"unit\":\"C\"";
        }
        payload += "},";

        payload += "\"heart_rate\":{";
        payload += "\"sensor_status\":\"" + biometrics.hrStatus + "\"";
        if (biometrics.hrValid) {
            payload += ",\"value\":" + String(biometrics.heartRate);
            payload += ",\"unit\":\"bpm\"";
        }
        payload += "},";

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

// Check Serial Commands
void checkSerialCommands(SensorData& data) {
    if (Serial.available()) {
        char cmd = Serial.read();
        if (cmd == 'E' || cmd == 'e') {
            Serial.println("\n[Serial Cmd] 'E' received: Triggering Emergency SMS & Voice Call Test...");
            triggerLocalAlarm();
            triggerEmergencySMS(EMERGENCY_PHONE_NUMBER, "Serial Monitor Emergency Test ('E')", data);
            initiateEmergencyCall(EMERGENCY_PHONE_NUMBER);
            sendVitalsToBackend(false, true);
        } else if (cmd == 'H' || cmd == 'h') {
            Serial.println("\n[Serial Cmd] 'H' received: Hanging up voice call...");
            endVoiceCall();
        }
    }
}

// setup()
void setup() {
    Serial.begin(115200);
    delay(500);

    Serial.println("=================================================");
    Serial.println(" ALPHA SQUARED - ESP32 IoT SOS & HEALTH SYSTEM   ");
    Serial.println("=================================================");

    pinMode(BUZZER_PIN, OUTPUT);
    pinMode(LED_STATUS_PIN, OUTPUT);

    initSensors();

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
        Serial.println("\n[Wi-Fi] Wi-Fi connection standby. Standalone / Cellular SMS mode active.");
        digitalWrite(LED_STATUS_PIN, LOW);
    }
}

// loop()
void loop() {
    unsigned long currentMillis = millis();
    SensorData biometrics = readBiometricSensors();

    processGsmTasks();
    checkSerialCommands(biometrics);

    bool sosButtonPressed = handleDebouncedButtonPress();
    if (sosButtonPressed) {
        Serial.println("\n🚨 PHYSICAL SOS PUSH BUTTON PRESSED!");
        triggerLocalAlarm();
        triggerEmergencySMS(EMERGENCY_PHONE_NUMBER, "Physical SOS Button Pressed", biometrics);
        initiateEmergencyCall(EMERGENCY_PHONE_NUMBER);
        sendVitalsToBackend(false, true);
    }

    if (currentMillis - lastSensorRead >= SENSOR_READ_INTERVAL) {
        lastSensorRead = currentMillis;
        sendVitalsToBackend(false, sosButtonPressed);
    }
}
