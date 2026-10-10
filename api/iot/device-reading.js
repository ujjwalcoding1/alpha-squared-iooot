/**
 * Alpha Squared IoT - Sensor Data Reading & Analytics Endpoint
 * Handles:
 * - GET /api/iot/device/:id/latest           (Latest sensor readings for dashboard)
 * - GET /api/iot/device/:id/history          (Time-range filtered historical data for Chart.js)
 * - GET /api/iot/device/:id/status           (Device connectivity & sensor states)
 * - GET /api/iot/device/:id/location-history  (GPS path and coordinates)
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
        const device = await devicesCol.findOne({ device_id: deviceId });
        if (!device) {
            return res.status(404).json({
                success: false,
                error: `Device '${deviceId}' is not registered.`
            });
        }

        // --------------------------------------------------------------------
        // 1. LATEST READINGS: /api/iot/device/:id/latest
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
                    battery_level: typeof r.battery_level === 'number' ? r.battery_level : null,
                    signal_strength: typeof r.signal_strength === 'number' ? r.signal_strength : null,
                    is_simulated: Boolean(r.is_simulated)
                }
            });
        }

        // --------------------------------------------------------------------
        // 2. HISTORICAL DATA: /api/iot/device/:id/history
        // --------------------------------------------------------------------
        if (view === 'history') {
            const range = req.query.range || searchParams.get('range') || '1h';
            const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || searchParams.get('limit') || '100', 10)));
            const includeSim = req.query.include_simulated === 'true' || searchParams.get('include_simulated') === 'true';

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
                battery: d.battery_level !== undefined ? d.battery_level : null,
                rssi: d.signal_strength !== undefined ? d.signal_strength : null,
                is_simulated: Boolean(d.is_simulated)
            }));

            return res.status(200).json({
                success: true,
                device_id: deviceId,
                range: range,
                count: series.length,
                data: series
            });
        }

        // --------------------------------------------------------------------
        // 3. DEVICE STATUS & HEALTH: /api/iot/device/:id/status
        // --------------------------------------------------------------------
        if (view === 'status') {
            const now = Date.now();
            const lastSeenMs = device.last_seen_at ? new Date(device.last_seen_at).getTime() : null;
            const diffSec = lastSeenMs ? Math.round((now - lastSeenMs) / 1000) : null;
            const isOnline = device.is_enabled && lastSeenMs && (diffSec < 60);

            const latestDoc = await readingsCol.find({ device_id: deviceId })
                .sort({ server_received_at: -1 })
                .limit(1)
                .next();

            return res.status(200).json({
                success: true,
                device_id: deviceId,
                device_name: device.device_name,
                is_enabled: device.is_enabled,
                connectivity: !device.is_enabled ? 'disabled' : (isOnline ? 'online' : 'offline'),
                last_seen_at: device.last_seen_at,
                seconds_since_last_seen: diffSec,
                sensors: {
                    temperature: (latestDoc && latestDoc.temperature && latestDoc.temperature.sensor_status) || 'disconnected',
                    heart_rate: (latestDoc && latestDoc.heart_rate && latestDoc.heart_rate.sensor_status) || 'disconnected',
                    blood_pressure: (latestDoc && latestDoc.blood_pressure && latestDoc.blood_pressure.sensor_status) || 'not_installed',
                    gps: (latestDoc && latestDoc.gps && latestDoc.gps.fix_valid) ? 'fix_acquired' : 'no_fix'
                }
            });
        }

        // --------------------------------------------------------------------
        // 4. GPS LOCATION HISTORY: /api/iot/device/:id/location-history
        // --------------------------------------------------------------------
        if (view === 'location-history') {
            const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || searchParams.get('limit') || '50', 10)));
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
        console.error('[Device Reading Error]:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Internal server error processing reading request.',
            details: err.message
        });
    }
};
