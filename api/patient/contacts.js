/**
 * Alpha Squad IoT - Patient Emergency Contacts Management Endpoint
 * GET  /api/patient/contacts  (Fetch configured primary & secondary contacts)
 * POST /api/patient/contacts  (Update contacts in MongoDB Atlas)
 */

const { applyCors } = require('../../backend/cors');
const db = require('../../backend/db');

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;

    // GET /api/patient/contacts
    if (req.method === 'GET') {
        try {
            const contactsCol = await db.getPatientContactsCollection();
            const contacts = await contactsCol.find({}).toArray();

            const primary = contacts.find(c => c.contact_type === 'primary') || {
                contact_type: 'primary',
                name: 'Dr. Marcus Vance (Primary Caregiver)',
                relation: 'Physician / Family',
                phone: process.env.PRIMARY_EMERGENCY_PHONE || '+919876543210',
                email: process.env.GMAIL_RECEIVER || 'caregiver-or-doctor-email@gmail.com',
                call_enabled: true,
                email_enabled: true,
                telegram_enabled: true
            };

            const secondary = contacts.find(c => c.contact_type === 'secondary') || {
                contact_type: 'secondary',
                name: 'Sarah Vance (Secondary Contact)',
                relation: 'Daughter',
                phone: process.env.SECONDARY_EMERGENCY_PHONE || '+919876543211',
                email: 'secondary-caregiver@gmail.com',
                call_enabled: true,
                email_enabled: true,
                telegram_enabled: false
            };

            return res.status(200).json({
                success: true,
                contacts: { primary, secondary }
            });
        } catch (err) {
            console.error('[Get Contacts Error]:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Database error fetching patient contacts.',
                details: err.message
            });
        }
    }

    // POST /api/patient/contacts
    if (req.method === 'POST') {
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (_) {}
        }

        const nowIso = new Date().toISOString();

        try {
            const contactsCol = await db.getPatientContactsCollection();

            if (body.primary && typeof body.primary === 'object') {
                await contactsCol.updateOne(
                    { contact_type: 'primary' },
                    {
                        $set: {
                            name: body.primary.name || 'Primary Caregiver',
                            relation: body.primary.relation || 'Caregiver',
                            phone: body.primary.phone || '+919876543210',
                            email: body.primary.email || 'caregiver@example.com',
                            call_enabled: body.primary.call_enabled !== false,
                            email_enabled: body.primary.email_enabled !== false,
                            telegram_enabled: body.primary.telegram_enabled !== false,
                            updated_at: nowIso
                        }
                    },
                    { upsert: true }
                );
            }

            if (body.secondary && typeof body.secondary === 'object') {
                await contactsCol.updateOne(
                    { contact_type: 'secondary' },
                    {
                        $set: {
                            name: body.secondary.name || 'Secondary Contact',
                            relation: body.secondary.relation || 'Family',
                            phone: body.secondary.phone || '+919876543211',
                            email: body.secondary.email || 'backup@example.com',
                            call_enabled: body.secondary.call_enabled !== false,
                            email_enabled: body.secondary.email_enabled !== false,
                            telegram_enabled: body.secondary.telegram_enabled === true,
                            updated_at: nowIso
                        }
                    },
                    { upsert: true }
                );
            }

            return res.status(200).json({
                success: true,
                message: 'Patient emergency contacts updated successfully in MongoDB Atlas.',
                updated_at: nowIso
            });
        } catch (err) {
            console.error('[Update Contacts Error]:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Database error saving patient contacts.',
                details: err.message
            });
        }
    }

    return res.status(405).json({ success: false, error: 'Method not allowed. Use GET or POST.' });
};

