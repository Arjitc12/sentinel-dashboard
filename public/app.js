'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   SENTINEL Dashboard — Frontend Application v2
   New features: Threat Level, AQI, Earthquakes, Map, Custom Keywords, Export
   ═══════════════════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  currentLocation: '',
  currentTimeline: '24h',
  data: null,
  newsFilter: 'all',
  notificationsEnabled: false,
  pollTimer: null,
  pollIntervalMs: 300000,
  sseSource: null,
  customKeywords: [],
  map: null,
  mapInitialized: false,
  mapVisible: false,
  mapMarkers: [],
};

const $ = id => document.getElementById(id);

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  connectSSE();
  loadLocationHistory();
  loadAlertHistory();
  loadCustomKeywords();

  $('locationInput').addEventListener('keydown', e => { if (e.key === 'Enter') startMonitor(); });
  $('keywordInput').addEventListener('keydown', e => { if (e.key === 'Enter') addKeyword(); });

  if (Notification.permission === 'granted') {
    state.notificationsEnabled = true;
    $('notifToggle').textContent = 'Enabled';
    $('notifToggle').classList.add('active');
  }

  fetch('/api/locations').then(r => r.json()).then(({ locations }) => {
    if (locations?.length) $('locationInput').value = locations[0].name;
  }).catch(() => {});
});

// ── Clock ─────────────────────────────────────────────────────────────────────
function startClock() {
  const update = () => {
    $('clockDisplay').textContent = new Date().toLocaleString('en-IN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short', hour12: false,
    });
  };
  update(); setInterval(update, 1000);
}

// ── SSE Connection ────────────────────────────────────────────────────────────
function connectSSE() {
  if (state.sseSource) state.sseSource.close();
  const es = new EventSource('/events');
  state.sseSource = es;
  es.onopen = () => setLiveStatus(true);
  es.onerror = () => { setLiveStatus(false); setTimeout(connectSSE, 5000); };
  es.onmessage = e => { try { const m = JSON.parse(e.data); if (m.type === 'alert') handleIncomingAlert(m); } catch {} };
}
function setLiveStatus(online) {
  const el = $('liveIndicator');
  el.className = `status-indicator ${online ? 'online' : 'offline'}`;
  el.querySelector('.status-text').textContent = online ? 'LIVE' : 'OFFLINE';
}

// ── Monitor ───────────────────────────────────────────────────────────────────
async function startMonitor() {
  const location = $('locationInput').value.trim();
  const timeline = $('timelineSelect').value;
  if (!location) { showToast('medium', '⚠️', 'No Location', 'Please enter a location to monitor.'); return; }

  state.currentLocation = location;
  state.currentTimeline = timeline;
  showLoading(true, 'Connecting to all intelligence feeds...');
  $('monitorBtn').classList.add('loading');
  $('monitorBtn').innerHTML = '<span class="btn-icon">⏳</span> ACQUIRING...';
  clearPollTimer();

  try {
    await fetchAndRender(location, timeline, false);
    schedulePoll();
  } catch (err) {
    showToast('critical', '❌', 'Fetch Failed', err.message);
  } finally {
    showLoading(false);
    $('monitorBtn').classList.remove('loading');
    $('monitorBtn').innerHTML = '<span class="btn-icon">⚡</span> MONITOR';
  }
}

async function fetchAndRender(location, timeline, forceRefresh = false) {
  const res = await fetch('/api/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location, timeline, forceRefresh, customKeywords: state.customKeywords }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  const data = await res.json();
  state.data = data;

  hideWelcome();
  renderThreatLevel(data.threatLevel);
  renderNews(data.news);
  renderWeather(data.weather);
  renderTraffic(data.traffic);
  renderRadiation(data.radiation);
  renderAQI(data.aqi);
  renderEarthquakes(data.earthquakes);
  updateMap(data);
  loadAlertHistory();
  loadLocationHistory();
}

// ── Poll Timer ─────────────────────────────────────────────────────────────────
function schedulePoll() {
  clearPollTimer();
  if (!state.pollIntervalMs || !state.currentLocation) return;
  state.pollTimer = setTimeout(async () => {
    try { await fetchAndRender(state.currentLocation, state.currentTimeline, true); } catch {}
    schedulePoll();
  }, state.pollIntervalMs);
}
function clearPollTimer() { if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null; } }
function updatePollInterval() {
  state.pollIntervalMs = parseInt($('pollInterval').value, 10);
  clearPollTimer();
  if (state.currentLocation) schedulePoll();
}

