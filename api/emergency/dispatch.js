/**
 * Alpha Squad IoT - Unified Emergency Alert Dispatch Endpoint
 * POST /api/emergency/dispatch
 * 
 * Orchestrates:
 * 1. Three-Zone clinical safety evaluation
 * 2. Emergency Gmail dispatch with clickable Google Maps GPS link
 * 3. Emergency Voice Calling workflow to Primary & Secondary contacts (Twilio / SIM800L)
 * 4. Telegram alert message dispatch
 * 5. Full event persistence into MongoDB Atlas 'emergency_events' collection
 */

const { applyCors } = require('../../backend/cors');
const db = require('../../backend/db');
const { evaluateThreeZones } = require('../../backend/safety-zones');
const { dispatchEmergencyPhoneCall } = require('../../backend/emergency-call');
const nodemailer = require('nodemailer');

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
    }

    let body = req.body || {};
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) {}
    }

    const eventId = body.eventId || body.event_id || `EMG_${Date.now()}`;
    const eventType = body.type || 'Critical Emergency Alert';
    const patientName = body.patientName || 'Eleanor Vance (Patient ALPHA-001)';
    const patientId = body.patientId || 'ALPHA-001';
    const vitals = body.vitals || {};
    const location = body.location || {};
    const isTest = Boolean(body.isTest || (body.source && body.source.includes('test')));
    const explicitTestCall = Boolean(body.explicitTestCall || body.explicit_test_call);

    // 1. Evaluate Three-Zone safety status
    const safetyEval = evaluateThreeZones(vitals);

    // Parse GPS honestly
    const hasGps = (location.fix_valid !== false) &&
                   (typeof location.latitude === 'number' && !isNaN(location.latitude)) &&
                   (typeof location.longitude === 'number' && !isNaN(location.longitude));
    const mapsUrl = hasGps ? `https://www.google.com/maps?q=${location.latitude},${location.longitude}` : null;
    const gpsData = {
        latitude: hasGps ? location.latitude : null,
        longitude: hasGps ? location.longitude : null,
        fix_valid: hasGps,
        maps_url: mapsUrl,
        source: location.source || (hasGps ? 'Hardware GPS (NEO-6M)' : 'Unavailable')
    };

    // If not a RED zone emergency and not an explicit test, log warning and do not trigger emergency sirens/calls
    if (!safetyEval.requires_immediate_dispatch && !isTest) {
        try {
            const eventsCol = await db.getEmergencyEventsCollection();
            await eventsCol.insertOne({
                event_id: eventId,
                patient_id: patientId,
                patient_name: patientName,
                zone: safetyEval.zone,
                reasons: safetyEval.reasons,
                recommendation: safetyEval.recommendation,
                vitals,
                location: gpsData,
                dispatched: false,
                created_at: new Date().toISOString()
            });
        } catch (dbErr) {
            console.warn('[Dispatch] MongoDB log notice:', dbErr.message);
        }

        return res.status(200).json({
            success: true,
            dispatched: false,
            action: safetyEval.zone === 'YELLOW' ? 'caregiver_logged' : 'normal_logged',
            zone: safetyEval.zone,
            safety_evaluation: safetyEval,
            message: safetyEval.zone === 'YELLOW' 
                ? 'Warning condition logged. Resting guidance provided to patient.' 
                : 'Normal vitals. No emergency dispatch needed.'
        });
    }

    const deliveryStatus = {
        email: { status: 'skipped', message: 'Email dispatch disabled' },
        phone_call: { status: 'skipped', message: 'Calling disabled' },
        telegram: { status: 'skipped', message: 'Telegram disabled' }
    };

    // 2. Dispatch Emergency Voice Call Workflow
    try {
        const callResult = await dispatchEmergencyPhoneCall({
            eventId,
            reason: eventType,
            vitals,
            location: gpsData,
            primaryPhone: body.primaryPhone || process.env.PRIMARY_EMERGENCY_PHONE,
            secondaryPhone: body.secondaryPhone || process.env.SECONDARY_EMERGENCY_PHONE,
            isTest,
            explicitTestCall
        });
        deliveryStatus.phone_call = callResult;
    } catch (callErr) {
        deliveryStatus.phone_call = { success: false, status: 'error', error: callErr.message };
    }

    // 3. Dispatch Gmail Emergency Alert Email
    const GMAIL_SENDER = process.env.GMAIL_SENDER;
    const GMAIL_RECEIVER = process.env.GMAIL_RECEIVER;
    const GMAIL_APP_PASS = process.env.GMAIL_APP_PASSWORD;

    if (GMAIL_SENDER && GMAIL_RECEIVER && GMAIL_APP_PASS) {
        try {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { user: GMAIL_SENDER, pass: GMAIL_APP_PASS }
            });

            const recipients = [GMAIL_RECEIVER];
            const secEmail = process.env.SECONDARY_EMERGENCY_EMAIL || (body.contacts && body.contacts.secondary && body.contacts.secondary.email);
            if (secEmail && secEmail.includes('@') && secEmail !== GMAIL_RECEIVER) {
                recipients.push(secEmail);
            }

            const subject = isTest
                ? '🧪 [Alpha Squad] Test Emergency Notification'
                : `🚨 [Alpha Squad] EMERGENCY ALERT: ${eventType} (Patient ALPHA-001)`;

            const emailHtml = `
            <div style="font-family:Arial,sans-serif;background:#0f172a;color:#f1f5f9;padding:24px;border-radius:8px;">
                <h2 style="color:${isTest ? '#0ea5e9' : '#ef4444'};margin-top:0;">
                    ${isTest ? '🧪 TEST EMERGENCY NOTIFICATION' : '🚨 EMERGENCY ALERT: IMMEDIATE ATTENTION REQUIRED'}
                </h2>
                <p><strong>Patient:</strong> ${patientName}</p>
                <p><strong>Reason:</strong> ${eventType}</p>
                <p><strong>Zone:</strong> <span style="color:${safetyEval.color};font-weight:700;">${safetyEval.zone} - ${safetyEval.status}</span></p>
                <p><strong>Recommendation:</strong> ${safetyEval.recommendation}</p>
                <hr style="border-color:#334155;margin:16px 0;"/>
                <h3>Vitals at Alert:</h3>
                <ul>
                    <li>Body Temperature: <strong>${vitals.temperature !== undefined ? `${vitals.temperature} °C` : 'Unavailable'}</strong></li>
                    <li>Heart Rate: <strong>${vitals.heartRate !== undefined ? `${vitals.heartRate} BPM` : 'Unavailable'}</strong></li>
                </ul>
                <hr style="border-color:#334155;margin:16px 0;"/>
                <h3>Patient Location:</h3>
                ${hasGps ? `
                <p>Latitude: <strong>${gpsData.latitude.toFixed(5)}</strong>, Longitude: <strong>${gpsData.longitude.toFixed(5)}</strong></p>
                <p><a href="${mapsUrl}" target="_blank" style="background:#10b981;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:700;">Open Google Maps Location</a></p>
                ` : `<p style="color:#f59e0b;">⚠️ GPS Fix was unavailable at time of alarm.</p>`}
                <hr style="border-color:#334155;margin:16px 0;"/>
                <p style="font-size:12px;color:#94a3b8;">Automated Voice Call Workflow: <strong>${deliveryStatus.phone_call.status || 'Standby'}</strong></p>
                <p style="font-size:11px;color:#64748b;">Notice: Prototype medical monitoring alert. Does not replace professional clinical diagnosis.</p>
            </div>`;

            const info = await transporter.sendMail({
                from: `"Alpha Squad Alert System" <${GMAIL_SENDER}>`,
                to: recipients.join(', '),
                subject,
                html: emailHtml
            });

            deliveryStatus.email = {
                success: true,
                status: 'delivered',
                messageId: info.messageId,
                recipients
            };
        } catch (emailErr) {
            deliveryStatus.email = { success: false, status: 'failed', error: emailErr.message };
        }
    } else {
        deliveryStatus.email = { success: false, status: 'unconfigured', message: 'Gmail credentials not configured in environment variables' };
    }

    // 4. Dispatch Telegram Notification if configured
    const tgToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgChat = process.env.TELEGRAM_CAREGIVER_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
    if (tgToken && tgChat) {
        try {
            const tgMsg = `🚨 *EMERGENCY ALERT: ${eventType}*\n\n` +
                          `👤 *Patient:* ${patientName}\n` +
                          `🌡️ *Temp:* ${vitals.temperature !== undefined ? `${vitals.temperature} °C` : 'Unavailable'}\n` +
                          `❤️ *HR:* ${vitals.heartRate !== undefined ? `${vitals.heartRate} BPM` : 'Unavailable'}\n` +
                          `📍 *Location:* ${hasGps ? `[Open Google Maps](${mapsUrl})` : 'GPS Unavailable'}\n` +
                          `📞 *Voice Call:* ${deliveryStatus.phone_call.status || 'Active'}\n` +
                          `🕒 *Time:* ${new Date().toISOString()}`;

            const tgRes = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: tgChat, text: tgMsg, parse_mode: 'Markdown' })
            });
            deliveryStatus.telegram = { success: tgRes.ok, status: tgRes.ok ? 'delivered' : 'failed' };
        } catch (tgErr) {
            deliveryStatus.telegram = { success: false, status: 'error', error: tgErr.message };
        }
    } else {
        deliveryStatus.telegram = { success: false, status: 'unconfigured', message: 'Telegram Bot credentials not configured' };
    }

    // 5. Persist Full Emergency Event into MongoDB Atlas 'emergency_events'
    const nowIso = new Date().toISOString();
    const eventDoc = {
        event_id: eventId,
        patient_id: patientId,
        patient_name: patientName,
        event_type: eventType,
        zone: safetyEval.zone,
        reasons: safetyEval.reasons,
        recommendation: safetyEval.recommendation,
        vitals: {
            temperature: vitals.temperature !== undefined ? vitals.temperature : null,
            heart_rate: vitals.heartRate !== undefined ? vitals.heartRate : null,
            spo2: vitals.spo2 !== undefined ? vitals.spo2 : null
        },
        location: gpsData,
        delivery: deliveryStatus,
        is_test: isTest,
        created_at: nowIso,
        acknowledged: false,
        acknowledged_at: null,
        resolved_by: null
    };

    try {
        const eventsCol = await db.getEmergencyEventsCollection();
        await eventsCol.insertOne(eventDoc);
    } catch (dbErr) {
        console.warn('[Dispatch] MongoDB event save notice:', dbErr.message);
    }

    return res.status(200).json({
        success: true,
        dispatched: true,
        event_id: eventId,
        zone: safetyEval.zone,
        bypass_fall_countdown: safetyEval.bypass_fall_countdown,
        safety_evaluation: safetyEval,
        delivery: deliveryStatus,
        location: gpsData,
        maps_url: mapsUrl,
        message: 'Emergency dispatch workflow executed successfully.'
    });
};
