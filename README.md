# Alpha Squared – IoT Smart Health & Emergency Detection System

![Alpha Squared Banner](web/assets/images/banner.png)

> **Hackathon Project:** 3-Day IoT Health Monitoring & Emergency Alert Platform
> **Tech Stack:** ESP32 (C/C++), Firebase Realtime Database, Vanilla HTML5/CSS3/JavaScript, Chart.js, Leaflet.js

---

## 📌 Executive Summary

**Alpha Squared** is a complete, real-time IoT healthcare monitoring and emergency detection system designed for elderly care, post-operative monitoring, and high-risk health tracking. Using an ESP32 microcontroller equipped with biometric sensors (Heart Rate, SpO2, Temperature) and an MPU6050 accelerometer/gyroscope, the system detects critical vital abnormalities and sudden fall events. 

Data is transmitted directly via Wi-Fi to **Firebase Realtime Database** and visualized instantly on a responsive, zero-latency web dashboard accessible from desktop and mobile devices.

---

## 🏗 System Architecture & Workflow

```
+-------------------+      +-------------------+      +-------------------------+
|  Biometric &      |      |   ESP32 Board     |      |  Firebase Realtime DB   |
|  Motion Sensors   | ---> |  (Biometrics &    | ---> |  (JSON Data Store &     |
|  (MAX30102/MPU)   |      |   Fall Algorithm) |      |   Sync Engine)          |
+-------------------+      +-------------------+      +-------------------------+
                                                                   |
                                                                   v
+-------------------+      +-------------------+      +-------------------------+
| Caregiver Alerts  | <--- | Web Dashboard     | <--- | Real-Time Sync &        |
| (SMS/Email/Audio) |      | (JS/Charts/Maps)  |      | Status Calculations     |
+-------------------+      +-------------------+      +-------------------------+
```

---

## 📂 Repository Structure

```
ALPHA-SQUARED-IOT/
│
├── README.md                          # Main project overview & setup guide
├── .gitignore                         # Secret & build file exclusions
│
├── hardware/
│   ├── esp32/
│   │   ├── esp32_main.ino             # Main Arduino sketch & loop logic
│   │   ├── config.h                   # Pin definitions & interval constants
│   │   ├── wifi_config.h              # Wi-Fi SSID & Firebase credentials
│   │   ├── sensors.h                  # Biometric sensor reading headers
│   │   ├── sensors.cpp                # Heart rate, SpO2, temperature drivers
│   │   ├── fall_detection.h           # MPU6050 vector magnitude fall header
│   │   └── fall_detection.cpp         # Fall algorithm implementation
│   └── circuit/
│       ├── circuit_diagram.png        # Graphical wiring schematic
│       └── wiring_notes.md            # Pinout tables and voltage guidelines
│
├── web/
│   ├── index.html                     # Landing & authentication entry page
│   ├── dashboard.html                 # Live monitoring dashboard
│   ├── emergency.html                 # Dedicated emergency override screen
│   ├── history.html                   # Historical vitals & event log tables
│   ├── settings.html                  # Thresholds & caregiver contact config
│   ├── css/
│   │   ├── style.css                  # Core typography & CSS variables
│   │   ├── dashboard.css              # Dark theme health cards & status UI
│   │   └── responsive.css             # Mobile break-points (360px - 1440px)
│   ├── js/
│   │   ├── firebase-config.js         # Firebase initialization & fallback
│   │   ├── auth.js                    # Simple session management
│   │   ├── sensors.js                 # Central health status calculation logic
│   │   ├── location.js                # Leaflet map integration & coordinates
│   │   ├── emergency.js               # SOS & Emergency trigger & debounce logic
│   │   ├── charts.js                  # Chart.js historical vitals rendering
│   │   ├── alerts.js                  # Notification engine (Sound & Webhook)
│   │   ├── history.js                 # History filter & data table engine
│   │   └── dashboard.js               # Main UI event loop & realtime sync
│   └── assets/
│       ├── images/                    # Visual assets
│       ├── icons/                     # UI icons
│       └── logo/                      # Alpha Squared branding logos
│
├── backend/
│   ├── firebase/
│   │   ├── database-rules.json        # Realtime Database security rules
│   │   └── firebase-config.md         # Guide to setup Firebase project
│   └── alerts/
│       └── email-alert.js             # Node.js / Webhook fallback script
│
├── docs/
│   ├── architecture.png               # System architecture diagram
│   ├── flowchart.png                  # Emergency detection flowchart
│   ├── circuit.png                    # Circuit diagram duplicate reference
│   └── api-notes.md                   # Firebase REST / JSON schema doc
│
├── testing/
│   ├── test-cases.md                  # Test suite matrix & verification
│   └── demo-data.json                 # Sample payload for simulation mode
│
└── presentation/
    ├── demo-script.md                 # 3-minute hackathon pitch script
    └── screenshots/                   # Dashboard screenshots
```

---

## ⚡ Quick Start Guide

### 1. Web Application Setup
1. Clone or download this repository.
2. Open `web/index.html` directly in any web browser (or serve with VS Code Live Server / standard HTTP server).
3. By default, the application runs with **Demo Mode Ready** or connects to Firebase using `web/js/firebase-config.js`.
4. Configure your own Firebase Realtime DB credentials in `web/js/firebase-config.js`.

### 2. ESP32 Firmware Setup
1. Open `hardware/esp32/esp32_main.ino` in Arduino IDE.
2. Install required Arduino libraries:
   - `Firebase ESP32 Client` (by Mobizt) or `ArduinoJson` + `HTTPClient`
   - `Adafruit MPU6050` & `Adafruit Unified Sensor`
   - `MAX30105` (by SparkFun)
3. Update `hardware/esp32/wifi_config.h` with your Wi-Fi SSID, Password, and Firebase Realtime Database URL.
4. Flash to ESP32 board.

---

## 🚑 Health & Emergency Logic

| Metric | Normal Range | Warning Range | Critical / Emergency Range |
| :--- | :--- | :--- | :--- |
| **Heart Rate** | 60 - 100 BPM | 50-59 or 101-120 BPM | < 50 BPM or > 120 BPM |
| **SpO2 (Oxygen)** | 95 - 100 % | 91 - 94 % | < 91 % |
| **Temperature** | 36.1 - 37.5 °C | 35.5-36.0 or 37.6-38.5 °C | < 35.5 °C or > 38.5 °C |
| **Fall Detection** | Normal (`false`) | - | Fall Detected (`true`) |
| **Manual SOS** | Normal (`false`) | - | SOS Triggered (`true`) |

---

## 🔑 Key Features
- **Zero-Latency Live Sync:** Dashboard updates automatically via Firebase Realtime listeners without requiring manual page refresh.
- **Fail-Safe Fall Cancel Window:** 10-second countdown allows false-alarm cancellation before broadcast.
- **Live Patient GPS Mapping:** Integrated Leaflet.js interactive maps with custom location fallback.
- **Interactive Vitals Trend Charts:** Responsive time-series charts using Chart.js.
- **Audible Emergency Siren & Visual Alerts:** Flashing red alert banners and audio cues during emergency states.
- **Dual Mode Support:** Switch effortlessly between **LIVE DEVICE** data stream and simulated **DEMO MODE**.

---

## 🛡 Disclaimer
*This project is a hackathon prototype designed for educational and demonstration purposes. Thresholds are user-configurable in settings and must not be used as a substitute for professional medical advice or certified diagnostic equipment.*
