---
name: weather-monitor
description: |
  Fetches current weather and short-term forecast for a location using Open-Meteo.
  No API key required. Detects severe weather conditions automatically.
---

# Weather Monitor Skill

## Input
```json
{
  "location": "Mumbai, India",
  "lat": 19.0760,    // optional — will geocode from location if not provided
  "lon": 72.8777
}
```

## Output
```json
{
  "skill": "weather-monitor",
  "location": "Mumbai, India",
  "coordinates": { "lat": 19.076, "lon": 72.877 },
  "fetchedAt": "ISO timestamp",
  "current": {
    "temp": 32,           // Celsius
    "feelsLike": 36,
    "humidity": 78,       // %
    "windSpeed": 24,      // km/h
    "windDirection": 220, // degrees
    "precipitation": 0,   // mm
    "weatherCode": 0,
    "description": "Clear sky",
    "visibility": 10,     // km
    "uvIndex": 7
  },
  "forecast": [
    { "time": "ISO", "temp": 30, "precipitation": 5, "weatherCode": 80 }
  ],
  "alerts": [
    { "type": "STORM", "severity": "high", "message": "Heavy rainfall expected" }
  ],
  "source": "open-meteo | demo"
}
```

## Weather Codes (WMO Standard)
- 0: Clear sky
- 45-48: Fog
- 51-67: Rain/Drizzle
- 71-77: Snow
- 80-82: Showers
- 95-99: Thunderstorm

## Alert Triggers
- Wind speed > 50 km/h → STRONG_WIND
- Precipitation > 20mm/h → HEAVY_RAIN
- Weather code 95-99 → THUNDERSTORM
- Visibility < 1km → LOW_VISIBILITY

## Usage
```bash
node skills/weather-monitor/skill.js --test --location "Mumbai"
```
