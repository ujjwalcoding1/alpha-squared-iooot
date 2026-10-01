# Alpha Squared Test Suite & Validation Matrix

## Test Cases

| ID | Category | Description | Expected Result | Pass/Fail Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **TC-01** | UI / Responsive | Open `index.html` on 360px mobile view | Page scales cleanly without horizontal scroll | PASS |
| **TC-02** | Vitals Sync | Push updated HR/SpO2 to Firebase | Dashboard vitals cards update in real-time | PASS |
| **TC-03** | SOS Trigger | Click SOS button on Dashboard | Siren sounds, status becomes EMERGENCY, event saved | PASS |
| **TC-04** | Fall Detection | ESP32 sends `fallDetected: true` | Fall confirmation countdown pops up; auto triggers emergency | PASS |
| **TC-05** | Cancel Fall | Click "Cancel False Alarm" within 10s | Emergency state aborted; notification cleared | PASS |
| **TC-06** | Map Display | Open map view on Dashboard | Patient coordinates render on Leaflet interactive map | PASS |
| **TC-07** | Threshold Config | Change HR Max to 90 BPM in Settings | Heart rate 95 BPM turns card Yellow/Red warning state | PASS |
| **TC-08** | Demo Simulation | Toggle Demo Mode ON | Synthetic vitals stream smoothly with "DEMO MODE" badge | PASS |
| **TC-09** | Debouncing | Trigger SOS twice within 5 seconds | Only 1 emergency entry recorded in Firebase history | PASS |
| **TC-10** | Device Timeout | Disconnect ESP32 / stop data stream | Device badge changes to "OFFLINE" after timeout | PASS |
