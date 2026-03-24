'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');

// AQI index descriptions per WMO European AQI standard
const AQI_LEVELS = [
  { max: 20,  label: 'Good',         color: '#34d399', icon: '😊' },
  { max: 40,  label: 'Fair',         color: '#86efac', icon: '🙂' },
  { max: 60,  label: 'Moderate',     color: '#fbbf24', icon: '😐' },
  { max: 80,  label: 'Poor',         color: '#fb923c', icon: '😷' },
  { max: 100, label: 'Very Poor',    color: '#f87171', icon: '🤢' },
  { max: Infinity, label: 'Hazardous', color: '#a78bfa', icon: '☠️' },
];

function classifyAQI(europeanAQI) {
  return AQI_LEVELS.find(l => europeanAQI <= l.max) || AQI_LEVELS[AQI_LEVELS.length - 1];
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
    skill: 'aqi-monitor', location, fetchedAt: new Date().toISOString(),
    current: {
      europeanAQI: 32, label: 'Fair', color: '#86efac', icon: '🙂',
      pm2_5: 12.4, pm10: 22.1, no2: 18.3, o3: 45.2, co: 0.24,
      dominantPollutant: 'PM2.5',
    },
    trend: 'stable',   // improving | worsening | stable
    alerts: [],
    source: 'demo',
  };
}

async function fetchAQI({ location, lat, lon }) {
  try {
    if (!lat || !lon) ({ lat, lon } = await geocode(location));

    const res = await axios.get('https://air-quality-api.open-meteo.com/v1/air-quality', {
      params: {
        latitude: lat, longitude: lon,
        current: 'european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide',
        hourly: 'european_aqi',
        timezone: 'auto', forecast_days: 1,
      },
      timeout: 8000,
    });

    const c = res.data.current;
    const aqi = c.european_aqi || 0;
    const level = classifyAQI(aqi);

    // Trend: compare first 3 vs last 3 hours
    const hourly = res.data.hourly?.european_aqi || [];
    let trend = 'stable';
    if (hourly.length >= 6) {
      const early = hourly.slice(0, 3).reduce((a, b) => a + (b || 0), 0) / 3;
      const late  = hourly.slice(-3).reduce((a, b) => a + (b || 0), 0) / 3;
      if (late - early > 5) trend = 'worsening';
      else if (early - late > 5) trend = 'improving';
    }

    const alerts = [];
    if (aqi >= 80) alerts.push({ type: 'POOR_AIR', severity: 'high', message: `AQI ${aqi} — Poor air quality. Limit outdoor exposure.` });
    else if (aqi >= 60) alerts.push({ type: 'MODERATE_AIR', severity: 'medium', message: `AQI ${aqi} — Moderate air quality. Sensitive groups take care.` });

    return {
      skill: 'aqi-monitor', location, fetchedAt: new Date().toISOString(),
      current: {
        europeanAQI: aqi,
        label: level.label, color: level.color, icon: level.icon,
        pm2_5: +(c.pm2_5 || 0).toFixed(1),
        pm10:  +(c.pm10 || 0).toFixed(1),
        no2:   +(c.nitrogen_dioxide || 0).toFixed(1),
        o3:    +(c.ozone || 0).toFixed(1),
        co:    +(c.carbon_monoxide || 0).toFixed(2),
        dominantPollutant: 'PM2.5',
      },
      trend, alerts, source: 'open-meteo-aq',
    };
  } catch (err) {
    console.warn('[aqi-monitor] error, using demo:', err.message);
    return getDemoData(location);
  }
}

module.exports = { fetchAQI };

if (require.main === module) {
  const args = process.argv.slice(2);
  const loc = args[args.indexOf('--location') + 1] || 'Mumbai, India';
  fetchAQI({ location: loc }).then(r => console.log(JSON.stringify(r, null, 2))).catch(console.error);
}