// ── Threat Level ──────────────────────────────────────────────────────────────
function renderThreatLevel(tl) {
  if (!tl) return;
  const widget = $('threatWidget');
  widget.style.display = 'flex';
  $('threatFill').style.width = `${tl.score}%`;
  $('threatFill').style.background = tl.color;
  const text = $('threatText');
  text.textContent = `${tl.level}  ${tl.score}`;
  text.style.color = tl.color;
  // Flash header border color for critical
  document.querySelector('.header').style.borderBottomColor = tl.score >= 80 ? tl.color : '';
}

// ── Render: News ──────────────────────────────────────────────────────────────
function renderNews(news) {
  const panel = $('newsPanel');
  panel.style.display = 'flex';
  if (!news || news.error) { $('newsList').innerHTML = `<div class="error-state">News unavailable: ${news?.error || ''}</div>`; return; }

  const high = news.summary?.highIntensity || 0;
  $('newsBadge').textContent = high > 0 ? `${high} HIGH` : '';
  $('newsBadge').style.display = high > 0 ? '' : 'none';
  $('newsMeta').textContent = `${news.summary?.total || 0} articles · ${news.source}`;

  filterNewsItems(news.items, state.newsFilter);
  updateTickerFromNews(news.items);
}

function filterNewsItems(items, filter) {
  state.newsFilter = filter;
  const filtered = filter === 'all' ? items : items.filter(i => i.category === filter);
  const list = $('newsList');
  if (!filtered.length) { list.innerHTML = '<div class="empty-state">No matching articles</div>'; return; }
  list.innerHTML = filtered.map(item => {
    const s = item.intensityScore;
    const cls = s >= 9 ? 'score-critical' : s >= 7 ? 'score-high' : s >= 5 ? 'score-medium' : '';
    const tags = (item.tags || []).slice(0, 3).map(t => `<span class="news-tag">${escHtml(t)}</span>`).join('');
    return `<div class="news-item ${cls}">
      <div class="news-item-header">
        <span class="news-score score-${s}">${s}/10</span>
        <span class="news-category">${(item.category||'other').replace(/_/g,' ')}</span>
        <span class="news-time">${formatTimeAgo(item.publishedAt)}</span>
      </div>
      <div class="news-title">${escHtml(item.title)}</div>
      ${item.description ? `<div class="news-desc">${escHtml(item.description)}</div>` : ''}
      <div class="news-footer">
        <span class="news-source">📡 ${escHtml(item.source)}</span>
        <div class="news-tags">${tags}</div>
        ${item.url && item.url !== '#' ? `<a href="${item.url}" target="_blank" class="news-source" style="margin-left:auto">↗ Read</a>` : ''}
      </div>
    </div>`;
  }).join('');
}
function filterNews(cat, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (state.data?.news) filterNewsItems(state.data.news.items || [], cat);
}

