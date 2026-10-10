/**
 * Alpha Squared IoT - ESP32 Telemetry Ingestion Endpoint (Live Monitoring Mode)
 * POST /api/iot/data
 * 
 * Secure Live Ingestion:
 * - Authenticates device token against device registry (Upstash Redis / In-Memory)
 * - Validates physiological ranges and timestamp drift
 * - Preserves absence of missing sensors (e.g. Blood Pressure, GPS) without fabrication
 * - Updates latest live reading for real-time dashboard display
 * - Updates device last-seen timestamp and online status
 */

const { applyCors } = require('../../backend/cors');
const liveStore = require('../../backend/live-store');
const { authenticateDevice } = require('../../backend/auth');
const { validateTelemetryPayload } = require('../../backend/validation');

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed. Use POST to submit device telemetry.'
        });
    }

    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: 'Malformed JSON payload.'
            });
        }
    }

    if (!body || typeof body !== 'object') {
        return res.status(400).json({
            success: false,
            error: 'Empty or invalid JSON body.'
        });
    }

    // 1. Authenticate Device
    const authResult = await authenticateDevice(req, body.device_id);
    if (!authResult.authenticated) {
        return res.status(authResult.statusCode).json({
            success: false,
            error: authResult.error
        });
    }

    // 2. Validate Schema & Physiological Ranges
    const validation = validateTelemetryPayload(body);
    if (!validation.valid) {
        return res.status(400).json({
            success: false,
            error: `Payload validation failed: ${validation.error}`
        });
    }

    const data = validation.data;
    const nowIso = new Date().toISOString();

    // 3. Store Latest Sensor Reading in Live Memory / Upstash Store
    try {
        const readingDoc = {
            id: `live_${Date.now()}`,
            device_id: data.device_id,
            device_timestamp: data.device_timestamp,
            server_received_at: nowIso,
            temperature: {
                value: data.temperature.value,
                unit: data.temperature.unit,
                sensor_status: data.temperature.sensor_status
            },
            heart_rate: {
                value: data.heart_rate.value,
                unit: data.heart_rate.unit,
                sensor_status: data.heart_rate.sensor_status
            },
            blood_pressure: {
                systolic: data.blood_pressure.systolic,
                diastolic: data.blood_pressure.diastolic,
                unit: data.blood_pressure.unit,
                sensor_status: data.blood_pressure.sensor_status
            },
            gps: {
                latitude: data.gps.latitude,
                longitude: data.gps.longitude,
                fix_valid: data.gps.fix_valid,
                sensor_status: data.gps.sensor_status
            },
            sim800l: {
                status: data.sim800l ? data.sim800l.status : 'unknown',
                last_sms_status: data.sim800l ? data.sim800l.last_sms_status : null,
                last_sms_at: data.sim800l ? data.sim800l.last_sms_at : null,
                last_call_status: data.sim800l ? data.sim800l.last_call_status : 'idle',
                last_sos_time: data.sim800l ? data.sim800l.last_sos_time : null
            },
            battery_level: data.battery_level,
            signal_strength: data.signal_strength,
            is_simulated: data.is_simulated,
            raw_payload: body
        };

        await liveStore.setLatestReading(data.device_id, readingDoc);

        return res.status(201).json({
            success: true,
            message: 'Live sensor reading ingested into store.',
            reading_id: readingDoc.id,
            server_received_at: nowIso,
            is_simulated: data.is_simulated,
            device_id: data.device_id,
            storage_mode: process.env.UPSTASH_REDIS_REST_URL ? 'upstash-redis' : 'live-in-memory',
            persistent: false
        });

    } catch (err) {
        console.error('[Telemetry Ingestion Error]:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Live ingestion error.',
            details: err.message
        });
    }
};
