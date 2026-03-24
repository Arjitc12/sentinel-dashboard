'use strict';

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../server/db.json');
const MAX_ALERTS = 100;

const DEFAULT_DB = {
  version: 1,
  locations: [],
  alerts: [],
  preferences: {
    defaultLocation: '',
    defaultTimeline: '24h',
    alertThresholds: { news: 7, congestion: 8, radiation: 'elevated' },
    browserNotifications: true,
    pollIntervalMs: 300000,
  },
  cache: { lastFetch: null, data: {} },
};

function load() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
      return JSON.parse(JSON.stringify(DEFAULT_DB));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    console.warn('[memory-bank] read error:', e.message);
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

function save(db) {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
  catch (e) { console.warn('[memory-bank] write error:', e.message); }
}

function get(key) { return load()[key]; }

function set(key, value) { const db = load(); db[key] = value; save(db); }

function addLocation(loc) {
  const db = load();
  const idx = db.locations.findIndex(l => l.name.toLowerCase() === loc.name.toLowerCase());
  if (idx >= 0) {
    db.locations[idx].lastMonitored = new Date().toISOString();
    db.locations[idx].monitorCount = (db.locations[idx].monitorCount || 0) + 1;
    if (loc.lat) db.locations[idx].lat = loc.lat;
    if (loc.lon) db.locations[idx].lon = loc.lon;
  } else {
    db.locations.unshift({ id: `loc-${Date.now()}`, addedAt: new Date().toISOString(), lastMonitored: new Date().toISOString(), monitorCount: 1, ...loc });
    if (db.locations.length > 20) db.locations.pop(); // keep last 20
  }
  save(db);
}

function addAlerts(newAlerts) {
  if (!newAlerts.length) return;
  const db = load();
  db.alerts = [...newAlerts, ...db.alerts].slice(0, MAX_ALERTS);
  save(db);
}

function markAlertsRead() {
  const db = load(); db.alerts.forEach(a => { a.read = true; }); save(db);
}

function getUnreadCount() { return load().alerts.filter(a => !a.read).length; }

function setCache(data) {
  const db = load();
  db.cache = { lastFetch: new Date().toISOString(), data };
  save(db);
}

function getCache(maxAgeMs = 5 * 60 * 1000) {
  const db = load();
  if (!db.cache.lastFetch) return null;
  const age = Date.now() - new Date(db.cache.lastFetch).getTime();
  return age < maxAgeMs ? db.cache.data : null;
}

function clearCache() { set('cache', { lastFetch: null, data: {} }); }

module.exports = { get, set, addLocation, addAlerts, markAlertsRead, getUnreadCount, setCache, getCache, clearCache };

if (require.main === module) {
  console.log('Memory Bank Test');
  addLocation({ name: 'Mumbai, India', lat: 19.076, lon: 72.877 });
  addLocation({ name: 'Delhi, India', lat: 28.613, lon: 77.209 });
  console.log('Locations:', get('locations'));
  addAlerts([{ id: 'test-1', timestamp: new Date().toISOString(), severity: 'high', category: 'news', title: 'Test Alert', message: 'Testing memory bank', location: 'Mumbai', read: false }]);
  console.log('Unread count:', getUnreadCount());
  markAlertsRead();
  console.log('After read, unread count:', getUnreadCount());
}
