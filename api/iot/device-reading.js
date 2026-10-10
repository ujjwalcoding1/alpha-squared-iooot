/**
 * Alpha Squared IoT - Live Sensor Data & Status Endpoint (Live Monitoring Mode)
 * Handles:
 * - GET /api/iot/device/:id/latest           (Latest live sensor readings for dashboard)
 * - GET /api/iot/device/:id/history          (Live-only single telemetry point notice)
 * - GET /api/iot/device/:id/status           (Device connectivity & sensor health states)
 * - GET /api/iot/device/:id/location-history  (Current live GPS coordinate fix)
 */

const { applyCors } = require('../../backend/cors');
const liveStore = require('../../backend/live-store');

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

    const { deviceId, view } = parseReadingUrl(req);

    if (!deviceId) {
        return res.status(400).json({
            success: false,
            error: 'Missing required device identifier in URL path.'
        });
    }

    try {
        const device = await liveStore.getDevice(deviceId);
        if (!device) {
            return res.status(404).json({
                success: false,
                error: `Device '${deviceId}' is not registered.`
            });
        }

        // --------------------------------------------------------------------
        // 1. LATEST LIVE READINGS: /api/iot/device/:id/latest
        // --------------------------------------------------------------------
        if (view === 'latest') {
            const r = await liveStore.getLatestReading(deviceId);

            if (!r) {
                return res.status(200).json({
                    success: true,
                    device_id: deviceId,
                    has_data: false,
                    message: 'No sensor readings received yet for this device.',
                    reading: null
                });
            }

            return res.status(200).json({
                success: true,
                device_id: deviceId,
                has_data: true,
                reading: {
                    id: r.id,
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
                        fix_valid: Boolean(r.gps && r.gps.fix_valid),
                        status: (r.gps && r.gps.sensor_status) || (r.gps && r.gps.fix_valid ? 'ok' : 'no_fix')
                    },
                    sim800l: {
                        status: (r.sim800l && r.sim800l.status) || 'unknown',
                        last_sms_status: (r.sim800l && r.sim800l.last_sms_status) || null,
                        last_sms_at: (r.sim800l && r.sim800l.last_sms_at) || null,
                        last_call_status: (r.sim800l && r.sim800l.last_call_status) || 'idle',
                        last_sos_time: (r.sim800l && r.sim800l.last_sos_time) || null
                    },
                    battery_level: typeof r.battery_level === 'number' ? r.battery_level : null,
                    signal_strength: typeof r.signal_strength === 'number' ? r.signal_strength : null,
                    is_simulated: Boolean(r.is_simulated)
                }
            });
        }

        // --------------------------------------------------------------------
        // 2. LIVE DATA NOTICE: /api/iot/device/:id/history
        // --------------------------------------------------------------------
        if (view === 'history') {
            const r = await liveStore.getLatestReading(deviceId);
            const dataPoint = r ? [{
                id: r.id,
                time: r.device_timestamp || r.server_received_at,
                temperature: r.temperature ? r.temperature.value : null,
                temperature_status: (r.temperature && r.temperature.sensor_status) || 'ok',
                heart_rate: r.heart_rate ? r.heart_rate.value : null,
                heart_rate_status: (r.heart_rate && r.heart_rate.sensor_status) || 'ok',
                bp_systolic: r.blood_pressure ? r.blood_pressure.systolic : null,
                bp_diastolic: r.blood_pressure ? r.blood_pressure.diastolic : null,
                bp_status: (r.blood_pressure && r.blood_pressure.sensor_status) || 'not_installed',
                gps: r.gps ? { latitude: r.gps.latitude, longitude: r.gps.longitude, fix_valid: Boolean(r.gps.fix_valid) } : null,
                battery: r.battery_level !== undefined ? r.battery_level : null,
                rssi: r.signal_strength !== undefined ? r.signal_strength : null,
                is_simulated: Boolean(r.is_simulated)
            }] : [];

            return res.status(200).json({
                success: true,
                device_id: deviceId,
                mode: 'live_only',
                persistent: false,
                message: 'Historical storage disabled. Displaying latest live reading only.',
                count: dataPoint.length,
                data: dataPoint
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

            const latestDoc = await liveStore.getLatestReading(deviceId);

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
        // 4. GPS LOCATION: /api/iot/device/:id/location-history
        // --------------------------------------------------------------------
        if (view === 'location-history') {
            const r = await liveStore.getLatestReading(deviceId);
            const hasGps = r && r.gps && r.gps.latitude !== null && r.gps.longitude !== null;

            const locations = hasGps ? [{
                timestamp: r.server_received_at,
                latitude: r.gps.latitude,
                longitude: r.gps.longitude,
                fix_valid: Boolean(r.gps.fix_valid)
            }] : [];

            return res.status(200).json({
                success: true,
                device_id: deviceId,
                mode: 'live_only',
                count: locations.length,
                locations: locations
            });
        }

        return res.status(404).json({
            success: false,
            error: `Unknown view option '${view}'. Supported views: latest, status, history, location-history.`
        });

    } catch (err) {
        console.error('[Device Reading Error]:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Server error retrieving live sensor telemetry.',
            details: err.message
        });
    }
};
