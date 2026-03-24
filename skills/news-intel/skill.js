'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');

// ── High-intensity keyword sets ─────────────────────────────────────────────
const KEYWORD_SETS = {
  civil_unrest: ['riot', 'protest', 'unrest', 'clash', 'violence', 'mob', 'strike', 'siege', 'coup', 'curfew', 'agitation', 'demonstration', 'uprising', 'bandh', 'hartaal'],
  vip_movement: ['VIP', 'convoy', 'motorcade', 'president', 'prime minister', 'minister', 'dignitary', 'security cordon', 'state visit', 'official visit', 'VVIP'],
  emergency:    ['explosion', 'blast', 'fire', 'collapse', 'accident', 'crash', 'evacuation', 'disaster', 'flood', 'earthquake', 'tsunami', 'cyclone', 'landslide', 'rescue'],
  traffic:      ['road closure', 'blockade', 'diversion', 'highway blocked', 'route closed', 'traffic jam', 'gridlock'],
};

const ALL_KEYWORDS = Object.values(KEYWORD_SETS).flat();

function timelineToFrom(timeline) {
  const now = new Date();
  const map = { '1h': 1, '6h': 6, '24h': 24, '7d': 168 };
  now.setHours(now.getHours() - (map[timeline] || 24));
  return now;
}

function scoreArticle(article, extraKeywords = []) {
  const text = `${article.title} ${article.description || ''}`.toLowerCase();
  const titleText = article.title.toLowerCase();
  let score = 0, category = 'other', tags = [], maxCategoryScore = 0;

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
  if (category === 'civil_unrest' || category === 'emergency') score += 2;
  if (category === 'vip_movement') score += 1;

  return { score: Math.min(10, Math.max(1, score)), category, tags: [...new Set(tags)] };
}

/** Zero-dependency RSS item extractor using regex */
function parseRSSItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  const extract = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
    return m ? (m[1] || m[2] || '').trim() : '';
  };

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title       = extract(block, 'title');
    const link        = extract(block, 'link') || block.match(/<link[^>]*\/?>([^<]+)/i)?.[1] || '#';
    const pubDate     = extract(block, 'pubDate');
    const description = extract(block, 'description').replace(/<[^>]+>/g, '').trim();
    const sourceMatch = block.match(/<source[^>]*>([^<]+)<\/source>/i) || block.match(/<source[^>]+url="[^"]*"[^>]*>([^<]+)<\/source>/i);
    const source      = sourceMatch ? sourceMatch[1].trim() : 'Google News';

    if (title) items.push({ title, link, pubDate, description: description.slice(0, 200), source });
  }
  return items;
}

/** Fetch real news via Google News RSS — no API key required */
async function fetchGoogleNewsRSS(location, timeline, extraKeywords = []) {
  const query = encodeURIComponent(`${location} (${ALL_KEYWORDS.slice(0, 10).join(' OR ')})`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;

  const res = await axios.get(url, {
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sentinel/1.0; RSS reader)' },
  });

  const rawItems = parseRSSItems(res.data);
  const cutoff = timelineToFrom(timeline).getTime();
  const locationTokens = location.toLowerCase().split(/[\s,]+/).filter(t => t.length > 2);

  return rawItems
    .map((item, i) => {
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      const { score, category, tags } = scoreArticle({ title: item.title, description: item.description }, extraKeywords);
      return {
        id: `gnrss-${i}`,
        title: item.title.replace(/\s*-\s*[^-]+$/, '').trim(), // remove "- Publisher" at end
        description: item.description,
        url: item.link,
        source: item.source,
        publishedAt: pubDate.toISOString(),
        intensityScore: score,
        category, tags, imageUrl: null,
      };
    })
    .filter(a => {
      const text = `${a.title} ${a.description}`.toLowerCase();
      const mentionsLocation = locationTokens.some(t => text.includes(t));
      const isRecent = new Date(a.publishedAt).getTime() >= cutoff;
      return isRecent && (mentionsLocation || a.intensityScore >= 4);
    })
    .sort((a, b) => b.intensityScore - a.intensityScore)
    .slice(0, 20);
}

