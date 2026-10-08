/**
 * Alpha Squared - GPS Location & Leaflet Interactive Map Module
 * 
 * Features:
 * - Device / Browser Geolocation API integration
 * - Graceful timeout, permission-denied & error handling
 * - Leaflet.js interactive OpenStreetMap rendering
 * - Google Maps deep-link generator
 */

let leafletMap = null;
let patientMarker = null;

// Fallback Default Coordinates (New Delhi, India demo coordinates)
const DEFAULT_COORDS = { lat: 28.6139, lng: 77.2090 };

/**
 * Initializes the Leaflet interactive map inside the specified DOM container
 */
function initLeafletMap(containerId = "map-container") {
    const mapElement = document.getElementById(containerId);
    if (!mapElement) return;

    if (typeof L === 'undefined') {
        console.warn("[Location] Leaflet.js library not loaded. Map fallback text will be shown.");
        mapElement.innerHTML = `<div style="padding:2rem; text-align:center; color:#94a3b8;">
            Map service initializing... (Latitude: ${DEFAULT_COORDS.lat}, Longitude: ${DEFAULT_COORDS.lng})
        </div>`;
        return;
    }

    try {
        if (!leafletMap) {
            leafletMap = L.map(containerId).setView([DEFAULT_COORDS.lat, DEFAULT_COORDS.lng], 15);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© OpenStreetMap contributors'
            }).addTo(leafletMap);

            patientMarker = L.marker([DEFAULT_COORDS.lat, DEFAULT_COORDS.lng]).addTo(leafletMap)
                .bindPopup("<b>Patient Current Location</b><br>Device Node: ESP32_ALPHA_01")
                .openPopup();
        }
    } catch (e) {
        console.error("[Location] Error creating map:", e);
    }
}

/**
 * Updates coordinates on the UI and repositions the Leaflet map marker
 */
function updatePatientLocation(lat, lng) {
    const validLat = (lat !== undefined && lat !== null && !isNaN(lat)) ? parseFloat(lat) : DEFAULT_COORDS.lat;
    const validLng = (lng !== undefined && lng !== null && !isNaN(lng)) ? parseFloat(lng) : DEFAULT_COORDS.lng;

    const latSpan = document.getElementById("location-lat");
    const lngSpan = document.getElementById("location-lng");
    
    if (latSpan) latSpan.textContent = validLat.toFixed(4);
    if (lngSpan) lngSpan.textContent = validLng.toFixed(4);

    if (leafletMap && patientMarker) {
        const newLatLng = [validLat, validLng];
        patientMarker.setLatLng(newLatLng);
        leafletMap.panTo(newLatLng);
    }

    const mapBtn = document.getElementById("btn-open-google-maps");
    if (mapBtn) {
        mapBtn.onclick = () => {
            window.open(`https://www.google.com/maps?q=${validLat},${validLng}`, '_blank');
        };
    }
}

/**
 * Asynchronously retrieves the patient's current GPS position using the browser's Geolocation API.
 * Handles timeouts, permission denials, and unavailable GPS gracefully without throwing errors.
 * 
 * @param {Object} options Geolocation options (timeout, maximumAge, highAccuracy)
 * @returns {Promise<Object>} Location result object
 */
function getCurrentPatientLocation(options = {}) {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            console.warn("[Location] Geolocation API is not supported by this browser.");
            resolve({
                available: false,
                latitude: null,
                longitude: null,
                accuracy: null,
                mapsUrl: null,
                statusText: "Geolocation not supported by browser",
                error: "NOT_SUPPORTED"
            });
            return;
        }

        const geoOptions = {
            enableHighAccuracy: options.enableHighAccuracy !== undefined ? options.enableHighAccuracy : true,
            timeout: options.timeout || 6000, // 6-second timeout so emergency alerts are never delayed indefinitely
            maximumAge: options.maximumAge || 10000
        };

        let resolved = false;

        // Safety fallback timer in case browser hangs on prompt
        const safetyTimer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                console.warn("[Location] Geolocation request timed out (Safety timer).");
                resolve({
                    available: false,
                    latitude: null,
                    longitude: null,
                    accuracy: null,
                    mapsUrl: null,
                    statusText: "GPS request timed out",
                    error: "TIMEOUT"
                });
            }
        }, geoOptions.timeout + 1500);

        navigator.geolocation.getCurrentPosition(
            (position) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(safetyTimer);

                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const accuracy = position.coords.accuracy;
                const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

                console.log(`[Location] GPS acquired: Lat ${lat}, Lng ${lng} (Accuracy: ±${Math.round(accuracy)}m)`);

                // Update UI map
                updatePatientLocation(lat, lng);

                resolve({
                    available: true,
                    latitude: lat,
                    longitude: lng,
                    accuracy: accuracy,
                    mapsUrl: mapsUrl,
                    statusText: `GPS Acquired (±${Math.round(accuracy)}m)`,
                    error: null
                });
            },
            (error) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(safetyTimer);

                let errorMsg = "Unknown GPS error";
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        errorMsg = "Location permission denied by user";
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMsg = "GPS position unavailable";
                        break;
                    case error.TIMEOUT:
                        errorMsg = "GPS location request timed out";
                        break;
                }

                console.warn("[Location] Geolocation error:", errorMsg);

                resolve({
                    available: false,
                    latitude: null,
                    longitude: null,
                    accuracy: null,
                    mapsUrl: null,
                    statusText: errorMsg,
                    error: error.message || errorMsg
                });
            },
            geoOptions
        );
    });
}
