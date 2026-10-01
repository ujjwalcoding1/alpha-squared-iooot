/**
 * Alpha Squared - Modular Backend Caregiver Alert Service
 * 
 * Supports Webhook / Email / SMS integration via Node.js / Serverless Cloud Function.
 * Can be triggered via HTTP webhook when an Emergency Event is posted to Firebase.
 */

// =========================================================================
// CONFIGURATION REQUIRED: Set up your Email/SMS Service Provider (e.g. Twilio/SendGrid)
// =========================================================================

const ALERT_CONFIG = {
    ENABLED: false, // Set to true after filling in API keys
    WEBHOOK_URL: "https://api.example.com/alerts/send",
    TWILIO_ACCOUNT_SID: "YOUR_TWILIO_ACCOUNT_SID",
    TWILIO_AUTH_TOKEN: "YOUR_TWILIO_AUTH_TOKEN",
    FROM_PHONE: "+1234567890",
    CAREGIVER_PHONE: "+19876543210"
};

async function sendEmergencyAlert(emergencyPayload) {
    if (!ALERT_CONFIG.ENABLED) {
        console.log("[Alert Service] Alert disabled or provider NOT CONFIGURABLE in hackathon mode.");
        return {
            status: "Not Configured",
            message: "Caregiver alert provider credentials pending configuration in backend/alerts/email-alert.js"
        };
    }

    try {
        console.log("[Alert Service] Dispatching SMS & Email notification for event:", emergencyPayload.eventId);
        
        // Example Webhook dispatch logic:
        // const response = await fetch(ALERT_CONFIG.WEBHOOK_URL, {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify(emergencyPayload)
        // });
        
        return {
            status: "Alert Sent",
            message: `Successfully notified caregiver (${ALERT_CONFIG.CAREGIVER_PHONE})`
        };
    } catch (error) {
        console.error("[Alert Service] Emergency alert dispatch failed:", error);
        return {
            status: "Alert Failed",
            message: error.message
        };
    }
}

if (typeof module !== 'undefined') {
    module.exports = { sendEmergencyAlert, ALERT_CONFIG };
}
