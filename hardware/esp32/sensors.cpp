#include "sensors.h"
#include "config.h"

// Note: Replace simulated readings with MAX30102 / LM35 pin readings when hardware is connected.

void initSensors() {
    Serial.println("[Sensors] Initializing biometrics (MAX30102 & Temperature Sensor)...");
    // Wire.begin(SDA_PIN, SCL_PIN);
    // Initialize MAX30102 sensor if detected on I2C bus
}

SensorData readBiometricSensors() {
    SensorData data;
    
    // Realistic health range sampling algorithm for prototype demonstration
    // Base heart rate 72-78, SpO2 96-99%, Temp 36.5-37.1
    data.heartRate = 72 + random(-4, 6);
    data.spo2 = 97 + random(-1, 3);
    if (data.spo2 > 100) data.spo2 = 100;
    
    data.temperature = 36.6 + (float)random(-2, 4) / 10.0;
    data.isValid = true;

    return data;
}
