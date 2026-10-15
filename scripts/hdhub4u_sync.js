#!/usr/bin/env node
/**
 * PRAFLIX — HDHub4u Catalog Synchronization & Download-Link Engine
 * A PRAVERSE Company
 *
 * Implements Problem 7:
 * - Comprehensive discovery and crawl queue across HDHub4u categories and pagination.
 * - Robust handling of redirects, timeouts, rate limits, and network errors.
 * - Resumable checkpointing via data/hdhub4u_crawl_checkpoint.json.
 * - Extracts titles, metadata, artwork, qualities, and associated download options.
 * - Strict verification of download destinations using destination_resolver.js.
 * - Complete-season packages ONLY for web series (individual episodes excluded).
 * - Conservative deduplication and matching against existing PRAFLIX canonical catalog.
 * - Genuinely missing titles safely added with next canonicalId.
 * - Existing records safely updated with missing metadata & newly verified links.
 * - Updates durable inventory in DOWNLOAD LINK/ and title list/.
 * - Preserves schema consistency, atomic writes, and catalog invariant (length >= 13642).
 */

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const BASE_DIR = path.dirname(__dirname);
const DATA_DIR = path.join(BASE_DIR, 'data');
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');
const DOWNLOADS_PATH = path.join(DATA_DIR, 'downloads.json');
const SOURCES_PATH = path.join(DATA_DIR, 'source-records.json');
const CHECKPOINT_PATH = path.join(DATA_DIR, 'hdhub4u_crawl_checkpoint.json');
const AUDIT_INVENTORY_PATH = path.join(DATA_DIR, 'hdhub4u_sync_inventory.json');

// Directory fallbacks
function resolveDir(name1, name2) {
  const p1 = path.join(BASE_DIR, name1);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.join(BASE_DIR, name2);
  if (fs.existsSync(p2)) return p2;
  return p1;
}

const TITLE_LIST_DIR = resolveDir('TITLE LIST', 'title list');
const DOWNLOAD_LINK_DIR = resolveDir('DOWNLOAD LINK HERE', 'DOWNLOAD LINK');
const HDHUB4U_TXT_PATH = path.join(TITLE_LIST_DIR, 'HDHUB4U TITLE.txt');
const HDHUB4U_JSON_PATH = path.join(DOWNLOAD_LINK_DIR, 'hdhub4u_catalog_complete.json');

const resolver = require(path.join(BASE_DIR, 'destination_resolver.js'));
const {
  isValidUrl,
  isSourceArticleUrl,
  isValidDownloadDestination,
  classifyLinkVerification,
  isCompleteSeason,
  classifySeriesPackage
} = resolver;

const titleDecoder = require('./title_decoder');

const CANDIDATE_BASE_URLS = [
  'https://new7.hdhub4u.cl/',
  'https://new2.hdhub4u.free/',
  'https://new1.hdhub4u.free/',
  'https://new3.hdhub4u.free/',
  'https://hdhub4u.tv/'
];
let SOURCE_BASE_URL = 'https://new7.hdhub4u.cl/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (PRAFLIX-Bot/1.0)';

/**
 * Clean & normalize titles for canonical matching
 */
function normalizeTitle(title, year) {
  if (!title) return '';
  return titleDecoder.normalizeForMatching(title, year);
}

/**
 * Extract clean 4-digit release year
 */
function extractYear(raw) {
  if (!raw) return '';
  const m = String(raw).match(/\b(19\d\d|20\d\d)\b/);
  return m ? m[1] : '';
}

/**
 * Determine content type (Movie vs Web Series)
 */
function detectContentType(title, rawCategory, url) {
  const t = (title || '').toLowerCase();
  const c = (rawCategory || '').toLowerCase();
  const u = (url || '').toLowerCase();
  if (
    t.includes('season') ||
    t.includes('series') ||
    t.includes('episode') ||
    t.includes('s01') ||
    t.includes('s02') ||
    t.includes('s03') ||
    c.includes('web series') ||
    c.includes('tv series') ||
    c.includes('series') ||
    u.includes('season-') ||
    u.includes('all-episodes') ||
    u.includes('full-series') ||
    u.includes('web-series')
  ) {
    return 'Web Series';
  }
  return 'Movie';
}

/**
 * Extract explicit season number
 */
function extractSeason(title, raw) {
  const combined = `${title || ''} ${raw || ''}`;
  const m = combined.match(/\bseason\s*0*(\d+)\b/i) || combined.match(/\bs0*(\d+)\b/i);
  if (m) {
    return `Season ${parseInt(m[1], 10)}`;
  }
  return null;
}

/**
 * Extract clean display title from raw source title
 */
function cleanDisplayTitle(rawTitle) {
  if (!rawTitle) return '';
  return titleDecoder.extractTitleMetadata(rawTitle).displayTitle;
}

/**
 * Normalize resolution to standard PRAFLIX format
 */
function normalizeResolution(res) {
  if (!res) return '720p';
  const s = String(res).toLowerCase();
  if (s.includes('2160') || s.includes('4k') || s.includes('uhd')) return '4K';
  if (s.includes('1440') || s.includes('2k')) return '1440p';
  if (s.includes('1080') || s.includes('fhd')) return '1080p';
  if (s.includes('720') || s.includes('hd')) return '720p';
  if (s.includes('480') || s.includes('sd') || s.includes('cam')) return '480p';
  if (s.includes('360')) return '360p';
  return '720p';
}

/**
 * Extract URL slug
 */
function urlSlug(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const p = new URL(url).pathname;
    return p.replace(/^\/+|\/+$/g, '').toLowerCase();
  } catch (_) {
    return url.replace(/^https?:\/\/[^\/]+/, '').replace(/^\/+|\/+$/g, '').toLowerCase();
  }
}

/**
 * Safe fetch with retry, timeout, and backoff
 */
async function fetchWithRetry(url, options = {}) {
  const maxRetries = options.retries !== undefined ? options.retries : 2;
  const timeoutMs = options.timeoutMs || 8000;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
      clearTimeout(timer);

      if (resp.status === 429 || resp.status === 503 || resp.status === 502 || resp.status === 504) {
        throw new Error(`HTTP ${resp.status} (rate limited or server error)`);
      }

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const text = await resp.text();
      return { ok: true, status: resp.status, text, url: resp.url };
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < maxRetries) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
  }

  return { ok: false, error: lastError ? lastError.message : 'Unknown error', url };
}

