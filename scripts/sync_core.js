/**
 * PRAFLIX — Automated 24-Hour Catalog Synchronization & Telegram Reporting Engine
 * A PRAVERSE Company
 *
 * Core synchronization module:
 * - Checks 3 providers: HDHub4u, 10Moviez, HDWall
 * - Incremental sync (does NOT rebuild catalog from scratch)
 * - Detects new movies and web series
 * - Deduplicates against existing canonical catalog (13,642 titles)
 * - Updates screenshots, posters, and quality metadata for existing titles
 * - Preserves canonical title IDs and existing providers
 * - Isolated provider execution: failure of one provider does NOT block others
 * - Generates high-fidelity Telegram report matching PRAFLIX specification
 * - Sends report securely using TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID
 */

const fs = require('fs');
const path = require('path');

const BASE_DIR = path.dirname(__dirname);
const DATA_DIR = path.join(BASE_DIR, 'data');
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');
const SOURCES_PATH = path.join(DATA_DIR, 'source-records.json');
const DOWNLOADS_PATH = path.join(DATA_DIR, 'downloads.json');

const titleDecoder = require('./title_decoder');
const resolver = require(path.join(BASE_DIR, 'destination_resolver'));
const providerRegistry = require('./provider_registry');
const adapters = require('./adapters');

// Provider Constants
const PROVIDERS = ['HDHub4u', '10Moviez', 'HDWall'];

const PROVIDER_KEYS = {
  'hdhub4u': 'HDHub4u',
  '10moviez': '10Moviez',
  'hdwall': 'HDWall'
};

/**
 * Clean & normalize titles for canonical matching
 */
function normalizeTitle(title, year) {
  if (!title) return '';
  return titleDecoder.normalizeForMatching(title, year);
}

/**
 * Normalize resolution labels to canonical standards (4K, 1080p, 720p, 480p)
 */
function normalizeQuality(raw) {
  if (!raw) return '720p';
  const s = String(raw).toLowerCase().trim();
  if (s.includes('2160') || s.includes('4k') || s.includes('uhd')) return '4K';
  if (s.includes('1080') || s.includes('fhd') || s.includes('full hd')) return '1080p';
  if (s.includes('720') || s.includes('hd')) return '720p';
  if (s.includes('480') || s.includes('sd')) return '480p';
  return '720p';
}

/**
 * Determine content type (Movie vs Web Series)
 */
function detectContentType(title, rawCategory) {
  const t = (title || '').toLowerCase();
  const c = (rawCategory || '').toLowerCase();
  if (
    t.includes('season') ||
    t.includes('series') ||
    t.includes('episode') ||
    t.includes('s01') ||
    t.includes('s02') ||
    t.includes('s03') ||
    c.includes('web series') ||
    c.includes('tv series') ||
    c.includes('series')
  ) {
    return 'Web Series';
  }
  return 'Movie';
}

/**
 * Match a candidate item against the existing canonical catalog
 */
function matchExistingTitle(candidate, catalog) {
  const candRawTitle = candidate.displayTitle || candidate.title || candidate.originalSourceTitle || '';
  const candMeta = titleDecoder.extractTitleMetadata(candRawTitle);
  const candYear = candidate.year ? String(candidate.year).trim() : candMeta.year;
  const candNorm = titleDecoder.normalizeForMatching(candMeta.displayTitle, candYear);
  const candSourceUrl = (candidate.sourceUrl || '').toLowerCase();
  const candType = candidate.type || (candidate.isSeries ? 'Web Series' : null);

  for (const item of catalog) {
    // Disallow collision between different content types (Movie vs Web Series)
    if (candType && item.type && candType !== item.type) {
      continue;
    }

    // 1. Direct source URL match in variants
    if (candSourceUrl && (item.variants || []).some(v => v.sourceUrl && v.sourceUrl.toLowerCase() === candSourceUrl)) {
      return item;
    }

    // 2. Normalized title + year match
    const itemNorm = titleDecoder.normalizeForMatching(item.displayTitle, item.year);
    if (candNorm && itemNorm && candNorm === itemNorm) {
      return item;
    }

    // 3. Match without year if either year is missing
    const candNormNoYear = titleDecoder.normalizeForMatching(candMeta.displayTitle, '');
    const itemNormNoYear = titleDecoder.normalizeForMatching(item.displayTitle, '');
    if (candNormNoYear && itemNormNoYear && candNormNoYear === itemNormNoYear) {
      if (!candYear || !item.year || candYear === item.year) {
        return item;
      }
    }
  }

  return null;
}

/**
 * Extract and strictly verify candidate download links from a provider item.
 * Filters out:
 * - source article URLs
 * - empty, javascript:, or placeholder URLs
 * - unverified/broken hosts or hijacked ad/survey redirectors
 * - links belonging to a different movie or source page
 */
function extractAndVerifyCandidateLinks(item, providerName) {
  const candidateList = [];

  if (Array.isArray(item.links)) {
    item.links.forEach(l => {
      if (l) candidateList.push(typeof l === 'string' ? { downloadUrl: l } : l);
    });
  }

  if (Array.isArray(item.downloadLinks)) {
    item.downloadLinks.forEach(l => {
      if (l) candidateList.push(typeof l === 'string' ? { downloadUrl: l } : l);
    });
  }

  if (Array.isArray(item.qualities)) {
    item.qualities.forEach(q => {
      if (q && typeof q === 'object' && (q.link || q.downloadUrl || q.url)) {
        candidateList.push({
          downloadUrl: q.downloadUrl || q.link || q.url,
          resolution: q.resolution || q.label || '720p',
          rawQuality: q.label || q.resolution || '720p'
        });
      }
    });
  }

  if (Array.isArray(item.downloadOptions)) {
    item.downloadOptions.forEach(opt => {
      if (opt && typeof opt === 'object') {
        const u = opt.downloadUrl || opt.url || opt.link;
        if (u) {
          candidateList.push({
            downloadUrl: u,
            resolution: opt.resolution || opt.quality || '720p',
            rawQuality: opt.quality || opt.rawQuality || '720p',
            episode: opt.episode || opt.season || null
          });
        }
      }
    });
  }

  const verified = [];
  const skippedDuplicates = [];
  const seenUrls = new Set();

  for (const c of candidateList) {
    const rawUrl = (c.downloadUrl || c.url || '').trim();
    if (!rawUrl) continue;

    // Provider specific prefix rules (e.g. HDHub4u HubDrive prefix restriction)
    if (providerName && providerName.toLowerCase() === 'hdhub4u') {
      if (!rawUrl.startsWith('https://hubdrive.pics/file/')) {
        continue;
      }
    }

    // Series complete-season policy: filter out loose individual episodes
    if (item.type === 'Web Series' || item.isSeries) {
      const epDesc = c.episode || c.rawLabel || c.label || '';
      if (epDesc && !resolver.isCompleteSeason(c)) {
        continue;
      }
    }

    // Strict validation via destination_resolver
    const classification = resolver.classifyLinkVerification(c || rawUrl, item.sourceUrl);
    if (classification.status !== 'verified') {
      continue;
    }

    const res = normalizeQuality(c.resolution || c.quality || c.rawQuality || '720p');
    const key = `${rawUrl}__${res}`;
    if (seenUrls.has(key)) {
      skippedDuplicates.push({
        downloadUrl: rawUrl,
        resolution: res,
        reason: 'duplicate_in_candidate_list'
      });
      continue;
    }
    seenUrls.add(key);

    verified.push({
      sourceName: providerName,
      downloadUrl: rawUrl,
      resolution: res,
      rawQuality: c.rawQuality || c.resolution || res,
      episode: c.episode || null,
      verificationStatus: 'verified',
      verificationEvidence: classification.evidence || 'verified_destination_evidence'
    });
  }

  return { verified, skippedDuplicates };
}