// ── Render: Weather ───────────────────────────────────────────────────────────
function renderWeather(weather) {
  $('weatherPanel').style.display = 'flex';
  if (!weather || weather.error) { $('weatherCurrent').innerHTML = `<div class="error-state">Weather unavailable</div>`; return; }
  const c = weather.current;
  $('weatherMeta').textContent = `via ${weather.source}`;
  $('weatherCurrent').innerHTML = `
    <div class="weather-main">
      <div class="weather-temp">${c.temp}</div><div class="weather-unit">°C</div>
    </div>
    <div class="weather-desc-block">
      <div class="weather-description">${weatherIcon(c.weatherCode)} ${c.description}</div>
      <div class="weather-feels">Feels like ${c.feelsLike}°C</div>
    </div>
    <div class="weather-stats">
      <div class="weather-stat"><span class="weather-stat-label">Humidity</span><span class="weather-stat-value">${c.humidity}%</span></div>
      <div class="weather-stat"><span class="weather-stat-label">Wind</span><span class="weather-stat-value">${c.windSpeed} km/h</span></div>
      <div class="weather-stat"><span class="weather-stat-label">Precip.</span><span class="weather-stat-value">${c.precipitation}mm</span></div>
      <div class="weather-stat"><span class="weather-stat-label">Visibility</span><span class="weather-stat-value">${c.visibility}km</span></div>
    </div>`;
  $('weatherAlerts').innerHTML = (weather.alerts||[]).map(a =>
    `<div class="weather-alert-item ${a.severity}">⚠ ${escHtml(a.type.replace(/_/g,' '))} — ${escHtml(a.message)}</div>`).join('');
  $('weatherForecast').innerHTML = (weather.forecast||[]).map(f =>
    `<div class="forecast-item">
      <div class="forecast-time">${formatHour(f.time)}</div>
      <div class="forecast-icon">${weatherIcon(f.weatherCode)}</div>
      <div class="forecast-temp">${f.temp}°</div>
      ${f.precipitation>0 ? `<div class="forecast-rain">💧${f.precipitation}mm</div>` : ''}
    </div>`).join('');
}

// ── Render: Traffic ───────────────────────────────────────────────────────────
function renderTraffic(traffic) {
  $('trafficPanel').style.display = 'flex';
  if (!traffic || traffic.error) { $('incidentList').innerHTML = `<div class="error-state">Traffic unavailable</div>`; return; }
  $('trafficMeta').textContent = `via ${traffic.source}`;
  const score = traffic.congestionScore || 0;
  const scoreColor = score>=8 ? 'var(--red)' : score>=5 ? 'var(--orange)' : score>=3 ? 'var(--amber)' : 'var(--green)';
  $('trafficScoreRow').innerHTML = `<div class="congestion-label">Congestion</div><div class="congestion-bar"><div class="congestion-fill" style="width:${score*10}%;background:${scoreColor}"></div></div><div class="congestion-score" style="color:${scoreColor}">${score}/10</div>`;
  $('trafficAnomaly').style.display = traffic.anomalyDetected ? '' : 'none';
  $('trafficAnomalyBanner').style.display = traffic.anomalyDetected ? '' : 'none';
  if (traffic.anomalyDetected) $('trafficAnomalyBanner').textContent = `🚨 ${traffic.anomalySummary}`;
  $('incidentList').innerHTML = (traffic.incidents||[]).length
    ? (traffic.incidents||[]).map(inc => `<div class="incident-item ${inc.anomaly?'anomaly':''}">
        <div class="incident-severity sev-${inc.severity}"></div>
        <div class="incident-body">
          <div class="incident-type">${escHtml(inc.type.replace(/_/g,' '))} ${inc.anomaly?`<span class="incident-anomaly-tag">⚠ ${inc.anomalyType}</span>`:''}</div>
          <div class="incident-desc">${escHtml(inc.description)}</div>
          ${inc.affectedRoads?.length?`<div class="incident-road">🛣 ${inc.affectedRoads.join(', ')}</div>`:''}
          ${inc.delay>0?`<div class="incident-delay">+${inc.delay} min delay</div>`:''}
        </div></div>`).join('')
    : '<div class="empty-state">No active incidents</div>';
}

