/**
 * Alpha Squared IoT - Sensor Data & Status Retrieval Endpoint (MongoDB Atlas)
 * Handles:
 * - GET /api/iot/device/:id/latest           (Latest sensor reading for dashboard)
 * - GET /api/iot/device/:id/history          (Historical readings with range/limit)
 * - GET /api/iot/device/:id/status           (Device status & sensor health)
 * - GET /api/iot/device/:id/location-history  (Filtered GPS trail for map)
 */

const { applyCors } = require('../../backend/cors');
const db = require('../../backend/db');

function parseReadingUrl(req) {
    const url = new URL(req.url, 'http://localhost');
    const pathParts = url.pathname.split('/').filter(Boolean);

    let deviceId = req.query ? req.query.id : null;
    let view = req.query ? req.query.view : null;

    const devIdx = pathParts.indexOf('device');
    if (devIdx !== -1 && pathParts.length > devIdx + 1) {
        deviceId = pathParts[devIdx + 1];
        if (pathParts.length > devIdx + 2) {
            view = pathParts[devIdx + 2];
        }
    }

    return {
        deviceId,
        view: view || 'latest',
        searchParams: url.searchParams
    };
}

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;

    if (req.method !== 'GET') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed. Use GET.'
        });
    }

    const { deviceId, view, searchParams } = parseReadingUrl(req);

    if (!deviceId) {
        return res.status(400).json({
            success: false,
            error: 'Missing required device identifier in URL path.'
        });
    }

    try {
        const devicesCol = await db.getDevicesCollection();
        const readingsCol = await db.getReadingsCollection();

        // Verify device exists
        let device = await devicesCol.findOne({ device_id: deviceId });
        if (!device && deviceId === 'ALPHA-001') {
            const crypto = require('crypto');
            const demoHash = crypto.createHash('sha256').update('alphadev_demo_secret_token_12345').digest('hex');
            const nowIso = new Date().toISOString();
            await devicesCol.updateOne(
                { device_id: 'ALPHA-001' },
                {
                    $setOnInsert: {
                        device_id: 'ALPHA-001',
                        device_name: 'Alpha Squad Health Monitor Node 1',
                        device_type: 'ESP32',
                        token_hash: demoHash,
                        is_enabled: true,
                        created_at: nowIso,
                        updated_at: nowIso,
                        last_seen_at: null,
                        status: 'offline',
                        metadata: {}
                    }
                },
                { upsert: true }
            );
            device = await devicesCol.findOne({ device_id: deviceId });
        }

        if (!device) {
            const hasReadings = await readingsCol.countDocuments({ device_id: deviceId });
            if (!hasReadings) {
                return res.status(404).json({
                    success: false,
                    error: `Device '${deviceId}' is not registered.`
                });
            }
        }

        // --------------------------------------------------------------------
        // 1. LATEST SENSOR READING: /api/iot/device/:id/latest
        // --------------------------------------------------------------------
        if (view === 'latest') {
            const r = await readingsCol.find({ device_id: deviceId })
                .sort({ server_received_at: -1 })
                .limit(1)
                .next();

            if (!r) {
                return res.status(200).json({
                    success: true,
                    device_id: deviceId,
                    has_data: false,
                    message: 'No sensor readings recorded yet for this device.',
                    reading: null
                });
            }

            return res.status(200).json({
                success: true,
                device_id: deviceId,
                has_data: true,
                reading: {
                    id: r._id.toString(),
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
        }

        // --------------------------------------------------------------------
        // 2. HISTORICAL READINGS: /api/iot/device/:id/history
        // --------------------------------------------------------------------
        if (view === 'history') {
            const range = (req.query && req.query.range) || searchParams.get('range') || '1h';
            const limit = Math.min(1000, Math.max(1, parseInt((req.query && req.query.limit) || searchParams.get('limit') || '100', 10)));
            const includeSim = ((req.query && req.query.include_simulated) === 'true') || searchParams.get('include_simulated') === 'true';

            const now = Date.now();
            let cutoffMs = now - 3600000; // default 1 hour
            if (range === '15m') cutoffMs = now - 15 * 60000;
            else if (range === '1h') cutoffMs = now - 3600000;
            else if (range === '24h') cutoffMs = now - 86400000;
            else if (range === '7d') cutoffMs = now - 7 * 86400000;
            else if (range === 'all') cutoffMs = 0;

            const cutoffIso = new Date(cutoffMs).toISOString();

            const queryFilter = {
                device_id: deviceId,
                server_received_at: { $gte: cutoffIso }
            };

            if (!includeSim) {
                queryFilter.is_simulated = false;
            }

            const docs = await readingsCol.find(queryFilter)
                .sort({ server_received_at: 1 })
                .limit(limit)
                .toArray();

            const series = docs.map(d => ({
                id: d._id.toString(),
                time: d.device_timestamp || d.server_received_at,
                temperature: d.temperature ? d.temperature.value : null,
                temperature_status: (d.temperature && d.temperature.sensor_status) || 'ok',
                heart_rate: d.heart_rate ? d.heart_rate.value : null,
                heart_rate_status: (d.heart_rate && d.heart_rate.sensor_status) || 'ok',
                bp_systolic: d.blood_pressure ? d.blood_pressure.systolic : null,
                bp_diastolic: d.blood_pressure ? d.blood_pressure.diastolic : null,
                bp_status: (d.blood_pressure && d.blood_pressure.sensor_status) || 'not_installed',
                gps: d.gps ? { latitude: d.gps.latitude, longitude: d.gps.longitude, fix_valid: Boolean(d.gps.fix_valid) } : null,
                spo2: d.spo2 ? (typeof d.spo2 === 'object' ? d.spo2.value : d.spo2) : null,
                battery: d.battery_level !== undefined ? d.battery_level : null,
                rssi: d.signal_strength !== undefined ? d.signal_strength : null,
                is_simulated: Boolean(d.is_simulated)
            }));

            return res.status(200).json({
                success: true,
                device_id: deviceId,
                range,
                count: series.length,
                data: series
            });
        }

        // --------------------------------------------------------------------
        // 3. DEVICE STATUS & HEALTH: /api/iot/device/:id/status
        // --------------------------------------------------------------------
        if (view === 'status') {
            const now = Date.now();
            const lastSeenMs = (device && device.last_seen_at) ? new Date(device.last_seen_at).getTime() : null;
            const diffSec = lastSeenMs ? Math.round((now - lastSeenMs) / 1000) : null;
            const isOnline = Boolean(device && device.is_enabled && lastSeenMs && (diffSec < 60));

            const latestDoc = await readingsCol.find({ device_id: deviceId })
                .sort({ server_received_at: -1 })
                .limit(1)
                .next();

            return res.status(200).json({
                success: true,
                device_id: deviceId,
                device_name: device ? device.device_name : 'Unknown Device',
                is_enabled: device ? device.is_enabled : false,
                connectivity: !device || !device.is_enabled ? 'disabled' : (isOnline ? 'online' : 'offline'),
                last_seen_at: device ? device.last_seen_at : null,
                seconds_since_last_seen: diffSec,
                sensors: {
                    temperature: (latestDoc && latestDoc.temperature && latestDoc.temperature.sensor_status) || 'disconnected',
                    heart_rate: (latestDoc && latestDoc.heart_rate && latestDoc.heart_rate.sensor_status) || 'disconnected',
                    blood_pressure: (latestDoc && latestDoc.blood_pressure && latestDoc.blood_pressure.sensor_status) || 'not_installed',
                    gps: (latestDoc && latestDoc.gps && latestDoc.gps.fix_valid) ? 'fix_acquired' : 'no_fix',
                    sim800l: (latestDoc && latestDoc.sim800l && latestDoc.sim800l.status) || 'unknown'
                },
                last_sms_event: (latestDoc && latestDoc.sim800l) ? {
                    status: latestDoc.sim800l.last_sms_status,
                    call_status: latestDoc.sim800l.last_call_status || 'idle',
                    sos_time: latestDoc.sim800l.last_sos_time || null,
                    timestamp: latestDoc.sim800l.last_sms_at
                } : null
            });
        }

        // --------------------------------------------------------------------
        // 4. GPS LOCATION HISTORY: /api/iot/device/:id/location-history
        // --------------------------------------------------------------------
        if (view === 'location-history') {
            const limit = Math.min(200, Math.max(1, parseInt((req.query && req.query.limit) || searchParams.get('limit') || '50', 10)));
            const gpsDocs = await readingsCol.find({
                device_id: deviceId,
                'gps.latitude': { $ne: null },
                'gps.longitude': { $ne: null }
            })
            .sort({ server_received_at: -1 })
            .limit(limit)
            .toArray();

            return res.status(200).json({
                success: true,
                device_id: deviceId,
                count: gpsDocs.length,
                locations: gpsDocs.map(l => ({
                    timestamp: l.server_received_at,
                    latitude: l.gps.latitude,
                    longitude: l.gps.longitude,
                    fix_valid: Boolean(l.gps.fix_valid)
                }))
            });
        }

        return res.status(404).json({
            success: false,
            error: `Unknown view or resource '${view}'. Valid: latest, history, status, location-history.`
        });

    } catch (err) {
        console.error('[Device Reading Endpoint Error]:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Database error retrieving sensor readings.',
            details: err.message
        });
    }
};
