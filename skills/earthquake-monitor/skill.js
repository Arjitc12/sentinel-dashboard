'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function classifyMagnitude(mag) {
  if (mag >= 7.0) return { severity: 'critical', label: 'Major', color: '#f87171' };
  if (mag >= 5.0) return { severity: 'high',     label: 'Moderate', color: '#fb923c' };
  if (mag >= 3.0) return { severity: 'medium',   label: 'Minor', color: '#fbbf24' };
  return                 { severity: 'low',      label: 'Micro', color: '#34d399'  };
}

async function geocode(location) {
  const res = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: { q: location, format: 'json', limit: 1 },
    headers: { 'User-Agent': 'Sentinel-Dashboard/1.0' }, timeout: 5000,
  });
  if (!res.data.length) throw new Error(`Cannot geocode ${location}`);
  return { lat: parseFloat(res.data[0].lat), lon: parseFloat(res.data[0].lon) };
}

function getDemoData(location) {
  return {
    skill: 'earthquake-monitor', location, fetchedAt: new Date().toISOString(),
    earthquakes: [
      { id: 'demo-eq-1', magnitude: 2.4, depth: 10, place: '45km NE of Mumbai', time: new Date(Date.now() - 7200000).toISOString(), distanceKm: 48, severity: 'low', label: 'Micro', color: '#34d399', lat: 19.55, lon: 73.1 },
      { id: 'demo-eq-2', magnitude: 3.8, depth: 25, place: '110km SE of Mumbai', time: new Date(Date.now() - 18000000).toISOString(), distanceKm: 112, severity: 'medium', label: 'Minor', color: '#fbbf24', lat: 18.5, lon: 73.3 },
    ],
    summary: { total: 2, maxMagnitude: 3.8, alertLevel: 'medium' },
    source: 'demo',
  };
}

async function fetchEarthquakes({ location, lat, lon, radiusKm = 500, minMagnitude = 2.0 }) {
  try {
    if (!lat || !lon) ({ lat, lon } = await geocode(location));

    const endTime = new Date().toISOString().split('.')[0];
    const startTime = new Date(Date.now() - 7 * 24 * 3600000).toISOString().split('.')[0];

    const res = await axios.get('https://earthquake.usgs.gov/fdsnws/event/1/query', {
      params: {
        format: 'geojson', latitude: lat, longitude: lon,
        maxradiuskm: radiusKm, minmagnitude: minMagnitude,
        starttime: startTime, endtime: endTime,
        orderby: 'magnitude', limit: 10,
      },
      timeout: 8000,
    });

    const features = res.data.features || [];
    const earthquakes = features.map(f => {
      const p = f.properties;
      const coords = f.geometry.coordinates; // [lon, lat, depth]
      const mag = p.mag || 0;
      const cls = classifyMagnitude(mag);
      const distanceKm = Math.round(haversine(lat, lon, coords[1], coords[0]));
      return {
        id: f.id, magnitude: mag, depth: Math.round(coords[2]),
        place: p.place || 'Unknown', time: new Date(p.time).toISOString(),
        distanceKm, lat: coords[1], lon: coords[0],
        ...cls,
      };
    });

    const maxMag = earthquakes.reduce((m, e) => Math.max(m, e.magnitude), 0);
    const alertLevel = maxMag >= 5.0 ? 'high' : maxMag >= 3.0 ? 'medium' : 'low';

    return {
      skill: 'earthquake-monitor', location, fetchedAt: new Date().toISOString(),
      earthquakes, summary: { total: earthquakes.length, maxMagnitude: maxMag, alertLevel },
      source: 'usgs',
    };
  } catch (err) {
    console.warn('[earthquake-monitor] error, using demo:', err.message);
    return getDemoData(location);
  }
}

module.exports = { fetchEarthquakes };

if (require.main === module) {
  const args = process.argv.slice(2);
  const loc = args[args.indexOf('--location') + 1] || 'Mumbai, India';
  fetchEarthquakes({ location: loc }).then(r => console.log(JSON.stringify(r, null, 2))).catch(console.error);
}