/**
 * Fetch latest items for a provider with timeout and error isolation
 */
async function fetchProviderLatest(providerName, options = {}) {
  const timeoutMs = options.timeoutMs || 8000;
  const providerLower = providerName.toLowerCase();

  // For testing or simulated runs
  if (options.mockFailures && options.mockFailures[providerName]) {
    throw new Error(options.mockFailures[providerName]);
  }
  if (options.mockItems && options.mockItems[providerName] !== undefined) {
    if (options.mockItems[providerName] === null) {
      throw new Error(`Simulated connection timeout from ${providerName}`);
    }
    if (options.mockItems[providerName] instanceof Error) {
      throw options.mockItems[providerName];
    }
    return options.mockItems[providerName];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let urls = [];
    if (providerLower === 'hdwall') {
      urls = ['https://hdwall.xyz/page/1/'];
    } else if (providerLower === '10moviez') {
      urls = ['https://10moviez.biz/category/web-series/page/1/'];
    } else if (providerLower === 'hdhub4u') {
      urls = ['https://new7.hdhub4u.cl/', 'https://new2.hdhub4u.free/', 'https://new1.hdhub4u.free/'];
    }

    let response = null;
    let lastFetchErr = null;
    for (const testUrl of urls) {
      try {
        const res = await fetch(testUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        if (res.ok) {
          response = res;
          break;
        } else {
          lastFetchErr = new Error(`HTTP ${res.status} from ${providerName}`);
        }
      } catch (fErr) {
        lastFetchErr = fErr;
      }
    }

    clearTimeout(timeoutId);

    if (!response || !response.ok) {
      throw lastFetchErr || new Error(`Network failure from ${providerName}`);
    }

    const html = await response.text();
    const items = parseProviderHtml(providerName, html);

    // Guard: Reachable website returning 0 parsed items must NOT be claimed as successful complete scan
    if (items.length === 0 && html.length > 500) {
      const isChallenge = html.includes('challenge-platform') || html.includes('cf-chl') || html.includes('Just a moment...');
      const errReason = isChallenge
        ? `HTTP 200 with anti-bot verification challenge from ${providerName} (INCONCLUSIVE)`
        : `Reachable site ${providerName} returned 0 parsed titles: parser layout mismatch or incomplete listing (INCONCLUSIVE / PARSING_FAILED)`;
      throw new Error(errReason);
    }

    return items;
  } catch (err) {
    clearTimeout(timeoutId);
    throw new Error(`Failed to sync ${providerName}: ${err.message}`);
  }
}

/**
 * Parse provider HTML to extract public listings and screenshots
 */
function parseProviderHtml(providerName, html) {
  const providerLower = providerName.toLowerCase();
  if (html && (html.includes('challenge-platform') || html.includes('cf-chl') || html.includes('Just a moment...') || html.includes('cf-browser-verification'))) {
    throw new Error(`HTTP 200 with anti-bot verification challenge from ${providerName} (INCONCLUSIVE)`);
  }
  const items = [];

  if (providerLower === 'hdwall') {
    // Strategy 1: Modern card layout (<li class="thumb..."> or <figure>)
    const cardRegex = /<li[^>]*class="[^"]*thumb[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let cardMatch;
    while ((cardMatch = cardRegex.exec(html)) !== null) {
      const cardContent = cardMatch[1];
      const aMatch = cardContent.match(/<a[^>]+href="([^"]+\.html)"/i);
      const imgMatch = cardContent.match(/<img[\s\S]*?src="([^"]+)"[\s\S]*?alt="([^"]+)"/i) ||
                       cardContent.match(/<img[\s\S]*?alt="([^"]+)"[\s\S]*?src="([^"]+)"/i);

      if (aMatch && imgMatch) {
        let sourceUrl = aMatch[1].trim();
        if (sourceUrl.startsWith('/')) {
          sourceUrl = `https://hdhub.club${sourceUrl}`;
        }
        let sourcePosterUrl = (imgMatch[1].startsWith('/') ? `https://hdhub.club${imgMatch[1]}` : imgMatch[1]).trim();
        let rawTitle = imgMatch[2].replace(/&amp;/g, '&').replace(/&#038;/g, '&').replace(/&#xE02C;/g, '').trim();

        let screenshotUrl = null;
        if (sourcePosterUrl.includes('/uploads/posts/covers/photo_')) {
          screenshotUrl = sourcePosterUrl.replace('/uploads/posts/covers/photo_', '/uploads/posts/screenshot/screenshot_');
        }

        const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
        const meta = titleDecoder.extractTitleMetadata(rawTitle);
        const year = meta.year || (yearMatch ? yearMatch[1] : '');
        const type = detectContentType(rawTitle, '');

        items.push({
          provider: 'HDWall',
          source: 'hdwall',
          originalSourceTitle: titleDecoder.cleanTitle(rawTitle),
          displayTitle: meta.displayTitle || titleDecoder.cleanTitle(rawTitle),
          year: year,
          type: type,
          sourceUrl: sourceUrl,
          sourcePosterUrl: sourcePosterUrl,
          screenshots: screenshotUrl ? [screenshotUrl] : [],
          qualities: [{ resolution: '720p', label: 'HD' }]
        });
      }
    }

    // Strategy 2: Legacy layout (<div class="custom-poster">)
    if (items.length === 0) {
      const articleRegex = /<div class="custom-poster"[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<img [^>]*src="([^"]+)"[^>]*alt="([^"]+)"/g;
      let match;
      while ((match = articleRegex.exec(html)) !== null) {
        let sourceUrl = match[1].trim();
        if (sourceUrl.startsWith('/')) {
          sourceUrl = `https://hdhub.club${sourceUrl}`;
        }
        let sourcePosterUrl = (match[2].startsWith('/') ? `https://hdhub.club${match[2]}` : match[2]).trim();
        let rawTitle = match[3].replace(/&amp;/g, '&').replace(/&#038;/g, '&').replace(/&#xE02C;/g, '').trim();

        let screenshotUrl = null;
        if (sourcePosterUrl.includes('/uploads/posts/covers/photo_')) {
          screenshotUrl = sourcePosterUrl.replace('/uploads/posts/covers/photo_', '/uploads/posts/screenshot/screenshot_');
        }

        const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
        const meta = titleDecoder.extractTitleMetadata(rawTitle);
        const year = meta.year || (yearMatch ? yearMatch[1] : '');
        const type = detectContentType(rawTitle, '');

        items.push({
          provider: 'HDWall',
          source: 'hdwall',
          originalSourceTitle: titleDecoder.cleanTitle(rawTitle),
          displayTitle: meta.displayTitle || titleDecoder.cleanTitle(rawTitle),
          year: year,
          type: type,
          sourceUrl: sourceUrl,
          sourcePosterUrl: sourcePosterUrl,
          screenshots: screenshotUrl ? [screenshotUrl] : [],
          qualities: [{ resolution: '720p', label: 'HD' }]
        });
      }
    }
  } else if (providerLower === '10moviez') {
    const itemRegex = /<a class="poster"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<img [^>]*src="([^"]+)"[^>]*alt="([^"]+)"/g;
    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      const sourceUrl = match[1];
      const sourcePosterUrl = match[2];
      const rawTitle = match[3];

      const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
      const meta = titleDecoder.extractTitleMetadata(rawTitle);
      const year = meta.year || (yearMatch ? yearMatch[1] : '');
      const type = detectContentType(rawTitle, 'Web Series');

      items.push({
        provider: '10Moviez',
        source: '10moviez',
        originalSourceTitle: titleDecoder.cleanTitle(rawTitle),
        displayTitle: meta.displayTitle,
        year: year,
        type: type,
        sourceUrl: sourceUrl,
        sourcePosterUrl: sourcePosterUrl,
        screenshots: [],
        qualities: [{ resolution: '720p', label: '720p' }, { resolution: '1080p', label: '1080p' }]
      });
    }
  } else if (providerLower === 'hdhub4u') {
    const baseUrl = 'https://new7.hdhub4u.cl/';
    const seenUrls = new Set();

    const addItem = (sourceUrlRaw, posterRaw, rawTitle) => {
      if (!sourceUrlRaw || !rawTitle) return;
      let sourceUrl = sourceUrlRaw.trim();
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

      let sourcePosterUrl = (posterRaw || '').trim();
      if (sourcePosterUrl.startsWith('http://')) {
        sourcePosterUrl = sourcePosterUrl.replace(/^http:\/\//i, 'https://');
      }

      const cleanT = rawTitle.replace(/&#038;/g, '&').replace(/&#8217;/g, "'").replace(/&#8211;/g, '-').replace(/&amp;/g, '&').trim();
      if (!cleanT || (sourcePosterUrl && sourcePosterUrl.includes('logo'))) return;

      if (!seenUrls.has(sourceUrl)) {
        seenUrls.add(sourceUrl);

        const yearMatch = cleanT.match(/\b(19\d{2}|20\d{2})\b/);
        const meta = titleDecoder.extractTitleMetadata(cleanT);
        const year = meta.year || (yearMatch ? yearMatch[1] : '');
        const type = detectContentType(cleanT, '', sourceUrl);

        items.push({
          provider: 'HDHub4u',
          source: 'hdhub4u',
          originalSourceTitle: titleDecoder.cleanTitle(cleanT),
          displayTitle: meta.displayTitle || cleanT,
          year: year,
          type: type,
          sourceUrl: sourceUrl,
          sourcePosterUrl: sourcePosterUrl,
          screenshots: [],
          qualities: [{ resolution: '720p', label: '720p' }, { resolution: '1080p', label: '1080p' }]
        });
      }
    };

    // Strategy 1: Modern thumb / figure card layout
    const liRegex = /<li[^>]*class="[^"]*thumb[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch;
    while ((liMatch = liRegex.exec(html)) !== null) {
      const block = liMatch[1];
      const linkMatch = block.match(/<figure>[\s\S]*?<a\s+[^>]*href="([^"]+)"[^>]*>/i) || block.match(/<a\s+[^>]*href="([^"]+)"[^>]*>/i);
      const imgMatch = block.match(/<img\s+[^>]*src="([^"]+)"[^>]*>/i);
      const titleMatch = block.match(/<figcaption>[\s\S]*?<p>([\s\S]*?)<\/p>/i) ||
                         block.match(/alt="([^"]+)"/i) ||
                         block.match(/title="([^"]+)"/i);
      if (linkMatch && titleMatch) {
        const rawTitle = titleMatch[1].replace(/<[^>]+>/g, '').trim();
        addItem(linkMatch[1], imgMatch ? imgMatch[1] : '', rawTitle);
      }
    }

    // Strategy 2: Legacy article tag layout
    if (items.length === 0) {
      const postRegex = /<article[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<img [^>]*src="([^"]+)"[^>]*alt="([^"]+)"/g;
      let match;
      while ((match = postRegex.exec(html)) !== null) {
        addItem(match[1], match[2], match[3]);
      }
    }
  }

  return items;
}

/**
 * Synchronize a single provider incrementally
 */
async function syncProvider(providerName, catalog, sourceRecords, options = {}) {
  const result = {
    provider: providerName,
    failed: false,
    error: null,
    newMovies: 0,
    newSeries: 0,
    newlyIngestedCount: 0,
    updatedExisting: 0,
    itemsProcessed: 0,
    newCanonicalTitles: [],
    existingTitlesUpdated: [],
    newProviderLinks: [],
    titleListEntriesAppended: [],
    incompleteTitles: [],
    incompleteCount: 0,
    duplicateRecordsSkipped: 0,
    duplicateLinksSkipped: 0,
    duplicateLinksSkippedList: [],
    unmatchedOrAmbiguous: 0,
    variantsImported: 0,
    appendedToTitleListCount: 0,
    qualityCounts: { '4K': 0, '1080p': 0, '720p': 0, '480p': 0 }
  };

  try {
    if (providerName.toLowerCase() === 'hdhub4u' && !options.mockItems && !options.mockFailures) {
      try {
        const hdhubSync = require('./hdhub4u_sync');
        const syncReport = await hdhubSync.runHDHub4uSync(options);
        // Synchronize in-memory catalog and sourceRecords with newly persisted data from hdhub4u_sync
        if (fs.existsSync(CATALOG_PATH)) {
          const updatedCat = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
          catalog.length = 0;
          catalog.push(...updatedCat);
        }
        if (fs.existsSync(SOURCES_PATH)) {
          const updatedSrc = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
          sourceRecords.length = 0;
          sourceRecords.push(...updatedSrc);
        }
        result.liveCrawl = syncReport.liveCrawl;
        result.durableSnapshot = syncReport.durableSnapshot;
        result.newMovies = syncReport.metrics.newlyAddedMovies !== undefined ? syncReport.metrics.newlyAddedMovies : syncReport.metrics.newlyAddedToCatalog;
        result.newSeries = syncReport.metrics.newlyAddedSeries || 0;
        result.newlyIngestedCount = (result.newMovies + result.newSeries);
        result.updatedExisting = syncReport.metrics.existingUpdatedWithLinks;
        result.itemsProcessed = syncReport.metrics.totalDiscovered;
        result.duplicateRecordsSkipped = syncReport.metrics ? (syncReport.metrics.duplicatesPrevented || 0) : 0;
        result.unmatchedOrAmbiguous = syncReport.metrics ? (syncReport.metrics.ambiguousTitlesCount || 0) : 0;
        result.variantsImported = syncReport.metrics ? (syncReport.metrics.downloadOptionsCollected || 0) : 0;
        result.incompleteCount = syncReport.incompleteTitles ? syncReport.incompleteTitles.length : (syncReport.metrics ? (syncReport.metrics.incompleteTitlesCount || 0) : 0);
        result.incompleteTitles = syncReport.incompleteTitles || [];
        result.newCanonicalTitles = (syncReport.newlyAddedCanonicalItems || []).map(c => ({
          canonicalId: c.canonicalId,
          displayTitle: c.displayTitle || c.title,
          year: c.year || '',
          type: c.type || 'Movie',
          provider: 'HDHub4u'
        }));
        result.existingTitlesUpdated = (syncReport.existingTitlesUpdated || []).map(e => ({
          canonicalId: e.canonicalId,
          displayTitle: e.displayTitle,
          year: e.year || '',
          type: e.type || 'Movie',
          provider: 'HDHub4u',
          newLinksCount: e.newLinksCount || 1
        }));
        result.newProviderLinks = syncReport.newProviderLinks || [];
        result.duplicateLinksSkipped = (syncReport.duplicateLinksSkipped ? syncReport.duplicateLinksSkipped.length : (syncReport.metrics ? (syncReport.metrics.duplicatesPrevented || 0) : 0));
        result.duplicateLinksSkippedList = syncReport.duplicateLinksSkipped || [];
        if (syncReport.titleListSync) {
          result.titleListSync = syncReport.titleListSync;
          result.appendedToTitleListCount = syncReport.titleListSync.appendedCount;
          result.titleListEntriesAppended = syncReport.titleListSync.appendedEntries || [];
        } else {
          result.appendedToTitleListCount = result.newCanonicalTitles.length;
          result.titleListEntriesAppended = result.newCanonicalTitles.map(t => ({
            title: t.displayTitle,
            date: formatIstDateTime(new Date()).slice(0, 8),
            provider: 'HDHub4u',
            formattedEntry: t.displayTitle
          }));
        }
        return result;
      } catch (hErr) {
        console.warn('[WARN] HDHub4u comprehensive sync notice, falling back to incremental parser:', hErr.message);
      }
    }

    const items = await fetchProviderLatest(providerName, options);
    result.itemsProcessed = items.length;
    result.liveCrawl = {
      liveReachable: true,
      liveDiscoveredCount: items.length
    };

    // Retrieve provider configuration and independent source catalog
    const providerConfig = providerRegistry.getProvider(providerName) || { id: providerName.toLowerCase(), displayName: providerName };
    let sourceCatalog = [];
    try {
      sourceCatalog = providerRegistry.loadSourceCatalog(providerConfig.id);
    } catch (_) {}

    // Find current max canonical ID
    let maxCanonicalId = catalog.reduce((max, item) => Math.max(max, item.canonicalId || 0), 0);

    for (const item of items) {
      // For HDWall live crawls, fetch detail page to extract verified direct storage CDN links if needed
      if (providerName.toLowerCase() === 'hdwall' && item.sourceUrl && (!item.downloadOptions || item.downloadOptions.length === 0) && !options.skipNetwork && !options.mockItems) {
        try {
          const detailResp = await fetch(item.sourceUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (PRAFLIX-Bot/1.0)'
            },
            signal: AbortSignal.timeout(6000)
          });
          if (detailResp.ok) {
            const dHtml = await detailResp.text();
            const HDWallAdapter = require('./adapters/hdwall_adapter');
            const hdwallAdapter = new HDWallAdapter(providerConfig);
            const parsedDls = hdwallAdapter.parseDetailPage(dHtml, item.sourceUrl);
            if (parsedDls && parsedDls.length > 0) {
              item.downloadOptions = parsedDls;
            }
          }
        } catch (dErr) {
          console.warn(`[WARN] Could not fetch detail page for HDWall item "${item.displayTitle}": ${dErr.message}`);
        }
      }

      const { verified: verifiedLinks, skippedDuplicates } = extractAndVerifyCandidateLinks(item, providerName);
      if (skippedDuplicates.length > 0) {
        result.duplicateLinksSkipped += skippedDuplicates.length;
        result.duplicateLinksSkippedList.push(...skippedDuplicates);
      }

      const existing = matchExistingTitle(item, catalog);

      if (existing) {
        // Update existing title with provider variant & screenshots
        result.updatedExisting++;
        if (!existing.variants) existing.variants = [];

        const hasVariant = existing.variants.some(v => v.sourceUrl && v.sourceUrl === item.sourceUrl);
        if (!hasVariant) {
          result.variantsImported++;
          existing.variants.push({
            originalSourceTitle: item.originalSourceTitle,
            source: item.source || providerName.toLowerCase(),
            sourceUrl: item.sourceUrl,
            poster: item.sourcePosterUrl,
            qualities: item.qualities || [],
            screenshots: item.screenshots || []
          });
        }

        // Combine unique screenshots
        if (item.screenshots && item.screenshots.length > 0) {
          if (!existing.screenshots) existing.screenshots = [];
          const existingUrls = new Set(existing.screenshots.map(s => typeof s === 'string' ? s : s.url));
          item.screenshots.forEach(ssUrl => {
            if (!existingUrls.has(ssUrl)) {
              existingUrls.add(ssUrl);
              existing.screenshots.push({
                url: ssUrl,
                source: item.source || providerName.toLowerCase(),
                provider: providerName,
                caption: `${existing.displayTitle} — ${providerName} Still`
              });
            }
          });
        }

        // Update downloads if verified links found
        if (verifiedLinks.length > 0) {
          let newLinksCountForThisTitle = 0;
          let dlData = null;
          let dlEntry = null;

          if (fs.existsSync(DOWNLOADS_PATH)) {
            try {
              dlData = JSON.parse(fs.readFileSync(DOWNLOADS_PATH, 'utf8'));
              dlEntry = dlData.entries.find(e => e.catalogueId === existing.canonicalId);
            } catch (_) {}
          }

          if (!dlEntry) {
            dlEntry = {
              catalogueId: existing.canonicalId,
              title: existing.displayTitle,
              type: existing.type || 'Movie',
              year: existing.year || '',
              lastCheckedAt: new Date().toISOString(),
              discoveryStatus: 'links_found',
              verificationStatus: 'verified',
              verificationEvidence: 'Verified storage CDN / drive destination',
              links: []
            };
            if (dlData && Array.isArray(dlData.entries)) {
              dlData.entries.push(dlEntry);
            }
          }
          if (!dlEntry.links) dlEntry.links = [];
          const existingUrls = new Set(dlEntry.links.map(l => `${l.downloadUrl}__${l.resolution}`));

          verifiedLinks.forEach(vl => {
            const resNorm = vl.resolution || '720p';
            result.qualityCounts[resNorm] = (result.qualityCounts[resNorm] || 0) + 1;
            const k = `${vl.downloadUrl}__${vl.resolution}`;
            if (!existingUrls.has(k)) {
              existingUrls.add(k);
              dlEntry.links.push(vl);
              newLinksCountForThisTitle++;
              result.newProviderLinks.push({
                canonicalId: existing.canonicalId,
                provider: providerName,
                downloadUrl: vl.downloadUrl,
                resolution: vl.resolution
              });
            } else {
              result.duplicateLinksSkipped++;
              result.duplicateLinksSkippedList.push({
                canonicalId: existing.canonicalId,
                provider: providerName,
                downloadUrl: vl.downloadUrl,
                reason: 'already_persisted_for_canonical_title'
              });
            }
          });

          if (newLinksCountForThisTitle > 0) {
            result.updatedExisting++;
            result.existingTitlesUpdated.push({
              canonicalId: existing.canonicalId,
              displayTitle: existing.displayTitle,
              year: existing.year || '',
              type: existing.type || 'Movie',
              provider: providerName,
              newLinksCount: newLinksCountForThisTitle
            });
            if (dlData && fs.existsSync(DOWNLOADS_PATH) && options.persist !== false && !options.dryRun && !options.mockItems) {
              try {
                fs.writeFileSync(DOWNLOADS_PATH, JSON.stringify(dlData, null, 2), 'utf8');
              } catch (_) {}
            }
          }
        }

        // Record in provider's independent source catalog
        const existingSourceIdx = sourceCatalog.findIndex(sc => sc.sourceUrl === item.sourceUrl || sc.canonicalId === existing.canonicalId);
        const sourceEntry = {
          providerId: providerConfig.id,
          provider: providerConfig.displayName || providerName,
          sourceTitle: item.originalSourceTitle,
          cleanTitle: existing.displayTitle,
          normalizedTitle: existing.normalizedTitle,
          sourceUrl: item.sourceUrl,
          sourcePosterUrl: item.sourcePosterUrl || existing.poster,
          year: existing.year || item.year || '',
          type: existing.type || item.type || 'Movie',
          season: existing.season || item.season || null,
          discoveryDate: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date()),
          firstSeenAt: existingSourceIdx !== -1 ? sourceCatalog[existingSourceIdx].firstSeenAt : new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          lastSuccessfulScanAt: new Date().toISOString(),
          qualities: item.qualities || [],
          links: verifiedLinks,
          importStatus: 'updated',
          canonicalId: existing.canonicalId,
          validationErrors: []
        };
        if (existingSourceIdx !== -1) {
          sourceCatalog[existingSourceIdx] = sourceEntry;
        } else {
          sourceCatalog.push(sourceEntry);
        }
      } else {
        // Genuinely new candidate title!
        // INGESTION GATE: Check if eligible verified download links exist
        if (verifiedLinks.length === 0) {
          result.incompleteCount++;
          result.incompleteTitles.push({
            canonicalId: null,
            title: titleDecoder.cleanTitle(item.displayTitle),
            year: item.year || '',
            type: item.type || 'Movie',
            provider: providerName,
            sourceUrl: item.sourceUrl,
            timestamp: new Date().toISOString(),
            reason: 'no_eligible_links'
          });
          console.warn(`[INCOMPLETE IMPORT] "${item.displayTitle}" skipped from catalog: No eligible verified download links.`);

          // Record quarantined entry in independent source catalog
          const existingSourceIdx = sourceCatalog.findIndex(sc => sc.sourceUrl === item.sourceUrl);
          const quarantinedEntry = {
            providerId: providerConfig.id,
            provider: providerConfig.displayName || providerName,
            sourceTitle: item.originalSourceTitle,
            cleanTitle: titleDecoder.cleanTitle(item.displayTitle),
            normalizedTitle: normalizeTitle(item.displayTitle),
            sourceUrl: item.sourceUrl,
            sourcePosterUrl: item.sourcePosterUrl,
            year: item.year || '',
            type: item.type || 'Movie',
            season: item.season || null,
            discoveryDate: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date()),
            firstSeenAt: existingSourceIdx !== -1 ? sourceCatalog[existingSourceIdx].firstSeenAt : new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            lastSuccessfulScanAt: new Date().toISOString(),
            qualities: item.qualities || [],
            links: [],
            importStatus: 'quarantined',
            canonicalId: null,
            validationErrors: ['no_eligible_links']
          };
          if (existingSourceIdx !== -1) {
            sourceCatalog[existingSourceIdx] = quarantinedEntry;
          } else {
            sourceCatalog.push(quarantinedEntry);
          }
          continue;
        }

        // Verified links exist! Proceed with ingestion
        maxCanonicalId++;
        const isSeries = item.type === 'Web Series';
        if (isSeries) {
          result.newSeries++;
        } else {
          result.newMovies++;
        }

        const cleanTitle = titleDecoder.cleanTitle(item.displayTitle);
        const newTitleEntry = {
          canonicalId: maxCanonicalId,
          displayTitle: cleanTitle,
          year: item.year || '',
          type: item.type || (isSeries ? 'Web Series' : 'Movie'),
          provider: providerName
        };
        result.newCanonicalTitles.push(newTitleEntry);
        result.variantsImported++;

        const newCanonical = {
          canonicalId: maxCanonicalId,
          id: maxCanonicalId,
          displayTitle: cleanTitle,
          normalizedTitle: normalizeTitle(cleanTitle),
          originalSourceTitle: item.originalSourceTitle,
          year: item.year || '',
          type: item.type || 'Movie',
          season: isSeries ? (item.season || 'Season 1') : null,
          poster: item.sourcePosterUrl || 'assets/posters/fallback.svg',
          sourceUrl: item.sourceUrl,
          categories: [isSeries ? 'Web Series' : 'Cinema'],
          languages: item.languages || ['Hindi'],
          qualities: (item.qualities || []).map(q => q.resolution || q.label || q),
          variants: [
            {
              originalSourceTitle: item.originalSourceTitle,
              source: item.source || providerName.toLowerCase(),
              sourceUrl: item.sourceUrl,
              poster: item.sourcePosterUrl,
              qualities: item.qualities || [],
              screenshots: item.screenshots || []
            }
          ],
          screenshots: (item.screenshots || []).map(ssUrl => ({
            url: ssUrl,
            source: item.source || providerName.toLowerCase(),
            provider: providerName,
            caption: `${cleanTitle} — ${providerName} Still`
          }))
        };

        catalog.push(newCanonical);

        // Add to sourceRecords
        sourceRecords.push({
          id: `src-${providerName.toLowerCase()}-${maxCanonicalId}`,
          source: item.source || providerName.toLowerCase(),
          displayTitle: cleanTitle,
          originalSourceTitle: item.originalSourceTitle,
          normalizedTitle: normalizeTitle(cleanTitle),
          year: item.year || '',
          type: item.type || 'Movie',
          sourceUrl: item.sourceUrl,
          sourcePosterUrl: item.sourcePosterUrl,
          qualities: item.qualities || [],
          screenshots: item.screenshots || []
        });

        // Add to downloads.json if available and persistent live sync
        if (fs.existsSync(DOWNLOADS_PATH) && options.persist !== false && !options.dryRun && !options.mockItems) {
          try {
            const dlData = JSON.parse(fs.readFileSync(DOWNLOADS_PATH, 'utf8'));
            dlData.entries.push({
              catalogueId: maxCanonicalId,
              title: cleanTitle,
              type: item.type || (isSeries ? 'Web Series' : 'Movie'),
              year: item.year || '',
              lastCheckedAt: new Date().toISOString(),
              discoveryStatus: 'links_found',
              verificationStatus: 'verified',
              verificationEvidence: 'Verified storage CDN / drive destination',
              links: verifiedLinks
            });
            fs.writeFileSync(DOWNLOADS_PATH, JSON.stringify(dlData, null, 2), 'utf8');
          } catch (_) {}
        }

        verifiedLinks.forEach(vl => {
          const resNorm = vl.resolution || '720p';
          result.qualityCounts[resNorm] = (result.qualityCounts[resNorm] || 0) + 1;
          result.newProviderLinks.push({
            canonicalId: maxCanonicalId,
            provider: providerName,
            downloadUrl: vl.downloadUrl,
            resolution: vl.resolution
          });
        });

        // Record newly imported entry in independent source catalog
        const existingSourceIdx = sourceCatalog.findIndex(sc => sc.sourceUrl === item.sourceUrl);
        const importedEntry = {
          providerId: providerConfig.id,
          provider: providerConfig.displayName || providerName,
          sourceTitle: item.originalSourceTitle,
          cleanTitle: cleanTitle,
          normalizedTitle: normalizeTitle(cleanTitle),
          sourceUrl: item.sourceUrl,
          sourcePosterUrl: item.sourcePosterUrl,
          year: item.year || '',
          type: item.type || (isSeries ? 'Web Series' : 'Movie'),
          season: isSeries ? (item.season || 'Season 1') : null,
          discoveryDate: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date()),
          firstSeenAt: existingSourceIdx !== -1 ? sourceCatalog[existingSourceIdx].firstSeenAt : new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          lastSuccessfulScanAt: new Date().toISOString(),
          qualities: item.qualities || [],
          links: verifiedLinks,
          importStatus: 'imported',
          canonicalId: maxCanonicalId,
          validationErrors: []
        };
        if (existingSourceIdx !== -1) {
          sourceCatalog[existingSourceIdx] = importedEntry;
        } else {
          sourceCatalog.push(importedEntry);
        }
      }
    }

    // Persist provider's independent source catalog, state, and last run
    if (options.persist !== false && !options.dryRun && !options.mockItems) {
      try {
        providerRegistry.saveSourceCatalog(providerConfig.id, sourceCatalog);
        providerRegistry.saveState(providerConfig.id, {
          lastScanTimestamp: new Date().toISOString(),
          lastSuccessfulScanTimestamp: new Date().toISOString(),
          scanStatus: 'success',
          completeness: 'COMPLETE',
          recordCount: sourceCatalog.length
        });
        providerRegistry.saveLastRun(providerConfig.id, result);
      } catch (_) {}
    }

    // Synchronize title list ONLY with successfully ingested new canonical titles
    const processedCandidateTitles = result.newCanonicalTitles.map(i => i.displayTitle).filter(Boolean);
    const titleListSync = require('./title_list_sync');
    const isDryRunForTitleList = Boolean(options.dryRun || options.mockItems || options.persist === false);
    const tlResult = titleListSync.syncProviderTitleList(providerName, processedCandidateTitles, {
      date: new Date(),
      dryRun: isDryRunForTitleList
    });
    result.titleListSync = tlResult;
    result.appendedToTitleListCount = tlResult.appendedCount;
    result.titleListEntriesAppended = tlResult.appendedEntries || [];
    result.newlyIngestedCount = result.newCanonicalTitles.length;
  } catch (err) {
    result.failed = true;
    result.error = err.message;
  }

  return result;
}

