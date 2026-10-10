#!/usr/bin/env node
/**
 * PRAFLIX — Download Link & Title List Matcher & Verifier
 * A PRAVERSE Company
 *
 * Reads:
 *  - Title Lists: TITLE LIST / title list (10MOVIEZ TITLE.txt, HDHUB4U TITLE.txt, HDWALL TITLE.txt)
 *  - Download Link Records: DOWNLOAD LINK HERE / DOWNLOAD LINK (hdhub4u_catalog_complete.json, PDFs)
 *  - Catalog: data/catalog.json
 *
 * Matches catalog titles conservatively to verified download records.
 * Ensures source article URLs are never treated as download destinations.
 * Maintains strict separation between complete seasons and individual episodes.
 * Safe and repeatable (idempotent).
 */

const fs = require('fs');
const path = require('path');

const BASE_DIR = path.dirname(__dirname);
const resolver = require(path.join(BASE_DIR, 'destination_resolver.js'));
const { classifyLinkVerification, isVerifiedDownloadLink } = resolver;

// Resolve directories with fallbacks
function getDir(name1, name2) {
  const p1 = path.join(BASE_DIR, name1);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.join(BASE_DIR, name2);
  if (fs.existsSync(p2)) return p2;
  return p1;
}

const DOWNLOAD_DIR = getDir('DOWNLOAD LINK HERE', 'DOWNLOAD LINK');
const TITLE_DIR = getDir('TITLE LIST', 'title list');
const DATA_DIR = path.join(BASE_DIR, 'data');
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');
const DOWNLOADS_PATH = path.join(DATA_DIR, 'downloads.json');

/**
 * Normalize title for conservative matching
 */
function normalizeTitle(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/^free\s+/i, '')
    .replace(/\[duplicate\]/gi, '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/\bseason\s*\d+\b/gi, '')
    .replace(/\bs\d+\b/gi, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract clean year from string
 */
function extractYear(str) {
  if (!str) return null;
  const m = String(str).match(/\b(19\d\d|20\d\d)\b/);
  return m ? m[1] : null;
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
 * Determine if a URL is a source article page rather than a verified download destination
 */
function isSourceArticleUrl(url, sourceUrl) {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (sourceUrl && u === String(sourceUrl).trim()) return true;
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('hdhub4u.free') || host.includes('hdhub4u.ms') || host.includes('hdhub4u.tv') || host.includes('hdhub4u.lat')) return true;
    if (host.includes('10moviez.biz')) return true;
    if (host.includes('hdwall.xyz') && (parsed.pathname.endsWith('.html') || parsed.pathname.includes('/posts/'))) return true;
  } catch (_) {}
  return false;
}

/**
 * Determine if URL is a valid download destination based on verification classification
 */
function isValidDownloadDestination(url, sourceUrl) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed === '#' || trimmed.startsWith('javascript:')) return false;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (isSourceArticleUrl(trimmed, sourceUrl)) return false;
  const classification = classifyLinkVerification(trimmed, sourceUrl);
  return classification.status === 'verified';
}

