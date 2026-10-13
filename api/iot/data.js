/**
 * Alpha Squared IoT - ESP32 Telemetry Ingestion & Retrieval Endpoint (MongoDB Atlas)
 * Handles:
 * - POST /api/iot/data (Ingests ESP32 telemetry into alpha_squad.sensor_readings)
 * - GET  /api/iot/data (Safe telemetry retrieval endpoint for dashboard)
 */

const { applyCors } = require('../../backend/cors');
const db = require('../../backend/db');
const { authenticateDevice } = require('../../backend/auth');
const { validateTelemetryPayload } = require('../../backend/validation');

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;

    // 1. Safe GET handler: Retrieve latest sensor reading from MongoDB Atlas for the website
    if (req.method === 'GET') {
        try {
            const readingsCol = await db.getReadingsCollection();
            const deviceId = (req.query && (req.query.device_id || req.query.id))
                ? (req.query.device_id || req.query.id).trim()
                : null;

            const queryFilter = deviceId ? { device_id: deviceId } : {};
            const r = await readingsCol.find(queryFilter)
                .sort({ server_received_at: -1 })
                .limit(1)
                .next();

            if (!r) {
                return res.status(200).json({
                    success: true,
                    device_id: deviceId || 'ALPHA-001',
                    has_data: false,
                    message: 'No sensor readings recorded yet in MongoDB Atlas.',
                    reading: null
                });
            }

            return res.status(200).json({
                success: true,
                device_id: r.device_id,
                has_data: true,
                reading: {
                    id: r._id.toString(),
                    device_id: r.device_id,
                    timestamp: r.device_timestamp || r.server_received_at,
                    server_received_at: r.server_received_at,
                    temperature: {
                        value: r.temperature ? r.temperature.value : null,
                        unit: (r.temperature && r.temperature.unit) || 'C',
                        status: (r.temperature && r.temperature.sensor_status) || 'disconnected'
                    },
                    heart_rate: {
                        value: r.heart_rate ? r.heart_rate.value : null,
                        unit: (r.heart_rate && r.heart_rate.unit) || 'bpm',
                        status: (r.heart_rate && r.heart_rate.sensor_status) || 'disconnected'
                    },
                    blood_pressure: {
                        systolic: r.blood_pressure ? r.blood_pressure.systolic : null,
                        diastolic: r.blood_pressure ? r.blood_pressure.diastolic : null,
                        unit: (r.blood_pressure && r.blood_pressure.unit) || 'mmHg',
                        status: (r.blood_pressure && r.blood_pressure.sensor_status) || 'not_installed'
                    },
                    gps: {
                        latitude: r.gps ? r.gps.latitude : null,
                        longitude: r.gps ? r.gps.longitude : null,
                        fix_valid: Boolean(r.gps && r.gps.fix_valid)
                    },
                    sim800l: {
                        status: (r.sim800l && r.sim800l.status) || 'unknown',
                        last_sms_status: (r.sim800l && r.sim800l.last_sms_status) || null,
                        last_sms_at: (r.sim800l && r.sim800l.last_sms_at) || null,
                        last_call_status: (r.sim800l && r.sim800l.last_call_status) || 'idle',
                        last_sos_time: (r.sim800l && r.sim800l.last_sos_time) || null
                    },
                    spo2: {
                        value: r.spo2 ? (typeof r.spo2 === 'object' ? r.spo2.value : r.spo2) : null,
                        unit: '%',
                        status: (r.spo2 && r.spo2.sensor_status) || 'ok'
                    },
                    battery_level: typeof r.battery_level === 'number' ? r.battery_level : null,
                    signal_strength: typeof r.signal_strength === 'number' ? r.signal_strength : null,
                    is_simulated: Boolean(r.is_simulated)
                }
            });
        } catch (err) {
            console.error('[Telemetry GET Error]:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Database storage error while retrieving telemetry data.',
                details: err.message
            });
        }
    }

    // 2. POST handler: Ingest telemetry from ESP32 into MongoDB Atlas
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed. Use POST to ingest telemetry or GET to retrieve latest reading.'
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

    // 3. Store in MongoDB Atlas (alpha_squad.sensor_readings)
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
            spo2: data.spo2 ? {
                value: data.spo2.value,
                unit: data.spo2.unit,
                sensor_status: data.spo2.sensor_status
            } : null,
            battery_level: data.battery_level,
            signal_strength: data.signal_strength,
            is_simulated: data.is_simulated,
            raw_payload: body
        };

        const result = await readingsCol.insertOne(readingDoc);

        // Update device last_seen_at and status in MongoDB Atlas
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
            message: 'Sensor reading ingested into MongoDB Atlas successfully.',
            reading_id: result.insertedId.toString(),
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
