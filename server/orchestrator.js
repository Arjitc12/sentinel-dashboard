'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { fetchNews }          = require('../skills/news-intel/skill');
const { fetchWeather }       = require('../skills/weather-monitor/skill');
const { fetchTraffic }       = require('../skills/traffic-intel/skill');
const { fetchRadiation }     = require('../skills/radiation-monitor/skill');
const { fetchAQI }           = require('../skills/aqi-monitor/skill');
const { fetchEarthquakes }   = require('../skills/earthquake-monitor/skill');
const { evaluate }           = require('../skills/alert-engine/skill');
const memoryBank             = require('../skills/memory-bank/skill');

const CACHE_TTL_MS = parseInt(process.env.POLL_INTERVAL_MS || '300000', 10);

/** Compute a composite SENTINEL threat level 0–100 across all signals */
function computeThreatLevel(result) {
  let score = 0;

  // News contribution (0-35)
  const maxNewsScore = result.news?.summary?.maxScore || 0;
  score += Math.min(35, maxNewsScore * 3.5);

  // Weather (0-20)
  const weatherAlerts = result.weather?.alerts?.length || 0;
  score += Math.min(20, weatherAlerts * 8);

  // Traffic (0-20)
  if (result.traffic?.anomalyDetected) score += 18;
  else score += Math.min(10, (result.traffic?.congestionScore || 0));

  // Radiation (0-15)
  const radStatus = result.radiation?.primary?.status;
  const radScores = { normal: 0, elevated: 6, high: 10, critical: 15 };
  score += radScores[radStatus] || 0;

  // AQI (0-5)
  const aqi = result.aqi?.current?.europeanAQI || 0;
  if (aqi >= 80) score += 5;
  else if (aqi >= 60) score += 3;

  // Earthquake (0-5)
  const maxMag = result.earthquakes?.summary?.maxMagnitude || 0;
  if (maxMag >= 5.0) score += 5;
  else if (maxMag >= 3.0) score += 2;

  score = Math.min(100, Math.round(score));

  let level, color;
  if (score >= 80)      { level = 'CRITICAL'; color = '#f87171'; }
  else if (score >= 60) { level = 'HIGH';     color = '#fb923c'; }
  else if (score >= 40) { level = 'ELEVATED'; color = '#fbbf24'; }
  else if (score >= 20) { level = 'GUARDED';  color = '#38bdf8'; }
  else                  { level = 'LOW';      color = '#34d399'; }

  return { score, level, color };
}

/** Run all skills in parallel and aggregate results */
async function orchestrate({ location, lat, lon, timeline = '24h', forceRefresh = false, customKeywords = [] }) {
  if (!forceRefresh) {
    const cached = memoryBank.getCache(CACHE_TTL_MS);
    if (cached && cached.location === location) {
      console.log(`[orchestrator] Serving cached data for ${location}`);
      return cached;
    }
  }

  console.log(`[orchestrator] Fetching fresh data for: ${location} (timeline: ${timeline})`);

  const [news, weather, traffic, radiation, aqi, earthquakes] = await Promise.allSettled([
    fetchNews({ location, timeline, keywords: customKeywords }),
    fetchWeather({ location, lat, lon }),
    fetchTraffic({ location, lat, lon }),
    fetchRadiation({ location, lat, lon }),
    fetchAQI({ location, lat, lon }),
    fetchEarthquakes({ location, lat, lon }),
  ]);

  const result = {
    location, timeline,
    fetchedAt: new Date().toISOString(),
    news:        news.status        === 'fulfilled' ? news.value        : { skill: 'news-intel', error: news.reason?.message },
    weather:     weather.status     === 'fulfilled' ? weather.value     : { skill: 'weather-monitor', error: weather.reason?.message },
    traffic:     traffic.status     === 'fulfilled' ? traffic.value     : { skill: 'traffic-intel', error: traffic.reason?.message },
    radiation:   radiation.status   === 'fulfilled' ? radiation.value   : { skill: 'radiation-monitor', error: radiation.reason?.message },
    aqi:         aqi.status         === 'fulfilled' ? aqi.value         : { skill: 'aqi-monitor', error: aqi.reason?.message },
    earthquakes: earthquakes.status === 'fulfilled' ? earthquakes.value : { skill: 'earthquake-monitor', error: earthquakes.reason?.message },
  };

  // Compute composite threat level
  result.threatLevel = computeThreatLevel(result);

  // Run alert engine
  const alertResult = evaluate({ location, ...result });
  result.alerts = alertResult;

  // Persist to memory bank
  memoryBank.setCache(result);
  memoryBank.addLocation({ name: location, lat, lon });
  if (alertResult.hasNewAlerts) memoryBank.addAlerts(alertResult.alerts);

  return result;
}

module.exports = { orchestrate };
