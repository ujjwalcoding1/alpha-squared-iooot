#ifndef WIFI_CONFIG_H
#define WIFI_CONFIG_H

// =========================================================================
// CONFIGURATION REQUIRED: Replace placeholders with real Wi-Fi & Device info
// =========================================================================

// 1. Wi-Fi Credentials
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// 2. Alpha Squared Backend API Endpoint
// Set to your deployed Vercel domain (e.g., https://alpha-squared-iooot.vercel.app)
#define API_BASE_URL "https://alpha-squared-iooot.vercel.app"

// 3. Hardware Device Identity & Authentication Token
// Device ID and secret token must match MongoDB 'devices' collection
#define DEVICE_ID "ALPHA-001"
#define DEVICE_TOKEN "alphadev_demo_secret_token_12345"

// 4. Legacy Firebase Realtime Database Config (Optional)
#define FIREBASE_HOST "https://alpha-squared-iot-default-rtdb.firebaseio.com/"
#define FIREBASE_AUTH "YOUR_FIREBASE_DATABASE_SECRET_OR_API_KEY"

#endif // WIFI_CONFIG_H
