/**
 * Alpha Squared IoT - Database Compatibility Facade (MongoDB Removed)
 * Legacy compatibility layer reporting live monitoring mode without active MongoDB Atlas connections.
 */

const liveStore = require('./live-store');

async function connectToDatabase() {
    return { client: null, db: null, mode: 'live-store' };
}

async function getDbStatus() {
    const status = liveStore.getStoreStatus();
    return {
        provider: 'none (live-in-memory)',
        connected: false,
        mode: 'live-monitoring-only',
        persistent: false,
        message: status.message,
        devicesCount: status.devicesCount,
        readingsCount: status.readingsCount
    };
}

async function getDevicesCollection() {
    throw new Error('MongoDB has been removed from this project. Live in-memory store active.');
}

async function getReadingsCollection() {
    throw new Error('MongoDB has been removed from this project. Live in-memory store active.');
}

function getMongoUri() {
    return '';
}

function getDatabaseName() {
    return 'none (live-monitoring-mode)';
}

module.exports = {
    connectToDatabase,
    getDbStatus,
    getDevicesCollection,
    getReadingsCollection,
    getMongoUri,
    getDatabaseName
};
