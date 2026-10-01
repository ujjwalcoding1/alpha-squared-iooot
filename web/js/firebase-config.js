/**
 * Alpha Squared - Firebase Configuration & Initialization Module
 * 
 * Supports both Live Firebase Realtime DB Connection and Demo Simulation Fallback.
 */

// CONFIGURATION PLACEHOLDER - Replace with your project credentials if connecting to live Firebase
const FIREBASE_CONFIG = {
    apiKey: "YOUR_API_KEY_PLACEHOLDER",
    authDomain: "alpha-squared-iot.firebaseapp.com",
    databaseURL: "https://alpha-squared-iot-default-rtdb.firebaseio.com",
    projectId: "alpha-squared-iot",
    storageBucket: "alpha-squared-iot.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef123456"
};

let db = null;
let isFirebaseConfigured = false;
let isDemoMode = false;

function initFirebase() {
    console.log("[Firebase] Checking configuration...");
    
    // Validate if user has updated placeholders
    if (FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY_PLACEHOLDER" && typeof firebase !== 'undefined') {
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
            db = firebase.database();
            isFirebaseConfigured = true;
            isDemoMode = false;
            console.log("[Firebase] Connected to Firebase Realtime Database!");
            return true;
        } catch (error) {
            console.warn("[Firebase] Firebase initialization failed. Falling back to Demo Mode.", error);
        }
    }
    
    // Default fallback to Demo Simulation Mode
    isFirebaseConfigured = false;
    isDemoMode = true;
    console.log("[Firebase] Running in DEMO SIMULATION MODE (No external API keys required).");
    return false;
}

// Global accessor functions
function getDatabase() {
    return db;
}

function getSystemMode() {
    return isDemoMode ? "DEMO MODE" : "LIVE DEVICE";
}

function setDemoModeState(enabled) {
    isDemoMode = enabled;
    localStorage.setItem("alpha_demo_mode", enabled ? "true" : "false");
    console.log(`[System Mode] Switched to: ${getSystemMode()}`);
}

// Auto-initialize on load
document.addEventListener("DOMContentLoaded", () => {
    const savedDemoState = localStorage.getItem("alpha_demo_mode");
    if (savedDemoState !== null) {
        isDemoMode = (savedDemoState === "true");
    }
    initFirebase();
});
