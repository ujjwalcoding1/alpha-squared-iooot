# Alpha Squared Hackathon 3-Minute Live Pitch & Demo Script

## 🎙 Introduction (0:00 - 0:30)
"Judges and mentors, welcome to **Alpha Squared**. Every year, millions of elderly individuals and high-risk patients experience sudden falls or cardiac events at home when caregivers aren't in the room. Immediate response time is the difference between life and death. 

Today we present a working, end-to-end IoT Smart Health & Emergency Detection System built with an ESP32 wearable sensor, Firebase Realtime Database, and a zero-latency web monitoring platform."

## 📡 Live Hardware & Dashboard Sync (0:30 - 1:15)
"Look at our web dashboard right now. It is receiving live streams from our ESP32 device. 
- You can see **Heart Rate**, **SpO2**, and **Body Temperature** updating in real time without refreshing the page.
- Notice the **Device Online Badge** indicating hardware health status.
- Our centralized health algorithm classifies overall status in real-time: **SAFE (Green)**, **WARNING (Yellow)**, or **EMERGENCY (Red)** based on customizable clinical thresholds."

## 🚨 Emergency Detection & Fall Alarm (1:15 - 2:00)
"Now, let's trigger a simulated fall or press the hardware/web **SOS Button**.
1. Watch the dashboard instantly shift to **EMERGENCY STATE**.
2. A 10-second fail-safe countdown begins on screen to prevent false alarm panic.
3. Once confirmed, the system logs an immutable Emergency Event in Firebase, triggers an audible siren cue, displays the exact **GPS Map Coordinates** of the patient using Leaflet.js, and dispatches caregiver alerts."

## 📊 Analytics, History & Demo Resiliency (2:00 - 2:45)
"In our **History tab**, doctors and family members can view historical biometric trends rendered with Chart.js to spot degrading health patterns over time. 
In **Settings**, caregivers can customize vital threshold boundaries or update emergency contact numbers.
Furthermore, if hardware connection is lost at any point, our dashboard features a built-in **Demo Simulation Mode** so monitoring never goes dark."

## 🏁 Conclusion & Q&A (2:45 - 3:00)
"Alpha Squared is low-cost, modular, scalable, and ready to deploy to protect lives. Thank you!"
