#include "sensors.h"
#include "config.h"
#include "wifi_config.h"

#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <TinyGPS++.h>

// Hardware Serial instances for GPS and GSM
HardwareSerial gpsSerial(2);  // RX: GPIO 16, TX: GPIO 17
HardwareSerial gsmSerial(1);  // RX: GPIO 26, TX: GPIO 27

// Sensor Drivers
OneWire oneWire(DS18B20_PIN);
DallasTemperature tempSensor(&oneWire);
TinyGPSPlus gpsDriver;

// System Timers & Status Trackers
static unsigned long lastSmsTimeMs = 0;
static String currentSmsStatus = "none";
static String currentSmsTimestamp = "";

static String currentCallStatus = "idle"; // "idle", "dialing", "active", "ended", "failed"
static unsigned long callStartTimeMs = 0;
static String lastSosTimestamp = "";

// Software Debouncing State
static int lastButtonState = HIGH;
static int stableButtonState = HIGH;
static unsigned long lastDebounceTime = 0;

void initSensors() {
    Serial.println("\n[Sensors] Initializing Hardware Subsystems...");

    pinMode(SOS_BUTTON_PIN, INPUT_PULLUP);

    // 1. Initialize DS18B20 Temperature Sensor
    tempSensor.begin();
    int tempCount = tempSensor.getDeviceCount();
    Serial.printf("[Sensors] DS18B20 Temperature Sensors Found: %d\n", tempCount);

    // 2. Initialize I2C Bus (MAX30102 & MPU6050)
    Wire.begin(SDA_PIN, SCL_PIN);
    Serial.println("[Sensors] I2C Bus initialized on SDA 21, SCL 22.");

    // 3. Initialize NEO-6M GPS HardwareSerial2
    gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
    Serial.println("[Sensors] NEO-6M GPS Serial2 initialized at 9600 baud.");

    // 4. Initialize SIM800L GSM HardwareSerial1
    gsmSerial.begin(9600, SERIAL_8N1, GSM_RX_PIN, GSM_TX_PIN);
    Serial.println("[Sensors] SIM800L GSM Serial1 initialized at 9600 baud.");

    delay(300);
}

bool handleDebouncedButtonPress() {
    int reading = digitalRead(SOS_BUTTON_PIN);

    if (reading != lastButtonState) {
        lastDebounceTime = millis();
    }
    lastButtonState = reading;

    if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY_MS) {
        if (reading != stableButtonState) {
            stableButtonState = reading;
            // Active LOW button press transition (HIGH -> LOW)
            if (stableButtonState == LOW) {
                return true;
            }
        }
    }
    return false;
}

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

    data.gsmStatus = "unknown";
    data.lastSmsStatus = currentSmsStatus;
    data.lastSmsTime = currentSmsTimestamp;
    data.lastCallStatus = currentCallStatus;
    data.lastSosTime = lastSosTimestamp;

    // 1. Read DS18B20 Temperature
    tempSensor.requestTemperatures();
    float tC = tempSensor.getTempCByIndex(0);

    if (tC != DEVICE_DISCONNECTED_C && tC > -20.0 && tC < 65.0) {
        data.temperature = tC;
        data.tempValid = true;
        data.tempStatus = "ok";
    } else {
        data.tempValid = false;
        data.tempStatus = "disconnected";
    }

    // 2. Non-blocking GPS Serial Data Parsing
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

    // 3. Check GSM AT Status
    gsmSerial.println("AT");
    delay(50);
    if (gsmSerial.available()) {
        String resp = gsmSerial.readString();
        if (resp.indexOf("OK") != -1) {
            data.gsmStatus = "ready";
        } else {
            data.gsmStatus = "error";
        }
    } else {
        data.gsmStatus = "unavailable";
    }

    return data;
}

