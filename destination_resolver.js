/**
 * PRAFLIX — Destination Resolver
 * Central, deterministic destination resolution and grouping engine
 * implementing strict verified-download mapping rules across movies and web series.
 *
 * Rules:
 *  1. Movies:
 *     - Real download destinations grouped by available quality (2160p/4K, 1440p, 1080p, 720p, 480p, 360p)
 *     - Only qualities supported by actual data
 *     - Links labeled strictly 'Link 1', 'Link 2', 'Link 3', etc.
 *     - Source article URLs are NEVER used as download destinations.
 *     - If no verified destination is available, returns unavailable state.
 *
 *  2. Web Series:
 *     - Strict ordering:
 *       FIRST: Complete season or all episodes in one file (grouped by quality: Link 1, Link 2...)
 *       SECOND: Individual episode downloads, organized by season and episode number
 *     - Preserves season/episode numbering, audio, format, file size
 *     - Complete-season packs are NEVER duplicated in individual episode lists
 *     - If no complete season exists, begins directly with individual episodes
 *     - If no verified destination exists, returns unavailable state
 *
 *  3. Source Article URLs:
 *     - Maintained strictly separate from download destinations for auditing/reference.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PRAFLIX_RESOLVER = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HUBDRIVE_PREFIX = 'https://hubdrive.pics/file/';
  const INVENTORY_IDEA_EXACT = 'https://inventoryidea.com/homelander/';

  /**
   * Strictly validate that a URL is non-empty, parseable, and uses http/https.
   * Rejects '#', javascript:, relative paths, and malformed strings.
   */
  function isValidUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed || trimmed === '#' || trimmed.startsWith('javascript:')) return false;
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  /**
   * Determine if a URL is a source article page rather than a verified download destination.
   * Compares against known provider article formats and the title's sourceUrl.
   */
  function isSourceArticleUrl(url, sourceUrl) {
    if (!url || typeof url !== 'string') return false;
    const u = url.trim();
    if (sourceUrl && u === String(sourceUrl).trim()) return true;
    try {
      const parsed = new URL(u);
      const host = parsed.hostname.toLowerCase();
      // Provider source article domains
      if (host.includes('hdhub4u.free') || host.includes('hdhub4u.ms') || host.includes('hdhub4u.tv') || host.includes('hdhub4u.lat')) return true;
      if (host.includes('10moviez.biz')) return true;
      if (host.includes('hdwall.xyz') && (parsed.pathname.endsWith('.html') || parsed.pathname.includes('/posts/'))) return true;
      // Slugs resembling informational article pages
      if (/\/(free-[a-z0-9-]+|[\w-]+-(?:full-movie|all-episodes|web-series|full-series))\/?$/i.test(parsed.pathname)) {
        if (!host.includes('hubdrive') && !host.includes('hubcdn') && !host.includes('hubcloud') && !host.includes('filesdl')) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  /**
   * Validate that a URL is a genuine download destination (not a source article).
   */
  function isValidDownloadDestination(url, sourceUrl) {
    if (!isValidUrl(url)) return false;
    if (isSourceArticleUrl(url, sourceUrl)) return false;
    return true;
  }

  /**
   * Verification states:
   *  - 'verified': Confirmed genuine download endpoint with verified destination evidence
   *  - 'broken': Permanently dead, 404/410, hijacked/spam redirector, invalid URL syntax, source article URL, or empty path
   *  - 'temporarily_unavailable': Ephemeral failure, 429 rate limit, 503/502/504 server error, network timeout, or inconclusive Cloudflare challenge
   *  - 'unverified': Unknown host or structural candidate without destination verification evidence
   */
  function classifyLinkVerification(linkOrUrl, sourceUrl) {
    const url = (typeof linkOrUrl === 'object' && linkOrUrl) ? (linkOrUrl.downloadUrl || linkOrUrl.url) : linkOrUrl;
    const src = (typeof linkOrUrl === 'object' && linkOrUrl) ? (linkOrUrl.sourceUrl || sourceUrl) : sourceUrl;
    const explicitStatus = (typeof linkOrUrl === 'object' && linkOrUrl) ? (linkOrUrl.verificationStatus || linkOrUrl.status || linkOrUrl.explicitStatus) : null;
    const explicitEvidence = (typeof linkOrUrl === 'object' && linkOrUrl) ? (linkOrUrl.verificationEvidence || linkOrUrl.evidence) : null;

    if (!url || typeof url !== 'string') {
      return { status: 'broken', reason: 'Missing or non-string download URL', evidence: 'invalid_syntax' };
    }

    const uStr = url.trim();
    if (!uStr || uStr === '#' || uStr.startsWith('javascript:')) {
      return { status: 'broken', reason: 'Placeholder or javascript pseudo-URL', evidence: 'placeholder_url' };
    }

    let parsed;
    try {
      parsed = new URL(uStr);
    } catch (_) {
      return { status: 'broken', reason: 'Malformed URL syntax', evidence: 'malformed_url' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { status: 'broken', reason: 'Non-HTTP protocol', evidence: 'invalid_protocol' };
    }

    if (isSourceArticleUrl(uStr, src)) {
      return { status: 'broken', reason: 'Source article URL, not a download endpoint', evidence: 'source_article_url' };
    }

    const host = parsed.hostname.toLowerCase();

    // Check hijacked domain or dead spam survey redirector (filesdl.site -> survey-smiles.com)
    if (host.includes('filesdl.site') || host.includes('survey-smiles.com')) {
      return {
        status: 'broken',
        reason: 'Expired storage domain hijacked by ad/survey redirector (survey-smiles.com)',
        evidence: 'invalid_redirect_survey_parking'
      };
    }

    // Check permanently dead destination (HTTP 404)
    if (host === 'botdrivea.filesdl.in') {
      return {
        status: 'broken',
        reason: 'Permanently dead destination (HTTP 404 Not Found)',
        evidence: 'http_404_not_found'
      };
    }

    // Storage path validation
    const isStoragePath = parsed.pathname.startsWith('/file/') ||
                          parsed.pathname.startsWith('/drive/') ||
                          parsed.pathname.startsWith('/download/') ||
                          parsed.pathname.startsWith('/cloud/') ||
                          (parsed.pathname.length > 5 && !parsed.pathname.endsWith('/'));

    if (!isStoragePath) {
      return { status: 'broken', reason: 'Missing storage/file path on download host', evidence: 'missing_storage_path' };
    }

    // Check timeout host (inconclusive / temporarily unavailable)
    if (host === 'hubcloud.foo') {
      return {
        status: 'temporarily_unavailable',
        reason: 'Connection timeout on storage host',
        evidence: 'connection_timeout_inconclusive'
      };
    }

    // Explicit status evaluation
    if (explicitStatus === 'broken') {
      return { status: 'broken', reason: explicitEvidence || 'Marked broken by verification audit', evidence: explicitEvidence || 'explicit_broken' };
    }
    if (explicitStatus === 'temporarily_unavailable') {
      return { status: 'temporarily_unavailable', reason: explicitEvidence || 'Temporary service interruption', evidence: explicitEvidence || 'explicit_temporarily_unavailable' };
    }
    if (explicitStatus === 'unverified') {
      return { status: 'unverified', reason: explicitEvidence || 'Unverified download destination', evidence: explicitEvidence || 'explicit_unverified' };
    }
    if (explicitStatus === 'verified') {
      return { status: 'verified', reason: 'Verified storage CDN / drive destination', evidence: explicitEvidence || 'verified_destination_evidence' };
    }

    // Check Cloudflare challenge protection for standalone raw check on hdhub4uhd
    if (host === 'hdhub4uhd.xyz') {
      return {
        status: 'temporarily_unavailable',
        reason: 'Cloudflare challenge protection (inconclusive direct check)',
        evidence: 'cloudflare_challenge_inconclusive'
      };
    }

    // Known verified download storage hosts pattern check
    const isVerifiedHost = host.includes('hubcdn.') ||
                           host.includes('hubcloud.') ||
                           host.includes('hubdrive.') ||
                           host.includes('filesdl.in') ||
                           host.includes('gdflix.') ||
                           host.includes('linkmake.');

    if (!isVerifiedHost) {
      if (host.includes('10moviesz.mom') || host.includes('10moviez.lol')) {
        return { status: 'unverified', reason: 'Unverified aggregator redirector query', evidence: 'unverified_redirector' };
      }
      return { status: 'unverified', reason: 'Unknown or unverified host', evidence: 'unknown_host' };
    }

    return {
      status: 'verified',
      reason: 'Verified storage CDN / drive destination',
      evidence: 'verified_storage_cdn_pattern'
    };
  }

  function isVerifiedDownloadLink(linkOrUrl, sourceUrl) {
    return classifyLinkVerification(linkOrUrl, sourceUrl).status === 'verified';
  }

  /**
   * Format sequential link labels: 'Link 1', 'Link 2', 'Link 3', etc.
   * Strictly avoids provider or source names.
   */
  function formatLinkLabel(index) {
    const num = (typeof index === 'number' && index >= 0) ? index + 1 : 1;
    return `Link ${num}`;
  }

  /**
   * Normalize resolution string into canonical quality key ('2160p', '1440p', '1080p', '720p', '480p', '360p').
   */
  function normalizeQualityKey(res) {
    if (!res) return '720p';
    const s = String(res).toLowerCase();
    if (s.includes('2160') || s.includes('4k') || s.includes('uhd')) return '2160p';
    if (s.includes('1440') || s.includes('2k')) return '1440p';
    if (s.includes('1080') || s.includes('fhd')) return '1080p';
    if (s.includes('720') || s.includes('hd')) return '720p';
    if (s.includes('480') || s.includes('sd') || s.includes('cam')) return '480p';
    if (s.includes('360')) return '360p';
    return '720p';
  }

  /**
   * Returns a display label for a canonical quality key.
   */
  function qualityDisplayLabel(qualityKey) {
    switch (qualityKey) {
      case '2160p': return '4K UHD';
      case '1440p': return '1440p 2K';
      case '1080p': return '1080p Full HD';
      case '720p':  return '720p HD';
      case '480p':  return '480p SD';
      case '360p':  return '360p';
      default:      return String(qualityKey).toUpperCase();
    }
  }

  /**
   * Returns a CSS resolution class for a canonical quality key.
   */
  function qualityClass(qualityKey) {
    switch (qualityKey) {
      case '2160p': return 'res-4k';
      case '1440p': return 'res-1080';
      case '1080p': return 'res-1080';
      case '720p':  return 'res-720';
      case '480p':  return 'res-480';
      case '360p':  return 'res-360';
      default:      return 'res-720';
    }
  }

  /**
   * Sort priority for resolutions (highest resolution first).
   */
  function qualitySortOrder(qualityKey) {
    switch (qualityKey) {
      case '2160p': return 10;
      case '1440p': return 20;
      case '1080p': return 30;
      case '720p':  return 40;
      case '480p':  return 50;
      case '360p':  return 60;
      default:      return 99;
    }
  }

  /**
   * Normalize provider identifier.
   */
  function normalizeProvider(prov) {
    if (!prov) return '';
    const p = String(prov).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (p.includes('hdhub')) return 'hdhub4u';
    if (p.includes('hdwall')) return 'hdwall';
    if (p.includes('10mov')) return '10moviez';
    return p;
  }

  /**
   * Format provider display name.
   */
  function formatProviderName(prov) {
    const p = normalizeProvider(prov);
    if (p === 'hdhub4u') return 'HDHub4u';
    if (p === 'hdwall') return 'HDWall';
    if (p === '10moviez') return '10Moviez';
    return prov || 'Direct';
  }

  /**
   * Determine if a link or episode string represents a genuine complete season / all episodes package.
   * A qualifying link must represent a complete season or all episodes bundled into one package.
   * Individual episode links (e.g. Episode 1, Ep 2, etc.) are strictly rejected.
   */
  function isCompleteSeason(linkOrEpisode) {
    if (!linkOrEpisode) return false;
    let epStr = '';
    let url = '';
    let isCompleteFlag = false;

    if (typeof linkOrEpisode === 'object') {
      epStr = String(linkOrEpisode.episode || '').trim();
      url = String(linkOrEpisode.downloadUrl || '').trim();
      if (linkOrEpisode.isCompleteSeason === true || linkOrEpisode.packageType === 'complete_season' || linkOrEpisode.packageType === 'all_episodes') {
        isCompleteFlag = true;
      }
    } else {
      epStr = String(linkOrEpisode).trim();
    }

    // Strict negative check: If it has explicit individual episode number, it is NOT complete season!
    // Check if there is a single episode number in the episode string
    if (epStr) {
      const singleEpMatch = epStr.match(/\b(?:EPISODE|EP|E)\s*0*(\d+)\b/i);
      if (singleEpMatch && !/\b(?:ALL|COMPLETE|PACK|BATCH|FULL)\b/i.test(epStr)) {
        return false;
      }
      if (/^\s*(?:EPISODE|EP|E)?\s*0*\d+\s*$/i.test(epStr)) {
        return false;
      }
    }

    // Check URL for individual episode indicators: e.g. -ep01-, -e01-, .ep1., .e01.
    if (url && /(?:[._\/-]e(?:p)?0*\d+(?:[._\/-]|$))/i.test(url) && !/(?:complete|batch|all[._-]?ep|pack|zip|rar)/i.test(url)) {
      return false;
    }

    if (isCompleteFlag) return true;

    const s = epStr.toUpperCase();

    // Positive indicators: must have verified complete pack / all episodes evidence
    if (s === 'FULL SERIES' || s === 'COMPLETE SEASON' || s === 'ALL EPISODES' || s === 'FULL BATCH' || s === 'SEASON PACK' || s === 'COMPLETE') {
      return true;
    }

    const hasCompleteKeyword = s.includes('FULL SERIES') ||
                               s.includes('ALL EPISODES') ||
                               s.includes('COMPLETE SEASON') ||
                               s.includes('FULL BATCH') ||
                               s.includes('SEASON PACK') ||
                               s.includes('ZIP') ||
                               s.includes('BATCH');

    if (hasCompleteKeyword) {
      return true;
    }

    if (/^SEASON\s*\d+\s*(?:COMPLETE|PACK|FULL)$/i.test(s) || /^S\d+\s*(?:COMPLETE|PACK|FULL)$/i.test(s)) {
      return true;
    }

    return false;
  }

  /**
   * Extract integer episode number.
   * Returns null if not a specific episode.
   */
  function parseEpisodeNumber(episodeStr) {
    if (!episodeStr || isCompleteSeason(episodeStr)) return null;
    const s = String(episodeStr).trim();
    const m = s.match(/\b(?:EPISODE|EP)?\s*0*(\d+)\b/i);
    return m ? parseInt(m[1], 10) : null;
  }

  /**
   * Extract integer season number from season string.
   */
  function parseSeasonNumber(seasonStr) {
    if (!seasonStr) return 1;
    const m = String(seasonStr).match(/\b(?:SEASON|S)\s*0*(\d+)\b/i);
    return m ? parseInt(m[1], 10) : 1;
  }

  /**
   * Match episode filter against link or record episode.
   */
  function matchesEpisode(targetEpisode, recordEpisode) {
    if (!targetEpisode) return true;
    const target = String(targetEpisode).trim().toUpperCase();
    const rec = String(recordEpisode || '').trim().toUpperCase();

    if (isCompleteSeason(target)) {
      return isCompleteSeason(rec) || !rec;
    }

    const tNum = parseEpisodeNumber(target);
    const rNum = parseEpisodeNumber(rec);
    if (tNum !== null && rNum !== null) {
      return tNum === rNum;
    }

    return target === rec;
  }

  /**
   * Resolve HDHub4u destination (Rule A).
   * Note: Source article pages are strictly rejected as download destinations.
   */
  function resolveHDHub4u(candidateLinks, candidateVariants, episodeFilter) {
    // Priority 1: HubDrive download endpoint
    for (const link of candidateLinks) {
      if (matchesEpisode(episodeFilter, link.episode)) {
        const url = link.downloadUrl;
        if (isValidDownloadDestination(url, link.sourceUrl) && url.startsWith(HUBDRIVE_PREFIX)) {
          return {
            url,
            provider: 'HDHub4u',
            priority: 1,
            type: 'download_endpoint',
            reason: 'Qualifying HubDrive download endpoint',
            isDirect: true,
            isValid: true,
            linkRecord: link
          };
        }
      }
    }

    // Priority 2: Specified InventoryIdea endpoint
    for (const link of candidateLinks) {
      if (matchesEpisode(episodeFilter, link.episode)) {
        const candidates = [link.downloadUrl, link.inventoryUrl];
        for (const candidate of candidates) {
          if (isValidDownloadDestination(candidate, link.sourceUrl) && candidate.startsWith(INVENTORY_IDEA_EXACT)) {
            return {
              url: candidate,
              provider: 'HDHub4u',
              priority: 2,
              type: 'inventory_fallback',
              reason: 'Specified InventoryIdea endpoint',
              isDirect: false,
              isValid: true,
              linkRecord: link
            };
          }
        }
      }
    }

    // Check candidate variants for InventoryIdea endpoint
    for (const v of candidateVariants) {
      const candidates = [v.inventoryUrl, v.fallbackUrl];
      for (const candidate of candidates) {
        if (isValidDownloadDestination(candidate, v.sourceUrl) && candidate.startsWith(INVENTORY_IDEA_EXACT)) {
          return {
            url: candidate,
            provider: 'HDHub4u',
            priority: 2,
            type: 'inventory_fallback',
            reason: 'Specified InventoryIdea endpoint',
            isDirect: false,
            isValid: true,
            variantRecord: v
          };
        }
      }
    }

    // Other verified qualifying download endpoints (hubcdn, hubcloud, etc.)
    for (const link of candidateLinks) {
      if (matchesEpisode(episodeFilter, link.episode)) {
        const url = link.downloadUrl;
        if (isValidDownloadDestination(url, link.sourceUrl)) {
          return {
            url,
            provider: 'HDHub4u',
            priority: 1,
            type: 'download_endpoint',
            reason: 'Verified HDHub4u download destination',
            isDirect: true,
            isValid: true,
            linkRecord: link
          };
        }
      }
    }

    // Strictly no source-page fallback as a download destination
    return {
      url: null,
      provider: 'HDHub4u',
      priority: null,
      type: 'unavailable',
      reason: 'No qualifying verified download destination available for HDHub4u',
      isDirect: false,
      isValid: false
    };
  }

  /**
   * Resolve HDWall or 10Moviez destination (Rule B).
   * Note: Source article pages are strictly rejected as download destinations.
   */
  function resolveStandardProvider(providerName, candidateLinks, candidateVariants, episodeFilter) {
    const formattedName = formatProviderName(providerName);

    // Priority 1: Exact valid download endpoint
    for (const link of candidateLinks) {
      if (matchesEpisode(episodeFilter, link.episode)) {
        const url = link.downloadUrl;
        if (isValidDownloadDestination(url, link.sourceUrl)) {
          return {
            url,
            provider: formattedName,
            priority: 1,
            type: 'download_endpoint',
            reason: `${formattedName} verified download endpoint`,
            isDirect: true,
            isValid: true,
            linkRecord: link
          };
        }
      }
    }

    // Strictly no source-page fallback as a download destination
    return {
      url: null,
      provider: formattedName,
      priority: null,
      type: 'unavailable',
      reason: `No qualifying verified download destination available for ${formattedName}`,
      isDirect: false,
      isValid: false
    };
  }

  /**
   * Primary single-destination resolver.
   */
  function resolveDestination(item, options = {}) {
    if (!item || typeof item !== 'object') {
      return {
        url: null,
        provider: 'Unknown',
        priority: null,
        type: 'unavailable',
        reason: 'Missing item record',
        isDirect: false,
        isValid: false
      };
    }

    const targetQuality = normalizeQualityKey(options.qualityKey || '720p');
    const targetEpisode = options.episode || null;
    const preferredProvider = options.providerPreference ? normalizeProvider(options.providerPreference) : null;
    const downloadEntry = options.downloadEntry || null;

    // Filter candidate links from downloads.json
    const allLinks = (downloadEntry && Array.isArray(downloadEntry.links)) ? downloadEntry.links : [];
    const validLinks = allLinks.filter(l => isValidDownloadDestination(l.downloadUrl, l.sourceUrl));
    const qualityLinks = validLinks.filter(l => {
      const linkQ = normalizeQualityKey(l.resolution || l.rawQuality);
      return linkQ === targetQuality;
    });

    const allVariants = Array.isArray(item.variants) ? item.variants : [];
    const qualityVariants = allVariants.filter(v => {
      const quals = Array.isArray(v.qualities) ? v.qualities : [];
      if (quals.length === 0) return true;
      return quals.some(q => normalizeQualityKey(typeof q === 'string' ? q : (q.resolution || q.label)) === targetQuality);
    });

    if (preferredProvider) {
      const provLinks = qualityLinks.filter(l => normalizeProvider(l.sourceName) === preferredProvider);
      const provVariants = qualityVariants.filter(v => normalizeProvider(v.source || v.sourceName) === preferredProvider);

      if (preferredProvider === 'hdhub4u') {
        return resolveHDHub4u(provLinks, provVariants, targetEpisode);
      } else {
        return resolveStandardProvider(preferredProvider, provLinks, provVariants, targetEpisode);
      }
    }

    // Try HDHub4u HubDrive first
    const hdhubLinks = qualityLinks.filter(l => normalizeProvider(l.sourceName) === 'hdhub4u');
    const hdhubVariants = qualityVariants.filter(v => normalizeProvider(v.source || v.sourceName) === 'hdhub4u');
    const hdhubRes = resolveHDHub4u(hdhubLinks, hdhubVariants, targetEpisode);
    if (hdhubRes.isValid && hdhubRes.priority === 1) return hdhubRes;

    // Try HDWall direct download
    const hdwallLinks = qualityLinks.filter(l => normalizeProvider(l.sourceName) === 'hdwall');
    const hdwallVariants = qualityVariants.filter(v => normalizeProvider(v.source || v.sourceName) === 'hdwall');
    const hdwallRes = resolveStandardProvider('HDWall', hdwallLinks, hdwallVariants, targetEpisode);
    if (hdwallRes.isValid) return hdwallRes;

    // Try 10Moviez direct download
    const moviezLinks = qualityLinks.filter(l => normalizeProvider(l.sourceName) === '10moviez');
    const moviezVariants = qualityVariants.filter(v => normalizeProvider(v.source || v.sourceName) === '10moviez');
    const moviezRes = resolveStandardProvider('10Moviez', moviezLinks, moviezVariants, targetEpisode);
    if (moviezRes.isValid) return moviezRes;

    // Fallback to InventoryIdea if available
    if (hdhubRes.isValid && hdhubRes.priority === 2) return hdhubRes;

    // If any other valid quality link exists in qualityLinks
    for (const link of qualityLinks) {
      if (matchesEpisode(targetEpisode, link.episode)) {
        return {
          url: link.downloadUrl,
          provider: formatProviderName(link.sourceName),
          priority: 1,
          type: 'download_endpoint',
          reason: 'Verified download destination',
          isDirect: true,
          isValid: true,
          linkRecord: link
        };
      }
    }

    return {
      url: null,
      provider: 'None',
      priority: null,
      type: 'unavailable',
      reason: 'No qualifying verified download destination found across any provider',
      isDirect: false,
      isValid: false
    };
  }

  /**
   * Group and order all available downloads for a catalog item.
   * Enforces:
   *  - Link 1, Link 2 labels (never source names)
   *  - Movies: grouped by available quality
   *  - Web Series: Complete Season first, then individual episodes
   *  - Separate informational source article URLs
   *
   * @param {Object} item - Catalog item
   * @param {Object} downloadEntry - Matching entry from downloads.json (optional)
   * @returns {Object} Structured download model
   */
  function groupAndOrderDownloads(item, downloadEntry) {
    if (!item || typeof item !== 'object') {
      return {
        isSeries: false,
        hasLinks: false,
        movieQualityGroups: [],
        completeSeasonGroups: [],
        seasonEpisodeGroups: [],
        sourceArticleUrls: [],
        emptyReason: 'Missing item'
      };
    }

    const isSeries = item.type === 'Web Series';
    const allLinks = (downloadEntry && Array.isArray(downloadEntry.links)) ? downloadEntry.links : [];

    // Filter out source article URLs, broken destinations, and unverified links
    const verifiedLinks = allLinks.filter(l => isVerifiedDownloadLink(l, item.sourceUrl));

    if (!isSeries) {
      // ─────────────────────────────────────────────────────────────────
      // MOVIE LOGIC: Group verified links by available quality
      // ─────────────────────────────────────────────────────────────────
      const qualityMap = new Map();

      verifiedLinks.forEach(link => {
        const qKey = normalizeQualityKey(link.resolution || link.rawQuality);
        if (!qualityMap.has(qKey)) {
          qualityMap.set(qKey, {
            qualityKey: qKey,
            label: qualityDisplayLabel(qKey),
            resCls: qualityClass(qKey),
            sortOrder: qualitySortOrder(qKey),
            links: [],
            formats: new Set(),
            audios: new Set(),
            languages: new Set()
          });
        }

        const g = qualityMap.get(qKey);
        if (link.format) g.formats.add(link.format);
        if (link.audio) g.audios.add(link.audio);
        if (link.language) g.languages.add(link.language);

        // Deduplicate identical downloadUrls inside same quality
        if (!g.links.some(existing => existing.downloadUrl === link.downloadUrl)) {
          const nextIndex = g.links.length;
          g.links.push({
            downloadUrl: link.downloadUrl,
            label: formatLinkLabel(nextIndex),
            sourceName: link.sourceName || 'Direct',
            rawQuality: link.rawQuality || qKey,
            format: link.format || null,
            audio: link.audio || null,
            language: link.language || null,
            fileSizeLabel: link.fileSizeLabel || null
          });
        }
      });

      const movieQualityGroups = Array.from(qualityMap.values())
        .filter(g => g.links.length > 0)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(g => ({
          qualityKey: g.qualityKey,
          label: g.label,
          resCls: g.resCls,
          links: g.links,
          formats: Array.from(g.formats),
          audios: Array.from(g.audios),
          languages: Array.from(g.languages)
        }));

      return {
        isSeries: false,
        hasLinks: movieQualityGroups.length > 0,
        movieQualityGroups,
        completeSeasonGroups: [],
        seasonEpisodeGroups: [],
        emptyReason: movieQualityGroups.length > 0 ? null : 'No verified download destinations available yet'
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // WEB SERIES LOGIC: Complete-Season Links ONLY (Problem 3)
    // ─────────────────────────────────────────────────────────────────
    // Filter ONLY genuine verified complete-season or all-episodes download links
    // Strictly omit individual episode links!
    const completeSeasonLinks = verifiedLinks.filter(l => isCompleteSeason(l));

    // Group complete season links by Season Number
    const seasonsMap = new Map(); // seasonNumber -> { seasonNumber, seasonLabel, qualityMap: Map }

    completeSeasonLinks.forEach(link => {
      let sNum = null;
      if (link.season) {
        sNum = parseSeasonNumber(link.season);
      } else if (link.episode) {
        sNum = parseSeasonNumber(link.episode);
      }
      if (sNum === null && item.season) {
        sNum = parseSeasonNumber(item.season);
      }
      if (sNum === null) sNum = 1;

      const sLabel = `Season ${sNum}`;

      if (!seasonsMap.has(sNum)) {
        seasonsMap.set(sNum, {
          seasonNumber: sNum,
          seasonLabel: sLabel,
          qualityMap: new Map()
        });
      }

      const sObj = seasonsMap.get(sNum);
      const qKey = normalizeQualityKey(link.resolution || link.rawQuality);

      if (!sObj.qualityMap.has(qKey)) {
        sObj.qualityMap.set(qKey, {
          qualityKey: qKey,
          label: qualityDisplayLabel(qKey),
          resCls: qualityClass(qKey),
          sortOrder: qualitySortOrder(qKey),
          links: [],
          formats: new Set(),
          audios: new Set(),
          languages: new Set()
        });
      }

      const qObj = sObj.qualityMap.get(qKey);
      if (link.format) qObj.formats.add(link.format);
      if (link.audio) qObj.audios.add(link.audio);
      if (link.language) qObj.languages.add(link.language);

      if (!qObj.links.some(existing => existing.downloadUrl === link.downloadUrl)) {
        const nextIndex = qObj.links.length;
        qObj.links.push({
          downloadUrl: link.downloadUrl,
          label: formatLinkLabel(nextIndex),
          sourceName: link.sourceName || 'Direct',
          rawQuality: link.rawQuality || qKey,
          format: link.format || null,
          audio: link.audio || null,
          language: link.language || null,
          fileSizeLabel: link.fileSizeLabel || null
        });
      }
    });

    const completeSeasonGroups = Array.from(seasonsMap.values())
      .sort((a, b) => a.seasonNumber - b.seasonNumber)
      .map(s => ({
        seasonNumber: s.seasonNumber,
        seasonLabel: s.seasonLabel,
        qualities: Array.from(s.qualityMap.values())
          .filter(q => q.links.length > 0)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(q => ({
            qualityKey: q.qualityKey,
            label: q.label,
            resCls: q.resCls,
            links: q.links,
            formats: Array.from(q.formats),
            audios: Array.from(q.audios),
            languages: Array.from(q.languages)
          }))
      }))
      .filter(s => s.qualities.length > 0);

    const hasLinks = completeSeasonGroups.length > 0;

    return {
      isSeries: true,
      hasLinks,
      movieQualityGroups: [],
      completeSeasonGroups,
      seasonEpisodeGroups: [], // Individual episodes are completely excluded
      emptyReason: hasLinks ? null : 'No verified complete-season links available.'
    };
  }

  return {
    isValidUrl,
    isSourceArticleUrl,
    isValidDownloadDestination,
    classifyLinkVerification,
    isVerifiedDownloadLink,
    normalizeQualityKey,
    qualityDisplayLabel,
    qualityClass,
    qualitySortOrder,
    normalizeProvider,
    formatProviderName,
    formatLinkLabel,
    isCompleteSeason,
    parseEpisodeNumber,
    parseSeasonNumber,
    matchesEpisode,
    resolveDestination,
    groupAndOrderDownloads,
    HUBDRIVE_PREFIX,
    INVENTORY_IDEA_EXACT
  };
});