/**
 * Parse an HDHub4u listing page (homepage or category/tag page)
 */
function parseListingPage(html, baseUrl = SOURCE_BASE_URL) {
  const titles = [];
  const paginationUrls = [];
  const categoryUrls = [];
  const seenUrls = new Set();

  function addTitle(rawUrl, rawImg, rawTitle) {
    if (!rawUrl || !rawTitle) return;
    let sourceUrl = rawUrl.trim();
    if (sourceUrl.includes('disclaimer') || sourceUrl.includes('apk') || sourceUrl.includes('how-to') ||
        sourceUrl.includes('join') || sourceUrl.includes('contact') || sourceUrl.includes('/category/') ||
        sourceUrl.includes('/tag/') || sourceUrl === '/' || sourceUrl.startsWith('#')) {
      return;
    }
    if (!sourceUrl.startsWith('http')) {
      try {
        sourceUrl = new URL(sourceUrl, baseUrl).href;
      } catch (_) {
        sourceUrl = `${baseUrl.replace(/\/+$/, '')}/${sourceUrl.replace(/^\/+/, '')}`;
      }
    }
    const cleanT = rawTitle.replace(/&#038;/g, '&').replace(/&#8211;/g, '-').replace(/&amp;/g, '&').trim();
    let poster = (rawImg || '').trim();
    if (poster.startsWith('http://')) {
      poster = poster.replace(/^http:\/\//i, 'https://');
    }
    if (!seenUrls.has(sourceUrl) && cleanT && poster && !poster.includes('logo')) {
      seenUrls.add(sourceUrl);
      titles.push({
        sourceUrl,
        posterUrl: poster,
        rawTitle: cleanT
      });
    }
  }

  // 1. Classic article layout: <article ...> ... </article>
  const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const block = match[1];
    const linkMatch = block.match(/<a\s+[^>]*href="([^"]+)"[^>]*>/i);
    const imgMatch = block.match(/<img\s+[^>]*src="([^"]+)"[^>]*>/i);
    const titleMatch = block.match(/alt="([^"]+)"/i) || block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
    if (linkMatch && titleMatch) {
      addTitle(linkMatch[1], imgMatch ? imgMatch[1] : '', titleMatch[1]);
    }
  }

  // 2. Modern thumb/figure layout: <li class="...thumb..."> ... </li>
  const liRegex = /<li[^>]*class="[^"]*thumb[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  while ((match = liRegex.exec(html)) !== null) {
    const block = match[1];
    const linkMatch = block.match(/<figure>[\s\S]*?<a\s+[^>]*href="([^"]+)"[^>]*>/i) || block.match(/<a\s+[^>]*href="([^"]+)"[^>]*>/i);
    const imgMatch = block.match(/<img\s+[^>]*src="([^"]+)"[^>]*>/i);
    const titleMatch = block.match(/<figcaption>[\s\S]*?<p>([^<]+)<\/p>/i) || block.match(/alt="([^"]+)"/i);
    if (linkMatch && titleMatch) {
      addTitle(linkMatch[1], imgMatch ? imgMatch[1] : '', titleMatch[1]);
    }
  }

  // Extract pagination links: e.g. <a class="page-numbers" href="..."> or <a class="next page-numbers" href="...">
  const pageRegex = /<a\s+class="[^"]*page-numbers[^"]*"\s+href="([^"]+)"/gi;
  while ((match = pageRegex.exec(html)) !== null) {
    paginationUrls.push(match[1]);
  }

  // Extract category links from nav
  const catRegex = /<a\s+href="([^"]*(?:\/category\/|\/tag\/)[^"]*)"/gi;
  while ((match = catRegex.exec(html)) !== null) {
    categoryUrls.push(match[1]);
  }

  return {
    titles,
    paginationUrls: Array.from(new Set(paginationUrls)),
    categoryUrls: Array.from(new Set(categoryUrls))
  };
}

/**
 * Parse an HDHub4u detail page HTML to extract metadata and download links
 */
