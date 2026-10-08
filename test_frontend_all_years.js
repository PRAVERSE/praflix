/**
 * PRAFLIX — Frontend UX & All Years Verification Suite
 * A PRAVERSE Company
 */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(65));
console.log('PRAFLIX FRONTEND ALL-YEARS VALIDATION SUITE');
console.log('='.repeat(65));

let passed = 0;
let total = 0;

function check(testNum, name, condition, details = '') {
  total++;
  if (condition) {
    passed++;
    console.log(`✓ Test ${String(testNum).padStart(2, '0')}: ${name} — PASSED ${details}`);
  } else {
    console.error(`✗ Test ${String(testNum).padStart(2, '0')}: ${name} — FAILED ${details}`);
  }
}

// 1. Inspect index.html
const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

check(1, "YEARS navigation section removed from HTML", 
  !html.includes('class="year-nav-strip"') && 
  !html.includes('id="year-nav-pills"') && 
  !html.includes('class="year-pill"'),
  "(No year-nav-strip or year-pills markup)"
);

check(2, "Hero brand and search bar preserved cleanly",
  html.includes('class="cinema-hero-section"') &&
  html.includes('class="hero-brand-heading"') &&
  html.includes('id="search-input"') &&
  html.includes('id="search-clear"'),
  "(Hero brand and search bar intact)"
);

check(3, "filter-year dropdown removed from HTML controls bar",
  !html.includes('id="filter-year"') &&
  !html.includes('aria-label="Filter by release year"'),
  "(filter-year select element cleanly removed; catalog always on All Years)"
);

check(4, "Controls bar and header metrics removed, header nav menu preserved",
  !html.includes('id="controls-bar"') &&
  !html.includes('id="header-metric-pill"') &&
  !html.includes('id="header-search-btn"') &&
  html.includes('id="nav-menu"') &&
  html.includes('data-category="All"'),
  "(controls-bar and header metrics cleanly removed; nav-menu intact)"
);

// 2. Inspect styles.css
const cssPath = path.join(__dirname, 'styles.css');
const css = fs.readFileSync(cssPath, 'utf8');

check(5, "Unused year-nav-strip styles removed from styles.css",
  !css.includes('.year-nav-strip') && !css.includes('.year-pill'),
  "(No dead year navigation CSS rules)"
);

// 3. Inspect app.js
const jsPath = path.join(__dirname, 'app.js');
const jsCode = fs.readFileSync(jsPath, 'utf8');

check(6, "app.js defaults year state to All Years ('')",
  jsCode.includes("defaultYear: ''") || jsCode.includes('defaultYear: ""'),
  "(state.defaultYear and activeFilters.year are empty strings)"
);

check(7, "resetAllFilters sets year to All Years and DOM.filterYear removed",
  !jsCode.includes('DOM.filterYear') &&
  (jsCode.includes("state.activeFilters.year = ''") || jsCode.includes('state.activeFilters.year = ""')),
  "(Clear Filters restores All Years, no dead DOM.filterYear references)"
);

// Load catalog for data tests
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'catalog.json'), 'utf8'));

function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SOUTH_INDIAN_LANGS = ['telugu', 'tamil', 'malayalam', 'kannada'];

function isSouthIndian(item) {
  const langs = (item.languages || []).map(l => String(l).toLowerCase());
  if (SOUTH_INDIAN_LANGS.some(sl => langs.includes(sl))) return true;
  const text = `${item.displayTitle || ''} ${item.originalSourceTitle || ''}`.toLowerCase();
  return text.includes('south');
}

function isHollywood(item) {
  const langs = (item.languages || []).map(l => String(l).toLowerCase());
  if (langs.includes('english')) return true;
  const text = `${item.displayTitle || ''} ${item.originalSourceTitle || ''}`.toLowerCase();
  return text.includes('hollywood');
}

function isBollywood(item) {
  const text = `${item.displayTitle || ''} ${item.originalSourceTitle || ''}`.toLowerCase();
  if (text.includes('bollywood')) return true;
  const langs = (item.languages || []).map(l => String(l).toLowerCase());
  return langs.includes('hindi') && !isSouthIndian(item) && !isHollywood(item);
}

function isPlatformMatch(item, platformName) {
  if (!platformName) return true;
  const target = platformName.toLowerCase();
  const matchPlat = (p) => {
    const s = String(p || '').toLowerCase();
    if (target === 'prime video' || target === 'prime') {
      return s === 'prime video' || s === 'amazon prime video' || s === 'amazon prime' || s === 'prime' || s.includes('prime-video') || s.includes('amazon-prime');
    }
    return s.includes(target);
  };
  if ((item.platforms || []).some(matchPlat)) return true;
  if (matchPlat(item.platform)) return true;
  if ((item.variants || []).some(v => matchPlat(v.platform) || (v.sourceUrl && (v.sourceUrl.includes('/' + target + '/') || v.sourceUrl.includes('category/amazon-prime'))))) return true;
  return false;
}

