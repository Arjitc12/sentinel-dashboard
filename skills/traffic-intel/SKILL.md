---
name: traffic-intel
description: |
  Fetches real-time traffic incidents for a location using TomTom Traffic API.
  Detects anomalies like VIP-related road closures, major blockages, and unusual congestion patterns.
  Falls back to demo data without an API key.
---

# Traffic Intel Skill

## Input
```json
{
  "location": "Mumbai, India",
  "lat": 19.0760,
  "lon": 72.8777,
  "radiusKm": 10
}
```

## Output
```json
{
  "skill": "traffic-intel",
  "location": "Mumbai, India",
  "fetchedAt": "ISO timestamp",
  "incidents": [
    {
      "id": "string",
      "type": "closure | congestion | accident | hazard | construction",
      "severity": 1-4,
      "description": "string",
      "affectedRoads": ["NH 48"],
      "location": { "lat": 19.1, "lon": 72.8 },
      "startTime": "ISO",
      "delay": 15,           // minutes
      "anomaly": true,
      "anomalyType": "vip_movement | unusual_closure | perimeter"
    }
  ],
  "congestionScore": 6,     // 0-10
  "anomalyDetected": true,
  "anomalySummary": "Unusual road closures detected — possible VIP movement",
  "source": "tomtom | demo"
}
```

## Anomaly Detection Logic
- Multiple simultaneous closures on parallel routes → VIP convoy pattern
- Closures without construction or accident events → Security cordon
- Congestion score spike > 7 with no reported incidents → Crowd event
- Closures near government buildings / airports → Security alert

## Usage
```bash
node skills/traffic-intel/skill.js --test --location "Mumbai"
```
