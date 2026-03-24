---
name: memory-bank
description: |
  Persistent JSON-based storage for location history, alert history, and user preferences.
  Used by all other skills to store and retrieve state across sessions.
---

# Memory Bank Skill

## Schema
```json
{
  "version": 1,
  "locations": [
    {
      "id": "uuid",
      "name": "Mumbai, India",
      "lat": 19.076,
      "lon": 72.877,
      "addedAt": "ISO",
      "lastMonitored": "ISO",
      "monitorCount": 5
    }
  ],
  "alerts": [
    {
      "id": "uuid",
      "timestamp": "ISO",
      "severity": "high",
      "category": "news",
      "title": "string",
      "message": "string",
      "location": "string",
      "read": false
    }
  ],
  "preferences": {
    "defaultLocation": "Mumbai, India",
    "defaultTimeline": "24h",
    "alertThresholds": {
      "news": 7,
      "congestion": 8,
      "radiation": "elevated"
    },
    "browserNotifications": true,
    "pollIntervalMs": 300000
  },
  "cache": {
    "lastFetch": "ISO",
    "data": {}
  }
}
```

## API
- `get(key)` → returns value at key
- `set(key, value)` → sets value
- `addLocation(locationObj)` → upserts location
- `addAlert(alertObj)` → prepends alert (max 100 stored)
- `markAlertsRead()` → marks all as read
- `getUnreadCount()` → returns count
- `clearCache()` → clears cached data

## Usage
```bash
node skills/memory-bank/skill.js --test
```
