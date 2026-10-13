/**
 * Alpha Squared - GPS Location & Leaflet Interactive Map Module
 * 
 * Features:
 * - Device / Browser Geolocation API integration
 * - Graceful timeout, permission-denied & error handling
 * - Leaflet.js interactive OpenStreetMap rendering
 * - Google Maps deep-link generator
 * - Strict non-fabrication of GPS data (displays 'Unavailable' when disconnected)
 */

let leafletMap = null;
let patientMarker = null;
let lastKnownValidCoords = null;

/**
 * Initializes the Leaflet interactive map inside the specified DOM container
 */
function initLeafletMap(containerId = "map-container") {
    const mapElement = document.getElementById(containerId);
    if (!mapElement) return;

    if (typeof L === 'undefined') {
        console.warn("[Location] Leaflet.js library not loaded.");
        mapElement.innerHTML = `<div style="padding:2rem; text-align:center; color:#94a3b8; background:rgba(15,23,42,0.6); border-radius:8px;">
            Leaflet map library loading...
        </div>`;
        return;
    }

    try {
        if (!leafletMap) {
            // Default initial center set to generic region view, zoom level 2
            leafletMap = L.map(containerId).setView([20.0, 0.0], 2);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© OpenStreetMap contributors'
            }).addTo(leafletMap);
        }
    } catch (e) {
        console.error("[Location] Error initializing Leaflet map:", e);
    }
}

/**
 * Updates coordinates on the UI and repositions the Leaflet map marker honestly
 * @param {number|null} lat 
 * @param {number|null} lng 
 * @param {boolean} [fixValid] 
 * @param {string|null} [lastFixTime] 
 */
function updatePatientLocation(lat, lng, fixValid, lastFixTime = null) {
    const latSpan = document.getElementById("location-lat");
    const lngSpan = document.getElementById("location-lng");
    const gpsStatusSpan = document.getElementById("gps-fix-status-text");
    const mapBtn = document.getElementById("btn-open-google-maps");

    if (fixValid === undefined) {
        fixValid = (lat !== undefined && lat !== null && !isNaN(lat)) &&
                   (lng !== undefined && lng !== null && !isNaN(lng));
    }

    const hasValidCoords = Boolean(fixValid) &&
                           (lat !== undefined && lat !== null && !isNaN(lat)) &&
                           (lng !== undefined && lng !== null && !isNaN(lng));

    if (hasValidCoords) {
        lastKnownValidCoords = { lat: parseFloat(Number(lat).toFixed(7)), lng: parseFloat(Number(lng).toFixed(7)), time: lastFixTime || new Date().toISOString() };

        if (latSpan) latSpan.textContent = lastKnownValidCoords.lat.toFixed(5);
        if (lngSpan) lngSpan.textContent = lastKnownValidCoords.lng.toFixed(5);
        if (gpsStatusSpan) {
            gpsStatusSpan.className = "vital-status-pill normal";
            gpsStatusSpan.textContent = "GPS FIX ACQUIRED";
        }

        if (mapBtn) {
            mapBtn.disabled = false;
            mapBtn.style.opacity = "1";
            mapBtn.title = "Open Google Maps location";
            mapBtn.onclick = () => {
                window.open(`https://www.google.com/maps?q=${lastKnownValidCoords.lat},${lastKnownValidCoords.lng}`, '_blank');
            };
        }

        if (leafletMap) {
            const newLatLng = [lastKnownValidCoords.lat, lastKnownValidCoords.lng];
            if (!patientMarker) {
                patientMarker = L.marker(newLatLng).addTo(leafletMap)
                    .bindPopup(`<b>Patient GPS Fix</b><br>Device: ALPHA-001<br>Lat: ${lastKnownValidCoords.lat}<br>Lng: ${lastKnownValidCoords.lng}`)
                    .openPopup();
            } else {
                patientMarker.setLatLng(newLatLng);
                if (patientMarker.getPopup()) {
                    patientMarker.getPopup().setContent(`<b>Patient GPS Fix</b><br>Device: ALPHA-001<br>Lat: ${lastKnownValidCoords.lat}<br>Lng: ${lastKnownValidCoords.lng}`);
                }
            }
            leafletMap.setView(newLatLng, 15);
        }
    } else {
        // No current GPS fix - do NOT fabricate default coordinates
        if (latSpan) latSpan.textContent = lastKnownValidCoords ? `${lastKnownValidCoords.lat.toFixed(5)} (Last Known)` : "Unavailable";
        if (lngSpan) lngSpan.textContent = lastKnownValidCoords ? `${lastKnownValidCoords.lng.toFixed(5)} (Last Known)` : "Unavailable";

        if (gpsStatusSpan) {
            gpsStatusSpan.className = "vital-status-pill critical";
            gpsStatusSpan.textContent = lastKnownValidCoords ? "GPS FIX STALE / UNAVAILABLE" : "GPS FIX UNAVAILABLE";
        }

        if (mapBtn) {
            if (lastKnownValidCoords) {
                mapBtn.disabled = false;
                mapBtn.style.opacity = "0.8";
                mapBtn.title = "Open last known GPS location on Google Maps";
                mapBtn.onclick = () => {
                    window.open(`https://www.google.com/maps?q=${lastKnownValidCoords.lat},${lastKnownValidCoords.lng}`, '_blank');
                };
            } else {
                mapBtn.disabled = false;
                mapBtn.style.opacity = "0.6";
                mapBtn.title = "GPS fix unavailable";
                mapBtn.onclick = () => {
                    alert("GPS hardware module is not connected or has no satellite fix. Coordinates are unavailable.");
                };
            }
        }
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
                updatePatientLocation(lat, lng, true);

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
