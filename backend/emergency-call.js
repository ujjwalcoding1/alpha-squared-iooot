/**
 * Alpha Squad IoT - Emergency Voice Calling Engine (Twilio REST API)
 * 
 * Secure Voice Call Dispatch:
 * - Operates entirely server-side without leaking Twilio SID/Auth tokens.
 * - Places automated voice calls to Primary & Secondary emergency contacts.
 * - Generates clear Text-to-Speech (TwiML) describing the emergency reason, vitals, and GPS dispatch.
 * - Implements call deduplication and 60-second event cooldowns to prevent panic dialing.
 * - Safely handles unconfigured states without claiming a call was placed.
 * - Logs all call attempts and statuses to MongoDB 'emergency_calls' collection.
 */

const db = require('./db');

// In-memory call cooldown tracker (prevents duplicate phone calls within 60s)
const activeCallLocks = new Map();
const CALL_COOLDOWN_MS = 60000;

function cleanExpiredLocks() {
    const now = Date.now();
    for (const [key, timestamp] of activeCallLocks.entries()) {
        if (now - timestamp > CALL_COOLDOWN_MS) {
            activeCallLocks.delete(key);
        }
    }
}

/**
 * Initiates an automated cloud voice call using Twilio Voice API.
 * 
 * @param {Object} options {
 *   eventId: string,
 *   reason: string,
 *   vitals?: Object,
 *   location?: Object,
 *   primaryPhone?: string,
 *   secondaryPhone?: string,
 *   isTest?: boolean,
 *   explicitTestCall?: boolean
 * }
 * @returns {Promise<Object>} Call status result
 */
