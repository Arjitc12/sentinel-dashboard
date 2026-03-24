---
name: news-intel
description: |
  Fetches and scores high-intensity news for a given location and time window.
  Detects civil unrest, VIP movements, emergencies, and major security events.
  Returns an array of scored news items ready for dashboard display.
---

# News Intel Skill

## Input
```json
{
  "location": "Mumbai, India",
  "timeline": "24h",     // "1h" | "6h" | "24h" | "7d"
  "keywords": []         // optional extra keywords
}
```

## Output
```json
{
  "skill": "news-intel",
  "location": "Mumbai, India",
  "fetchedAt": "ISO timestamp",
  "items": [
    {
      "id": "unique-id",
      "title": "string",
      "description": "string",
      "url": "string",
      "source": "string",
      "publishedAt": "ISO timestamp",
      "intensityScore": 8,      // 1-10
      "category": "civil_unrest | vip_movement | emergency | traffic | other",
      "tags": ["riot", "police"],
      "imageUrl": "string | null"
    }
  ],
  "summary": {
    "total": 5,
    "highIntensity": 2,    // score >= 7
    "maxScore": 9
  },
  "source": "gnews | demo"
}
```

## Intensity Scoring
- Base score from keyword matching (each keyword = +1, max 5)
- Doubles if: title matches (vs body only)
- +3 if source is major outlet
- Category bonuses: civil_unrest +2, emergency +2, vip_movement +1

## High-Intensity Keywords Tracked
civil_unrest: riot, protest, unrest, clash, violence, mob, strike, siege, coup
vip_movement: VIP, convoy, motorcade, president, prime minister, security cordon, dignitary
emergency: explosion, blast, fire, collapse, accident, crash, evacuation, disaster
traffic: road closure, blockade, diversion, curfew

## Usage
```bash
node skills/news-intel/skill.js --test --location "Mumbai" --timeline "24h"
```