/** Fetch via GNews paid key */
async function fetchGNews(location, timeline, apiKey, extraKeywords = []) {
  const res = await axios.get('https://gnews.io/api/v4/search', {
    params: {
      q: [...ALL_KEYWORDS.slice(0, 6), ...extraKeywords, location].join(' OR '),
      lang: 'en', from: timelineToFrom(timeline).toISOString(), max: 20, apikey: apiKey,
    },
    timeout: 8000,
  });
  return (res.data.articles || []).map((a, i) => {
    const { score, category, tags } = scoreArticle(a, extraKeywords);
    return { id: `gnews-${i}`, title: a.title, description: a.description, url: a.url, source: a.source?.name || 'Unknown', publishedAt: a.publishedAt, intensityScore: score, category, tags, imageUrl: a.image || null };
  }).filter(a => a.intensityScore > 0).sort((a, b) => b.intensityScore - a.intensityScore);
}

/** Main — tries Google News RSS first (free, real), then GNews key, then demo */
async function fetchNews({ location, timeline = '24h', keywords = [] }) {
  // 1) Google News RSS — always try first
  try {
    const articles = await fetchGoogleNewsRSS(location, timeline, keywords);
    if (articles.length > 0) {
      const highIntensity = articles.filter(a => a.intensityScore >= 7).length;
      return {
        skill: 'news-intel', location, fetchedAt: new Date().toISOString(),
        items: articles,
        summary: { total: articles.length, highIntensity, maxScore: articles[0]?.intensityScore || 0 },
        source: 'google-news',
      };
    }
    console.warn('[news-intel] Google News returned 0 relevant articles, trying fallback');
  } catch (err) {
    console.warn('[news-intel] Google News RSS error:', err.message);
  }

  // 2) GNews API key
  const apiKey = process.env.GNEWS_API_KEY;
  if (apiKey) {
    try {
      const articles = await fetchGNews(location, timeline, apiKey, keywords);
      if (articles.length > 0) {
        return {
          skill: 'news-intel', location, fetchedAt: new Date().toISOString(),
          items: articles,
          summary: { total: articles.length, highIntensity: articles.filter(a => a.intensityScore >= 7).length, maxScore: articles[0]?.intensityScore || 0 },
          source: 'gnews',
        };
      }
    } catch (err) {
      console.warn('[news-intel] GNews API error:', err.message);
    }
  }

  // 3) Demo fallback
  console.warn('[news-intel] All sources failed — returning demo');
  return {
    skill: 'news-intel', location, fetchedAt: new Date().toISOString(),
    items: [
      { id: 'demo-1', title: `Security alert near ${location}`, description: 'Police deployed, situation being monitored.', url: '#', source: 'Demo', publishedAt: new Date(Date.now() - 3600000).toISOString(), intensityScore: 7, category: 'civil_unrest', tags: ['police'], imageUrl: null },
      { id: 'demo-2', title: `VIP convoy through ${location} today`, description: 'Route diversions expected on arterial roads.', url: '#', source: 'Demo', publishedAt: new Date(Date.now() - 7200000).toISOString(), intensityScore: 5, category: 'vip_movement', tags: ['convoy'], imageUrl: null },
    ],
    summary: { total: 2, highIntensity: 1, maxScore: 7 },
    source: 'demo',
  };
}

module.exports = { fetchNews };

if (require.main === module) {
  const args = process.argv.slice(2);
  const loc = args[args.indexOf('--location') + 1] || 'Mumbai, India';
  const tl  = args[args.indexOf('--timeline') + 1] || '24h';
  fetchNews({ location: loc, timeline: tl }).then(r => {
    console.log(`Source: ${r.source} | Articles: ${r.items.length}`);
    r.items.slice(0, 5).forEach(a => console.log(`  [${a.intensityScore}/10] ${a.title}`));
  }).catch(console.error);
}
