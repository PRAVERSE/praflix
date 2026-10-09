// Live production verification script
// Run: node verify_live.js

const BASE = 'https://praflix.us.ci';
const checks = [];

async function checkHealth() {
  const d = await fetch(`${BASE}/api/health`).then(r => r.json());
  const ok = d.status === 'ok' && d.db === 'D1 connected';
  checks.push({ name: 'Health API', pass: ok, detail: `status=${d.status}, db=${d.db}` });
}

async function checkCatalog() {
  const d = await fetch(`${BASE}/api/catalog?page=1&limit=3&sort=year-desc`).then(r => r.json());
  const ok = d.total > 10000 && Array.isArray(d.records) && d.records.length === 3;
  checks.push({ name: 'Catalog API', pass: ok, detail: `total=${d.total}, records=${d.records.length}, first="${d.records[0]?.displayTitle}"` });
}

async function checkSearch() {
  const d = await fetch(`${BASE}/api/search?q=ordinary&limit=5`).then(r => r.json());
  const ok = d.total >= 1 && Array.isArray(d.records) && d.records.length >= 1;
  checks.push({ name: 'Search API', pass: ok, detail: `total=${d.total}, first="${d.records[0]?.displayTitle}"` });
}

async function checkYearFilter() {
  const d = await fetch(`${BASE}/api/catalog?page=1&limit=5&year=2024`).then(r => r.json());
  const allCorrectYear = d.records.every(r => r.year === '2024');
  const ok = d.total > 0 && allCorrectYear;
  checks.push({ name: 'Year Filter (2024)', pass: ok, detail: `total=${d.total}, allYear2024=${allCorrectYear}` });
}

async function checkAppJsFix() {
  const text = await fetch(`${BASE}/app.js`).then(r => r.text());
  const hasYearFix = text.includes('const { search, year, category, type, platform, season, language, quality, sort } = state.activeFilters;');
  const hasNoYearBug = !text.includes('if (year) params.set') || text.includes('const { search, year,');
  checks.push({ name: 'app.js year destructure fix', pass: hasYearFix, detail: `fix present=${hasYearFix}` });
}

async function checkHomepage() {
  const r = await fetch(`${BASE}/`);
  const html = await r.text();
  const ok = r.status === 200 && html.includes('PRAFLIX') && html.includes('<script');
  checks.push({ name: 'Homepage HTTP 200', pass: ok, detail: `status=${r.status}, len=${html.length}` });
}

(async () => {
  await Promise.all([checkHealth(), checkCatalog(), checkSearch(), checkYearFilter(), checkAppJsFix(), checkHomepage()]);
  
  console.log('\n=== PRAFLIX LIVE SITE VERIFICATION ===\n');
  checks.forEach(c => {
    const icon = c.pass ? '✅' : '❌';
    console.log(`${icon} ${c.name}: ${c.detail}`);
  });
  const allPass = checks.every(c => c.pass);
  console.log('\n' + (allPass ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'));
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
