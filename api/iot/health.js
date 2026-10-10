/**
 * Alpha Squared IoT - Health & Connectivity Verification Endpoint (Live Monitoring Mode)
 * GET /api/iot/health
 * Public endpoint: returns system status, live telemetry state, and active features without leaking secrets.
 */

const { applyCors } = require('../../backend/cors');
const liveStore = require('../../backend/live-store');

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;

    if (req.method !== 'GET') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed. Use GET.'
        });
    }

    try {
        const storeStatus = await liveStore.getStoreStatus();
        const isHealthy = storeStatus.shared_storage_configured ? storeStatus.connected : true; // Operational locally, degraded without Vercel Redis

        return res.status(200).json({
            status: isHealthy ? (storeStatus.shared_storage_configured ? 'operational' : 'standalone_memory') : 'degraded',
            service: 'Alpha Squared IoT Live Monitoring API',
            version: '2.2.0-live',
            server_time: new Date().toISOString(),
            mode: 'live-sensor-monitoring',
            storage: {
                provider: storeStatus.provider,
                shared_storage_configured: storeStatus.shared_storage_configured,
                connected: storeStatus.connected,
                persistent: false,
                message: storeStatus.message,
                registered_devices: storeStatus.devicesCount,
                active_readings: storeStatus.readingsCount
            },
            features: {
                device_authentication: 'active',
                range_validation: 'active',
                gps_mapping: 'active',
                emergency_dispatch: 'active'
            }
        });
    } catch (err) {
        console.error('[Health Endpoint Error]:', err.message);
        return res.status(500).json({
            status: 'error',
            error: 'Health check encountered an internal error.',
            message: err.message
        });
    }
};
