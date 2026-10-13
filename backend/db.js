/**
 * Alpha Squared IoT - MongoDB Atlas Database Connector & Connection Pool
 * Optimized for Vercel Serverless Functions with connection caching.
 */

const { MongoClient, ServerApiVersion } = require('mongodb');

let cachedClient = null;
let cachedDb = null;
let indexesCreated = false;

function getMongoUri() {
    return (
        process.env.MONGODB_URI ||
        process.env.MONGO_URI ||
        process.env.MONGODB_URL ||
        process.env.MONGO_URL ||
        ''
    ).trim();
}

function getDatabaseName() {
    const customDb = process.env.MONGODB_DB_NAME || process.env.MONGO_DB_NAME || process.env.MONGODB_DATABASE;
    if (customDb && customDb.trim()) {
        return customDb.trim();
    }
    const uri = getMongoUri();
    if (uri) {
        try {
            const url = new URL(uri.replace('mongodb+srv://', 'http://').replace('mongodb://', 'http://'));
            const dbFromPath = url.pathname ? url.pathname.replace(/^\//, '').split('?')[0].trim() : '';
            if (dbFromPath) {
                return dbFromPath;
            }
        } catch (_) {}
    }
    return 'alpha_squad';
}

function sanitizeErrorMessage(msg) {
    if (!msg || typeof msg !== 'string') return 'Unknown error';
    return msg.replace(/mongodb(\+srv)?:\/\/[^@]+@/gi, 'mongodb$1://***:***@');
}

function resetDbConnection() {
    cachedClient = null;
    cachedDb = null;
    indexesCreated = false;
}

/**
 * Connect to MongoDB Atlas with connection caching for serverless environments.
 * Uses bounded timeouts (3.5s by default) to prevent Vercel 504 invocation timeouts.
 */
async function connectToDatabase(options = {}) {
    const uri = getMongoUri();
    if (!uri) {
        throw new Error('MONGODB_URI environment variable is not configured.');
    }

    if (cachedClient && cachedDb) {
        try {
            // Verify cached connection is alive with bounded ping timeout
            await cachedDb.command({ ping: 1 }, { maxTimeMS: 2000 });
            return { client: cachedClient, db: cachedDb };
        } catch (_) {
            try {
                await cachedClient.close();
            } catch (_) {}
            cachedClient = null;
            cachedDb = null;
        }
    }

    const connectTimeoutMS = options.timeoutMs || parseInt(process.env.MONGODB_CONNECT_TIMEOUT_MS, 10) || 3500;
    const serverSelectionTimeoutMS = options.timeoutMs || parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 10) || 3500;
    const socketTimeoutMS = parseInt(process.env.MONGODB_SOCKET_TIMEOUT_MS, 10) || 6000;

    const client = new MongoClient(uri, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        },
        connectTimeoutMS,
        serverSelectionTimeoutMS,
        socketTimeoutMS,
        maxPoolSize: 10
    });

    await client.connect();
    const db = client.db(getDatabaseName());

    cachedClient = client;
    cachedDb = db;

    // Ensure database indexes on initial connection if not explicitly skipped
    if (!indexesCreated && !options.skipIndexes) {
        ensureIndexes(db)
            .then(() => { indexesCreated = true; })
            .catch((idxErr) => console.warn('[MongoDB] Index creation warning:', sanitizeErrorMessage(idxErr.message)));
    }

    return { client: cachedClient, db: cachedDb };
}

/**
 * Creates required indexes and seeds default documents in parallel
 */
async function ensureIndexes(db) {
    const devicesCol = db.collection('devices');
    const readingsCol = db.collection('sensor_readings');
    const eventsCol = db.collection('emergency_events');
    const callsCol = db.collection('emergency_calls');
    const contactsCol = db.collection('patient_contacts');
    const patientEventsCol = db.collection('patient_events');

    const crypto = require('crypto');
    const demoHash = crypto.createHash('sha256').update('alphadev_demo_secret_token_12345').digest('hex');
    const nowIso = new Date().toISOString();

    const tasks = [
        devicesCol.createIndex({ device_id: 1 }, { unique: true }),
        devicesCol.createIndex({ is_enabled: 1 }),
        devicesCol.createIndex({ last_seen_at: -1 }),

        readingsCol.createIndex({ device_id: 1, server_received_at: -1 }),
        readingsCol.createIndex({ server_received_at: -1 }),
        readingsCol.createIndex({ device_id: 1, is_simulated: 1, server_received_at: -1 }),

        eventsCol.createIndex({ event_id: 1 }, { unique: true }),
        eventsCol.createIndex({ created_at: -1 }),
        eventsCol.createIndex({ acknowledged: 1 }),
        eventsCol.createIndex({ zone: 1 }),

        callsCol.createIndex({ event_id: 1 }),
        callsCol.createIndex({ initiated_at: -1 }),

        contactsCol.createIndex({ contact_type: 1 }, { unique: true }),
        patientEventsCol.createIndex({ timestamp: -1 }),

        devicesCol.updateOne(
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
        ),

        contactsCol.updateOne(
            { contact_type: 'primary' },
            {
                $setOnInsert: {
                    contact_type: 'primary',
                    name: 'Dr. Marcus Vance (Primary Caregiver)',
                    relation: 'Physician / Family',
                    phone: process.env.PRIMARY_EMERGENCY_PHONE || '+919876543210',
                    email: process.env.GMAIL_RECEIVER || 'caregiver-or-doctor-email@gmail.com',
                    call_enabled: true,
                    email_enabled: true,
                    telegram_enabled: true,
                    updated_at: nowIso
                }
            },
            { upsert: true }
        ),

        contactsCol.updateOne(
            { contact_type: 'secondary' },
            {
                $setOnInsert: {
                    contact_type: 'secondary',
                    name: 'Sarah Vance (Secondary Contact)',
                    relation: 'Daughter',
                    phone: process.env.SECONDARY_EMERGENCY_PHONE || '+919876543211',
                    email: 'secondary-caregiver@gmail.com',
                    call_enabled: true,
                    email_enabled: true,
                    telegram_enabled: false,
                    updated_at: nowIso
                }
            },
            { upsert: true }
        )
    ];

    await Promise.allSettled(tasks);
}

