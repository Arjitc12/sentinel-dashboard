'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');

const INCIDENT_TYPES = { 1: 'accident', 2: 'fog', 4: 'dangerous', 8: 'rain', 16: 'ice', 32: 'accident', 64: 'closure', 128: 'road_works' };
const TYPE_NAMES = { closure: 'Road Closure', accident: 'Accident', congestion: 'Congestion', hazard: 'Hazard', road_works: 'Road Works' };

/** Generate bounding box from lat/lon + radius in km */
function bbox(lat, lon, radiusKm) {
  const deg = radiusKm / 111;
  return `${lon - deg},${lat - deg},${lon + deg},${lat + deg}`;
}

/** Detect VIP / security anomaly patterns in incidents */
function detectAnomalies(incidents) {
  const closures = incidents.filter(i => i.type === 'closure');
  const accidents = incidents.filter(i => i.type === 'accident');

  if (closures.length >= 2 && accidents.length === 0) {
    return { detected: true, type: 'vip_movement', summary: `${closures.length} simultaneous road closures — possible VIP convoy or security cordon` };
  }
  if (closures.length >= 3) {
    return { detected: true, type: 'perimeter', summary: 'Multiple closures forming possible security perimeter' };
  }
  return { detected: false, type: null, summary: null };
}

function getDemoData(location) {
  const incidents = [
    { id: 'demo-t1', type: 'closure', severity: 3, description: 'Road closed — security operations in progress', affectedRoads: ['Marine Drive'], location: { lat: 18.94, lon: 72.82 }, startTime: new Date(Date.now() - 3600000).toISOString(), delay: 0, anomaly: true, anomalyType: 'vip_movement' },
    { id: 'demo-t2', type: 'closure', severity: 3, description: 'Alternate route also closed — convoy expected', affectedRoads: ['Pedder Road'], location: { lat: 18.97, lon: 72.80 }, startTime: new Date(Date.now() - 3600000).toISOString(), delay: 0, anomaly: true, anomalyType: 'vip_movement' },
    { id: 'demo-t3', type: 'accident', severity: 2, description: 'Minor collision — two lanes blocked', affectedRoads: ['Eastern Expressway'], location: { lat: 19.04, lon: 72.85 }, startTime: new Date(Date.now() - 1800000).toISOString(), delay: 12, anomaly: false, anomalyType: null },
  ];
  const anomaly = detectAnomalies(incidents);
  return {
    skill: 'traffic-intel', location, fetchedAt: new Date().toISOString(),
    incidents, congestionScore: 7,
    anomalyDetected: anomaly.detected, anomalySummary: anomaly.summary,
    source: 'demo',
  };
}

async function fetchTraffic({ location, lat, lon, radiusKm = 10 }) {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) return getDemoData(location);

  if (!lat || !lon) {
    try {
      const geo = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: { q: location, format: 'json', limit: 1 },
        headers: { 'User-Agent': 'Sentinel-Dashboard/1.0' }, timeout: 5000,
      });
      if (geo.data.length) { lat = parseFloat(geo.data[0].lat); lon = parseFloat(geo.data[0].lon); }
    } catch (e) { return getDemoData(location); }
  }

  try {
    const res = await axios.get(`https://api.tomtom.com/traffic/services/5/incidentDetails`, {
      params: { key: apiKey, bbox: bbox(lat, lon, radiusKm), fields: '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},from,to,length,delay,roadNumbers,timeValidity{startTime,endTime}}}}', language: 'en-GB', t: 1111, categoryFilter: '0,1,2,3,4,5,6,7,8,9,10,11,14' },
      timeout: 8000,
    });

    const raw = res.data.incidents || [];
    const incidents = raw.map(inc => {
      const p = inc.properties || {};
      const coords = inc.geometry?.coordinates;
      const incType = INCIDENT_TYPES[p.iconCategory] || 'hazard';
      return {
        id: p.id || `t-${Math.random()}`,
        type: incType,
        severity: p.magnitudeOfDelay || 1,
        description: (p.events || []).map(e => e.description).join('; ') || TYPE_NAMES[incType] || incType,
        affectedRoads: p.roadNumbers || [],
        location: coords ? { lat: coords[1], lon: coords[0] } : { lat, lon },
        startTime: p.timeValidity?.startTime || new Date().toISOString(),
        delay: Math.round((p.delay || 0) / 60),
        anomaly: false, anomalyType: null,
      };
    });

    const anomaly = detectAnomalies(incidents);
    incidents.forEach(i => { if (anomaly.detected) { i.anomaly = true; i.anomalyType = anomaly.type; } });

    const totalDelay = incidents.reduce((s, i) => s + i.delay, 0);
    const congestionScore = Math.min(10, Math.round((incidents.length * 0.5) + (totalDelay / 10)));

    return { skill: 'traffic-intel', location, fetchedAt: new Date().toISOString(), incidents, congestionScore, anomalyDetected: anomaly.detected, anomalySummary: anomaly.summary, source: 'tomtom' };
  } catch (err) {
    console.warn('[traffic-intel] API error, using demo:', err.message);
    return getDemoData(location);
  }
}

module.exports = { fetchTraffic };

if (require.main === module) {
  const args = process.argv.slice(2);
  const loc = args[args.indexOf('--location') + 1] || 'Mumbai, India';
  fetchTraffic({ location: loc }).then(r => console.log(JSON.stringify(r, null, 2))).catch(console.error);
}
