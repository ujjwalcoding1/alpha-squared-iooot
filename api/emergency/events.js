/**
 * Alpha Squad IoT - Emergency Events History Endpoint
 * GET /api/emergency/events
 * Query params: ?limit=20&acknowledged=true|false
 */

const { applyCors } = require('../../backend/cors');
const db = require('../../backend/db');

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed. Use GET.' });
    }

    try {
        const eventsCol = await db.getEmergencyEventsCollection();
        const limit = Math.min(100, Math.max(1, parseInt((req.query && req.query.limit) || '20', 10)));

        const filter = {};
        if (req.query && req.query.acknowledged !== undefined) {
            filter.acknowledged = req.query.acknowledged === 'true';
        }

        const events = await eventsCol.find(filter)
            .sort({ created_at: -1 })
            .limit(limit)
            .toArray();

        return res.status(200).json({
            success: true,
            count: events.length,
            events: events.map(e => ({
                id: e._id ? e._id.toString() : null,
                event_id: e.event_id,
                event_type: e.event_type,
                zone: e.zone,
                reasons: e.reasons,
                recommendation: e.recommendation,
                vitals: e.vitals,
                location: e.location,
                delivery: e.delivery,
                created_at: e.created_at,
                acknowledged: e.acknowledged,
                acknowledged_at: e.acknowledged_at,
                resolved_by: e.resolved_by
            }))
        });
    } catch (err) {
        console.error('[Emergency Events Error]:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Database error retrieving emergency events.',
            details: err.message
        });
    }
};
