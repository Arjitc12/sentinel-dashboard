'use strict';

const { v4: uuidv4 } = (() => { try { return require('crypto'); } catch { return { v4: () => Math.random().toString(36).slice(2) }; } })();
function genId() { try { return require('crypto').randomUUID(); } catch { return Math.random().toString(36).slice(2); } }

const THRESHOLDS = {
  news: { critical: 9, high: 7, medium: 5 },
  weather: { high: ['THUNDERSTORM', 'EXTREME_WIND'], medium: ['STRONG_WIND', 'HEAVY_RAIN', 'LOW_VISIBILITY'] },
  traffic: { high: 'anomaly', medium: 8 },
  radiation: { critical: 'critical', high: 'high', medium: 'elevated' },
};

/** Evaluate all skill results and produce alerts */
function evaluate({ news, weather, traffic, radiation, location }) {
  const alerts = [];
  const now = new Date().toISOString();

  // ── News alerts ─────────────────────────────────────────────────────────
  if (news?.items) {
    news.items.forEach(item => {
      let severity = null;
      if (item.intensityScore >= THRESHOLDS.news.critical) severity = 'critical';
      else if (item.intensityScore >= THRESHOLDS.news.high) severity = 'high';
      else if (item.intensityScore >= THRESHOLDS.news.medium) severity = 'medium';
      if (severity) {
        alerts.push({ id: genId(), timestamp: now, severity, category: 'news', title: `[News] ${item.title}`, message: item.description || item.title, location, data: { score: item.intensityScore, category: item.category } });
      }
    });
  }

  // ── Weather alerts ───────────────────────────────────────────────────────
  if (weather?.alerts) {
    weather.alerts.forEach(a => {
      const severity = THRESHOLDS.weather.high.includes(a.type) ? 'high' : 'medium';
      alerts.push({ id: genId(), timestamp: now, severity, category: 'weather', title: `[Weather] ${a.type.replace(/_/g, ' ')}`, message: a.message, location, data: a });
    });
  }

  // ── Traffic alerts ───────────────────────────────────────────────────────
  if (traffic) {
    if (traffic.anomalyDetected) {
      alerts.push({ id: genId(), timestamp: now, severity: 'high', category: 'traffic', title: '[Traffic] Anomaly Detected', message: traffic.anomalySummary, location, data: { anomalyType: traffic.anomalyType } });
    } else if (traffic.congestionScore >= THRESHOLDS.traffic.medium) {
      alerts.push({ id: genId(), timestamp: now, severity: 'medium', category: 'traffic', title: '[Traffic] High Congestion', message: `Congestion score ${traffic.congestionScore}/10`, location, data: { score: traffic.congestionScore } });
    }
  }

  // ── Radiation alerts ─────────────────────────────────────────────────────
  if (radiation?.primary) {
    const s = radiation.primary.status;
    if (s === 'critical') alerts.push({ id: genId(), timestamp: now, severity: 'critical', category: 'radiation', title: '[Radiation] CRITICAL Level', message: `${radiation.primary.usvh} µSv/h — immediate attention required`, location, data: radiation.primary });
    else if (s === 'high') alerts.push({ id: genId(), timestamp: now, severity: 'high', category: 'radiation', title: '[Radiation] High Level Detected', message: `${radiation.primary.usvh} µSv/h — above alert threshold`, location, data: radiation.primary });
    else if (s === 'elevated') alerts.push({ id: genId(), timestamp: now, severity: 'medium', category: 'radiation', title: '[Radiation] Elevated Level', message: `${radiation.primary.usvh} µSv/h — monitoring recommended`, location, data: radiation.primary });

    // Also check neighbors
    (radiation.neighbors || []).forEach(n => {
      if (n.status === 'critical' || n.status === 'high') {
        alerts.push({ id: genId(), timestamp: now, severity: n.status === 'critical' ? 'critical' : 'high', category: 'radiation', title: `[Radiation] ${n.status.toUpperCase()} — ${n.name}`, message: `Neighboring region ${n.name}: ${n.usvh} µSv/h`, location: n.name, data: n });
      }
    });
  }

  return { skill: 'alert-engine', alerts, hasNewAlerts: alerts.length > 0, evaluatedAt: now };
}

module.exports = { evaluate };

if (require.main === module) {
  // Test with synthetic data
  const testData = {
    location: 'Mumbai, India',
    news: { items: [{ intensityScore: 8, title: 'Test riot event', description: 'Test', category: 'civil_unrest' }] },
    weather: { alerts: [{ type: 'THUNDERSTORM', severity: 'high', message: 'Storm incoming' }] },
    traffic: { anomalyDetected: true, anomalySummary: 'VIP convoy suspected', anomalyType: 'vip_movement', congestionScore: 7 },
    radiation: { primary: { usvh: 0.12, status: 'normal', sensorName: 'TEST' }, neighbors: [] },
  };
  console.log(JSON.stringify(evaluate(testData), null, 2));
}