async function dispatchEmergencyPhoneCall(options = {}) {
    cleanExpiredLocks();

    const {
        eventId = `CALL_${Date.now()}`,
        reason = 'Critical Emergency Condition Detected',
        vitals = {},
        location = null,
        primaryPhone,
        secondaryPhone,
        contacts,
        isTest = false,
        explicitTestCall = false
    } = options;

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    const targetPhone = primaryPhone || (contacts && contacts.primary && contacts.primary.phone) || process.env.PRIMARY_EMERGENCY_PHONE || '+919876543210';
    const backupPhone = secondaryPhone || (contacts && contacts.secondary && contacts.secondary.phone) || process.env.SECONDARY_EMERGENCY_PHONE || null;

    // 1. Deduplication / Cooldown Guard
    const lockKey = `${eventId}_${targetPhone}`;
    const now = Date.now();
    if (activeCallLocks.has(lockKey) && (now - activeCallLocks.get(lockKey) < CALL_COOLDOWN_MS)) {
        return {
            success: true,
            status: 'suppressed_cooldown',
            recipient: targetPhone,
            message: `Emergency call to ${targetPhone} was suppressed (Cooldown active: < 60s since last call).`
        };
    }

    // 2. Test Alert Guard (Never call real phone numbers for ordinary tests without explicit confirmation)
    if (isTest && !explicitTestCall) {
        return {
            success: true,
            status: 'test_simulated',
            recipient: targetPhone,
            provider: 'twilio_test_mode',
            message: `Test mode: Real telephone call to ${targetPhone} was simulated and not placed (Requires explicit test call confirmation).`
        };
    }

    // 3. Check Twilio Credentials
    if (!accountSid || !authToken || !fromNumber) {
        console.warn('[Calling Engine] Twilio credentials not configured in environment variables.');
        return {
            success: false,
            status: 'unconfigured',
            recipient: targetPhone,
            provider: 'none',
            message: 'Twilio voice call credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER) are not configured in Vercel environment variables. Call was not placed.'
        };
    }

    // Lock the event
    activeCallLocks.set(lockKey, now);

    // 4. Construct TwiML Voice Message XML
    const hr = vitals.heartRate || (vitals.heart_rate && vitals.heart_rate.value) || 'unknown';
    const temp = vitals.temperature || (vitals.temperature && vitals.temperature.value) || 'unknown';
    const hasGps = location && location.latitude && location.longitude;
    const locationSpoken = hasGps ? 'GPS coordinates and a Google Maps link have been dispatched to your email and phone.' : 'GPS satellite coordinates are currently unavailable.';

    const twimlMessage = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Pause length="1"/>
    <Say voice="Polly.Joanna" language="en-US">
        Emergency alert from Alpha Squad Health System for patient Alpha 0 0 1.
        Attention caregiver: ${reason}.
        Current patient vitals: Heart rate is ${hr} beats per minute. Body temperature is ${temp} degrees Celsius.
        ${locationSpoken}
        Immediate response is requested.
    </Say>
    <Pause length="2"/>
    <Say voice="Polly.Joanna" language="en-US">
        Repeating emergency notice for patient Alpha 0 0 1. Reason: ${reason}. Please check the patient immediately.
    </Say>
    <Pause length="1"/>
    <Hangup/>
</Response>`;

    // 5. Execute Call via Twilio REST API
    async function executeTwilioCall(recipientNumber) {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
        const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

        const params = new URLSearchParams();
        params.append('To', recipientNumber);
        params.append('From', fromNumber);
        params.append('Twiml', twimlMessage);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        const data = await response.json();
        return { ok: response.ok, status: response.status, data };
    }

    let callResult = null;
    let usedRecipient = targetPhone;
    let isSecondary = false;

    try {
        console.log(`[Calling Engine] Dialing Primary Contact: ${targetPhone}...`);
        const primaryRes = await executeTwilioCall(targetPhone);

        if (primaryRes.ok) {
            callResult = {
                success: true,
                status: 'initiated',
                call_sid: primaryRes.data.sid,
                recipient: targetPhone,
                contact_type: 'primary',
                provider: 'twilio',
                message: `Emergency voice call successfully initiated to primary contact (${targetPhone}). SID: ${primaryRes.data.sid}`
            };
        } else {
            console.warn(`[Calling Engine] Primary call to ${targetPhone} failed:`, primaryRes.data.message);

            // Failover to secondary contact if configured
            if (backupPhone && backupPhone !== targetPhone) {
                console.log(`[Calling Engine] Attempting failover call to Secondary Contact: ${backupPhone}...`);
                const secondaryRes = await executeTwilioCall(backupPhone);
                if (secondaryRes.ok) {
                    usedRecipient = backupPhone;
                    isSecondary = true;
                    callResult = {
                        success: true,
                        status: 'initiated_secondary',
                        call_sid: secondaryRes.data.sid,
                        recipient: backupPhone,
                        contact_type: 'secondary',
                        provider: 'twilio',
                        message: `Primary contact failed. Emergency voice call initiated to secondary contact (${backupPhone}). SID: ${secondaryRes.data.sid}`
                    };
                } else {
                    callResult = {
                        success: false,
                        status: 'failed',
                        recipient: targetPhone,
                        provider: 'twilio',
                        error: `Both primary (${primaryRes.data.message}) and secondary (${secondaryRes.data.message}) calls failed.`
                    };
                }
            } else {
                callResult = {
                    success: false,
                    status: 'failed',
                    recipient: targetPhone,
                    provider: 'twilio',
                    error: primaryRes.data.message || `Twilio HTTP ${primaryRes.status}`
                };
            }
        }
    } catch (err) {
        console.error('[Calling Engine] Fetch to Twilio API failed:', err.message);
        callResult = {
            success: false,
            status: 'network_error',
            recipient: targetPhone,
            provider: 'twilio',
            error: err.message
        };
    }

    // 6. Persist Call Record into MongoDB Atlas 'emergency_calls'
    try {
        const callsCol = await db.getEmergencyCallsCollection();
        await callsCol.insertOne({
            event_id: eventId,
            recipient: usedRecipient,
            contact_type: isSecondary ? 'secondary' : 'primary',
            call_sid: callResult.call_sid || null,
            status: callResult.status,
            provider: callResult.provider || 'twilio',
            initiated_at: new Date().toISOString(),
            reason,
            vitals: { heartRate: hr, temperature: temp },
            has_gps: hasGps,
            error: callResult.error || null
        });
    } catch (dbErr) {
        console.warn('[Calling Engine] MongoDB call log save notice:', dbErr.message);
    }

    return callResult;
}

module.exports = {
    dispatchEmergencyPhoneCall,
    initiateCloudEmergencyCall: dispatchEmergencyPhoneCall,
    activeCallLocks,
    CALL_COOLDOWN_MS
};
