'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');

// ── High-intensity keyword sets ─────────────────────────────────────────────
const KEYWORD_SETS = {
  civil_unrest: ['riot', 'protest', 'unrest', 'clash', 'violence', 'mob', 'strike', 'siege', 'coup', 'curfew', 'agitation', 'demonstration', 'uprising'],
  vip_movement: ['VIP', 'convoy', 'motorcade', 'president', 'prime minister', 'minister', 'dignitary', 'security cordon', 'state visit', 'official visit'],
  emergency:    ['explosion', 'blast', 'fire', 'collapse', 'accident', 'crash', 'evacuation', 'disaster', 'flood', 'earthquake', 'tsunami', 'cyclone'],
  traffic:      ['road closure', 'blockade', 'diversion', 'highway blocked', 'route closed', 'traffic jam', 'gridlock'],
};

const ALL_KEYWORDS = Object.values(KEYWORD_SETS).flat();

/** Maps WMO timeline string to GNews "from" param */
function timelineToFrom(timeline) {
  const now = new Date();
  const map = { '1h': 1, '6h': 6, '24h': 24, '7d': 168 };
  const hours = map[timeline] || 24;
  now.setHours(now.getHours() - hours);
  return now.toISOString().replace(/\.\d+Z$/, 'Z');
}

/** Score an article based on keyword, title, and source matching */
function scoreArticle(article, extraKeywords = []) {
  const text = `${article.title} ${article.description || ''}`.toLowerCase();
  const titleText = article.title.toLowerCase();

  let score = 0;
  let category = 'other';
  let tags = [];
  let maxCategoryScore = 0;

  Object.entries(KEYWORD_SETS).forEach(([cat, keywords]) => {
    let catScore = 0;
    keywords.forEach(kw => {
      if (text.includes(kw.toLowerCase())) {
        catScore += titleText.includes(kw.toLowerCase()) ? 2 : 1;
        tags.push(kw);
      }
    });
    if (catScore > maxCategoryScore) { maxCategoryScore = catScore; category = cat; }
    score += catScore;
  });

  extraKeywords.forEach(kw => { if (text.includes(kw.toLowerCase())) score += 1; });

  // Category bonuses
  if (category === 'civil_unrest' || category === 'emergency') score += 2;
  if (category === 'vip_movement') score += 1;

  return { score: Math.min(10, score), category, tags: [...new Set(tags)] };
}

/** Demo data when no API key is configured */
function getDemoData(location, timeline) {
  return {
    skill: 'news-intel',
    location,
    fetchedAt: new Date().toISOString(),
    items: [
      {
        id: 'demo-1', title: `Large protest reported near city center in ${location}`,
        description: 'Hundreds gather as tensions rise following local disputes. Police deployed.',
        url: '#', source: 'DemoNews', publishedAt: new Date(Date.now() - 3600000).toISOString(),
        intensityScore: 8, category: 'civil_unrest', tags: ['protest', 'police'], imageUrl: null,
      },
      {
        id: 'demo-2', title: `VIP convoy expected to pass through ${location} this afternoon`,
        description: 'Security forces have established perimeter on main arterial road. Expect closures.',
        url: '#', source: 'DemoNews', publishedAt: new Date(Date.now() - 7200000).toISOString(),
        intensityScore: 6, category: 'vip_movement', tags: ['convoy', 'security cordon'], imageUrl: null,
      },
      {
        id: 'demo-3', title: `Minor traffic disruption due to construction works near ${location}`,
        description: 'Work on the elevated highway causing moderate delays on alternate routes.',
        url: '#', source: 'DemoNews', publishedAt: new Date(Date.now() - 10800000).toISOString(),
        intensityScore: 2, category: 'traffic', tags: ['road closure'], imageUrl: null,
      },
    ],
    summary: { total: 3, highIntensity: 1, maxScore: 8 },
    source: 'demo',
  };
}

/** Main fetch function */
async function fetchNews({ location, timeline = '24h', keywords = [] }) {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) return getDemoData(location, timeline);

  try {
    const searchTerms = [...ALL_KEYWORDS.slice(0, 6), ...keywords, location].join(' OR ');
    const from = timelineToFrom(timeline);

    const res = await axios.get('https://gnews.io/api/v4/search', {
      params: { q: searchTerms, lang: 'en', country: 'any', from, max: 20, apikey: apiKey },
      timeout: 8000,
    });

    const articles = (res.data.articles || []).map((a, i) => {
      const { score, category, tags } = scoreArticle(a, keywords);
      return {
        id: `gnews-${i}`, title: a.title, description: a.description,
        url: a.url, source: a.source?.name || 'Unknown',
        publishedAt: a.publishedAt, intensityScore: score,
        category, tags, imageUrl: a.image || null,
      };
    }).filter(a => a.intensityScore > 0)
      .sort((a, b) => b.intensityScore - a.intensityScore);

    const highIntensity = articles.filter(a => a.intensityScore >= 7).length;
    return {
      skill: 'news-intel', location,
      fetchedAt: new Date().toISOString(), items: articles,
      summary: { total: articles.length, highIntensity, maxScore: articles[0]?.intensityScore || 0 },
      source: 'gnews',
    };
  } catch (err) {
    console.warn('[news-intel] API error, falling back to demo:', err.message);
    return getDemoData(location, timeline);
  }
}

module.exports = { fetchNews };

// ── CLI test mode ────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const loc = args[args.indexOf('--location') + 1] || 'Mumbai, India';
  const tl  = args[args.indexOf('--timeline') + 1] || '24h';
  fetchNews({ location: loc, timeline: tl })
    .then(r => { console.log(JSON.stringify(r, null, 2)); })
    .catch(console.error);
}
