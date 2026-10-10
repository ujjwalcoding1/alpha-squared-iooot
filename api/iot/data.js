/**
 * Alpha Squared IoT - ESP32 Telemetry Ingestion Endpoint
 * POST /api/iot/data
 * 
 * Secure Ingestion:
 * - Authenticates device token against MongoDB 'devices' collection
 * - Validates physiological ranges and timestamp drift
 * - Preserves absence of missing sensors (e.g. Blood Pressure, GPS) without fabrication
 * - Persists reading directly to MongoDB 'sensor_readings' collection
 * - Updates device last-seen timestamp and online status
 */

const { applyCors } = require('../../backend/cors');
const db = require('../../backend/db');
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

    // 3. Persist Sensor Reading Document to MongoDB
    try {
        const readingsCol = await db.getReadingsCollection();
        const devicesCol = await db.getDevicesCollection();

        const readingDoc = {
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
                fix_valid: data.gps.fix_valid
            },
            battery_level: data.battery_level,
            signal_strength: data.signal_strength,
            is_simulated: data.is_simulated,
            raw_payload: body
        };

        const insertResult = await readingsCol.insertOne(readingDoc);

        // 4. Update device connectivity & last-seen timestamp
        await devicesCol.updateOne(
            { device_id: data.device_id },
            {
                $set: {
                    last_seen_at: nowIso,
                    status: 'online',
                    updated_at: nowIso
                }
            }
        );

        return res.status(201).json({
            success: true,
            message: 'Sensor reading ingested and persisted to MongoDB Atlas.',
            reading_id: insertResult.insertedId.toString(),
            server_received_at: nowIso,
            is_simulated: data.is_simulated,
            device_id: data.device_id,
            storage_mode: 'mongodb-atlas',
            persistent: true
        });

    } catch (err) {
        console.error('[Telemetry Ingestion Error]:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Database storage error while persisting telemetry data.',
            details: err.message
        });
    }
};
