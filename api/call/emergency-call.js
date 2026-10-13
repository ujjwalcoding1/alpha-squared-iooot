/**
 * Alpha Squad IoT - Emergency Call Serverless Endpoint
 * POST /api/call/emergency-call
 * 
 * Body: {
 *   event_id?: string,
 *   reason?: string,
 *   vitals?: Object,
 *   location?: Object,
 *   primary_phone?: string,
 *   secondary_phone?: string,
 *   is_test?: boolean,
 *   explicit_test_call?: boolean
 * }
 */

const { applyCors } = require('../../backend/cors');
const { dispatchEmergencyPhoneCall } = require('../../backend/emergency-call');

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
    }

    let body = req.body || {};
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) {}
    }

    try {
        const result = await dispatchEmergencyPhoneCall({
            eventId: body.event_id || body.eventId,
            reason: body.reason || body.type,
            vitals: body.vitals || {},
            location: body.location || null,
            primaryPhone: body.primary_phone || body.primaryPhone,
            secondaryPhone: body.secondary_phone || body.secondaryPhone,
            isTest: Boolean(body.is_test || body.isTest || (body.source && body.source.includes('test'))),
            explicitTestCall: Boolean(body.explicit_test_call || body.explicitTestCall)
        });

        return res.status(200).json(result);
    } catch (err) {
        console.error('[API Emergency Call Error]:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Server error processing emergency voice call.',
            details: err.message
        });
    }
};