// ── Render: Radiation ─────────────────────────────────────────────────────────
function renderRadiation(rad) {
  $('radiationPanel').style.display = 'flex';
  if (!rad || rad.error) { $('radiationPrimary').innerHTML = `<div class="error-state">Radiation data unavailable</div>`; return; }
  $('radiationMeta').textContent = `via ${rad.source}`;
  $('radiationQuality').textContent = rad.dataQuality?.toUpperCase() || '';
  const p = rad.primary;
  const circumference = 2 * Math.PI * 40;
  const pct = Math.min(100, (p.usvh / 2) * 100);
  const gaugeColor = { normal:'var(--green)', elevated:'var(--amber)', high:'var(--orange)', critical:'var(--red)' }[p.status] || 'var(--cyan)';
  $('radiationPrimary').innerHTML = `
    <div class="radiation-gauge">
      <svg class="gauge-svg" viewBox="0 0 100 100">
        <circle class="gauge-track" cx="50" cy="50" r="40"/>
        <circle class="gauge-fill" cx="50" cy="50" r="40" stroke="${gaugeColor}" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference-(pct/100)*circumference}"/>
      </svg>
      <div class="gauge-center"><div class="gauge-value" style="color:${gaugeColor}">${p.usvh.toFixed(3)}</div><div class="gauge-unit">µSv/h</div></div>
    </div>
    <div class="radiation-info">
      <div class="radiation-status status-${p.status}">${p.status.toUpperCase()}</div>
      <div class="radiation-sensor">📡 ${escHtml(p.sensorName)}${p.sensorDistanceKm?` (${p.sensorDistanceKm}km away)`:''}</div>
      <div class="radiation-quality">Baseline: ${rad.baseline} µSv/h · ${rad.dataQuality?.toUpperCase()}</div>
    </div>`;
  $('radiationNeighbors').innerHTML = `<table class="neighbor-table"><thead><tr><th>Region</th><th>Dist.</th><th>µSv/h</th><th>Status</th></tr></thead><tbody>${
    (rad.neighbors||[]).map(n=>`<tr><td>${escHtml(n.name)}</td><td>${n.distanceKm}km</td><td>${n.usvh.toFixed(3)}</td><td><span class="rad-status-pill pill-${n.status}">${n.status}</span></td></tr>`).join('')
  }</tbody></table>`;
}

// ── Render: AQI (NEW) ─────────────────────────────────────────────────────────
function renderAQI(aqi) {
  const panel = $('aqiPanel');
  panel.style.display = 'flex';
  if (!aqi || aqi.error) { $('aqiMain').innerHTML = `<div class="error-state">AQI unavailable</div>`; return; }
  $('aqiMeta').textContent = `via ${aqi.source}`;

  const c = aqi.current;
  const circumference = 2 * Math.PI * 35;
  const pct = Math.min(100, c.europeanAQI);
  const dashOffset = circumference - (pct / 100) * circumference;

  $('aqiBadge').style.display = c.europeanAQI >= 60 ? '' : 'none';
  $('aqiBadge').textContent = c.label;

  const trendIcon = { improving: '↗ improving', worsening: '↘ worsening', stable: '→ stable' }[aqi.trend] || '';
  const trendCls  = `trend-${aqi.trend || 'stable'}`;

  $('aqiMain').innerHTML = `
    <div class="aqi-gauge-wrap">
      <svg class="aqi-gauge-svg" viewBox="0 0 100 100">
        <circle class="aqi-gauge-bg" cx="50" cy="50" r="35" transform="rotate(-90 50 50)"/>
        <circle class="aqi-gauge-arc" cx="50" cy="50" r="35"
          stroke="${c.color}" transform="rotate(-90 50 50)"
          stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"/>
      </svg>
      <div class="aqi-gauge-center">
        <div class="aqi-gauge-value" style="color:${c.color}">${c.europeanAQI}</div>
        <div class="aqi-gauge-label">AQI</div>
      </div>
    </div>
    <div class="aqi-info">
      <div class="aqi-status" style="color:${c.color}">${c.icon} ${c.label}</div>
      <div class="aqi-dominant">Dominant: ${c.dominantPollutant}</div>
      <div class="aqi-trend ${trendCls}">${trendIcon}</div>
    </div>`;

  $('aqiPollutants').innerHTML = [
    { name: 'PM2.5', val: c.pm2_5, unit: 'µg/m³' },
    { name: 'PM10',  val: c.pm10,  unit: 'µg/m³' },
    { name: 'NO₂',  val: c.no2,   unit: 'µg/m³' },
    { name: 'O₃',   val: c.o3,    unit: 'µg/m³' },
  ].map(p => `<div class="pollutant-item">
    <div class="pollutant-name">${p.name}</div>
    <div class="pollutant-value">${p.val}</div>
    <div class="pollutant-unit">${p.unit}</div>
  </div>`).join('');
}