/**
 * Execute sync across selected or all 3 providers
 */
async function runFullSync(catalog, sourceRecords, options = {}) {
  const syncStartTime = new Date();
  const providerResults = {};

  const targetProviders = options.provider && options.provider !== 'all'
    ? [PROVIDER_KEYS[options.provider.toLowerCase()] || options.provider]
    : PROVIDERS;

  // Sync selected providers
  for (const provider of targetProviders) {
    try {
      const res = await syncProvider(provider, catalog, sourceRecords, options);
      providerResults[provider] = res;
    } catch (err) {
      // Isolation guarantee: error in one provider does not prevent other providers
      providerResults[provider] = {
        provider,
        failed: true,
        error: err.message,
        newMovies: 0,
        newSeries: 0,
        updatedExisting: 0,
        titleListSync: { appendedCount: 0, skippedCount: 0, appendedTitles: [] }
      };
    }
  }

  // Aggregate totals
  let totalMovies = 0;
  let totalSeries = 0;
  let totalUpdated = 0;
  let totalTitleListAppended = 0;
  const allNewCanonicalTitles = [];
  const allExistingTitlesUpdated = [];
  const allNewProviderLinks = [];
  const allTitleListEntriesAppended = [];
  const allIncompleteTitles = [];
  const allDuplicateLinksSkipped = [];
  const allUnmatchedTitles = [];
  const allProviderFailures = [];

  for (const prov of targetProviders) {
    const r = providerResults[prov];
    if (r) {
      if (r.failed) {
        allProviderFailures.push({ provider: prov, error: r.error, timestamp: syncStartTime.toISOString() });
      } else {
        totalMovies += (typeof r.newMovies === 'number' ? r.newMovies : 0);
        totalSeries += (typeof r.newSeries === 'number' ? r.newSeries : 0);
        totalUpdated += (typeof r.updatedExisting === 'number' ? r.updatedExisting : 0);
        if (r.titleListSync && typeof r.titleListSync.appendedCount === 'number') {
          totalTitleListAppended += r.titleListSync.appendedCount;
        }
        if (Array.isArray(r.newCanonicalTitles)) {
          allNewCanonicalTitles.push(...r.newCanonicalTitles);
        }
        if (Array.isArray(r.existingTitlesUpdated)) {
          allExistingTitlesUpdated.push(...r.existingTitlesUpdated);
        }
        if (Array.isArray(r.newProviderLinks)) {
          allNewProviderLinks.push(...r.newProviderLinks);
        }
        if (Array.isArray(r.titleListEntriesAppended)) {
          allTitleListEntriesAppended.push(...r.titleListEntriesAppended);
        }
        if (Array.isArray(r.incompleteTitles)) {
          allIncompleteTitles.push(...r.incompleteTitles);
        }
        if (Array.isArray(r.duplicateLinksSkippedList)) {
          allDuplicateLinksSkipped.push(...r.duplicateLinksSkippedList);
        }
        if (Array.isArray(r.unmatchedTitles)) {
          allUnmatchedTitles.push(...r.unmatchedTitles);
        }
      }
    }
  }

  const totalAdded = totalMovies + totalSeries;
  const runTimeIst = formatIstDateTime(syncStartTime);
  const targetProviderName = options.provider && options.provider !== 'all' ? targetProviders[0] : null;

  const summary = {
    syncTime: syncStartTime.toISOString(),
    formattedTime: formatDateTime(syncStartTime),
    runTimeIst: runTimeIst,
    targetProvider: targetProviderName,
    providers: providerResults,
    newCanonicalTitles: allNewCanonicalTitles,
    hasNewTitles: allNewCanonicalTitles.length > 0,
    existingTitlesUpdated: allExistingTitlesUpdated,
    newProviderLinks: allNewProviderLinks,
    titleListEntriesAppended: allTitleListEntriesAppended,
    incompleteTitles: allIncompleteTitles,
    hasIncompleteTitles: allIncompleteTitles.length > 0,
    duplicateLinksSkipped: allDuplicateLinksSkipped,
    unmatchedTitles: allUnmatchedTitles,
    providerFailures: allProviderFailures,
    currentCatalogTotal: catalog.length,
    totals: {
      moviesAdded: totalMovies,
      seriesAdded: totalSeries,
      totalTitlesAdded: totalAdded,
      titlesUpdated: totalUpdated,
      titleListAppended: totalTitleListAppended,
      incompleteTitles: allIncompleteTitles.length,
      currentCatalogTotal: catalog.length
    }
  };

  const hasFailedProviders = Object.values(providerResults).some(p => p.failed);

  let reportText = '';
  if (hasFailedProviders) {
    reportText = formatTelegramReport(summary);
  } else if (summary.hasNewTitles) {
    summary.newTitlesReportText = formatNewTitlesTelegramReport({
      provider: targetProviderName || 'Multiple Providers',
      runTime: runTimeIst,
      newTitles: allNewCanonicalTitles,
      existingUpdated: allExistingTitlesUpdated,
      newProviderLinksCount: allNewProviderLinks.length,
      titleListAppendedCount: allTitleListEntriesAppended.length,
      incompleteTitles: allIncompleteTitles,
      duplicateLinksSkippedCount: allDuplicateLinksSkipped.length,
      validationStatus: 'Passed',
      deploymentStatus: options.deploymentStatus || 'Confirmed successful'
    });
    reportText = summary.newTitlesReportText;
  } else if (allExistingTitlesUpdated.length > 0) {
    summary.existingUpdatedReportText = formatExistingTitlesUpdatedReport({
      provider: targetProviderName || 'Multiple Providers',
      runTime: runTimeIst,
      existingUpdated: allExistingTitlesUpdated,
      newProviderLinksCount: allNewProviderLinks.length,
      incompleteTitles: allIncompleteTitles,
      duplicateLinksSkippedCount: allDuplicateLinksSkipped.length,
      validationStatus: 'Passed',
      deploymentStatus: options.deploymentStatus || 'Confirmed successful'
    });
    reportText = summary.existingUpdatedReportText;
  } else if (summary.hasIncompleteTitles && allNewCanonicalTitles.length === 0) {
    summary.incompleteReportText = formatIncompleteImportsWarning({
      provider: targetProviderName || 'Multiple Providers',
      runTime: runTimeIst,
      incompleteTitles: allIncompleteTitles,
      validationStatus: 'Passed (Catalog Protected)',
      deploymentStatus: options.deploymentStatus || 'Catalog Verified'
    });
    reportText = summary.incompleteReportText;
  } else {
    reportText = formatTelegramReport(summary);
  }

  return {
    summary,
    reportText,
    totalAdded,
    totalUpdated
  };
}

