#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>

struct SensorData {
    // Temperature (DS18B20)
    float temperature;
    bool tempValid;
    String tempStatus; // "ok", "disconnected", "error"

    // Heart Rate (MAX30102)
    int heartRate;
    bool hrValid;
    String hrStatus; // "ok", "disconnected", "error"

    // GPS Location (NEO-6M)
    float latitude;
    float longitude;
    bool gpsFixValid;
    String gpsStatus; // "ok", "no_fix", "disconnected"

    // SIM800L Cellular GSM Module
    String gsmStatus;      // "ready", "error", "unavailable"
    String lastSmsStatus;   // "submitted", "failed", "none"
    String lastSmsTime;
    String lastCallStatus;  // "idle", "dialing", "active", "ended", "failed"
    String lastSosTime;
};

void initSensors();
SensorData readBiometricSensors();
bool triggerEmergencySMS(const String& phoneNumber, const String& reason, const SensorData& data);
bool initiateEmergencyCall(const String& phoneNumber);
void endVoiceCall();
void processGsmTasks();
bool handleDebouncedButtonPress();
void checkSerialCommands(SensorData& data);

#endif // SENSORS_H