bool triggerEmergencySMS(const String& phoneNumber, const String& reason, const SensorData& data) {
    unsigned long now = millis();
    if (now - lastSmsTimeMs < EMERGENCY_COOLDOWN_MS) {
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
    gsmSerial.println("AT+CMGF=1"); // Set SMS text mode
    delay(200);

    gsmSerial.print("AT+CMGS=\"");
    gsmSerial.print(phoneNumber);
    gsmSerial.println("\"");

    // Wait for '>' prompt from SIM800L
    unsigned long promptStart = millis();
    while (millis() - promptStart < 1500) {
        if (gsmSerial.available() && gsmSerial.read() == '>') break;
        delay(10);
    }

    gsmSerial.print(message);
    delay(100);
    gsmSerial.write(26); // Send Ctrl+Z to submit SMS
    delay(2500);

    bool submitted = false;
    String response = "";
    while (gsmSerial.available()) {
        response += (char)gsmSerial.read();
    }

    if (response.indexOf("+CMGS:") != -1 || response.indexOf("OK") != -1) {
        Serial.println("[SIM800L] ✅ Emergency SMS submitted successfully!");
        submitted = true;
        currentSmsStatus = "submitted";
    } else {
        Serial.printf("[SIM800L] ❌ SMS submission failed or unconfirmed. GSM Response: %s\n", response.c_str());
        submitted = false;
        currentSmsStatus = "failed";
    }

    lastSmsTimeMs = now;
    currentSmsTimestamp = String(now / 1000) + "s_uptime";
    lastSosTimestamp = currentSmsTimestamp;
    return submitted;
}

bool initiateEmergencyCall(const String& phoneNumber) {
    if (phoneNumber.length() < 5) {
        Serial.println("[SIM800L] ❌ Invalid emergency phone number for voice call.");
        currentCallStatus = "failed";
        return false;
    }

    Serial.printf("[SIM800L] 📞 Initiating Outgoing Emergency Cellular Voice Call to: %s\n", phoneNumber.c_str());

    // GSM AT command for voice dial requires trailing semicolon ';'
    String dialCmd = "ATD" + phoneNumber + ";";
    gsmSerial.println(dialCmd);

    currentCallStatus = "dialing";
    callStartTimeMs = millis();
    lastSosTimestamp = String(callStartTimeMs / 1000) + "s_uptime";
    return true;
}

void endVoiceCall() {
    Serial.println("[SIM800L] 🛑 Ending Voice Call (Sending ATH)...");
    gsmSerial.println("ATH");
    currentCallStatus = "ended";
}

void processGsmTasks() {
    // Non-blocking GSM UART reader to track voice call state
    while (gsmSerial.available() > 0) {
        String line = gsmSerial.readStringUntil('\n');
        line.trim();
        if (line.length() == 0) continue;

        Serial.printf("[GSM UART] %s\n", line.c_str());

        if (line.indexOf("BUSY") != -1 || line.indexOf("NO CARRIER") != -1 || line.indexOf("NO DIALTONE") != -1) {
            Serial.println("[SIM800L] Call ended by remote party or line busy.");
            currentCallStatus = "ended";
        } else if (line.indexOf("VOICE CALL: BEGIN") != -1 || line.indexOf("OK") != -1) {
            if (currentCallStatus == "dialing") {
                currentCallStatus = "active";
            }
        } else if (line.indexOf("ERROR") != -1) {
            if (currentCallStatus == "dialing") {
                currentCallStatus = "failed";
            }
        }
    }

    // Auto-hangup call after VOICE_CALL_DURATION_MS (20s) to limit call costs
    if ((currentCallStatus == "dialing" || currentCallStatus == "active") && (millis() - callStartTimeMs > VOICE_CALL_DURATION_MS)) {
        Serial.println("[SIM800L] Voice call maximum duration timeout reached (20s). Hanging up...");
        endVoiceCall();
    }
}

void checkSerialCommands(SensorData& data) {
    if (Serial.available() > 0) {
        char ch = Serial.read();
        if (ch == 'E' || ch == 'e') {
            Serial.println("\n[Serial Monitor] 'E' Key Pressed! Triggering Emergency SMS & Voice Call Test...");
            triggerEmergencySMS(EMERGENCY_PHONE_NUMBER, "Serial Monitor Test (Key E)", data);
            initiateEmergencyCall(EMERGENCY_PHONE_NUMBER);
        } else if (ch == 'H' || ch == 'h') {
            Serial.println("\n[Serial Monitor] 'H' Key Pressed! Hanging up active voice call...");
            endVoiceCall();
        }
    }
}