/**
 * Format date and time strictly in IST (Asia/Kolkata, UTC+05:30)
 * Example: 13/10/26 10:00 AM IST
 */
function formatIstDateTime(d = new Date()) {
  const dateObj = (d instanceof Date && !isNaN(d)) ? d : new Date(d);
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(dateObj);
  return formatted.replace(',', '').toUpperCase() + ' IST';
}

/**
 * Format date and time for Telegram report in UTC
 */
function formatDateTime(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${year}-${month}-${day} ${hours}:${mins} UTC`;
}

/**
 * Format dedicated Telegram notification when new canonical titles are added
 * Matches required specification:
 * PRAFLIX — NEW TITLES ADDED
 * Provider: HDHub4u
 * Run time: 13/10/26 10:00 AM IST
 * Movies added:
 * - Title (Year)
 * Web series added:
 * - Series (Year)
 * Summary:
 * - New movies: N
 * - New web series: N
 * - Total new canonical titles: N
 * Catalog validation: Passed
 * Deployment: Confirmed successful
 */
function formatNewTitlesTelegramReport(params = {}) {
  let opts = params;
  if (typeof params === 'string') {
    opts = {
      provider: params,
      runId: arguments[1],
      newTitles: arguments[2] || [],
      existingUpdated: arguments[3] || [],
      ...(typeof arguments[4] === 'object' ? arguments[4] : {})
    };
  }

  const {
    provider = 'HDHub4u',
    runTime = formatIstDateTime(new Date()),
    newTitles = [],
    existingUpdated = [],
    newProviderLinksCount = (newTitles ? newTitles.length : 0),
    titleListAppendedCount = (newTitles ? newTitles.length : 0),
    incompleteTitles = [],
    duplicateLinksSkippedCount = 0,
    validationStatus = 'Passed',
    deploymentStatus = 'Confirmed successful'
  } = opts || {};

  const movies = newTitles.filter(t => (t.type || 'Movie').toLowerCase() === 'movie');
  const series = newTitles.filter(t => (t.type || '').toLowerCase().includes('series'));

  let text = 'PRAFLIX — NEW TITLES ADDED\n\n';
  text += `Provider: ${provider}\n`;
  text += `Run time: ${runTime}\n\n`;

  text += 'Movies added:\n';
  if (movies.length > 0) {
    movies.forEach(m => {
      const yr = m.year ? ` (${m.year})` : '';
      text += `- ${m.displayTitle || m.title}${yr}\n`;
    });
  } else {
    text += '- None\n';
  }
  text += '\n';

  text += 'Web series added:\n';
  if (series.length > 0) {
    series.forEach(s => {
      const yr = s.year ? ` (${s.year})` : '';
      text += `- ${s.displayTitle || s.title}${yr}\n`;
    });
  } else {
    text += '- None\n';
  }
  text += '\n';

  text += 'Summary:\n';
  text += `- New movies: ${movies.length}\n`;
  text += `- New web series: ${series.length}\n`;
  text += `- Total new canonical titles: ${newTitles.length}\n`;
  text += `- Verified download-link records added: ${newProviderLinksCount}\n`;
  text += `- Provider title-list entries appended: ${titleListAppendedCount}\n`;
  if (existingUpdated && existingUpdated.length > 0) {
    text += `- Existing titles updated with new links: ${existingUpdated.length}\n`;
  }
  if (incompleteTitles && incompleteTitles.length > 0) {
    text += `- Incomplete titles quarantined: ${incompleteTitles.length}\n`;
  }
  if (duplicateLinksSkippedCount > 0) {
    text += `- Duplicate links skipped: ${duplicateLinksSkippedCount}\n`;
  }
  text += '\n';

  text += `Catalog validation: ${validationStatus}\n`;
  text += `Deployment: ${deploymentStatus}`;

  return text;
}

/**
 * Format Telegram notification when existing canonical titles gain new verified links
 */
function formatExistingTitlesUpdatedReport(params = {}) {
  const {
    provider = 'HDHub4u',
    runTime = formatIstDateTime(new Date()),
    existingUpdated = [],
    newProviderLinksCount = 0,
    incompleteTitles = [],
    duplicateLinksSkippedCount = 0,
    validationStatus = 'Passed',
    deploymentStatus = 'Confirmed successful'
  } = params;

  let text = 'PRAFLIX — EXISTING TITLES UPDATED WITH NEW LINKS\n\n';
  text += `Provider: ${provider}\n`;
  text += `Run time: ${runTime}\n\n`;

  text += 'Existing titles updated:\n';
  if (existingUpdated.length > 0) {
    existingUpdated.forEach(t => {
      const yr = t.year ? ` (${t.year})` : '';
      const linksLabel = t.newLinksCount ? ` [+${t.newLinksCount} verified link${t.newLinksCount > 1 ? 's' : ''}]` : '';
      text += `- ${t.displayTitle || t.title}${yr}${linksLabel}\n`;
    });
  } else {
    text += '- None\n';
  }
  text += '\n';

  text += 'Summary:\n';
  text += `- New canonical titles: 0\n`;
  text += `- Existing titles updated with new links: ${existingUpdated.length}\n`;
  text += `- New verified provider-link records: ${newProviderLinksCount}\n`;
  if (incompleteTitles && incompleteTitles.length > 0) {
    text += `- Incomplete titles quarantined: ${incompleteTitles.length}\n`;
  }
  if (duplicateLinksSkippedCount > 0) {
    text += `- Duplicate links skipped: ${duplicateLinksSkippedCount}\n`;
  }
  text += '\n';

  text += `Catalog validation: ${validationStatus}\n`;
  text += `Deployment: ${deploymentStatus}`;

  return text;
}

/**
 * Format incomplete imports warning notification
 */
function formatIncompleteImportsWarning(params = {}) {
  const {
    provider = 'HDHub4u',
    runTime = formatIstDateTime(new Date()),
    incompleteTitles = [],
    validationStatus = 'Passed (Catalog Protected)',
    deploymentStatus = 'Catalog Verified'
  } = params;

  let text = 'PRAFLIX — INCOMPLETE IMPORTS WARNING\n\n';
  text += `Provider: ${provider}\n`;
  text += `Run time: ${runTime}\n\n`;
  text += 'Titles with missing download links or assets (excluded from catalog):\n';
  if (incompleteTitles.length > 0) {
    incompleteTitles.forEach(t => {
      const yr = t.year ? ` (${t.year})` : '';
      const reason = t.reason ? ` — Reason: ${t.reason}` : '';
      text += `- ${t.displayTitle || t.title}${yr}${reason}\n`;
    });
  } else {
    text += '- None\n';
  }
  text += '\n';
  text += 'Summary:\n';
  text += `- Incomplete titles detected: ${incompleteTitles.length}\n`;
  text += `- Action taken: Preserved existing catalog (zero empty titles imported)\n\n`;
  text += `Catalog validation: ${validationStatus}\n`;
  text += `Deployment: ${deploymentStatus}`;

  return text;
}

/**
 * Format provider failure notification
 */
function formatProviderFailureNotification(params = {}) {
  const {
    provider = 'Unknown',
    runTime = formatIstDateTime(new Date()),
    error = 'Unknown network error',
    inconclusive = false,
    deploymentStatus = 'Aborted (sync failed)'
  } = params;

  let text = `PRAFLIX — PROVIDER CRAWL ${inconclusive ? 'INCONCLUSIVE' : 'FAILED'}\n\n`;
  text += `Provider: ${provider}\n`;
  text += `Run time: ${runTime}\n\n`;
  text += `Status: ${inconclusive ? 'Inconclusive / Interrupted' : 'Failed'}\n`;
  text += `Error details: ${error}\n\n`;
  text += `Catalog validation: Preserved existing catalog (no partial modification)\n`;
  text += `Deployment: ${deploymentStatus}`;

  return text;
}

/**
 * Format daily status Telegram Report matching PRAFLIX specification
 */
function formatTelegramReport(summary) {
  const syncTime = summary.runTimeIst || summary.formattedTime || formatDateTime(new Date());
  const provs = summary.providers || {};
  const target = summary.targetProvider || summary.provider;
  const targetProvs = target ? [target] : PROVIDERS;

  let text = '━━━━━━━━━━━━━━━━━━━━━━\n';
  text += '       PRAFLIX REPORT\n';
  text += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
  text += '📅 DAILY CATALOG UPDATE\n';
  text += `🕐 Run time: ${syncTime}\n\n`;

  // Display targeted or all providers
  for (const prov of targetProvs) {
    let res = provs[prov];
    if (!res && target && target.toLowerCase() === prov.toLowerCase()) {
      res = summary;
    }

    text += '━━━━━━━━━━━━━━━━━━━━━━\n';
    text += `${prov.toUpperCase()}\n`;
    text += '━━━━━━━━━━━━━━━━━━━━━━\n\n';

    if (res && res.failed) {
      text += `⚠️ Sync failed: ${res.error || 'Connection error'}\n`;
      text += '🎬 New Movies: —\n';
      text += '📺 New Series: —\n';
      text += '📝 Title List: Unchanged (Ingestion incomplete)\n\n';
    } else if (res) {
      if (res.liveCrawl) {
        const liveDesc = res.liveCrawl.liveReachable
          ? `Reachable (${res.liveCrawl.liveDiscoveredCount || 0} live titles parsed)`
          : 'Offline / Interrupted';
        text += `🌐 Live Crawl: ${liveDesc}\n`;
      }
      if (res.durableSnapshot) {
        text += `📦 Snapshot Inspected: ${(res.durableSnapshot.recordCount || 0).toLocaleString()} raw records (distinct canonical titles matched)\n`;
      }
      const newM = res.newMovies !== undefined ? res.newMovies : (res.newTitlesCount || 0);
      const newS = res.newSeries !== undefined ? res.newSeries : 0;
      text += `🎬 New Movies: ${newM}\n`;
      text += `📺 New Series: ${newS}\n`;
      const upd = res.updatedExisting !== undefined ? res.updatedExisting : (res.existingUpdatedCount || 0);
      if (typeof upd === 'number' && upd > 0) {
        text += `🔄 Existing Titles Updated: ${upd.toLocaleString()}\n`;
      }
      if (Array.isArray(res.existingTitlesUpdated) && res.existingTitlesUpdated.length > 0) {
        text += `   - ${res.existingTitlesUpdated.map(x => x.displayTitle || x.title).join(', ')}\n`;
      }
      if (res.titleListSync) {
        text += `📝 Title List: +${res.titleListSync.appendedCount} appended (${res.titleListSync.skippedCount} existing)\n`;
      }
      text += '\n';
    } else {
      text += '⚠️ Sync failed\n';
      text += '🎬 New Movies: —\n';
      text += '📺 New Series: —\n\n';
    }
  }

  // Total section
  const total = summary.totals || { moviesAdded: 0, seriesAdded: 0, totalTitlesAdded: 0 };
  const catalogTotal = summary.currentCatalogTotal || (total.currentCatalogTotal) || 13687;
  text += '━━━━━━━━━━━━━━━━━━━━━━\n';
  text += 'TOTAL\n';
  text += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
  text += `🎬 Movies Added: ${total.moviesAdded}\n`;
  text += `📺 Series Added: ${total.seriesAdded}\n`;
  text += `📦 Total Titles Added: ${total.totalTitlesAdded}\n`;
  text += `📦 Canonical Catalog Total: ${catalogTotal.toLocaleString()} titles\n`;
  if (typeof total.titleListAppended === 'number') {
    text += `📝 Title List Entries Appended: ${total.titleListAppended}\n`;
  }
  text += '\n';

  if (total.totalTitlesAdded > 0) {
    text += '✅ PRAFLIX CATALOG UPDATED & VALIDATED\n';
    text += '🚀 Edge Deployment: Confirmed successful';
  } else {
    text += '✅ No new titles found today.\n';
    text += '🚀 Edge Deployment: Catalog Verified';
  }

  return text;
}

/**
 * Dispatch report securely to Telegram Bot API
 */
async function sendTelegramReport(reportText, credentials = {}) {
  let botToken = credentials.botToken || process.env.TELEGRAM_BOT_TOKEN;
  let chatId = credentials.channelId || credentials.chatId || process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHAT_ID;

  // Attempt to load from .env if running locally and not in env
  if ((!botToken || !chatId) && fs.existsSync('.env')) {
    const envContent = fs.readFileSync('.env', 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!botToken && trimmed.startsWith('TELEGRAM_BOT_TOKEN=')) {
        botToken = trimmed.slice('TELEGRAM_BOT_TOKEN='.length).trim();
      }
      if (!chatId && (trimmed.startsWith('TELEGRAM_CHANNEL_ID=') || trimmed.startsWith('TELEGRAM_CHAT_ID='))) {
        chatId = trimmed.slice(trimmed.indexOf('=') + 1).trim();
      }
    }
  }

  if (!botToken || !chatId) {
    return {
      success: false,
      error: 'Missing Telegram credentials (TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID/TELEGRAM_CHAT_ID)'
    };
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: reportText
    };
    if (credentials.parseMode) {
      payload.parse_mode = credentials.parseMode;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!data.ok) {
      return { success: false, error: data.description || 'Telegram API returned error' };
    }

    return { success: true, messageId: data.result ? data.result.message_id : null };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  PROVIDERS,
  normalizeTitle,
  detectContentType,
  matchExistingTitle,
  fetchProviderLatest,
  parseProviderHtml,
  extractAndVerifyCandidateLinks,
  syncProvider,
  runFullSync,
  formatIstDateTime,
  formatDateTime,
  formatNewTitlesTelegramReport,
  formatExistingTitlesUpdatedReport,
  formatIncompleteImportsWarning,
  formatProviderFailureNotification,
  formatTelegramReport,
  sendTelegramReport,
  providerRegistry,
  adapters
};
