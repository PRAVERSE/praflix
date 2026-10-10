/**
 * PRAFLIX — Post-Deployment Live Verification (Problem 12)
 * Production URL: https://praflix.us.ci
 * Brand: PRAFLIX — A PRAVERSE Company
 */

const https = require('https');
const assert = require('assert');

const PROD_URL = 'https://praflix.us.ci';
const WORKER_URL = 'https://praflix.praverse-auth.workers.dev';

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, ...options }, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(data).toString('utf8'),
          rawBody: Buffer.concat(data)
        });
      });
    }).on('error', reject);
  });
}

async function verifyLive() {
  console.log('='.repeat(70));
  console.log('PRAFLIX — POST-DEPLOYMENT VERIFICATION (PROBLEM 12)');
  console.log('Testing live production at:', PROD_URL);
  console.log('='.repeat(70));

  let passed = 0;
  let total = 0;

  async function check(desc, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`✓ Check ${String(total).padStart(2, '0')}: ${desc} — PASSED`);
    } catch (err) {
      console.error(`✗ Check ${String(total).padStart(2, '0')}: ${desc} — FAILED: ${err.message}`);
      throw err;
    }
  }

  // 1. Index HTML
  await check('Index HTML loads with 200 OK and cache-busting assets', async () => {
    const res = await fetchUrl(`${PROD_URL}/`);
    assert.strictEqual(res.statusCode, 200, `Expected 200 OK, got ${res.statusCode}`);
    assert.ok(res.body.includes('PRAFLIX'), 'HTML missing PRAFLIX brand');
    assert.ok(res.body.includes('v=20261010_p12'), 'HTML missing Problem 12 cache-busting token');
    assert.ok(res.body.includes('app.js?v=20261010_p12'), 'HTML missing versioned app.js script tag');
  });

  // 2. Catalog Manifest
  await check('Catalog manifest returns 13,678 records across 4 chunks', async () => {
    const res = await fetchUrl(`${PROD_URL}/data/catalog-manifest.json`);
    assert.strictEqual(res.statusCode, 200);
    const manifest = JSON.parse(res.body);
    assert.strictEqual(manifest.totalRecords, 13678);
    assert.strictEqual(manifest.chunkCount, 4);
    assert.strictEqual(manifest.chunks.length, 4);
  });

  // 3. Valid Poster IDs index
  await check('Poster validity index serves 9,172 confirmed real posters (67.06% coverage)', async () => {
    const res = await fetchUrl(`${PROD_URL}/data/poster-valid-ids.js?v=20261010_p12`);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.includes('window.PRAFLIX_POSTER_VALID_IDS = new Set('));
    global.window = {};
    eval(res.body);
    const set = global.window.PRAFLIX_POSTER_VALID_IDS;
    assert.strictEqual(set.size, 9172, `Expected 9,172 valid poster IDs, found ${set.size}`);
    assert.ok(set.has(1), 'Item 1 should be in valid set');
    assert.ok(set.has(13674), 'Item 13674 (Khel Khel Mein) should be in valid set');
    assert.ok(set.has(13677), 'Item 13677 (The Woman in Black) should be in valid set');
    assert.ok(set.has(13678), 'Item 13678 (Up in the Air) should be in valid set');
    assert.ok(!set.has(6808), 'Item 6808 (Kaashmora 2 mismatch) must NOT be in valid set');
    assert.ok(!set.has(7302), 'Item 7302 (Hyper mismatch) must NOT be in valid set');
  });

  // 4. Sample newly deployed local posters
  await check('Live newly deployed local poster (anali-2026.jpg) serves 200 OK image', async () => {
    const res = await fetchUrl(`${PROD_URL}/assets/posters/anali-2026.jpg`);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.rawBody.length > 5000, `Expected image > 5KB, got ${res.rawBody.length} bytes`);
  });

  await check('Live newly deployed local poster (batwara-1947-2026.jpg) serves 200 OK image', async () => {
    const res = await fetchUrl(`${PROD_URL}/assets/posters/batwara-1947-2026.jpg`);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.rawBody.length > 5000, `Expected image > 5KB, got ${res.rawBody.length} bytes`);
  });

  // 5. Neutral fallback SVG
  await check('Live neutral fallback SVG serves 200 OK with correct SVG XML', async () => {
    const res = await fetchUrl(`${PROD_URL}/assets/posters/fallback.svg`);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.includes('<svg'), 'Expected valid SVG root');
    assert.ok(res.body.includes('</svg>'), 'Expected valid SVG closing');
  });

  // 6. Recovered remote CDN posters (e.g. 13677, 13678)
  await check('Live CDN poster for Title 13677 (The Woman in Black) is accessible', async () => {
    const res = await fetchUrl('https://imgshare.info/images/2026/10/10/The-Woman-in-Black-2012.jpg');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.rawBody.length > 5000);
  });

  await check('Live CDN poster for Title 13678 (Up in the Air) is accessible', async () => {
    const res = await fetchUrl('https://imgshare.info/images/2026/10/10/Up-in-the-Air-2009.jpg');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.rawBody.length > 5000);
  });

  // 7. Catalog Chunk 4
  await check('Catalog chunk 4 serves 200 OK with recovered Problem 10 titles intact', async () => {
    const res = await fetchUrl(`${PROD_URL}/data/catalog-chunk-4.json`);
    assert.strictEqual(res.statusCode, 200);
    const chunk = JSON.parse(res.body);
    const item13674 = chunk.find(c => c.canonicalId === 13674);
    const item13677 = chunk.find(c => c.canonicalId === 13677);
    assert.ok(item13674, 'Item 13674 must exist in chunk 4');
    assert.ok(item13677, 'Item 13677 must exist in chunk 4');
    assert.strictEqual(item13677.poster, 'https://imgshare.info/images/2026/10/10/The-Woman-in-Black-2012.jpg');
  });

  // 8. Live Worker mirror check
  await check('Worker mirror (praflix.praverse-auth.workers.dev) serves 200 OK', async () => {
    const res = await fetchUrl(`${WORKER_URL}/`);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.includes('PRAFLIX'));
  });

  console.log('='.repeat(70));
  console.log(`ALL ${passed}/${total} LIVE PRODUCTION CHECKS PASSED WITH 100% SUCCESS!`);
  console.log('='.repeat(70));
}

verifyLive().catch(err => {
  console.error('LIVE VERIFICATION FAILED:', err);
  process.exit(1);
});