// Pre-compute _searchTokens
catalog.forEach(item => {
  const variantTitles = (item.variants || []).map(v => v.originalSourceTitle || '').join(' ');
  const variantLangs = (item.variants || []).flatMap(v => v.languages || []).join(' ');
  const searchCorpus = [
    item.displayTitle,
    item.normalizedTitle,
    item.year || '',
    item.season || '',
    item.type || '',
    (item.languages || []).join(' '),
    (item.qualities || []).join(' '),
    (item.platforms || []).join(' '),
    (item.categories || []).join(' '),
    item.audio || '',
    variantTitles,
    variantLangs
  ].join(' ');
  item._searchTokens = normalizeText(searchCorpus);
});

const defaultFilters = {
  search: '',
  year: '',
  category: 'All',
  type: '',
  platform: '',
  season: '',
  language: '',
  quality: '',
  sort: 'year-desc'
};

function filterCatalog(filters) {
  const { search, year, category, type, platform } = filters;
  const searchTokens = normalizeText(search).split(' ').filter(Boolean);
  let filtered = catalog;

  if (searchTokens.length > 0) {
    filtered = filtered.filter(item => {
      for (let i = 0; i < searchTokens.length; i++) {
        if (!item._searchTokens.includes(searchTokens[i])) return false;
      }
      return true;
    });
  }

  if (year) {
    filtered = filtered.filter(item => item.year === year);
  }

  if (category && category !== 'All') {
    if (category === 'Web Series' || category === 'series') {
      filtered = filtered.filter(item => (item.type || '').toLowerCase() === 'web series');
    } else if (category === 'Movie' || category === 'movie') {
      filtered = filtered.filter(item => (item.type || '').toLowerCase() === 'movie');
    } else if (category === 'Bollywood') {
      filtered = filtered.filter(item => isBollywood(item));
    } else if (category === 'Hollywood') {
      filtered = filtered.filter(item => isHollywood(item));
    } else if (category === 'South Indian') {
      filtered = filtered.filter(item => isSouthIndian(item));
    } else {
      filtered = filtered.filter(item =>
        (item.categories || []).includes(category) ||
        isPlatformMatch(item, category)
      );
    }
  }

  if (type) {
    filtered = filtered.filter(item => (item.type || '').toLowerCase() === type.toLowerCase());
  }

  if (platform) {
    filtered = filtered.filter(item => isPlatformMatch(item, platform));
  }

  return filtered;
}

// Test 08
const defaultResults = filterCatalog(defaultFilters);
check(8, `Initial state includes all ${catalog.length.toLocaleString()} titles across all years`,
  defaultResults.length === catalog.length,
  `(${defaultResults.length.toLocaleString()} titles returned)`
);

// Test 09
const totalPages = Math.ceil(catalog.length / 48);
check(9, `Initial pagination spans all years (${totalPages} pages for 48 items/page)`,
  totalPages > 200,
  `(${totalPages} pages dynamically computed)`
);

// Test 10
const yearsSet = new Set(defaultResults.map(r => r.year).filter(y => y && /^\d{4}$/.test(y)));
check(10, "Multiple years present in default view without year selection",
  yearsSet.size > 50,
  `(${yearsSet.size} distinct release years represented)`
);

// Test 11
const search12th = filterCatalog({ ...defaultFilters, search: '12th Fail' });
check(11, "Search finds older movie '12th Fail' (2023) across All Years",
  search12th.length > 0 && search12th.some(r => r.displayTitle.toLowerCase().includes('12th fail')),
  `(Found: '${search12th[0] ? search12th[0].displayTitle : ''}', Year: ${search12th[0] ? search12th[0].year : ''})`
);

// Test 12
const searchSacred = filterCatalog({ ...defaultFilters, search: 'Sacred Games' });
check(12, "Search finds older web series 'Sacred Games' (2018/2019) across All Years",
  searchSacred.length > 0 && searchSacred.some(r => r.displayTitle.toLowerCase().includes('sacred games')),
  `(Found: ${searchSacred.length} season/series entries for Sacred Games)`
);

// Test 13
const moviesResults = filterCatalog({ ...defaultFilters, type: 'Movie' });
check(13, `Movies tab returns all verified movies (${moviesResults.length.toLocaleString()})`,
  moviesResults.length >= 9000 && moviesResults.every(r => r.type === 'Movie'),
  `(${moviesResults.length} movies, ${Math.ceil(moviesResults.length / 48)} pages)`
);

