/**
 * Mock for repositories/polyline.repository.js
 */
const polylines = ['', '', '', '', ''];

function decodePolyline(encoded) {
    if (!encoded) return [];
    const points = [];
    let index = 0, lat = 0, lng = 0;
    while (index < encoded.length) {
        let shift = 0, result = 0, byte;
        do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
        lat += (result & 1) ? ~(result >> 1) : (result >> 1);
        shift = 0; result = 0;
        do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
        lng += (result & 1) ? ~(result >> 1) : (result >> 1);
        points.push([lng / 1e5, lat / 1e5]);
    }
    return points;
}

function getPolyline(edgeOffset) {
    if (edgeOffset < 0 || edgeOffset >= polylines.length) return [];
    return decodePolyline(polylines[edgeOffset]);
}

function getEncodedPolyline(edgeOffset) {
    if (edgeOffset < 0 || edgeOffset >= polylines.length) return '';
    return polylines[edgeOffset] || '';
}

module.exports = { getPolyline, getEncodedPolyline, decodePolyline };