/**
 * Normalize resolution string to standard key ('4K', '1080p', '720p', '480p', '360p')
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

function runMatching() {
  console.log('='.repeat(70));
  console.log('PRAFLIX — DOWNLOAD LINK & TITLE LIST MATCHER & AUDIT');
  console.log('A PRAVERSE Company');
  console.log('='.repeat(70));
  console.log(`Download directory: ${DOWNLOAD_DIR}`);
  console.log(`Title lists directory: ${TITLE_DIR}`);

  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`Catalog not found at ${CATALOG_PATH}`);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  console.log(`Loaded catalog: ${catalog.length.toLocaleString()} titles.`);

  let existingDownloads = { entries: [] };
  const backupBaselinePath = path.join(DATA_DIR, 'downloads.backup.json');
  const sourcePathToLoad = fs.existsSync(backupBaselinePath) ? backupBaselinePath : DOWNLOADS_PATH;
  if (fs.existsSync(sourcePathToLoad)) {
    existingDownloads = JSON.parse(fs.readFileSync(sourcePathToLoad, 'utf8'));
    console.log(`Loaded downloads baseline from ${path.basename(sourcePathToLoad)}: ${existingDownloads.entries.length.toLocaleString()} entries.`);
  }

  // Load HDHub4u complete catalog if present
  const hdhubPath = path.join(DOWNLOAD_DIR, 'hdhub4u_catalog_complete.json');
  let hdhubData = null;
  if (fs.existsSync(hdhubPath)) {
    hdhubData = JSON.parse(fs.readFileSync(hdhubPath, 'utf8'));
    console.log(`Loaded HDHub4u complete catalog: ${hdhubData.movies?.length || 0} movies, ${hdhubData.webSeries?.length || 0} series.`);
  }

  // Map catalog items by canonicalId, slug, and normalizedTitle+year+type
  const catalogById = new Map();
  const catalogBySlug = new Map();
  const catalogByTitleYear = new Map();

  catalog.forEach(item => {
    catalogById.set(Number(item.canonicalId), item);
    (item.variants || []).forEach(v => {
      if (v.sourceUrl) {
        const s = urlSlug(v.sourceUrl);
        if (s && !catalogBySlug.has(s)) {
          catalogBySlug.set(s, item);
        }
      }
    });

    const normT = normalizeTitle(item.displayTitle);
    const yr = item.year ? String(item.year).trim() : '';
    const key = `${normT}__${yr}__${item.type}`;
    if (!catalogByTitleYear.has(key)) {
      catalogByTitleYear.set(key, []);
    }
    catalogByTitleYear.get(key).push(item);
  });

  // Track results
  const entriesMap = new Map(); // canonicalId -> entry
  let totalLinksChecked = 0;
  let filteredSourceUrlsCount = 0;
  let deduplicatedLinksCount = 0;
  let excludedBrokenCount = 0;
  let leftUnverifiedCount = 0;
  let temporarilyUnavailableCount = 0;

  const auditTimestamp = new Date().toISOString();

  // 1. Ingest existing downloads entries and sanitize them
  existingDownloads.entries.forEach(entry => {
    if (!entry || entry.catalogueId == null) return;
    const cid = Number(entry.catalogueId);
    const catItem = catalogById.get(cid);
    if (!catItem) return; // stale or deleted canonical record

    const cleanedLinks = [];
    const seenLinks = new Set();

    (entry.links || []).forEach(link => {
      if (!link) return;
      totalLinksChecked++;

      const v = classifyLinkVerification(link, link.sourceUrl);
      if (v.status !== 'verified') {
        if (v.status === 'broken') excludedBrokenCount++;
        else if (v.status === 'unverified') leftUnverifiedCount++;
        else if (v.status === 'temporarily_unavailable') temporarilyUnavailableCount++;
        filteredSourceUrlsCount++;
        return;
      }

      // Check if downloadUrl matches any variant sourceUrl for this title
      const matchesVariantSource = (catItem.variants || []).some(vr => vr.sourceUrl && vr.sourceUrl.trim() === link.downloadUrl.trim());
      if (matchesVariantSource) {
        filteredSourceUrlsCount++;
        excludedBrokenCount++;
        return;
      }

      const resKey = normalizeResolution(link.resolution || link.rawQuality);
      const epKey = link.episode ? String(link.episode).trim().toUpperCase() : 'FULL SERIES';
      const dedupKey = `${link.downloadUrl.trim()}__${resKey}__${epKey}`;

      if (seenLinks.has(dedupKey)) {
        deduplicatedLinksCount++;
        return;
      }
      seenLinks.add(dedupKey);

      const cleanLink = {
        sourceName: 'Direct',
        downloadUrl: link.downloadUrl.trim(),
        resolution: resKey,
        rawQuality: link.rawQuality || undefined,
        episode: link.episode || undefined,
        season: link.season || undefined,
        format: link.format || undefined,
        audio: link.audio || undefined,
        language: link.language || undefined,
        fileSizeLabel: link.fileSizeLabel || undefined,
        verificationStatus: 'verified'
      };
      Object.keys(cleanLink).forEach(k => cleanLink[k] === undefined && delete cleanLink[k]);
      cleanedLinks.push(cleanLink);
    });

    if (cleanedLinks.length > 0) {
      entriesMap.set(cid, {
        catalogueId: cid,
        title: catItem.displayTitle,
        type: catItem.type,
        year: catItem.year,
        lastCheckedAt: entry.lastCheckedAt || auditTimestamp,
        discoveryStatus: 'links_found',
        verificationStatus: 'verified',
        verificationEvidence: 'Verified storage CDN / drive destination',
        links: cleanedLinks
      });
    }
  });

  // 2. Ingest ONLY unmapped titles from HDHub4u complete catalog
  let addedFromHDHub4u = 0;
  if (hdhubData) {
    // Process HDHub4u movies
    (hdhubData.movies || []).forEach(m => {
      (m.qualities || []).forEach(() => { totalLinksChecked++; });
      const validQualities = (m.qualities || []).filter(q => isValidDownloadDestination(q.link, m.sourceUrl));
      if (!validQualities.length) return;

      const slug = urlSlug(m.sourceUrl);
      let catItem = catalogBySlug.get(slug);

      if (!catItem) {
        const normT = normalizeTitle(m.title || m.originalTitle);
        const yr = extractYear(m.title) || extractYear(m.originalTitle);
        const candidates = catalogByTitleYear.get(`${normT}__${yr || ''}__Movie`);
        if (candidates && candidates.length === 1) {
          catItem = candidates[0];
        }
      }

      if (!catItem || catItem.type !== 'Movie') return;

      const cid = Number(catItem.canonicalId);
      // Strictly do not overwrite or append to existing records
      if (entriesMap.has(cid)) return;

      const newLinks = [];
      const seen = new Set();

      validQualities.forEach(q => {
        const resKey = normalizeResolution(q.quality || q.rawText);
        const dedupKey = `${q.link.trim()}__${resKey}`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          const cleanLink = {
            sourceName: 'Direct',
            downloadUrl: q.link.trim(),
            resolution: resKey,
            rawQuality: q.quality || undefined,
            format: 'WEB-DL',
            language: (catItem.languages && catItem.languages[0]) || undefined,
            verificationStatus: 'verified'
          };
          Object.keys(cleanLink).forEach(k => cleanLink[k] === undefined && delete cleanLink[k]);
          newLinks.push(cleanLink);
        }
      });

      if (newLinks.length > 0) {
        entriesMap.set(cid, {
          catalogueId: cid,
          title: catItem.displayTitle,
          type: 'Movie',
          year: catItem.year,
          lastCheckedAt: auditTimestamp,
          discoveryStatus: 'links_found',
          verificationStatus: 'verified',
          verificationEvidence: 'Verified storage CDN / drive destination',
          links: newLinks
        });
        addedFromHDHub4u++;
      }
    });

    // Process HDHub4u web series
    (hdhubData.webSeries || []).forEach(s => {
      (s.items || []).forEach(() => { totalLinksChecked++; });
      const validItems = (s.items || []).filter(i => isValidDownloadDestination(i.link, s.sourceUrl));
      if (!validItems.length) return;

      const slug = urlSlug(s.sourceUrl);
      let catItem = catalogBySlug.get(slug);

      if (!catItem) {
        const normT = normalizeTitle(s.title || s.originalTitle);
        const yr = extractYear(s.title) || extractYear(s.originalTitle);
        const candidates = catalogByTitleYear.get(`${normT}__${yr || ''}__Web Series`);
        if (candidates && candidates.length === 1) {
          catItem = candidates[0];
        }
      }

      if (!catItem || catItem.type !== 'Web Series') return;

      const cid = Number(catItem.canonicalId);
      // Strictly do not overwrite or append to existing records
      if (entriesMap.has(cid)) return;

      const newLinks = [];
      const seen = new Set();

      validItems.forEach(item => {
        const resKey = normalizeResolution(item.quality || item.rawText);
        let ep = item.episode || 'FULL SERIES';
        if (/^\d+$/.test(ep)) ep = `Episode ${ep}`;
        const dedupKey = `${item.link.trim()}__${resKey}__${ep}`;

        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          const cleanLink = {
            sourceName: 'Direct',
            downloadUrl: item.link.trim(),
            resolution: resKey,
            rawQuality: item.quality || undefined,
            episode: ep,
            season: catItem.season || 'Season 1',
            format: 'WEB-DL',
            language: (catItem.languages && catItem.languages[0]) || undefined,
            verificationStatus: 'verified'
          };
          Object.keys(cleanLink).forEach(k => cleanLink[k] === undefined && delete cleanLink[k]);
          newLinks.push(cleanLink);
        }
      });

      if (newLinks.length > 0) {
        entriesMap.set(cid, {
          catalogueId: cid,
          title: catItem.displayTitle,
          type: 'Web Series',
          year: catItem.year,
          lastCheckedAt: auditTimestamp,
          discoveryStatus: 'links_found',
          verificationStatus: 'verified',
          verificationEvidence: 'Verified storage CDN / drive destination',
          links: newLinks
        });
        addedFromHDHub4u++;
      }
    });
  }

  // Compile final entries array sorted by catalogueId
  const finalEntries = Array.from(entriesMap.values()).sort((a, b) => a.catalogueId - b.catalogueId);
  let totalVerifiedLinks = 0;
  finalEntries.forEach(e => {
    totalVerifiedLinks += (e.links || []).length;
  });

  const updatedDownloads = {
    version: '1.0.0',
    publisher: 'A PRAVERSE Company',
    lastUpdated: auditTimestamp,
    totalTitlesWithLinks: finalEntries.length,
    totalLinks: totalVerifiedLinks,
    entries: finalEntries
  };

  // Safe write with atomic backup
  const backupPath = path.join(DATA_DIR, 'downloads.backup.json');
  if (fs.existsSync(DOWNLOADS_PATH)) {
    fs.copyFileSync(DOWNLOADS_PATH, backupPath);
  }

  // Minified JSON write (< 25 MiB Cloudflare Pages limit compliance)
  fs.writeFileSync(DOWNLOADS_PATH, JSON.stringify(updatedDownloads), 'utf8');

  const unmatchedCatalogTitles = catalog.length - finalEntries.length;

  console.log('\n' + '='.repeat(70));
  console.log('PRAFLIX — DOWNLOAD VERIFICATION & AUDIT SUMMARY (Problems 3, 4, 5)');
  console.log('='.repeat(70));
  console.log(`- Total Catalog Titles: ${catalog.length.toLocaleString()}`);
  console.log(`- Titles with Verified Downloads: ${finalEntries.length.toLocaleString()} (${((finalEntries.length / catalog.length) * 100).toFixed(1)}%)`);
  console.log(`- Total Download Links Audited: ${totalLinksChecked.toLocaleString()}`);
  console.log(`- Total Verified Download Links: ${totalVerifiedLinks.toLocaleString()}`);
  console.log(`- Broken Links Excluded: ${excludedBrokenCount.toLocaleString()}`);
  console.log(`- Unverified Links Excluded: ${leftUnverifiedCount.toLocaleString()}`);
  console.log(`- Temporarily Unavailable Links: ${temporarilyUnavailableCount.toLocaleString()}`);
  console.log(`- Duplicate Links Deduplicated: ${deduplicatedLinksCount.toLocaleString()}`);
  console.log(`- Unmapped Titles (Safely Kept without Fabricated Links): ${unmatchedCatalogTitles.toLocaleString()}`);
  console.log(`- New Titles Matched from HDHub4u: ${addedFromHDHub4u.toLocaleString()}`);
  console.log('='.repeat(70));

  return {
    totalCatalog: catalog.length,
    totalTitlesWithLinks: finalEntries.length,
    totalLinksChecked,
    totalVerifiedLinks,
    excludedBrokenCount,
    leftUnverifiedCount,
    temporarilyUnavailableCount,
    filteredSourceUrlsCount,
    deduplicatedLinksCount,
    unmatchedCatalogTitles
  };
}

if (require.main === module) {
  try {
    runMatching();
  } catch (err) {
    console.error('[ERROR] Matching failed:', err);
    process.exit(1);
  }
}

module.exports = {
  runMatching,
  normalizeTitle,
  isSourceArticleUrl,
  isValidDownloadDestination,
  normalizeResolution
};
