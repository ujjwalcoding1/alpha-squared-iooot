/**
 * Alpha Squared - GPS Location & Leaflet Interactive Map Module
 */

let leafletMap = null;
let patientMarker = null;

// Fallback Default Coordinates (New Delhi, India demo location)
const DEFAULT_COORDS = { lat: 28.6139, lng: 77.2090 };

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

function updatePatientLocation(lat, lng) {
    const validLat = (lat !== undefined && lat !== null) ? parseFloat(lat) : DEFAULT_COORDS.lat;
    const validLng = (lng !== undefined && lng !== null) ? parseFloat(lng) : DEFAULT_COORDS.lng;

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
