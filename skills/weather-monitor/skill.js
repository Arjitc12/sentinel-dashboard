'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');

const WMO_DESCRIPTIONS = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Slight showers', 81: 'Moderate showers', 82: 'Violent showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm, heavy hail',
};

function describeCode(code) { return WMO_DESCRIPTIONS[code] || `Code ${code}`; }

/** Geocode a location string via Nominatim */
async function geocode(location) {
  const res = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: { q: location, format: 'json', limit: 1 },
    headers: { 'User-Agent': 'Sentinel-Dashboard/1.0' },
    timeout: 6000,
  });
  if (!res.data.length) throw new Error(`Could not geocode ${location}`);
  return { lat: parseFloat(res.data[0].lat), lon: parseFloat(res.data[0].lon) };
}

/** Derive weather alerts from current conditions */
function deriveAlerts(current) {
  const alerts = [];
  if (current.weatherCode >= 95) alerts.push({ type: 'THUNDERSTORM', severity: 'high', message: 'Active thunderstorm conditions' });
  if (current.windSpeed > 80) alerts.push({ type: 'EXTREME_WIND', severity: 'high', message: `Wind speed ${current.windSpeed} km/h — dangerous conditions` });
  else if (current.windSpeed > 50) alerts.push({ type: 'STRONG_WIND', severity: 'medium', message: `Wind speed ${current.windSpeed} km/h` });
  if (current.precipitation > 20) alerts.push({ type: 'HEAVY_RAIN', severity: 'high', message: `Heavy rainfall ${current.precipitation}mm/h` });
  if (current.visibility < 1) alerts.push({ type: 'LOW_VISIBILITY', severity: 'medium', message: `Visibility only ${current.visibility}km` });
  return alerts;
}

function getDemoData(location) {
  const current = { temp: 32, feelsLike: 36, humidity: 74, windSpeed: 18, windDirection: 220, precipitation: 0, weatherCode: 1, description: 'Mainly clear', visibility: 10, uvIndex: 7 };
  return {
    skill: 'weather-monitor', location,
    coordinates: { lat: 19.076, lon: 72.877 },
    fetchedAt: new Date().toISOString(),
    current, alerts: [],
    forecast: [
      { time: new Date(Date.now() + 3600000).toISOString(), temp: 31, precipitation: 0, weatherCode: 1, description: 'Mainly clear' },
      { time: new Date(Date.now() + 7200000).toISOString(), temp: 30, precipitation: 2, weatherCode: 80, description: 'Slight showers' },
      { time: new Date(Date.now() + 10800000).toISOString(), temp: 28, precipitation: 8, weatherCode: 81, description: 'Moderate showers' },
      { time: new Date(Date.now() + 14400000).toISOString(), temp: 27, precipitation: 1, weatherCode: 61, description: 'Slight rain' },
      { time: new Date(Date.now() + 18000000).toISOString(), temp: 29, precipitation: 0, weatherCode: 2, description: 'Partly cloudy' },
      { time: new Date(Date.now() + 21600000).toISOString(), temp: 31, precipitation: 0, weatherCode: 0, description: 'Clear sky' },
    ],
    source: 'demo',
  };
}

async function fetchWeather({ location, lat, lon }) {
  try {
    let coords = (lat && lon) ? { lat, lon } : await geocode(location);
    const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: coords.lat, longitude: coords.lon,
        current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code,visibility',
        hourly: 'temperature_2m,precipitation,weather_code',
        wind_speed_unit: 'kmh', timezone: 'auto', forecast_days: 1, forecast_hours: 6,
      },
      timeout: 8000,
    });

    const c = res.data.current;
    const current = {
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      windSpeed: Math.round(c.wind_speed_10m),
      windDirection: c.wind_direction_10m,
      precipitation: c.precipitation || 0,
      weatherCode: c.weather_code,
      description: describeCode(c.weather_code),
      visibility: (c.visibility || 10000) / 1000,
      uvIndex: null,
    };

    const hourly = res.data.hourly;
    const forecast = (hourly.time || []).slice(0, 6).map((t, i) => ({
      time: t, temp: Math.round(hourly.temperature_2m[i]),
      precipitation: hourly.precipitation[i] || 0,
      weatherCode: hourly.weather_code[i],
      description: describeCode(hourly.weather_code[i]),
    }));

    return {
      skill: 'weather-monitor', location, coordinates: coords,
      fetchedAt: new Date().toISOString(),
      current, alerts: deriveAlerts(current), forecast, source: 'open-meteo',
    };
  } catch (err) {
    console.warn('[weather-monitor] error, using demo:', err.message);
    return getDemoData(location);
  }
}

module.exports = { fetchWeather };

if (require.main === module) {
  const args = process.argv.slice(2);
  const loc = args[args.indexOf('--location') + 1] || 'Mumbai, India';
  fetchWeather({ location: loc }).then(r => console.log(JSON.stringify(r, null, 2))).catch(console.error);
}
