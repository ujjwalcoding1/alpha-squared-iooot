# Firebase Realtime Database Setup Guide

Follow these steps to connect your own Firebase Realtime Database to Alpha Squared:

## Step 1: Create a Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** and name it `alpha-squared-iot`.
3. Disable Google Analytics for simplicity (optional) and click **Create project**.

## Step 2: Set Up Realtime Database
1. In the Firebase console sidebar, navigate to **Build** -> **Realtime Database**.
2. Click **Create Database**.
3. Choose your database location (e.g., `us-central1` or closest to you).
4. Select **Start in test mode** (allows read/write for initial testing).
5. Click **Enable**.

## Step 3: Configure Database Security Rules
1. In the Realtime Database tab, click on **Rules**.
2. Replace existing rules with the contents of `backend/firebase/database-rules.json`.
3. Click **Publish**.

## Step 4: Obtain Firebase Web Configuration
1. In your Firebase Project Overview, click the **Web icon (</>)** to register an app.
2. Enter App nickname: `Alpha Squared Web`.
3. Copy the `firebaseConfig` object provided in the setup SDK script:
   ```javascript
   const firebaseConfig = {
     apiKey: "YOUR_API_KEY",
     authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
     databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
     projectId: "YOUR_PROJECT_ID",
     storageBucket: "YOUR_PROJECT_ID.appspot.com",
     messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
     appId: "YOUR_APP_ID"
   };
   ```
4. Paste these values into `web/js/firebase-config.js` and `hardware/esp32/wifi_config.h`.

---
*Note: If no Firebase configuration is supplied, Alpha Squared web dashboard automatically enters **DEMO SIMULATION MODE** so you can present the system immediately.*
