# Firebase Realtime Database Data Schema & API Notes

## Base Path
`https://<YOUR_FIREBASE_PROJECT_ID>.firebaseio.com/healthMonitoring/`

## Data Structure

### 1. Device Status Path: `/healthMonitoring/device`
```json
{
  "deviceId": "ESP32_ALPHA_01",
  "online": true,
  "lastSeen": 1740000000000
}
```

### 2. Patient Profile Path: `/healthMonitoring/patient`
```json
{
  "name": "Eleanor Vance",
  "age": 68,
  "bloodGroup": "O+",
  "emergencyContacts": {
    "primary": "+1 (555) 234-5678",
    "secondary": "+1 (555) 876-5432"
  }
}
```

### 3. Current Live Vitals Path: `/healthMonitoring/currentVitals`
```json
{
  "heartRate": 74,
  "spo2": 98,
  "temperature": 36.8,
  "fallDetected": false,
  "sos": false,
  "latitude": 28.6139,
  "longitude": 77.2090,
  "timestamp": 1740000000000
}
```

### 4. Emergency History Log Path: `/healthMonitoring/emergencies/<eventId>`
```json
{
  "eventId": "EMG_1740000050",
  "type": "Fall Detected",
  "timestamp": "2026-10-01 21:55:00",
  "heartRate": 115,
  "spo2": 92,
  "temperature": 37.2,
  "latitude": 28.6139,
  "longitude": 77.2090,
  "status": "Active",
  "acknowledged": false,
  "alertStatus": "Alert Sent"
}
```
