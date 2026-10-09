// Live production verification script
// Run: node verify_live.js

const BASE = 'https://praflix.us.ci';
const checks = [];

async function checkHealth() {
  const d = await fetch(`${BASE}/api/health`).then(r => r.json());
  const ok = d.status === 'ok' && d.service === 'PRAFLIX';
  checks.push({ name: 'Health API', pass: ok, detail: `status=${d.status}, service=${d.service}` });
}

async function checkHomepage() {
  const r = await fetch(`${BASE}/`);
  const html = await r.text();
  const ok = r.status === 200 && html.includes('PRAFLIX') && html.includes('app.js');
  checks.push({ name: 'Homepage HTML', pass: ok, detail: `status=${r.status}, length=${html.length} bytes` });
}

async function checkAppJsFix() {
  const text = await fetch(`${BASE}/app.js`).then(r => r.text());
  const hasYearFix = text.includes('const { search, year, category, type, platform, season, language, quality, sort } = state.activeFilters;');
  checks.push({ name: 'app.js year destructure fix', pass: hasYearFix, detail: `fix present=${hasYearFix}` });
}

async function checkDownloadsData() {
  const res = await fetch(`${BASE}/data/downloads.json`);
  const ok = res.status === 200;
  const data = await res.json();
  const valid = ok && data && Array.isArray(data.entries) && data.entries.length > 5000;
  checks.push({ name: 'Downloads Data (downloads.json)', pass: valid, detail: `status=${res.status}, entries=${data?.entries?.length}` });
}

async function checkStaticCatalogChunks() {
  const res = await fetch(`${BASE}/data/catalog-chunk-1.json`);
  const ok = res.status === 200;
  const chunk = await res.json();
  const valid = ok && Array.isArray(chunk) && chunk.length > 3000;
  checks.push({ name: 'Static Catalog Chunk 1', pass: valid, detail: `status=${res.status}, records=${chunk?.length}` });
}

async function checkFallbackPoster() {
  const res = await fetch(`${BASE}/assets/posters/fallback.svg`);
  const ok = res.status === 200 && res.headers.get('content-type')?.includes('svg');
  checks.push({ name: 'Fallback Poster SVG', pass: ok, detail: `status=${res.status}, type=${res.headers.get('content-type')}` });
}

(async () => {
  await Promise.all([
    checkHealth(),
    checkHomepage(),
    checkAppJsFix(),
    checkDownloadsData(),
    checkStaticCatalogChunks(),
    checkFallbackPoster()
  ]);

  console.log('\n=== PRAFLIX LIVE PRODUCTION VERIFICATION ===\n');
  checks.forEach(c => {
    const icon = c.pass ? '✅' : '❌';
    console.log(`${icon} ${c.name}: ${c.detail}`);
  });
  const allPass = checks.every(c => c.pass);
  console.log('\n' + (allPass ? '✅ ALL LIVE VERIFICATION CHECKS PASSED' : '❌ SOME CHECKS FAILED'));
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