// ── Render: Earthquakes (NEW) ─────────────────────────────────────────────────
function renderEarthquakes(data) {
  const panel = $('earthquakePanel');
  panel.style.display = 'flex';
  if (!data || data.error) { $('earthquakeList').innerHTML = `<div class="error-state">Seismic data unavailable</div>`; return; }
  $('eqMeta').textContent = `Last 7 days · via ${data.source}`;

  const sig = (data.earthquakes||[]).filter(e => e.magnitude >= 3.0).length;
  $('eqBadge').style.display = sig > 0 ? '' : 'none';
  $('eqBadge').textContent = sig > 0 ? `${sig} SIGNIFICANT` : '';

  $('earthquakeList').innerHTML = (data.earthquakes||[]).length
    ? data.earthquakes.map(eq => `<div class="eq-item">
        <div class="eq-magnitude" style="color:${eq.color}">
          <div class="eq-mag-value">${eq.magnitude.toFixed(1)}</div>
          <div class="eq-mag-label">${eq.label}</div>
        </div>
        <div class="eq-body">
          <div class="eq-place">${escHtml(eq.place)}</div>
          <div class="eq-depth">Depth: ${eq.depth}km</div>
          <div class="eq-meta">${formatTimeAgo(eq.time)}</div>
        </div>
        <div class="eq-distance">${eq.distanceKm}km</div>
      </div>`).join('')
    : '<div class="empty-state">No seismic activity in range</div>';
}

// ── Interactive Map ───────────────────────────────────────────────────────────
function toggleMap() {
  state.mapVisible = !state.mapVisible;
  const panel = $('mapPanel');
  const btn = $('mapToggle');
  panel.style.display = state.mapVisible ? 'flex' : 'none';
  btn.textContent = state.mapVisible ? 'Hide' : 'Show';
  btn.classList.toggle('active', state.mapVisible);

  if (state.mapVisible) {
    if (!state.mapInitialized) initMap();
    else if (state.data) updateMap(state.data);
  }
}

function initMap() {
  if (state.mapInitialized) return;
  state.mapInitialized = true;

  const coords = state.data?.weather?.coordinates || { lat: 20.5937, lon: 78.9629 };
  state.map = L.map('leafletMap', { zoomControl: true, attributionControl: true }).setView([coords.lat, coords.lon], 10);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(state.map);

  if (state.data) updateMap(state.data);
}

