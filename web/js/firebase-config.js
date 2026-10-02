/**
 * Alpha Squared - Firebase Configuration & Initialization Module
 * 
 * Supports both Live Firebase Realtime DB Connection and Demo Simulation Fallback.
 */

// CONFIGURATION PLACEHOLDER - Replace with your project credentials if connecting to live Firebase
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBnTWJ5OWKRIk9X5mNtPyESb9odn6rNl2U",
    authDomain: "alpha-squared-6db35.firebaseapp.com",
    projectId: "alpha-squared-6db35",
    storageBucket: "alpha-squared-6db35.firebasestorage.app",
    messagingSenderId: "1980026179",
    appId: "1:1980026179:web:3fdf53f90ffc2f561fb3f6",
    measurementId: "G-6YKDXP9C59"
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
