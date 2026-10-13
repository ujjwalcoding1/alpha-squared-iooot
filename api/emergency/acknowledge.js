/**
 * Alpha Squad IoT - Acknowledge & Resolve Emergency Endpoint
 * POST /api/emergency/acknowledge
 * Body: { event_id: string, resolved_by?: string, note?: string }
 */

const { applyCors } = require('../../backend/cors');
const db = require('../../backend/db');

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
    }

    let body = req.body || {};
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) {}
    }

    const eventId = body.event_id || body.eventId;
    const resolvedBy = body.resolved_by || body.resolvedBy || 'Caregiver / User Action';
    const note = body.note || 'Emergency acknowledged and cleared from dashboard';

    if (!eventId) {
        return res.status(400).json({ success: false, error: 'Field "event_id" is required.' });
    }

    try {
        const eventsCol = await db.getEmergencyEventsCollection();
        const nowIso = new Date().toISOString();

        const updateResult = await eventsCol.updateOne(
            { event_id: eventId },
            {
                $set: {
                    acknowledged: true,
                    acknowledged_at: nowIso,
                    resolved_by: resolvedBy,
                    resolution_note: note
                }
            }
        );

        if (updateResult.matchedCount === 0) {
            // Also upsert a record if event wasn't in DB yet
            await eventsCol.updateOne(
                { event_id: eventId },
                {
                    $setOnInsert: {
                        event_id: eventId,
                        event_type: 'Acknowledged Emergency Event',
                        created_at: nowIso
                    },
                    $set: {
                        acknowledged: true,
                        acknowledged_at: nowIso,
                        resolved_by: resolvedBy,
                        resolution_note: note
                    }
                },
                { upsert: true }
            );
        }

        return res.status(200).json({
            success: true,
            message: `Emergency event '${eventId}' acknowledged and resolved successfully.`,
            event_id: eventId,
            acknowledged_at: nowIso,
            resolved_by: resolvedBy
        });
    } catch (err) {
        console.error('[Emergency Acknowledge Error]:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Database error acknowledging emergency event.',
            details: err.message
        });
    }
};

