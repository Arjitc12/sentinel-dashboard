---
name: alert-engine
description: |
  Evaluates aggregated data from all skills and fires alerts when thresholds are crossed.
  Pushes alerts via Server-Sent Events (SSE) and stores them in the memory bank.
---

# Alert Engine Skill

## Input
Receives the full aggregated result from the orchestrator containing all skill outputs.

## Output
```json
{
  "skill": "alert-engine",
  "alerts": [
    {
      "id": "uuid",
      "timestamp": "ISO",
      "severity": "critical | high | medium | low",
      "category": "news | weather | traffic | radiation",
      "title": "string",
      "message": "string",
      "location": "string",
      "data": {}    // source skill data that triggered the alert
    }
  ],
  "hasNewAlerts": true
}
```

## Alert Thresholds
| Category  | Trigger Condition                              | Severity |
|-----------|------------------------------------------------|----------|
| News      | intensityScore >= 9                            | critical |
| News      | intensityScore >= 7                            | high     |
| News      | intensityScore >= 5                            | medium   |
| Weather   | Thunderstorm (code 95-99) or wind > 80 km/h   | high     |
| Weather   | Heavy rain > 20mm or wind > 50 km/h           | medium   |
| Traffic   | anomalyDetected = true                         | high     |
| Traffic   | congestionScore >= 8                           | medium   |
| Radiation | status = "critical"                            | critical |
| Radiation | status = "high"                               | high     |
| Radiation | status = "elevated"                           | medium   |

## Usage
```bash
node skills/alert-engine/skill.js --test
```