/**
 * Returns the 'devices' collection
 */
async function getDevicesCollection() {
    const { db } = await connectToDatabase();
    return db.collection('devices');
}

/**
 * Returns the 'sensor_readings' collection
 */
async function getReadingsCollection() {
    const { db } = await connectToDatabase();
    return db.collection('sensor_readings');
}

/**
 * Returns the 'emergency_events' collection
 */
async function getEmergencyEventsCollection() {
    const { db } = await connectToDatabase();
    return db.collection('emergency_events');
}

/**
 * Returns the 'emergency_calls' collection
 */
async function getEmergencyCallsCollection() {
    const { db } = await connectToDatabase();
    return db.collection('emergency_calls');
}

/**
 * Returns the 'patient_contacts' collection
 */
async function getPatientContactsCollection() {
    const { db } = await connectToDatabase();
    return db.collection('patient_contacts');
}

/**
 * Returns the 'patient_events' collection (warnings and zone transitions)
 */
async function getPatientEventsCollection() {
    const { db } = await connectToDatabase();
    return db.collection('patient_events');
}

/**
 * Safe status inspection for health check endpoint with bounded timeout
 */
async function getDbStatus(options = {}) {
    const uri = getMongoUri();
    if (!uri) {
        return {
            provider: 'mongodb-atlas',
            connected: false,
            database: null,
            message: 'MONGODB_URI is not configured in environment variables.',
            devicesCount: 0,
            readingsCount: 0
        };
    }

    const timeoutMs = options.timeoutMs || 3500;

    let timer = null;
    const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => {
            resolve({
                provider: 'mongodb-atlas',
                connected: false,
                database: getDatabaseName(),
                message: `Connection timed out after ${timeoutMs}ms. Verify MongoDB Atlas Network Access (allow 0.0.0.0/0) and credentials.`,
                devicesCount: 0,
                readingsCount: 0
            });
        }, timeoutMs);
    });

    const checkPromise = (async () => {
        try {
            const { db } = await connectToDatabase({ skipIndexes: true, timeoutMs });
            // Verify database with ping command bounded to 2000ms
            await db.command({ ping: 1 }, { maxTimeMS: 2000 });

            let devicesCount = 0;
            let readingsCount = 0;
            try {
                const [dCount, rCount] = await Promise.all([
                    db.collection('devices').countDocuments({}, { maxTimeMS: 1500 }),
                    db.collection('sensor_readings').countDocuments({}, { maxTimeMS: 1500 })
                ]);
                devicesCount = dCount;
                readingsCount = rCount;
            } catch (cntErr) {
                console.warn('[MongoDB] Count query error:', sanitizeErrorMessage(cntErr.message));
            }

            return {
                provider: 'mongodb-atlas',
                connected: true,
                database: getDatabaseName(),
                message: 'MongoDB Atlas connection active and verified.',
                devicesCount,
                readingsCount
            };
        } catch (err) {
            const safeMsg = sanitizeErrorMessage(err.message);
            return {
                provider: 'mongodb-atlas',
                connected: false,
                database: getDatabaseName(),
                message: `Connection error: ${safeMsg}`,
                devicesCount: 0,
                readingsCount: 0
            };
        }
    })();

    const result = await Promise.race([checkPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);
    return result;
}

module.exports = {
    connectToDatabase,
    ensureIndexes,
    getDbStatus,
    getDevicesCollection,
    getReadingsCollection,
    getEmergencyEventsCollection,
    getEmergencyCallsCollection,
    getPatientContactsCollection,
    getPatientEventsCollection,
    getMongoUri,
    getDatabaseName,
    resetDbConnection,
    sanitizeErrorMessage
};
