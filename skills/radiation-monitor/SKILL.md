---
name: radiation-monitor
description: |
  Fetches radiation (background gamma) levels for a location and neighboring regions.
  Uses Radmon.org for crowdsourced sensor data. Returns µSv/h readings with status classification.
  Shows coverage for the primary location and neighbors within 200km.
---

# Radiation Monitor Skill

## Input
```json
{
  "location": "Mumbai, India",
  "lat": 19.0760,
  "lon": 72.8777,
  "neighborRadiusKm": 200
}
```

## Output
```json
{
  "skill": "radiation-monitor",
  "location": "Mumbai, India",
  "fetchedAt": "ISO timestamp",
  "primary": {
    "usvh": 0.12,
    "status": "normal",      // normal | elevated | high | critical
    "sensorName": "MUM-001",
    "sensorDistanceKm": 2.4,
    "lastUpdate": "ISO"
  },
  "neighbors": [
    {
      "name": "Pune",
      "lat": 18.52, "lon": 73.85,
      "distanceKm": 148,
      "usvh": 0.09,
      "status": "normal",
      "sensorName": "PUN-002"
    }
  ],
  "baseline": 0.10,          // global background average µSv/h
  "dataQuality": "live | estimated | baseline",
  "source": "radmon | demo"
}
```

## Status Thresholds (µSv/h)
- normal: < 0.3 (natural background)
- elevated: 0.3 – 1.0 (worth monitoring)
- high: 1.0 – 10.0 (alert threshold — notify)
- critical: > 10.0 (emergency)

## Data Quality Labels
- live: active sensor data received
- estimated: sensor coverage but stale (>1hr)
- baseline: no nearby sensor — using natural background baseline

## Usage
```bash
node skills/radiation-monitor/skill.js --test --location "Mumbai"
```
