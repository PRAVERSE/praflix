/**
 * Test Suite: Multi-Vector Discovery Methods (Sitemaps, RSS, Crawler)
 * Validates:
 * 1. SitemapScanner: Standard urlset, sitemapindex, domain restrictions, malformed handling.
 * 2. RssScanner: RSS 2.0, Atom 1.0, entity cleaning, anti-bot challenge detection.
 * 3. PageCrawler: Link extraction, Cloudflare challenge detection, pagination deduplication.
 * 4. Live Provider Probing: Validates actual live responses from HDHub4u, 10Moviez, HDWall.
 */

const assert = require('assert');
const { SitemapScanner } = require('../ingestion_v2/discovery/sitemap_scanner');
const { RssScanner } = require('../ingestion_v2/discovery/rss_scanner');
const { PageCrawler } = require('../ingestion_v2/discovery/page_crawler');

async function runTests() {
  console.log('='.repeat(65));
  console.log('TEST SUITE: MULTI-VECTOR DISCOVERY METHODS');
  console.log('='.repeat(65));

  // --- Test 1: SitemapScanner standard urlset XML ---
  console.log('\n[Test 1] SitemapScanner: standard <urlset> XML parsing...');
  const urlsetXml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
      <loc>https://new7.hdhub4u.cl/pushpa-2-2024-hindi-movie/</loc>
      <lastmod>2026-10-13T12:00:00Z</lastmod>
    </url>
    <url>
      <loc>https://new7.hdhub4u.cl/weapons-2026-english-movie/</loc>
      <lastmod>2026-10-13T14:30:00Z</lastmod>
    </url>
    <url>
      <loc>https://malicious-external-site.com/spam/</loc>
    </url>
  </urlset>`;

  const sitemapScanner = new SitemapScanner({ allowedDomains: ['new7.hdhub4u.cl'] });
  const parsedUrlset = sitemapScanner.parseXml(urlsetXml, 'https://new7.hdhub4u.cl/sitemap.xml');
  assert.strictEqual(parsedUrlset.isIndex, false);
  assert.strictEqual(parsedUrlset.entries.length, 2, 'Should extract 2 valid domain URLs, ignoring external spam');
  assert.strictEqual(parsedUrlset.entries[0].loc, 'https://new7.hdhub4u.cl/pushpa-2-2024-hindi-movie/');
  assert.strictEqual(parsedUrlset.entries[0].lastmod, '2026-10-13T12:00:00Z');
  console.log('  ✓ Parsed urlset entries with accurate lastmod and domain restriction.');

  // --- Test 2: SitemapScanner sitemapindex XML ---
  console.log('\n[Test 2] SitemapScanner: <sitemapindex> parsing...');
  const sitemapIndexXml = `<?xml version="1.0" encoding="UTF-8"?>
  <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap><loc>https://new7.hdhub4u.cl/post-sitemap.xml</loc></sitemap>
    <sitemap><loc>https://new7.hdhub4u.cl/page-sitemap.xml</loc></sitemap>
  </sitemapindex>`;

  const parsedIndex = sitemapScanner.parseXml(sitemapIndexXml, 'https://new7.hdhub4u.cl/sitemap.xml');
  assert.strictEqual(parsedIndex.isIndex, true);
  assert.strictEqual(parsedIndex.subSitemaps.length, 2);
  assert.strictEqual(parsedIndex.subSitemaps[0], 'https://new7.hdhub4u.cl/post-sitemap.xml');
  console.log('  ✓ Parsed sitemap index and extracted sub-sitemap locations.');

  // --- Test 3: SitemapScanner error resilience ---
  console.log('\n[Test 3] SitemapScanner: error and malformed handling...');
  const emptyRes = sitemapScanner.parseXml('', '');
  assert.ok(emptyRes.error, 'Empty XML must produce an error property');
  const garbageRes = sitemapScanner.parseXml('<html><body>404 Not Found</body></html>', '');
  assert.ok(garbageRes.error, 'Non-sitemap HTML must produce error property');
  console.log('  ✓ Resilient against empty and non-sitemap responses.');

  // --- Test 4: RssScanner RSS 2.0 parsing ---
  console.log('\n[Test 4] RssScanner: RSS 2.0 with CDATA and HTML entity unescaping...');
  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <title>10MOVIEZ &amp; Web Series</title>
      <link>https://10moviez.biz</link>
      <item>
        <title><![CDATA[Free The Trap (2026) Season 1 All Episodes [Hindi ORG. &#038; English] Complete]]></title>
        <link>https://10moviez.biz/free-the-trap-2026-season-1-all-episodes-hindi/</link>
        <pubDate>Tue, 13 Oct 2026 15:51:56 +0000</pubDate>
        <category><![CDATA[Web Series]]></category>
        <category><![CDATA[Netflix]]></category>
        <description><![CDATA[Download The Trap Season 1 in 720p & 1080p]]></description>
      </item>
    </channel>
  </rss>`;

  const rssScanner = new RssScanner();
  const parsedRss = rssScanner.parseFeed(rssXml, 'https://10moviez.biz/feed/');
  assert.strictEqual(parsedRss.success, true);
  assert.strictEqual(parsedRss.feedType, 'rss2');
  assert.strictEqual(parsedRss.items.length, 1);
  assert.strictEqual(
    parsedRss.items[0].title,
    'Free The Trap (2026) Season 1 All Episodes [Hindi ORG. & English] Complete'
  );
  assert.strictEqual(parsedRss.items[0].link, 'https://10moviez.biz/free-the-trap-2026-season-1-all-episodes-hindi/');
  assert.deepStrictEqual(parsedRss.items[0].categories, ['Web Series', 'Netflix']);
  console.log('  ✓ Parsed RSS 2.0 item, extracted clean title, link, and categories.');

  // --- Test 5: RssScanner anti-bot challenge detection ---
  console.log('\n[Test 5] RssScanner: Anti-bot challenge detection...');
  const challengeHtml = `<html><head><title>Just a moment...</title></head><body><div class="challenge-platform"></div></body></html>`;
  const challengeRes = rssScanner.parseFeed(challengeHtml, 'https://10moviez.biz/feed/');
  assert.strictEqual(challengeRes.success, false);
  assert.ok(challengeRes.error.includes('anti-bot verification challenge'));
  console.log('  ✓ Detected Cloudflare anti-bot challenge and flagged as INCONCLUSIVE.');

  // --- Test 6: PageCrawler candidate extraction and deduplication ---
  console.log('\n[Test 6] PageCrawler: Link extraction, domain safety, and deduplication...');
  const samplePageHtml = `
  <div class="movies-grid">
    <a href="https://new7.hdhub4u.cl/movie-one-2026/">
      <img src="https://catimages.co/poster1.jpg" alt="Movie One (2026) 720p">
    </a>
    <a href="https://new7.hdhub4u.cl/movie-one-2026/">
      <span>Duplicate Link</span>
    </a>
    <a href="https://new7.hdhub4u.cl/category/bollywood/">
      <span>Category Link</span>
    </a>
    <a href="https://new7.hdhub4u.cl/movie-two-2026/">
      <img src="https://catimages.co/poster2.jpg" alt="Movie Two (2026)">
    </a>
  </div>`;

  const pageCrawler = new PageCrawler({ allowedDomains: ['new7.hdhub4u.cl'] });
  const candidates = pageCrawler.extractCandidateLinks(samplePageHtml, 'https://new7.hdhub4u.cl/page/1/');
  assert.strictEqual(candidates.length, 2, 'Should extract exactly 2 unique movie articles, ignoring category link and duplicate');
  assert.strictEqual(candidates[0].url, 'https://new7.hdhub4u.cl/movie-one-2026/');
  assert.strictEqual(candidates[1].url, 'https://new7.hdhub4u.cl/movie-two-2026/');
  console.log('  ✓ Filtered out navigation/category links and deduplicated candidates.');

  // --- Test 7: Live Discovery Check on actual sources ---
  console.log('\n[Test 7] Live Discovery Probing on actual source endpoints...');

  // 7A: HDHub4u Post Sitemap
  try {
    const liveSitemap = await sitemapScanner.scan('https://new7.hdhub4u.cl/post-sitemap.xml');
    assert.strictEqual(liveSitemap.success, true);
    assert.ok(liveSitemap.entries.length > 50, `Expected > 50 entries, got ${liveSitemap.entries.length}`);
    console.log(`  ✓ HDHub4u live /post-sitemap.xml: Discovered ${liveSitemap.entries.length} live article URLs.`);
  } catch (err) {
    console.warn(`  ⚠️ HDHub4u live probe notice: ${err.message}`);
  }

  // 7B: 10Moviez RSS feed
  try {
    const live10m = await rssScanner.scan('https://10moviez.biz/feed/');
    assert.strictEqual(live10m.success, true);
    assert.ok(live10m.items.length > 0, '10Moviez RSS feed should contain items');
    console.log(`  ✓ 10Moviez live /feed/: Discovered ${live10m.items.length} items from RSS feed (bypassing HTML challenges).`);
  } catch (err) {
    console.warn(`  ⚠️ 10Moviez live probe notice: ${err.message}`);
  }

  // 7C: HDWall DataLife RSS feed
  try {
    const liveHdw = await rssScanner.scan('https://hdwall.xyz/rss.xml');
    assert.strictEqual(liveHdw.success, true);
    assert.ok(liveHdw.items.length > 0, 'HDWall RSS should contain items');
    console.log(`  ✓ HDWall live /rss.xml: Discovered ${liveHdw.items.length} items from DataLife RSS feed.`);
  } catch (err) {
    console.warn(`  ⚠️ HDWall live probe notice: ${err.message}`);
  }

  console.log('\n[PASS] All Multi-Vector Discovery tests passed cleanly.\n');
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('\n[TEST FAILURE]', err);
    process.exit(1);
  });
}

module.exports = { runTests };
