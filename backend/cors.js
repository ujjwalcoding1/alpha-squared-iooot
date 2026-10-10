/**
 * Alpha Squared IoT - Unified CORS & Request Security Middleware
 */

const ALLOWED_ORIGINS = [
    "https://ujjwalcoding1.github.io",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://localhost:3000"
];

function applyCors(req, res) {
    const origin = req.headers['origin'] || '';
    const isAllowed = !origin || 
                      ALLOWED_ORIGINS.includes(origin) || 
                      origin.endsWith('.github.io') || 
                      origin.includes('localhost') || 
                      origin.includes('127.0.0.1');

    res.setHeader('Access-Control-Allow-Origin', isAllowed && origin ? origin : '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-token, x-admin-key, x-api-key, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return true;
    }
    return false;
}

module.exports = {
    applyCors
};

