#ifndef WIFI_CONFIG_H
#define WIFI_CONFIG_H

// =========================================================================
// CONFIGURATION REQUIRED: Replace placeholders with real Wi-Fi & Device info
// =========================================================================

// 1. Wi-Fi Credentials
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// 2. Alpha Squared Backend API Endpoint
#define API_BASE_URL "https://alpha-squared-iooot.vercel.app"

// 3. Hardware Device Identity & Secret Token (matches backend default token)
#define DEVICE_ID "ALPHA-001"
#define DEVICE_TOKEN "alphadev_alpha001_secret_token_2026"

// 4. SIM800L Emergency Contact Phone Numbers (E.164 format with country code)
#define EMERGENCY_PHONE_NUMBER "+919876543210"
#define SECONDARY_PHONE_NUMBER "+919876543211"

#endif // WIFI_CONFIG_H
