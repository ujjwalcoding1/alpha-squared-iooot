/**
 * Alpha Squared IoT - Health & Connectivity Verification Endpoint
 * GET /api/iot/health
 * Public endpoint: returns system status, database health, and telemetry stats without leaking secrets.
 */

const { applyCors } = require('../../backend/cors');
const db = require('../../backend/db');

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;

    if (req.method !== 'GET') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed. Use GET.'
        });
    }

    try {
        const dbStatus = await db.getDbStatus();

        return res.status(200).json({
            status: dbStatus.connected ? 'operational' : 'degraded',
            service: 'Alpha Squared IoT Health Monitoring API',
            version: '2.1.0',
            server_time: new Date().toISOString(),
            database: {
                provider: dbStatus.provider,
                connected: dbStatus.connected,
                database: dbStatus.database || null,
                message: dbStatus.message,
                registered_devices: dbStatus.devicesCount || 0,
                total_readings: dbStatus.readingsCount || 0
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
