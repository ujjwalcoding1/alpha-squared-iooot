#ifndef WIFI_CONFIG_H
#define WIFI_CONFIG_H

// =========================================================================
// CONFIGURATION REQUIRED: Replace placeholders with real Wi-Fi & Firebase info
// =========================================================================

// Wi-Fi Credentials
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Firebase Realtime Database Config
#define FIREBASE_HOST "https://alpha-squared-iot-default-rtdb.firebaseio.com/"
#define FIREBASE_AUTH "YOUR_FIREBASE_DATABASE_SECRET_OR_API_KEY"

// Fallback GPS Coordinates (if hardware GPS module is not connected)
#define DEFAULT_LATITUDE 28.6139
#define DEFAULT_LONGITUDE 77.2090

#endif // WIFI_CONFIG_H
