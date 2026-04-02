// Log the current visible extent of the map to the console and return the bounds in a format suitable for use with Turf.js
function logCurrentBounds(mapOrBounds) {
    if (!mapOrBounds) {
        throw new TypeError('Map bounds are unavailable.');
    }

    var bounds = typeof mapOrBounds.getBounds === 'function' ? mapOrBounds.getBounds() : mapOrBounds;
    if (!bounds || typeof bounds.getSouthWest !== 'function' || typeof bounds.getNorthEast !== 'function') {
        throw new TypeError('Expected a Leaflet map or bounds object.');
    }

    var southWest = bounds.getSouthWest(); 
    var northEast = bounds.getNorthEast(); 
    return [southWest.lng, southWest.lat, northEast.lng, northEast.lat];
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { logCurrentBounds };
} else {
    window.logCurrentBounds = logCurrentBounds;
}