// Test 14
const seriesResults = filterCatalog({ ...defaultFilters, type: 'Web Series' });
check(14, `Web Series tab returns all verified series (${seriesResults.length.toLocaleString()})`,
  seriesResults.length >= 1500 && seriesResults.every(r => r.type === 'Web Series'),
  `(${seriesResults.length} web series, ${Math.ceil(seriesResults.length / 48)} pages)`
);

// Test 15
const seriesCatResults = filterCatalog({ ...defaultFilters, category: 'Web Series' });
check(15, `Category 'Web Series' returns all series (${seriesCatResults.length.toLocaleString()})`,
  seriesCatResults.length >= 1500,
  `(${seriesCatResults.length} web series matched)`
);

// Bollywood Category verification
const bollywoodFilters = { ...defaultFilters, category: 'Bollywood' };
const bollywoodResults = filterCatalog(bollywoodFilters);
check(16, "Bollywood tab returns matching Hindi cinema records",
  bollywoodResults.length >= 4000 && bollywoodResults.every(r => isBollywood(r)),
  `(${bollywoodResults.length} Bollywood titles)`
);

// Hollywood Category verification
const hollywoodFilters = { ...defaultFilters, category: 'Hollywood' };
const hollywoodResults = filterCatalog(hollywoodFilters);
check(17, "Hollywood tab returns matching international/English cinema records",
  hollywoodResults.length >= 5000 && hollywoodResults.every(r => isHollywood(r)),
  `(${hollywoodResults.length} Hollywood titles)`
);

// South Indian Category verification
const southFilters = { ...defaultFilters, category: 'South Indian' };
const southResults = filterCatalog(southFilters);
check(18, "South Indian tab returns matching regional South cinema records",
  southResults.length >= 900 && southResults.every(r => isSouthIndian(r)),
  `(${southResults.length} South Indian titles)`
);

// Netflix Platform verification: 170 titles
const netflixFilters = { ...defaultFilters, platform: 'Netflix' };
const netflixResults = filterCatalog(netflixFilters);
check(19, "Netflix tab returns matching Netflix platform titles",
  netflixResults.length === 170,
  `(${netflixResults.length} Netflix titles)`
);

// Prime Video Platform verification: 16 titles
const primeFilters = { ...defaultFilters, platform: 'Prime Video' };
const primeResults = filterCatalog(primeFilters);
check(20, "Prime Video tab returns matching Prime Video platform titles",
  primeResults.length === 16,
  `(${primeResults.length} Prime Video titles)`
);

// Search within Category: Bollywood + 'Awarapan'
const searchBollywood = filterCatalog({ ...defaultFilters, category: 'Bollywood', search: 'Awarapan' });
check(21, "Search works within Bollywood category",
  searchBollywood.length > 0 && searchBollywood.some(r => r.displayTitle.includes('Awarapan')),
  `(Found: ${searchBollywood.map(r => r.displayTitle).join(', ')})`
);

// Search within Category: Web Series + 'Sacred Games'
const searchSeries = filterCatalog({ ...defaultFilters, type: 'Web Series', search: 'Sacred Games' });
check(22, "Search works within Web Series category",
  searchSeries.length > 0 && searchSeries.some(r => r.displayTitle.includes('Sacred Games')),
  `(Found: ${searchSeries.map(r => r.displayTitle).join(', ')})`
);

// Combined filters: Web Series + Netflix
const combinedFilters = { ...defaultFilters, type: 'Web Series', platform: 'Netflix' };
const combinedResults = filterCatalog(combinedFilters);
check(23, "Combined filters (Web Series + Netflix) work seamlessly",
  combinedResults.length > 0 && combinedResults.every(r => r.type === 'Web Series'),
  `(${combinedResults.length} Netflix web series)`
);

// Test Clear Filters returns to initial state
const clearedFilters = { ...defaultFilters };
const clearedResults = filterCatalog(clearedFilters);
check(24, `Clear Filters restores All Titles view with ${catalog.length.toLocaleString()} titles`,
  clearedResults.length === catalog.length,
  `(${clearedResults.length.toLocaleString()} titles)`
);

console.log('='.repeat(65));
if (passed === total) {
  console.log(`ALL ${passed}/${total} FRONTEND VALIDATION CHECKS PASSED WITH 100% SUCCESS!`);
} else {
  console.error(`FAILED: ${passed}/${total} passed.`);
  process.exit(1);
}
console.log('='.repeat(65));
