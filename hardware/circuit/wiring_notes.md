# ESP32 Hardware Wiring Notes & Pinout

## Component Pin Connections Table

| Component | Component Pin | ESP32 Pin | Wire Color / Power Notes |
| :--- | :--- | :--- | :--- |
| **Physical SOS Push Button** | Pin 1 (Signal) | **GPIO 32** | Green (Internal `INPUT_PULLUP`, Active LOW) |
| | Pin 2 (Ground) | GND | Black |
| **MPU6050 (Fall IMU)** | VCC | 3.3V | Red |
| | GND | GND | Black |
| | SDA | GPIO 21 | Blue (Shared I2C Bus) |
| | SCL | GPIO 22 | Yellow (Shared I2C Bus) |
| **MAX30102 (Heart Rate)** | VCC | 3.3V | Red |
| | GND | GND | Black |
| | SDA | GPIO 21 | Blue (Shared I2C Bus) |
| | SCL | GPIO 22 | Yellow (Shared I2C Bus) |
| **DS18B20 (Temperature)** | VDD | 3.3V | Red |
| | GND | GND | Black |
| | DQ (Data) | **GPIO 4** | Yellow (with 4.7kΩ pull-up resistor to 3.3V) |
| **NEO-6M GPS Module** | VCC | 3.3V / 5V | Red |
| | GND | GND | Black |
| | TX | **GPIO 16 (RX2)** | Yellow |
| | RX | **GPIO 17 (TX2)** | Blue |
| **SIM800L GSM Module** | VCC | 3.7V – 4.2V (2A Peak) | Red (External LiPo / LM2596 Buck Converter) |
| | GND | Common GND | Black |
| | TX | **GPIO 26 (RX1)** | Yellow |
| | RX | **GPIO 27 (TX1)** | Blue (with 1kΩ/2kΩ voltage divider to 3.3V) |
| **Buzzer** | (+) Positive | **GPIO 23** | Orange |
| | (-) Negative | GND | Black |
| **Status LED** | (+) Anode | **GPIO 2** | Built-in LED |

---

## Technical Hardware Notes & Cellular Compatibility

1. **SOS Push Button Pin Choice (GPIO 32):**
   - GPIO 32 is a safe, non-bootstrapping input pin with internal pull-up (`INPUT_PULLUP`) capability.
   - Pressing the switch shorts GPIO 32 to `GND` (falling edge trigger).
   - Software debouncing (50ms) prevents continuous false re-triggers.

2. **SIM800L Cellular Power & Voltage:**
   - SIM800L operates at 3.7V – 4.2V and draws up to 2A burst current during SMS transmission and call dialing.
   - **Do NOT power SIM800L directly from the ESP32 3.3V pin.** Use a dedicated 3.7V LiPo battery or an LM2596 DC-DC buck converter.
   - Common Ground (GND) must be connected between ESP32, SIM800L, and external power supply.

3. **2G GSM Operator Notice:**
   - SIM800L is a quad-band 2G GSM/GPRS module.
   - Ensure your SIM card and local carrier support **2G GSM voice and SMS** (e.g. Airtel/BSNL in India).
   - If deploying in regions where 2G has been decommissioned (e.g. 4G VoLTE only networks), replace the SIM800L with a 4G LTE voice-capable module such as **SIM7600G-H** or **A7670C**.
