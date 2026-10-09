/**
 * PRAFLIX — Destination Resolver
 * Central, deterministic destination resolution function implementing exact priority rules
 * for HDHub4u, HDWall, and 10Moviez providers across movies and web series.
 *
 * Rules:
 *  Rule A (HDHub4u):
 *    Priority 1: Qualifying HubDrive endpoint (begins exactly with https://hubdrive.pics/file/)
 *    Priority 2: Specified InventoryIdea endpoint (contains https://inventoryidea.com/homelander/)
 *    Priority 3: Verified source-page fallback associated with the exact title/version
 *    Priority 4: No valid destination -> unavailable / null
 *
 *  Rule B (HDWall & 10Moviez):
 *    Priority 1: Exact valid download endpoint stored for the selected version
 *    Priority 2: Verified source-page fallback associated with the exact title/version
 *    Priority 3: No valid destination -> unavailable / null
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
   * Normalize resolution string into canonical quality key ('2160p', '1080p', '720p', '480p', '360p').
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
   * Normalize provider identifier into canonical key ('hdhub4u', 'hdwall', '10moviez').
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
   * Match episode filter against link or record episode.
   * Ensures episode-specific links never bleed into different episodes or complete series.
   */
  function matchesEpisode(targetEpisode, recordEpisode) {
    if (!targetEpisode) return true; // No specific episode requested
    const target = String(targetEpisode).trim().toUpperCase();
    const rec = String(recordEpisode || '').trim().toUpperCase();

    // If target is "FULL SERIES", record must be full series
    if (target.includes('FULL') || target === 'FULL SERIES') {
      return rec.includes('FULL') || rec === 'FULL SERIES' || !rec;
    }

    // If target is specific episode, e.g. "Episode 1" or "EPISODE 01"
    const targetMatch = target.match(/\b(?:EPISODE|EP)\s*0*(\d+)\b/i);
    const recMatch = rec.match(/\b(?:EPISODE|EP)\s*0*(\d+)\b/i);
    if (targetMatch && recMatch) {
      return targetMatch[1] === recMatch[1];
    }

    return target === rec;
  }

  /**
   * Resolve HDHub4u destination using exact Rule A.
   */
  function resolveHDHub4u(candidateLinks, candidateVariants, episodeFilter) {
    // 1. Priority 1: Qualifying HubDrive download endpoint
    for (const link of candidateLinks) {
      if (matchesEpisode(episodeFilter, link.episode)) {
        const url = link.downloadUrl;
        if (isValidUrl(url) && url.startsWith(HUBDRIVE_PREFIX)) {
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

    // 2. Priority 2: Specified InventoryIdea endpoint
    for (const link of candidateLinks) {
      if (matchesEpisode(episodeFilter, link.episode)) {
        const candidateUrls = [link.downloadUrl, link.inventoryUrl, link.fallbackUrl];
        for (const candidate of candidateUrls) {
          if (isValidUrl(candidate) && candidate.startsWith(INVENTORY_IDEA_EXACT)) {
            return {
              url: candidate,
              provider: 'HDHub4u',
              priority: 2,
              type: 'inventory_fallback',
              reason: 'Specified InventoryIdea fallback endpoint',
              isDirect: false,
              isValid: true,
              linkRecord: link
            };
          }
        }
      }
    }
    // Also check candidate variants for stored InventoryIdea URL
    for (const v of candidateVariants) {
      const candidateUrls = [v.inventoryUrl, v.sourceUrl, v.fallbackUrl];
      for (const candidate of candidateUrls) {
        if (isValidUrl(candidate) && candidate.startsWith(INVENTORY_IDEA_EXACT)) {
          return {
            url: candidate,
            provider: 'HDHub4u',
            priority: 2,
            type: 'inventory_fallback',
            reason: 'Specified InventoryIdea fallback endpoint',
            isDirect: false,
            isValid: true,
            variantRecord: v
          };
        }
      }
    }

    // 3. Priority 3: Verified source-page fallback
    // Check links first, then variants for matching sourceUrl
    for (const link of candidateLinks) {
      if (matchesEpisode(episodeFilter, link.episode) && isValidUrl(link.sourceUrl)) {
        return {
          url: link.sourceUrl,
          provider: 'HDHub4u',
          priority: 3,
          type: 'source_fallback',
          reason: 'Verified source-page fallback',
          isDirect: false,
          isValid: true,
          linkRecord: link
        };
      }
    }
    for (const v of candidateVariants) {
      if (isValidUrl(v.sourceUrl)) {
        return {
          url: v.sourceUrl,
          provider: 'HDHub4u',
          priority: 3,
          type: 'source_fallback',
          reason: 'Verified source-page fallback',
          isDirect: false,
          isValid: true,
          variantRecord: v
        };
      }
    }

    // 4. Priority 4: No valid destination
    return {
      url: null,
      provider: 'HDHub4u',
      priority: null,
      type: 'unavailable',
      reason: 'No qualifying destination available for HDHub4u',
      isDirect: false,
      isValid: false
    };
  }

  /**
   * Resolve HDWall or 10Moviez destination using exact Rule B.
   */
  function resolveStandardProvider(providerName, candidateLinks, candidateVariants, episodeFilter) {
    const formattedName = formatProviderName(providerName);

    // 1. Priority 1: Exact valid download endpoint stored for the selected version
    for (const link of candidateLinks) {
      if (matchesEpisode(episodeFilter, link.episode)) {
        const url = link.downloadUrl;
        if (isValidUrl(url)) {
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

    // 2. Priority 2: Verified source-page fallback associated with the exact version
    for (const link of candidateLinks) {
      if (matchesEpisode(episodeFilter, link.episode) && isValidUrl(link.sourceUrl)) {
        return {
          url: link.sourceUrl,
          provider: formattedName,
          priority: 2,
          type: 'source_fallback',
          reason: `${formattedName} verified source-page fallback`,
          isDirect: false,
          isValid: true,
          linkRecord: link
        };
      }
    }
    for (const v of candidateVariants) {
      if (isValidUrl(v.sourceUrl)) {
        return {
          url: v.sourceUrl,
          provider: formattedName,
          priority: 2,
          type: 'source_fallback',
          reason: `${formattedName} verified source-page fallback`,
          isDirect: false,
          isValid: true,
          variantRecord: v
        };
      }
    }

    // 3. Priority 3: No valid destination
    return {
      url: null,
      provider: formattedName,
      priority: null,
      type: 'unavailable',
      reason: `No qualifying destination available for ${formattedName}`,
      isDirect: false,
      isValid: false
    };
  }

  /**
   * Primary destination resolver.
   *
   * @param {Object} item - Canonical title item (must have canonicalId, displayTitle, variants)
   * @param {Object} options - Resolution criteria:
   *   - qualityKey: string (e.g. '1080p', '720p', '480p', '2160p')
   *   - providerPreference: string optional ('HDHub4u', 'HDWall', '10Moviez')
   *   - episode: string optional ('Episode 1', 'FULL SERIES')
   *   - downloadEntry: object optional (entry from downloads.json for item.canonicalId)
   * @returns {Object} Resolution result
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
    const qualityLinks = allLinks.filter(l => {
      const linkQ = normalizeQualityKey(l.resolution || l.rawQuality);
      return linkQ === targetQuality;
    });

    // Filter candidate variants from item.variants
    const allVariants = Array.isArray(item.variants) ? item.variants : [];
    const qualityVariants = allVariants.filter(v => {
      const quals = Array.isArray(v.qualities) ? v.qualities : [];
      if (quals.length === 0) return true; // variant offers general qualities
      return quals.some(q => normalizeQualityKey(typeof q === 'string' ? q : (q.resolution || q.label)) === targetQuality);
    });

    // If specific provider requested
    if (preferredProvider) {
      const provLinks = qualityLinks.filter(l => normalizeProvider(l.sourceName) === preferredProvider);
      const provVariants = qualityVariants.filter(v => normalizeProvider(v.source || v.sourceName) === preferredProvider);

      if (preferredProvider === 'hdhub4u') {
        return resolveHDHub4u(provLinks, provVariants, targetEpisode);
      } else if (preferredProvider === 'hdwall') {
        return resolveStandardProvider('HDWall', provLinks, provVariants, targetEpisode);
      } else if (preferredProvider === '10moviez') {
        return resolveStandardProvider('10Moviez', provLinks, provVariants, targetEpisode);
      } else {
        return resolveStandardProvider(options.providerPreference, provLinks, provVariants, targetEpisode);
      }
    }

    // No specific provider requested -> Evaluate in priority order:
    // Try HDHub4u HubDrive first (highest priority qualifying download)
    const hdhubLinks = qualityLinks.filter(l => normalizeProvider(l.sourceName) === 'hdhub4u');
    const hdhubVariants = qualityVariants.filter(v => normalizeProvider(v.source || v.sourceName) === 'hdhub4u');
    const hdhubRes = resolveHDHub4u(hdhubLinks, hdhubVariants, targetEpisode);
    if (hdhubRes.isValid && hdhubRes.priority === 1) {
      return hdhubRes;
    }

    // Try HDWall direct download
    const hdwallLinks = qualityLinks.filter(l => normalizeProvider(l.sourceName) === 'hdwall');
    const hdwallVariants = qualityVariants.filter(v => normalizeProvider(v.source || v.sourceName) === 'hdwall');
    const hdwallRes = resolveStandardProvider('HDWall', hdwallLinks, hdwallVariants, targetEpisode);
    if (hdwallRes.isValid && hdwallRes.priority === 1) {
      return hdwallRes;
    }

    // Try 10Moviez direct download
    const moviezLinks = qualityLinks.filter(l => normalizeProvider(l.sourceName) === '10moviez');
    const moviezVariants = qualityVariants.filter(v => normalizeProvider(v.source || v.sourceName) === '10moviez');
    const moviezRes = resolveStandardProvider('10Moviez', moviezLinks, moviezVariants, targetEpisode);
    if (moviezRes.isValid && moviezRes.priority === 1) {
      return moviezRes;
    }

    // Check HDHub4u Priority 2 (InventoryIdea fallback)
    if (hdhubRes.isValid && hdhubRes.priority === 2) {
      return hdhubRes;
    }

    // Fallbacks: HDHub4u source fallback, then HDWall, then 10Moviez
    if (hdhubRes.isValid && hdhubRes.priority === 3) return hdhubRes;
    if (hdwallRes.isValid && hdwallRes.priority === 2) return hdwallRes;
    if (moviezRes.isValid && moviezRes.priority === 2) return moviezRes;

    // Check if item has any general sourceUrl on variants as last-resort fallback for this exact title
    for (const v of allVariants) {
      if (isValidUrl(v.sourceUrl)) {
        const provName = formatProviderName(v.source || v.sourceName);
        return {
          url: v.sourceUrl,
          provider: provName,
          priority: 3,
          type: 'source_fallback',
          reason: `${provName} verified title source-page fallback`,
          isDirect: false,
          isValid: true,
          variantRecord: v
        };
      }
    }

    return {
      url: null,
      provider: 'None',
      priority: null,
      type: 'unavailable',
      reason: 'No qualifying destination found across any provider',
      isDirect: false,
      isValid: false
    };
  }

  return {
    isValidUrl,
    normalizeQualityKey,
    normalizeProvider,
    formatProviderName,
    matchesEpisode,
    resolveDestination,
    HUBDRIVE_PREFIX,
    INVENTORY_IDEA_EXACT
  };
});
