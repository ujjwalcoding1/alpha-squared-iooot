# ESP32 Hardware Wiring Notes & Pinout

## Component Pin Connections

| Component | Component Pin | ESP32 Pin | Wire Color / Power |
| :--- | :--- | :--- | :--- |
| **MPU6050 (IMU)** | VCC | 3.3V | Red |
| | GND | GND | Black |
| | SDA | GPIO 21 | Blue |
| | SCL | GPIO 22 | Yellow |
| **MAX30102 (Pulse Oximeter)** | VCC | 3.3V | Red |
| | GND | GND | Black |
| | SDA | GPIO 21 (Shared I2C Bus) | Blue |
| | SCL | GPIO 22 (Shared I2C Bus) | Yellow |
| **SOS Button** | Pin 1 | GPIO 4 | Green |
| | Pin 2 | GND | Black |
| **Buzzer** | (+) Positive | GPIO 23 | Orange |
| | (-) Negative | GND | Black |
| **Status LED** | (+) Anode | GPIO 2 (Built-in) | Internal |

## Notes
- **I2C Bus Sharing:** Both the MAX30102 and MPU6050 share the hardware I2C bus (GPIO 21 for SDA, GPIO 22 for SCL).
- **Internal Pull-up Resistor:** GPIO 4 uses `INPUT_PULLUP` mode for the SOS button; pressing the button pulls the signal to `GND`.
- **Power Supply:** ESP32 is powered via Micro-USB (5V) or via external 3.3V regulated power rail.
