'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const { orchestrate } = require('./orchestrator');
const memoryBank = require('../skills/memory-bank/skill');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── SSE clients registry ─────────────────────────────────────────────────────
const sseClients = new Set();

function broadcastAlert(alert) {
  const payload = `data: ${JSON.stringify(alert)}\n\n`;
  sseClients.forEach(res => { try { res.write(payload); } catch { sseClients.delete(res); } });
}

// ── SSE endpoint ─────────────────────────────────────────────────────────────
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Heartbeat every 30s
  const heartbeat = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); } }, 30000);

  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SENTINEL live feed connected' })}\n\n`);
  sseClients.add(res);

  req.on('close', () => { sseClients.delete(res); clearInterval(heartbeat); });
});

// ── API: Fetch status for a location ────────────────────────────────────────
app.post('/api/status', async (req, res) => {
  const { location, lat, lon, timeline = '24h', forceRefresh = false, customKeywords = [] } = req.body;
  if (!location) return res.status(400).json({ error: 'location is required' });
  try {
    const result = await orchestrate({ location, lat, lon, timeline, forceRefresh, customKeywords });
    // Broadcast any new alerts via SSE
    if (result.alerts?.hasNewAlerts) {
      result.alerts.alerts.forEach(alert => broadcastAlert({ type: 'alert', ...alert }));
    }
    res.json(result);
  } catch (err) {
    console.error('[server] orchestrate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── API: Get alert history ────────────────────────────────────────────────────
app.get('/api/alerts', (req, res) => {
  const alerts = memoryBank.get('alerts') || [];
  const unread = memoryBank.getUnreadCount();
  res.json({ alerts, unreadCount: unread });
});

// ── API: Mark alerts read ─────────────────────────────────────────────────────
app.post('/api/alerts/read', (req, res) => {
  memoryBank.markAlertsRead();
  res.json({ ok: true });
});

// ── API: Location history ─────────────────────────────────────────────────────
app.get('/api/locations', (req, res) => {
  res.json({ locations: memoryBank.get('locations') || [] });
});

// ── API: Get/set preferences ──────────────────────────────────────────────────
app.get('/api/preferences', (req, res) => {
  res.json({ preferences: memoryBank.get('preferences') });
});

app.post('/api/preferences', (req, res) => {
  const current = memoryBank.get('preferences');
  memoryBank.set('preferences', { ...current, ...req.body });
  res.json({ ok: true, preferences: memoryBank.get('preferences') });
});

// ── Serve frontend ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🛰️  SENTINEL Dashboard running at http://localhost:${PORT}`);
  console.log(`   SSE feed at http://localhost:${PORT}/events`);
  console.log(`   API docs: POST /api/status, GET /api/alerts, GET /api/locations\n`);
});
