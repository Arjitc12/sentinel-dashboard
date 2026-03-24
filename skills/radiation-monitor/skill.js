'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');

const BASELINE_USVH = 0.10;    // global natural background
const THRESHOLDS = { normal: 0.3, elevated: 1.0, high: 10.0 };

function classifyRadiation(usvh) {
  if (usvh >= THRESHOLDS.high) return 'critical';
  if (usvh >= THRESHOLDS.elevated) return 'high';
  if (usvh >= THRESHOLDS.normal) return 'elevated';
  return 'normal';
}

/** Haversine distance in km */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getDemoData(location) {
  return {
    skill: 'radiation-monitor', location,
    fetchedAt: new Date().toISOString(),
    primary: { usvh: 0.12, status: 'normal', sensorName: 'DEMO-001', sensorDistanceKm: 3.2, lastUpdate: new Date().toISOString() },
    neighbors: [
      { name: 'Pune Region', lat: 18.52, lon: 73.85, distanceKm: 148, usvh: 0.09, status: 'normal', sensorName: 'DEMO-002' },
      { name: 'Nashik Region', lat: 19.99, lon: 73.79, distanceKm: 165, usvh: 0.11, status: 'normal', sensorName: 'DEMO-003' },
      { name: 'Thane Region', lat: 19.21, lon: 72.97, distanceKm: 18, usvh: 0.13, status: 'normal', sensorName: 'DEMO-004' },
    ],
    baseline: BASELINE_USVH,
    dataQuality: 'baseline',
    source: 'demo',
  };
}

/** Derive neighboring region sample points from a center lat/lon */
function getNeighborPoints(lat, lon, radiusKm) {
  const offsets = [
    { name: 'North', dlat: radiusKm / 111, dlon: 0 },
    { name: 'South', dlat: -(radiusKm / 111), dlon: 0 },
    { name: 'East',  dlat: 0, dlon: radiusKm / (111 * Math.cos(lat * Math.PI / 180)) },
    { name: 'West',  dlat: 0, dlon: -(radiusKm / (111 * Math.cos(lat * Math.PI / 180))) },
    { name: 'NE',    dlat: (radiusKm * 0.7) / 111, dlon: (radiusKm * 0.7) / (111 * Math.cos(lat * Math.PI / 180)) },
    { name: 'SW',    dlat: -(radiusKm * 0.7) / 111, dlon: -(radiusKm * 0.7) / (111 * Math.cos(lat * Math.PI / 180)) },
  ];
  return offsets.map(o => ({ name: `${o.name} Region`, lat: +(lat + o.dlat).toFixed(4), lon: +(lon + o.dlon).toFixed(4), distanceKm: Math.round(haversine(lat, lon, lat + o.dlat, lon + o.dlon)) }));
}

async function fetchRadiation({ location, lat, lon, neighborRadiusKm = 200 }) {
  // Geocode if needed
  if (!lat || !lon) {
    try {
      const geo = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: { q: location, format: 'json', limit: 1 },
        headers: { 'User-Agent': 'Sentinel-Dashboard/1.0' }, timeout: 5000,
      });
      if (geo.data.length) { lat = parseFloat(geo.data[0].lat); lon = parseFloat(geo.data[0].lon); }
      else return getDemoData(location);
    } catch { return getDemoData(location); }
  }

  try {
    // Radmon.org — fetches last N readings sorted by proximity
    const res = await axios.get('https://radmon.org/radmon.php', {
      params: { function: 'last10', user: 'guest', password: 'guest' },
      timeout: 8000,
    });

    // Radmon returns plain text CSV: date,time,user,cpm,usvh,lat,lon
    const lines = (res.data || '').split('\n').filter(l => l.trim());
    const sensors = lines.map(line => {
      const parts = line.split(',');
      if (parts.length < 7) return null;
      const sLat = parseFloat(parts[5]), sLon = parseFloat(parts[6]), usvh = parseFloat(parts[4]);
      if (isNaN(sLat) || isNaN(sLon) || isNaN(usvh)) return null;
      return { user: parts[2], usvh, lat: sLat, lon: sLon, lastUpdate: `${parts[0]} ${parts[1]}`, distanceKm: Math.round(haversine(lat, lon, sLat, sLon)) };
    }).filter(Boolean).sort((a, b) => a.distanceKm - b.distanceKm);

    const nearest = sensors[0];
    let primary, dataQuality;

    if (nearest && nearest.distanceKm < 300) {
      primary = { usvh: nearest.usvh, status: classifyRadiation(nearest.usvh), sensorName: nearest.user, sensorDistanceKm: nearest.distanceKm, lastUpdate: nearest.lastUpdate };
      dataQuality = nearest.distanceKm < 50 ? 'live' : 'estimated';
    } else {
      primary = { usvh: BASELINE_USVH, status: 'normal', sensorName: 'No nearby sensor', sensorDistanceKm: null, lastUpdate: null };
      dataQuality = 'baseline';
    }

    const neighborPoints = getNeighborPoints(lat, lon, neighborRadiusKm / 3);
    const neighbors = neighborPoints.map(np => {
      const near = sensors.find(s => haversine(np.lat, np.lon, s.lat, s.lon) < 100);
      return { name: np.name, lat: np.lat, lon: np.lon, distanceKm: np.distanceKm, usvh: near ? near.usvh : BASELINE_USVH, status: classifyRadiation(near ? near.usvh : BASELINE_USVH), sensorName: near ? near.user : 'baseline' };
    });

    return { skill: 'radiation-monitor', location, fetchedAt: new Date().toISOString(), primary, neighbors, baseline: BASELINE_USVH, dataQuality, source: 'radmon' };
  } catch (err) {
    console.warn('[radiation-monitor] error, using demo:', err.message);
    return getDemoData(location);
  }
}

module.exports = { fetchRadiation };

if (require.main === module) {
  const args = process.argv.slice(2);
  const loc = args[args.indexOf('--location') + 1] || 'Mumbai, India';
  fetchRadiation({ location: loc }).then(r => console.log(JSON.stringify(r, null, 2))).catch(console.error);
}