function updateMap(data) {
  if (!state.mapInitialized || !state.map) return;

  // Clear previous markers
  state.mapMarkers.forEach(m => m.remove());
  state.mapMarkers = [];

  const coords = data.weather?.coordinates;
  if (!coords) return;

  // Center marker for location
  const centerMarker = L.marker([coords.lat, coords.lon], {
    icon: L.divIcon({ className: '', html: `<div style="width:16px;height:16px;background:var(--cyan);border-radius:50%;border:3px solid #fff;box-shadow:0 0 12px var(--cyan)"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] })
  }).addTo(state.map)
    .bindPopup(`<strong>📍 ${escHtml(data.location)}</strong><br>Monitoring center`);
  state.mapMarkers.push(centerMarker);
  state.map.setView([coords.lat, coords.lon], 11);

  // Traffic incident pins
  (data.traffic?.incidents || []).forEach(inc => {
    if (!inc.location?.lat) return;
    const color = inc.anomaly ? '#fb923c' : '#fbbf24';
    const pin = L.circleMarker([inc.location.lat, inc.location.lon], {
      radius: inc.anomaly ? 10 : 7, fillColor: color, color: '#fff', weight: 1.5, fillOpacity: 0.85
    }).addTo(state.map)
      .bindPopup(`<strong>🚦 ${escHtml(inc.type.replace(/_/g,' '))}</strong><br>${escHtml(inc.description)}${inc.delay > 0 ? `<br>+${inc.delay} min delay` : ''}`);
    state.mapMarkers.push(pin);
  });

  // Earthquake pins
  (data.earthquakes?.earthquakes || []).filter(e => e.magnitude >= 2.5).forEach(eq => {
    const radius = Math.max(6, eq.magnitude * 3);
    const pin = L.circleMarker([eq.lat, eq.lon], {
      radius, fillColor: eq.color, color: '#fff', weight: 1, fillOpacity: 0.7
    }).addTo(state.map)
      .bindPopup(`<strong>🌊 M${eq.magnitude.toFixed(1)} ${escHtml(eq.label)}</strong><br>${escHtml(eq.place)}<br>Depth: ${eq.depth}km · ${formatTimeAgo(eq.time)}`);
    state.mapMarkers.push(pin);
  });

  // Radiation neighbor pins
  (data.radiation?.neighbors || []).forEach(n => {
    if (!n.lat || !n.lon) return;
    const color = { normal: '#34d399', elevated: '#fbbf24', high: '#fb923c', critical: '#f87171' }[n.status] || '#94a3b8';
    const pin = L.circleMarker([n.lat, n.lon], {
      radius: 7, fillColor: color, color: '#fff', weight: 1, fillOpacity: 0.6, dashArray: '4 2'
    }).addTo(state.map)
      .bindPopup(`<strong>☢️ ${escHtml(n.name)}</strong><br>Radiation: ${n.usvh} µSv/h<br>Status: ${n.status}`);
    state.mapMarkers.push(pin);
  });

  $('mapBadge').style.display = state.mapMarkers.length > 1 ? '' : 'none';
  $('mapBadge').textContent = `${state.mapMarkers.length - 1} pins`;
  $('mapMeta').textContent = `${state.mapMarkers.length - 1} incident markers · scroll to zoom`;

  // Force Leaflet to recalculate size (in case panel was hidden)
  setTimeout(() => state.map.invalidateSize(), 100);
}

// ── Alert Ticker ──────────────────────────────────────────────────────────────
function updateTickerFromNews(items) {
  const high = items.filter(i => i.intensityScore >= 5);
  if (!high.length) return;
  const container = document.createElement('div');
  container.className = 'ticker-items-container';
  [...high, ...high].forEach(item => {
    const div = document.createElement('div');
    div.className = `ticker-item ${item.intensityScore >= 9 ? 'critical' : item.intensityScore >= 7 ? 'high' : 'medium'}`;
    div.textContent = `[${item.intensityScore}/10] ${item.title}`;
    container.appendChild(div);
  });
  const track = $('alertTicker');
  track.innerHTML = '';
  track.appendChild(container);
}

// ── Custom Keywords ───────────────────────────────────────────────────────────
function loadCustomKeywords() {
  try { state.customKeywords = JSON.parse(localStorage.getItem('sentinel_keywords') || '[]'); } catch { state.customKeywords = []; }
  renderKeywordChips();
}

function addKeyword() {
  const input = $('keywordInput');
  const kw = input.value.trim().toLowerCase();
  if (!kw || state.customKeywords.includes(kw)) { input.value = ''; return; }
  state.customKeywords.push(kw);
  localStorage.setItem('sentinel_keywords', JSON.stringify(state.customKeywords));
  renderKeywordChips();
  input.value = '';
  showToast('low', '🔍', 'Keyword Added', `Now tracking "${kw}" — re-monitor to apply.`);
}

function removeKeyword(kw) {
  state.customKeywords = state.customKeywords.filter(k => k !== kw);
  localStorage.setItem('sentinel_keywords', JSON.stringify(state.customKeywords));
  renderKeywordChips();
}

function renderKeywordChips() {
  $('keywordChips').innerHTML = state.customKeywords.map(kw =>
    `<div class="keyword-chip">${escHtml(kw)}<span class="keyword-remove" onclick="removeKeyword('${escHtml(kw)}')">✕</span></div>`
  ).join('');
}

// ── Export Report ─────────────────────────────────────────────────────────────
function exportReport() {
  if (!state.data) { showToast('medium', '⚠️', 'No Data', 'MONITOR a location first to generate a report.'); return; }

  const d = state.data;
  const tl = d.threatLevel || {};
  const lines = [
    `SENTINEL SITUATION REPORT`,
    `═══════════════════════════════════`,
    `Location  : ${d.location}`,
    `Timeline  : ${d.timeline}`,
    `Generated : ${new Date(d.fetchedAt).toLocaleString()}`,
    `Threat    : ${tl.level} (${tl.score}/100)`,
    ``,
    `── NEWS INTELLIGENCE ──────────────`,
    ...(d.news?.items || []).map(n => `[${n.intensityScore}/10] ${n.category}: ${n.title} (${n.source})`),
    ``,
    `── WEATHER ────────────────────────`,
    d.weather?.current ? `Temp: ${d.weather.current.temp}°C, Wind: ${d.weather.current.windSpeed}km/h, ${d.weather.current.description}` : 'N/A',
    ...(d.weather?.alerts || []).map(a => `  ⚠ ${a.type}: ${a.message}`),
    ``,
    `── TRAFFIC ────────────────────────`,
    `Congestion Score: ${d.traffic?.congestionScore || 0}/10`,
    d.traffic?.anomalyDetected ? `  ⚠ ANOMALY: ${d.traffic.anomalySummary}` : '  No anomalies',
    ...(d.traffic?.incidents || []).map(i => `  • ${i.type}: ${i.description}`),
    ``,
    `── RADIATION ──────────────────────`,
    `Primary: ${d.radiation?.primary?.usvh?.toFixed(3) || '?'} µSv/h (${d.radiation?.primary?.status || '?'})`,
    ...(d.radiation?.neighbors || []).map(n => `  ${n.name}: ${n.usvh?.toFixed(3)} µSv/h (${n.status})`),
    ``,
    `── AIR QUALITY ────────────────────`,
    d.aqi?.current ? `AQI: ${d.aqi.current.europeanAQI} — ${d.aqi.current.label} (${d.aqi.trend || 'stable'})` : 'N/A',
    ``,
    `── SEISMIC ACTIVITY ───────────────`,
    ...(d.earthquakes?.earthquakes || []).map(e => `M${e.magnitude.toFixed(1)} ${e.label} — ${e.place} (${e.distanceKm}km away)`),
    ``,
    `── ALERTS ─────────────────────────`,
    ...(d.alerts?.alerts || []).map(a => `[${a.severity.toUpperCase()}] ${a.title}: ${a.message}`),
    ``,
    `Source: SENTINEL Dashboard | https://localhost:3000`,
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sentinel-report-${d.location.replace(/[^a-z0-9]/gi,'_')}-${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('low', '📤', 'Report Exported', `Situation report downloaded for ${d.location}.`);
}

// ── Alert History & Locations ─────────────────────────────────────────────────
async function loadAlertHistory() {
  try {
    const { alerts, unreadCount } = await fetch('/api/alerts').then(r => r.json());
    const badge = $('unreadBadge');
    if (unreadCount > 0) { badge.textContent = unreadCount; badge.style.display = ''; }
    else badge.style.display = 'none';
    const log = $('alertLog');
    if (!alerts.length) { log.innerHTML = '<div class="empty-state">No alerts yet</div>'; return; }
    log.innerHTML = alerts.slice(0,20).map(a => `<div class="alert-log-item severity-${a.severity} ${!a.read?'unread':''}" title="${escHtml(a.message||'')}">
      <div class="alert-log-title">${escHtml(a.title)}</div>
      <div class="alert-log-time">${formatTimeAgo(a.timestamp)}</div>
    </div>`).join('');
  } catch {}
}
async function markAllRead() {
  await fetch('/api/alerts/read', { method: 'POST' }).catch(() => {});
  loadAlertHistory();
}

async function loadLocationHistory() {
  try {
    const { locations } = await fetch('/api/locations').then(r => r.json());
    const list = $('locationList');
    if (!locations.length) { list.innerHTML = '<div class="empty-state">No history yet</div>'; return; }
    list.innerHTML = locations.slice(0,10).map(loc =>
      `<div class="location-item" onclick="selectLocation('${escHtml(loc.name)}')">
        <span class="location-item-name">📍 ${escHtml(loc.name)}</span>
        <span class="location-item-count">×${loc.monitorCount}</span>
      </div>`).join('');
    setupSuggestions(locations.map(l => l.name));
  } catch {}
}
function selectLocation(name) { $('locationInput').value = name; startMonitor(); }

function setupSuggestions(names) {
  const input = $('locationInput'), sugs = $('locationSuggestions');
  input.removeEventListener('input', input._sugHandler);
  input._sugHandler = () => {
    const val = input.value.toLowerCase();
    const matches = names.filter(n => n.toLowerCase().includes(val) && n !== input.value);
    if (!matches.length || !val) { sugs.style.display = 'none'; return; }
    sugs.innerHTML = matches.slice(0,5).map(m => `<div class="suggestion-item" onclick="selectLocation('${escHtml(m)}')">${escHtml(m)}</div>`).join('');
    sugs.style.display = 'block';
  };
  input.addEventListener('input', input._sugHandler);
  document.addEventListener('click', e => { if (!e.target.closest('.input-group')) sugs.style.display = 'none'; });
}

// ── SSE Alert Handler ─────────────────────────────────────────────────────────
function handleIncomingAlert(alert) {
  const sevIcon = { critical:'🚨', high:'⚠️', medium:'⚡', low:'ℹ️' }[alert.severity] || '🔔';
  showToast(alert.severity, sevIcon, alert.title, alert.message);
  if (state.notificationsEnabled && Notification.permission === 'granted') {
    new Notification(`SENTINEL: ${alert.title}`, { body: alert.message, icon: '🛰️' });
  }
  loadAlertHistory();
}

// ── Notifications ─────────────────────────────────────────────────────────────
async function toggleNotifications() {
  if (state.notificationsEnabled) {
    state.notificationsEnabled = false;
    $('notifToggle').textContent = 'Enable'; $('notifToggle').classList.remove('active'); return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    state.notificationsEnabled = true;
    $('notifToggle').textContent = 'Enabled'; $('notifToggle').classList.add('active');
    showToast('medium', '🔔', 'Enabled', 'You\'ll receive alerts for critical events.');
  } else showToast('medium', '🚫', 'Blocked', 'Enable notifications in browser settings.');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(severity, icon, title, message, ms=6000) {
  const id = `toast-${Date.now()}`;
  const toast = document.createElement('div');
  toast.className = `toast ${severity}`; toast.id = id;
  toast.innerHTML = `<div class="toast-icon">${icon}</div><div class="toast-body"><div class="toast-title">${escHtml(title)}</div><div class="toast-msg">${escHtml(message)}</div></div><button class="toast-close" onclick="dismissToast('${id}')">✕</button>`;
  $('toastContainer').appendChild(toast);
  setTimeout(() => dismissToast(id), ms);
}
function dismissToast(id) {
  const el = document.getElementById(id);
  if (el) { el.style.animation = 'slide-in 0.2s ease reverse'; setTimeout(() => el.remove(), 200); }
}

// ── Loading / Welcome ─────────────────────────────────────────────────────────
function showLoading(show, sub = '') { $('loadingOverlay').style.display = show ? 'flex' : 'none'; if (sub) $('loadingSub').textContent = sub; }
function hideWelcome() { $('welcomePanel').style.display = 'none'; }

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatTimeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff/60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}
function formatHour(iso) { try { return new Date(iso).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:false }); } catch { return iso; } }
function weatherIcon(code) {
  if (code===0) return '☀️'; if (code<=3) return '⛅'; if (code<=48) return '🌫️';
  if (code<=67) return '🌧️'; if (code<=77) return '🌨️'; if (code<=82) return '🌦️'; if (code<=99) return '⛈️'; return '🌤️';
}
