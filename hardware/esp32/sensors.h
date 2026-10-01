#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>

struct SensorData {
    int heartRate;
    int spo2;
    float temperature;
    bool isValid;
};

void initSensors();
SensorData readBiometricSensors();

#endif // SENSORS_H