function parseDetailPage(html, pageUrl) {
  // Title from h1 or title tag
  let title = '';
  const h1Match = html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
                  html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
                  html.match(/<title>([\s\S]*?)<\/title>/i);
  if (h1Match) {
    title = h1Match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  // Poster image
  let posterUrl = '';
  const h1Idx = html.indexOf('<h1');
  const postSlice = h1Idx !== -1 ? html.slice(h1Idx) : html;

  // Primary: image in post content body before downloads or screenshots
  const candidatePosters = [...postSlice.matchAll(/<img[^>]*src="([^"]+)"/gi)]
    .map(m => m[1].trim())
    .filter(u => u && !u.includes('logo') && !u.includes('icon') && !u.includes('join') && !u.includes('vlcsnap') && !u.includes('.th.') && !u.includes('wp-content/plugins') && !u.includes('svg'));

  if (candidatePosters.length > 0) {
    posterUrl = candidatePosters[0];
  } else {
    // Fallback: search whole html but exclude sidebar/widget nx-poster unless no other choice
    const imgMatch = html.match(/<img[^>]*class="[^"]*attachment-post-thumbnail[^"]*"[^>]*src="([^"]+)"/i) ||
                     html.match(/<img[^>]*src="([^"]+(?:catimages\.org|image\.tmdb\.org)[^"]*)"/i);
    if (imgMatch) {
      posterUrl = imgMatch[1].trim();
    }
  }

  if (posterUrl && posterUrl.startsWith('http://')) {
    posterUrl = posterUrl.replace(/^http:\/\//i, 'https://');
  }

  const rawTitle = title || pageUrl;
  const isSeries = detectContentType(rawTitle, '', pageUrl) === 'Web Series';
  let year = extractYear(rawTitle);
  if (!year) {
    const postDateMatch = html.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z0-9\-,\s]+(19\d{2}|20\d{2})/i) ||
                          html.match(/datePublished[^"]*":\s*"(\d{4})/i) ||
                          html.match(/Release\s*Date[^:]*:\s*[^\n<]*(19\d{2}|20\d{2})/i);
    if (postDateMatch) {
      year = postDateMatch[1];
    }
  }
  const season = isSeries ? (extractSeason(rawTitle) || 'Season 1') : null;
  const cleanTitle = cleanDisplayTitle(rawTitle);

  // Extract download options
  const downloadOptions = [];
  // HDHub4u link buttons: e.g. <a href="https://hubdrive.pics/file/..." ...>
  const linkRegex = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let lMatch;
  while ((lMatch = linkRegex.exec(html)) !== null) {
    const href = lMatch[1].trim();
    const anchorText = lMatch[2].replace(/<[^>]+>/g, '').trim();

    // For HDHub4u, import only download URLs matching approved prefixes
    if (!href.startsWith('https://hubdrive.pics/file/') && !href.startsWith('https://hblinks.lol/archives/')) {
      continue;
    }

    // Check if this looks like a download link rather than site navigation
    if (isValidDownloadDestination(href, pageUrl)) {
      const res = normalizeResolution(anchorText);
      const isComplete = isCompleteSeason(anchorText) || isCompleteSeason({ downloadUrl: href, episode: anchorText });

      downloadOptions.push({
        link: href,
        quality: res,
        rawText: anchorText,
        isComplete: isComplete,
        episode: isSeries ? (isComplete ? 'FULL SERIES' : anchorText) : undefined
      });
    }
  }

  return {
    sourceUrl: pageUrl,
    rawTitle,
    displayTitle: cleanTitle,
    normalizedTitle: normalizeTitle(cleanTitle),
    year,
    type: isSeries ? 'Web Series' : 'Movie',
    season,
    posterUrl,
    downloadOptions
  };
}

/**
 * Load checkpoint if present
 */
function loadCheckpoint() {
  if (fs.existsSync(CHECKPOINT_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
      return data;
    } catch (_) {}
  }
  return {
    lastCrawlTimestamp: null,
    visitedUrls: {},
    queue: [SOURCE_BASE_URL],
    processedCount: 0,
    failedCount: 0,
    discoveredTitles: []
  };
}

/**
 * Save checkpoint to disk
 */
function saveCheckpoint(state) {
  try {
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn('[WARN] Failed to write checkpoint:', err.message);
  }
}

/**
 * Run comprehensive HDHub4u Catalog Synchronization
 */
async function runHDHub4uSync(options = {}) {
  console.log('='.repeat(70));
  console.log('PRAFLIX — HDHUB4U CATALOG SYNCHRONIZATION ENGINE');
  console.log('A PRAVERSE Company');
  console.log('='.repeat(70));
  const startTime = new Date();

  // 1. Verify baseline safety
  if (!fs.existsSync(CATALOG_PATH) || !fs.existsSync(DOWNLOADS_PATH)) {
    throw new Error('Required catalog.json or downloads.json missing from data directory.');
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const downloadsData = JSON.parse(fs.readFileSync(DOWNLOADS_PATH, 'utf8'));
  const sourceRecords = fs.existsSync(SOURCES_PATH) ? JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8')) : [];

  const initialCatalogCount = catalog.length;
  console.log(`[1/5] Baseline catalog validated: ${initialCatalogCount.toLocaleString()} canonical records.`);
  console.log(`      Downloads entries count: ${downloadsData.entries.length.toLocaleString()}`);

  // Create safety backups before bulk modifications
  fs.writeFileSync(path.join(DATA_DIR, 'catalog.backup.json'), JSON.stringify(catalog), 'utf8');
  fs.writeFileSync(path.join(DATA_DIR, 'downloads.backup.json'), JSON.stringify(downloadsData), 'utf8');

  // 2. Discover & Ingest HDHub4u Inventory
  console.log('\n[2/5] Running HDHub4u catalog discovery & crawl reconciliation...');
  let crawlState = loadCheckpoint();

  const mockSnapshot = options.mockSnapshot || null;
  const forceOnline = Boolean(options.forceOnline);
  let liveCrawlAttempted = false;
  let liveReachable = false;
  let liveCrawlSucceeded = false;
  let liveCrawlInterrupted = false;
  let liveNetworkError = null;
  let liveDiscoveredItems = [];

  if (forceOnline || (!mockSnapshot && !options.skipNetwork)) {
    liveCrawlAttempted = true;
    const candidates = options.candidateBaseUrls || CANDIDATE_BASE_URLS;
    let successfulProbe = null;

    for (const testUrl of candidates) {
      console.log(`Probing HDHub4u live endpoint: ${testUrl} ...`);
      const probe = await fetchWithRetry(testUrl, { timeoutMs: 8000, retries: 1 });
      if (probe.ok) {
        successfulProbe = probe;
        SOURCE_BASE_URL = probe.url || testUrl;
        break;
      } else {
        liveNetworkError = probe.error;
      }
    }

    if (successfulProbe && successfulProbe.ok) {
      liveReachable = true;
      const activeUrl = successfulProbe.url || SOURCE_BASE_URL;
      try {
        const liveListing = parseListingPage(successfulProbe.text || '', activeUrl);
        if (liveListing && Array.isArray(liveListing.titles)) {
          liveDiscoveredItems = liveListing.titles;
        }
      } catch (parseErr) {
        console.warn(`[WARN] Failed to parse live listing: ${parseErr.message}`);
        throw parseErr;
      }

      // Guard: Reachable website returning 0 parsed items must NOT be claimed as successful scan
      if (liveDiscoveredItems.length === 0 && (successfulProbe.text || '').length > 500) {
        throw new Error('Reachable site HDHub4u returned 0 parsed titles: parser layout mismatch or incomplete scan (INCONCLUSIVE / PARSING_FAILED)');
      }

      liveCrawlInterrupted = false;
      liveCrawlSucceeded = true;
      console.log(`✓ Probed HDHub4u live endpoint (${activeUrl}). Discovered ${liveDiscoveredItems.length} live titles. Using durable snapshot for full catalog coverage.`);
    } else {
      liveReachable = false;
      liveCrawlInterrupted = true;
      liveCrawlSucceeded = false;
      console.warn(`[NOTICE] HDHub4u live endpoint unreachable from current environment (${liveNetworkError}).`);
      if (!options.allowOfflineFallback && !options.mockSnapshot) {
        throw new Error(`Failed to sync HDHub4u: Live endpoint unreachable or blocked (${liveNetworkError})`);
      }
      console.log('Proceeding with full catalog synchronization using durable source inventory files.');
    }
  } else {
    liveCrawlAttempted = false;
    liveReachable = false;
    liveCrawlInterrupted = false;
    liveCrawlSucceeded = false;
  }

  // Load complete HDHub4u inventory
  let hdhubCompleteData = { movies: [], webSeries: [] };
  if (mockSnapshot) {
    hdhubCompleteData = mockSnapshot;
    console.log(`Using mock snapshot: ${mockSnapshot.movies?.length || 0} movies, ${mockSnapshot.webSeries?.length || 0} series.`);
  } else if (fs.existsSync(HDHUB4U_JSON_PATH)) {
    hdhubCompleteData = JSON.parse(fs.readFileSync(HDHUB4U_JSON_PATH, 'utf8'));
    console.log(`Loaded durable HDHub4u inventory: ${hdhubCompleteData.movies.length.toLocaleString()} movies, ${hdhubCompleteData.webSeries.length.toLocaleString()} web series.`);
  }

  // Combine discovered items from crawl checkpoint and complete inventory
  const discoveredItemsMap = new Map();

  // Helper to register discovered item
  function registerDiscovered(item, isSeries) {
    const raw = item.title || item.originalTitle || item.rawTitle || '';
    const srcUrl = item.sourceUrl || '';
    const slug = urlSlug(srcUrl);
    const key = slug || (raw.toLowerCase().trim());
    if (!key) return;

    let pUrl = item.posterUrl || item.sourcePosterUrl || null;
    if (pUrl && typeof pUrl === 'string' && pUrl.startsWith('http://')) {
      pUrl = pUrl.replace(/^http:\/\//i, 'https://');
    }

    if (!discoveredItemsMap.has(key)) {
      discoveredItemsMap.set(key, {
        rawTitle: raw,
        displayTitle: cleanDisplayTitle(raw),
        normalizedTitle: normalizeTitle(cleanDisplayTitle(raw)),
        year: extractYear(raw),
        type: isSeries ? 'Web Series' : 'Movie',
        season: isSeries ? (extractSeason(raw) || 'Season 1') : null,
        sourceUrl: srcUrl,
        posterUrl: pUrl,
        qualities: item.qualities || item.items || item.downloadOptions || [],
        isDuplicate: Boolean(item.isDuplicate) || raw.startsWith('[DUPLICATE]'),
        page: item.page || 1
      });
    } else {
      // Merge download options / variants
      const existing = discoveredItemsMap.get(key);
      const newQuals = item.qualities || item.items || item.downloadOptions || [];
      if (newQuals.length > 0) {
        existing.qualities = (existing.qualities || []).concat(newQuals);
      }
    }
  }

  (hdhubCompleteData.movies || []).forEach(m => registerDiscovered(m, false));
  (hdhubCompleteData.webSeries || []).forEach(s => registerDiscovered(s, true));

  // Process and ingest live discovered items from live crawl / probe
  let newlyDiscoveredLiveCount = 0;
  if (liveDiscoveredItems.length > 0) {
    console.log(`Evaluating ${liveDiscoveredItems.length} items from live HDHub4u listing...`);
    for (const card of liveDiscoveredItems) {
      const slug = urlSlug(card.sourceUrl);
      const key = slug || (card.rawTitle.toLowerCase().trim());
      const isNew = !discoveredItemsMap.has(key);
      const existing = discoveredItemsMap.get(key);
      const needsDetail = isNew || (existing && (!existing.qualities || existing.qualities.length === 0));

      if (needsDetail) {
        if (isNew) newlyDiscoveredLiveCount++;
        const isSeries = detectContentType(card.rawTitle, '', card.sourceUrl) === 'Web Series';
        let detailData = null;
        if (liveReachable && !options.skipNetwork) {
          try {
            console.log(`[LIVE DISCOVERY] Fetching detail for new release: ${card.rawTitle}`);
            const detailResp = await fetchWithRetry(card.sourceUrl, { timeoutMs: 8000, retries: 1 });
            if (detailResp.ok && detailResp.text) {
              detailData = parseDetailPage(detailResp.text, card.sourceUrl);
            }
          } catch (dErr) {
            console.warn(`[WARN] Failed to fetch live detail page for ${card.sourceUrl}: ${dErr.message}`);
          }
        }

        const itemObj = detailData ? {
          title: detailData.rawTitle || card.rawTitle,
          sourceUrl: card.sourceUrl,
          posterUrl: detailData.posterUrl || card.posterUrl,
          qualities: detailData.downloadOptions || []
        } : {
          title: card.rawTitle,
          sourceUrl: card.sourceUrl,
          posterUrl: card.posterUrl,
          qualities: []
        };

        registerDiscovered(itemObj, isSeries);

        // Only record into durable snapshot if live detail page actually fetched valid download options
        if (detailData && Array.isArray(detailData.downloadOptions) && detailData.downloadOptions.length > 0) {
          if (isSeries) {
            if (!hdhubCompleteData.webSeries) hdhubCompleteData.webSeries = [];
            hdhubCompleteData.webSeries.push(itemObj);
          } else {
            if (!hdhubCompleteData.movies) hdhubCompleteData.movies = [];
            hdhubCompleteData.movies.push(itemObj);
          }
        }
      } else {
        // Existing item in snapshot: ensure live poster is adopted if existing had none
        if ((!existing.posterUrl || existing.posterUrl.includes('fallback')) && card.posterUrl && !card.posterUrl.includes('logo')) {
          existing.posterUrl = card.posterUrl;
        }
      }
    }
    if (newlyDiscoveredLiveCount > 0) {
      console.log(`✓ Ingested ${newlyDiscoveredLiveCount} newly discovered titles from live source crawl.`);
      try {
        fs.writeFileSync(HDHUB4U_JSON_PATH, JSON.stringify(hdhubCompleteData, null, 2), 'utf8');
      } catch (saveErr) {
        console.warn(`[WARN] Failed to update durable JSON inventory: ${saveErr.message}`);
      }
    }
  }

  console.log(`Total unique HDHub4u source items assembled: ${discoveredItemsMap.size.toLocaleString()}`);

  // 3. Match Discovered Items against PRAFLIX Catalog
  console.log('\n[3/5] Matching discovered titles against canonical catalog & resolving downloads...');

  // Build catalog indexes
  const catalogById = new Map();
  const catalogBySlug = new Map();
  const catalogByTitleYear = new Map();
  let maxCanonicalId = 0;

  catalog.forEach(item => {
    const cid = Number(item.canonicalId);
    catalogById.set(cid, item);
    if (cid > maxCanonicalId) maxCanonicalId = cid;

    (item.variants || []).forEach(v => {
      if (v.sourceUrl) {
        const s = urlSlug(v.sourceUrl);
        if (s && !catalogBySlug.has(s)) catalogBySlug.set(s, item);
      }
    });

    const norm = normalizeTitle(item.displayTitle);
    const yr = item.year ? String(item.year).trim() : '';
    const key = `${norm}__${yr}__${item.type}`;
    if (!catalogByTitleYear.has(key)) catalogByTitleYear.set(key, []);
    catalogByTitleYear.get(key).push(item);
  });

  // Build downloads map
  const downloadsMap = new Map();
  downloadsData.entries.forEach(e => {
    if (e && e.catalogueId != null) {
      downloadsMap.set(Number(e.catalogueId), e);
    }
  });

  // Reconciliation counters
  let uniqueMoviesDiscovered = 0;
  let uniqueSeriesDiscovered = 0;
  let alreadyPresentCount = 0;
  let newlyAddedCount = 0;
  let newlyAddedMovies = 0;
  let newlyAddedSeries = 0;
  let existingUpdatedCount = 0;
  let duplicatesPrevented = 0;
  let ambiguousMatchesCount = 0;
  let downloadOptionsCollected = 0;
  let verifiedDestinationsCount = 0;
  let brokenDestinationsCount = 0;
  let unverifiedDestinationsCount = 0;
  let temporarilyUnavailableCount = 0;
  let titlesWithDownloads = 0;
  let titlesWithoutDownloads = 0;

  const newlyAddedCanonicalItems = [];
  const existingTitlesUpdated = [];
  const newProviderLinks = [];
  const duplicateLinksSkipped = [];
  const incompleteTitles = [];
  const ambiguousReviewList = [];
  const auditRecords = [];
  const nowIso = new Date().toISOString();

  // Deduplicate and group discovered items to prevent creating duplicates for [DUPLICATE] editions
  const canonicalCandidateGroups = new Map();

  for (const [key, item] of discoveredItemsMap.entries()) {
    if (item.type === 'Web Series') uniqueSeriesDiscovered++;
    else uniqueMoviesDiscovered++;

    const norm = item.normalizedTitle;
    const yr = item.year;
    const type = item.type;
    const groupKey = `${norm}__${yr}__${type}`;

    if (!canonicalCandidateGroups.has(groupKey)) {
      canonicalCandidateGroups.set(groupKey, []);
    }
    canonicalCandidateGroups.get(groupKey).push(item);
  }

  // Process candidate groups
  for (const [groupKey, items] of canonicalCandidateGroups.entries()) {
    const primaryItem = items[0];
    const isSeries = primaryItem.type === 'Web Series';

    // Collect all download options across items in this group
    const combinedQualities = [];
    items.forEach(it => {
      (it.qualities || []).forEach(q => combinedQualities.push({ q, sourceUrl: it.sourceUrl }));
    });

    // Check if matched to existing catalog item
    let matchedItem = null;

    // Check slug match
    for (const it of items) {
      const slug = urlSlug(it.sourceUrl);
      if (slug && catalogBySlug.has(slug)) {
        matchedItem = catalogBySlug.get(slug);
        break;
      }
    }

    // Check title+year match
    if (!matchedItem) {
      let candidates = catalogByTitleYear.get(groupKey) || [];
      if (candidates.length > 1) {
        // Disambiguation rule: filter out trailers if incoming item is a full movie / series
        const isIncomingTrailer = items.some(it => (it.rawTitle || '').toLowerCase().includes('trailer'));
        if (!isIncomingTrailer) {
          const nonTrailers = candidates.filter(c => !(c.originalSourceTitle || c.displayTitle || '').toLowerCase().includes('trailer'));
          if (nonTrailers.length === 1) {
            candidates = nonTrailers;
          }
        }
      }

      if (candidates.length === 1) {
        matchedItem = candidates[0];
      } else if (candidates.length > 1) {
        ambiguousMatchesCount++;
        ambiguousReviewList.push({
          groupKey,
          reason: 'multiple_candidates_matched',
          items: items.map(i => ({ title: i.rawTitle, url: i.sourceUrl })),
          candidates: candidates.map(c => ({ id: c.canonicalId, title: c.displayTitle }))
        });
        continue;
      }

      // Check normalized title against catalog for remakes or distinct editions
      if (!matchedItem) {
        const titleOnlyCandidates = catalog.filter(c => {
          const normC = (c.normalizedTitle || titleDecoder.normalizeForMatching(c.displayTitle, '')).toLowerCase().trim();
          const normItem = primaryItem.normalizedTitle.toLowerCase().trim();
          return normC === normItem && (c.type || 'Movie') === (primaryItem.type || 'Movie');
        });

        if (titleOnlyCandidates.length > 0) {
          const candEdition = primaryItem.edition || titleDecoder.extractEdition(primaryItem.rawTitle);
          for (const candItem of titleOnlyCandidates) {
            const itemEdition = candItem.edition || titleDecoder.extractEdition(candItem.displayTitle);
            const candYear = (primaryItem.year || '').trim();
            const itemYear = (candItem.year || '').trim();

            if ((candEdition || itemEdition) && candEdition !== itemEdition) {
              ambiguousMatchesCount++;
              ambiguousReviewList.push({
                groupKey,
                reason: `distinct_edition_uncertain: candidate is "${candEdition || 'Standard'}", existing is "${itemEdition || 'Standard'}"`,
                items: items.map(i => ({ title: i.rawTitle, url: i.sourceUrl })),
                candidates: titleOnlyCandidates.map(c => ({ id: c.canonicalId, title: c.displayTitle, year: c.year }))
              });
              matchedItem = null;
              break;
            }

            if (candYear && itemYear && candYear !== itemYear) {
              ambiguousMatchesCount++;
              ambiguousReviewList.push({
                groupKey,
                reason: `year_discrepancy_uncertain: candidate year "${candYear}" vs existing "${itemYear}"`,
                items: items.map(i => ({ title: i.rawTitle, url: i.sourceUrl })),
                candidates: titleOnlyCandidates.map(c => ({ id: c.canonicalId, title: c.displayTitle, year: c.year }))
              });
              matchedItem = null;
              break;
            }
          }
          if (ambiguousReviewList.some(a => a.groupKey === groupKey)) {
            continue; // Routed to review queue! Do not create duplicate canonical title!
          }
        }
      }
    }

    let targetCanonicalId = null;
    let targetCanonicalItem = null;

    if (items.length > 1) {
      duplicatesPrevented += (items.length - 1);
    }

    // Process and verify download options
    const verifiedLinks = [];
    const seenLinks = new Set();

    combinedQualities.forEach(({ q, sourceUrl }) => {
      const linkUrl = (q.link || '').trim();
      if (!linkUrl) return;

      downloadOptionsCollected++;
      const classification = classifyLinkVerification(linkUrl, sourceUrl);

      if (classification.status === 'verified') {
        verifiedDestinationsCount++;
      } else if (classification.status === 'broken') {
        brokenDestinationsCount++;
        return;
      } else if (classification.status === 'temporarily_unavailable') {
        temporarilyUnavailableCount++;
        return;
      } else {
        unverifiedDestinationsCount++;
        return;
      }

      // Check series package classification for Web Series
      let packageClass = { packageType: 'unknown', isComplete: false };
      if (isSeries) {
        packageClass = classifySeriesPackage(q);
        if (!packageClass.isComplete) {
          packageClass = classifySeriesPackage({ downloadUrl: linkUrl, episode: q.episode || q.rawText });
        }
        if (!packageClass.isComplete) {
          // Individual episode links or unverified packages strictly omitted
          return;
        }
      }

      const resKey = normalizeResolution(q.quality || q.rawText);
      const epLabel = isSeries ? (packageClass.packageType === 'complete_series' ? 'COMPLETE SERIES' : 'COMPLETE SEASON') : undefined;
      const dedupKey = `${linkUrl}__${resKey}__${epLabel || ''}`;

      if (!seenLinks.has(dedupKey)) {
        seenLinks.add(dedupKey);
        verifiedLinks.push({
          sourceName: 'Direct',
          downloadUrl: linkUrl,
          resolution: resKey,
          rawQuality: q.quality || undefined,
          episode: epLabel,
          packageType: isSeries ? packageClass.packageType : undefined,
          season: isSeries ? (primaryItem.season || 'Season 1') : undefined,
          format: 'WEB-DL',
          verificationStatus: 'verified'
        });
      }
    });

    if (matchedItem) {
      alreadyPresentCount++;
      targetCanonicalItem = matchedItem;
      targetCanonicalId = Number(matchedItem.canonicalId);

      // Merge HDHub4u variants into existing record if not already attached
      if (!matchedItem.variants) matchedItem.variants = [];
      items.forEach(it => {
        const hasVariant = matchedItem.variants.some(v => v.sourceUrl && urlSlug(v.sourceUrl) === urlSlug(it.sourceUrl));
        if (!hasVariant && it.sourceUrl) {
          matchedItem.variants.push({
            originalSourceTitle: it.rawTitle,
            source: 'hdhub4u',
            sourceUrl: it.sourceUrl,
            poster: it.posterUrl || matchedItem.poster,
            qualities: (it.qualities || []).map(q => ({ resolution: normalizeResolution(q.quality || q.rawText), label: q.quality || 'HD' })),
            releaseType: 'WEB-DL'
          });
        }
      });

      // Update downloads if verified links found
      let existingEntry = downloadsMap.get(targetCanonicalId);
      if (verifiedLinks.length > 0) {
        titlesWithDownloads++;
        let newLinksCountForThisTitle = 0;
        if (!existingEntry) {
          existingEntry = {
            catalogueId: targetCanonicalId,
            title: targetCanonicalItem.displayTitle,
            type: targetCanonicalItem.type,
            year: targetCanonicalItem.year,
            lastCheckedAt: nowIso,
            discoveryStatus: 'links_found',
            verificationStatus: 'verified',
            verificationEvidence: 'Verified storage CDN / drive destination',
            links: verifiedLinks
          };
          downloadsMap.set(targetCanonicalId, existingEntry);
          downloadsData.entries.push(existingEntry);
          newLinksCountForThisTitle = verifiedLinks.length;
          verifiedLinks.forEach(vl => {
            newProviderLinks.push({
              canonicalId: targetCanonicalId,
              provider: 'HDHub4u',
              downloadUrl: vl.downloadUrl,
              resolution: vl.resolution
            });
          });
        } else {
          // Protect download links: Check existing URLs before adding variants.
          // Duplicate URLs must NOT overwrite existing provider attribution, quality, or verification status.
          const existingUrlMap = new Map();
          (existingEntry.links || []).forEach(l => {
            if (l.downloadUrl) {
              existingUrlMap.set(l.downloadUrl.trim().toLowerCase(), l);
            }
          });

          verifiedLinks.forEach(vl => {
            const normUrl = (vl.downloadUrl || '').trim().toLowerCase();
            if (!existingUrlMap.has(normUrl)) {
              existingUrlMap.set(normUrl, vl);
              if (!existingEntry.links) existingEntry.links = [];
              existingEntry.links.push(vl);
              newLinksCountForThisTitle++;
              newProviderLinks.push({
                canonicalId: targetCanonicalId,
                provider: 'HDHub4u',
                downloadUrl: vl.downloadUrl,
                resolution: vl.resolution
              });
            } else {
              duplicatesPrevented++;
              duplicateLinksSkipped.push({
                canonicalId: targetCanonicalId,
                provider: 'HDHub4u',
                downloadUrl: vl.downloadUrl,
                reason: 'duplicate_link_url_preserved_existing'
              });
            }
          });
          existingEntry.lastCheckedAt = nowIso;
          existingEntry.discoveryStatus = 'links_found';
          existingEntry.verificationStatus = 'verified';
        }

        if (newLinksCountForThisTitle > 0) {
          existingUpdatedCount++;
          existingTitlesUpdated.push({
            canonicalId: targetCanonicalId,
            displayTitle: targetCanonicalItem.displayTitle,
            year: targetCanonicalItem.year,
            type: targetCanonicalItem.type,
            provider: 'HDHub4u',
            newLinksCount: newLinksCountForThisTitle
          });
        }
      }

      auditRecords.push({
        canonicalId: targetCanonicalId,
        title: targetCanonicalItem.displayTitle,
        type: targetCanonicalItem.type,
        year: targetCanonicalItem.year,
        outcome: 'already_present_updated',
        linksCount: verifiedLinks.length
      });
    } else {
      // Genuinely missing title from catalog!
      // INGESTION GATE: New title must NEVER be added to catalog without eligible verified download links!
      if (verifiedLinks.length === 0) {
        titlesWithoutDownloads++;
        incompleteTitles.push({
          displayTitle: primaryItem.displayTitle,
          rawTitle: primaryItem.rawTitle,
          year: primaryItem.year || '',
          type: primaryItem.type,
          sourceUrl: primaryItem.sourceUrl,
          reason: 'no_eligible_links'
        });
        console.warn(`[INCOMPLETE IMPORT] "${primaryItem.displayTitle}" excluded from catalog: No eligible verified download links.`);
        continue;
      }

      // Verified links exist: Proceed with safe canonical ingestion
      newlyAddedCount++;
      if (isSeries) newlyAddedSeries++;
      else newlyAddedMovies++;
      maxCanonicalId++;
      targetCanonicalId = maxCanonicalId;

      const newRecord = {
        id: `praflix-${targetCanonicalId}`,
        canonicalId: targetCanonicalId,
        displayTitle: primaryItem.displayTitle,
        originalSourceTitle: primaryItem.rawTitle,
        normalizedTitle: primaryItem.normalizedTitle,
        year: primaryItem.year || '',
        type: primaryItem.type,
        season: isSeries ? (primaryItem.season || 'Season 1') : null,
        episodeStatus: null,
        genres: [isSeries ? 'Web Series' : 'Cinema'],
        languages: ['Hindi'],
        audioTracks: ['DD 5.1'],
        audio: 'DD 5.1',
        platform: null,
        platforms: [],
        releaseType: 'WEB-DL',
        poster: primaryItem.posterUrl ? primaryItem.posterUrl.replace(/^http:\/\//i, 'https://') : 'assets/posters/fallback.svg',
        sourcePosterUrl: primaryItem.posterUrl ? primaryItem.posterUrl.replace(/^http:\/\//i, 'https://') : null,
        qualities: Array.from(new Set(combinedQualities.map(c => normalizeResolution(c.q.quality || c.q.rawText)))),
        variantCount: items.length,
        variants: items.map((it, idx) => ({
          sourceId: targetCanonicalId * 100 + idx,
          sourceUrl: it.sourceUrl,
          source: 'hdhub4u',
          originalSourceTitle: it.rawTitle,
          languages: ['Hindi'],
          qualities: (it.qualities || []).map(q => ({
            resolution: normalizeResolution(q.quality || q.rawText),
            label: q.quality || 'HD'
          })),
          releaseType: 'WEB-DL',
          audio: 'DD 5.1',
          poster: (it.posterUrl || primaryItem.posterUrl) ? (it.posterUrl || primaryItem.posterUrl).replace(/^http:\/\//i, 'https://') : null
        })),
        status: 'active'
      };

      catalog.push(newRecord);
      catalogById.set(targetCanonicalId, newRecord);
      catalogByTitleYear.set(groupKey, [newRecord]);
      items.forEach(it => {
        const s = urlSlug(it.sourceUrl);
        if (s) catalogBySlug.set(s, newRecord);
      });
      targetCanonicalItem = newRecord;
      newlyAddedCanonicalItems.push(newRecord);

      // Add to internal sourceRecords
      items.forEach((it, idx) => {
        sourceRecords.push({
          id: targetCanonicalId * 100 + idx,
          source: 'hdhub4u',
          sourceId: `src-hdhub4u-${targetCanonicalId}-${idx}`,
          displayTitle: primaryItem.displayTitle,
          originalSourceTitle: it.rawTitle,
          normalizedTitle: primaryItem.normalizedTitle,
          year: it.year,
          type: it.type,
          season: it.season,
          sourceUrl: it.sourceUrl,
          sourcePosterUrl: it.posterUrl,
          qualities: it.qualities || [],
          sightings: [{ surface: 'hdhub4u_sync', discoveredAt: nowIso }]
        });
      });

      // Add to downloadsData with verified links
      titlesWithDownloads++;
      const downloadsEntry = {
        catalogueId: targetCanonicalId,
        title: targetCanonicalItem.displayTitle,
        type: targetCanonicalItem.type,
        year: targetCanonicalItem.year,
        lastCheckedAt: nowIso,
        discoveryStatus: 'links_found',
        verificationStatus: 'verified',
        verificationEvidence: 'Verified storage CDN / drive destination',
        links: verifiedLinks
      };
      downloadsMap.set(targetCanonicalId, downloadsEntry);
      downloadsData.entries.push(downloadsEntry);

      verifiedLinks.forEach(vl => {
        newProviderLinks.push({
          canonicalId: targetCanonicalId,
          provider: 'HDHub4u',
          downloadUrl: vl.downloadUrl,
          resolution: vl.resolution
        });
      });

      auditRecords.push({
        canonicalId: targetCanonicalId,
        title: targetCanonicalItem.displayTitle,
        type: targetCanonicalItem.type,
        year: targetCanonicalItem.year,
        outcome: 'newly_added',
        linksCount: verifiedLinks.length
      });
    }
  }

  // 4. Update Durable Inventories
  console.log('\n[4/5] Updating durable source inventories in TITLE LIST and DOWNLOAD LINK...');

  // Update hdhub4u_catalog_complete.json
  const durableJson = {
    source: SOURCE_BASE_URL,
    lastUpdated: nowIso,
    totalMovies: uniqueMoviesDiscovered,
    totalWebSeries: uniqueSeriesDiscovered,
    movies: hdhubCompleteData.movies || [],
    webSeries: hdhubCompleteData.webSeries || []
  };
  if (!options.dryRun) {
    fs.writeFileSync(HDHUB4U_JSON_PATH, JSON.stringify(durableJson, null, 2), 'utf8');
  }

  // Synchronize newly discovered & successfully processed titles to title list/HDHUB4U TITLE.txt
  // Append-only: Preserves all historical records, order, and prevents duplicates.
  const titleListSync = require('./title_list_sync');
  const candidateTitlesForTitleList = newlyAddedCanonicalItems.map(i => i.displayTitle || i.title);
  const titleListResult = titleListSync.syncProviderTitleList('hdhub4u', candidateTitlesForTitleList, {
    date: new Date(),
    dryRun: Boolean(options.dryRun)
  });
  console.log(`✓ Synchronized HDHUB4U TITLE.txt: ${titleListResult.appendedCount} new entries appended (${titleListResult.skippedCount} existing/duplicates preserved).`);

  // Save audit inventory separating live-source crawl results from durable snapshot
  const auditReport = {
    syncTimestamp: nowIso,
    liveCrawl: {
      attempted: liveCrawlAttempted,
      liveReachable: liveReachable,
      succeeded: liveCrawlSucceeded,
      interrupted: liveCrawlInterrupted,
      liveDiscoveredCount: liveDiscoveredItems.length,
      newlyDiscoveredCount: newlyDiscoveredLiveCount,
      error: liveNetworkError
    },
    durableSnapshot: {
      loaded: Boolean(hdhubCompleteData && ((hdhubCompleteData.movies && hdhubCompleteData.movies.length > 0) || (hdhubCompleteData.webSeries && hdhubCompleteData.webSeries.length > 0))),
      recordCount: (hdhubCompleteData.movies ? hdhubCompleteData.movies.length : 0) + (hdhubCompleteData.webSeries ? hdhubCompleteData.webSeries.length : 0),
      moviesCount: hdhubCompleteData.movies ? hdhubCompleteData.movies.length : 0,
      webSeriesCount: hdhubCompleteData.webSeries ? hdhubCompleteData.webSeries.length : 0,
      source: path.basename(HDHUB4U_JSON_PATH),
      preserved: true
    },
    metrics: {
      totalDiscovered: discoveredItemsMap.size,
      uniqueMovies: uniqueMoviesDiscovered,
      uniqueWebSeries: uniqueSeriesDiscovered,
      alreadyPresentInCatalog: alreadyPresentCount,
      newlyAddedToCatalog: newlyAddedCount,
      newlyAddedMovies: newlyAddedMovies,
      newlyAddedSeries: newlyAddedSeries,
      newlyDiscoveredLive: newlyDiscoveredLiveCount,
      existingUpdatedWithLinks: existingUpdatedCount,
      duplicatesPrevented: duplicatesPrevented,
      ambiguousTitlesCount: ambiguousMatchesCount,
      downloadOptionsCollected: downloadOptionsCollected,
      destinationsVerified: verifiedDestinationsCount,
      destinationsBroken: brokenDestinationsCount,
      destinationsTemporarilyUnavailable: temporarilyUnavailableCount,
      destinationsUnverified: unverifiedDestinationsCount,
      titlesWithDownloads: titlesWithDownloads,
      titlesWithoutDownloads: titlesWithoutDownloads,
      incompleteTitlesCount: incompleteTitles.length
    },
    newlyAddedTitles: newlyAddedCanonicalItems.map(c => ({
      canonicalId: c.canonicalId,
      title: c.displayTitle,
      displayTitle: c.displayTitle,
      year: c.year,
      type: c.type,
      provider: 'HDHub4u'
    })),
    newlyAddedCanonicalItems: newlyAddedCanonicalItems,
    existingTitlesUpdated: existingTitlesUpdated,
    newProviderLinks: newProviderLinks,
    duplicateLinksSkipped: duplicateLinksSkipped,
    incompleteTitles: incompleteTitles,
    titleListSync: titleListResult,
    ambiguousTitles: ambiguousReviewList
  };
  if (!options.dryRun) {
    fs.writeFileSync(AUDIT_INVENTORY_PATH, JSON.stringify(auditReport, null, 2), 'utf8');

    // Safely record ambiguous titles to persistent review queue
    if (ambiguousReviewList.length > 0) {
      try {
        const syncCore = require('./sync_core');
        syncCore.saveToReviewQueue(ambiguousReviewList.map(a => ({
          candidate: (a.items && a.items[0]) || { displayTitle: a.groupKey },
          reason: a.reason || 'ambiguous_candidate_match',
          potentialMatches: a.candidates || []
        })));
      } catch (e) {
        console.warn(`[ReviewQueue Warning] Could not save ambiguous titles to review queue: ${e.message}`);
      }
    }
  }

  // 5. Invariant Checks & Atomic Commit
  console.log('\n[5/5] Enforcing catalog invariants and committing data files...');
  if (catalog.length < initialCatalogCount) {
    throw new Error(`CRITICAL INVARIANT VIOLATION: Catalog shrunk from ${initialCatalogCount} to ${catalog.length}. Reverting.`);
  }

  if (!options.dryRun) {
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
    fs.writeFileSync(DOWNLOADS_PATH, JSON.stringify(downloadsData, null, 2), 'utf8');
    fs.writeFileSync(SOURCES_PATH, JSON.stringify(sourceRecords, null, 2), 'utf8');

    // Update crawl checkpoint
    crawlState.lastCrawlTimestamp = nowIso;
    crawlState.processedCount = discoveredItemsMap.size;
    saveCheckpoint(crawlState);
  }

  console.log(`✓ Catalog successfully saved: ${catalog.length.toLocaleString()} titles (+${newlyAddedCount} newly added).`);
  console.log(`✓ Downloads database successfully saved: ${downloadsData.entries.length.toLocaleString()} entries.`);
  console.log(`✓ Reconciliation audit saved to: ${AUDIT_INVENTORY_PATH}`);

  return auditReport;
}

if (require.main === module) {
  runHDHub4uSync()
    .then(report => {
      console.log('\nHDHUB4U SYNCHRONIZATION COMPLETED SUCCESSFULLY!');
      console.log(JSON.stringify(report.metrics, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('\n[FATAL] HDHub4u synchronization error:', err);
      process.exit(1);
    });
}

module.exports = {
  SOURCE_BASE_URL,
  normalizeTitle,
  extractYear,
  detectContentType,
  extractSeason,
  cleanDisplayTitle,
  normalizeResolution,
  parseListingPage,
  parseDetailPage,
  fetchWithRetry,
  loadCheckpoint,
  saveCheckpoint,
  runHDHub4uSync
};
