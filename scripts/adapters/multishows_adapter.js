/**
 * PRAFLIX — MultiShows Adapter
 * A PRAVERSE Company
 *
 * Implements discovery, searching, and link verification for https://multishows.top
 * Strict architectural rule:
 * MultiShows is strictly a conditional fallback source.
 * It is consulted ONLY when a newly discovered movie or web series has no eligible,
 * verified download-link records from HDHub4u.
 */

const path = require('path');
const BaseAdapter = require('./base_adapter');
const titleDecoder = require('../title_decoder');
const BASE_DIR = path.dirname(path.dirname(__dirname));
const resolver = require(path.join(BASE_DIR, 'destination_resolver.js'));

class MultiShowsAdapter extends BaseAdapter {
  constructor(providerConfig = {}) {
    const config = {
      id: 'multishows',
      displayName: 'MultiShows',
      baseUrl: 'https://multishows.top/',
      searchEndpoint: 'https://multishows.top/search/',
      isFallbackOnly: true,
      fallbackFor: 'hdhub4u',
      rateLimit: {
        timeoutMs: 10000,
        maxRetries: 3,
        concurrency: 2
      },
      ...providerConfig
    };
    super(config);
  }

  /**
   * Normalize title string for strict title matching
   */
  normalizeTitle(str) {
    if (!str) return '';
    let s = titleDecoder.cleanTitle(str).toLowerCase();
    // Normalize Roman numerals in titles e.g. "part ii" -> "part 2"
    s = s.replace(/\bepisode\s+ii\b/g, 'episode 2')
         .replace(/\bepisode\s+iii\b/g, 'episode 3')
         .replace(/\bepisode\s+iv\b/g, 'episode 4')
         .replace(/\bepisode\s+v\b/g, 'episode 5')
         .replace(/\bepisode\s+vi\b/g, 'episode 6')
         .replace(/\bpart\s+ii\b/g, 'part 2')
         .replace(/\bpart\s+iii\b/g, 'part 3');

    // Remove noise words
    s = s.replace(/\b(full\s*movie|dual\s*audio|hindi|dubbed|web-?dl|bluray|hdrip|x264|hevc|1080p|720p|480p|4k)\b/gi, ' ')
         .replace(/[^a-z0-9\s]/g, ' ')
         .replace(/\s+/g, ' ')
         .trim();
    return s;
  }

  /**
   * Check if release years match within acceptable bounds (allowing +/- 1 year tolerance)
   */
  isYearMatch(y1, y2) {
    if (!y1 || !y2) return true; // If one side lacks year, match is deferent to normalized title
    const n1 = parseInt(y1, 10);
    const n2 = parseInt(y2, 10);
    if (isNaN(n1) || isNaN(n2)) return true;
    return Math.abs(n1 - n2) <= 1;
  }

  /**
   * Check if content types match (Movie vs Web Series)
   */
  isTypeMatch(t1, t2) {
    if (!t1 || !t2) return true;
    const norm = t => {
      const s = String(t).toLowerCase();
      if (s.includes('series') || s.includes('show') || s.includes('season')) return 'Web Series';
      return 'Movie';
    };
    return norm(t1) === norm(t2);
  }

  /**
   * Parse search results HTML from https://multishows.top/search/<query>
   */
  parseSearchHtml(html) {
    if (!html || typeof html !== 'string') return [];

    // Check for anti-bot or challenge
    if (html.includes('challenge-platform') || html.includes('cf-browser-verification')) {
      throw new Error('anti_bot_challenge_inconclusive: Cloudflare verification detected');
    }

    const results = [];
    const seenUrls = new Set();

    // Pattern 1: Search card elements
    // Detail links are https://multishows.top/movie/<slug> or https://multishows.top/tv-show/<slug>
    const cardRegex = /<a\s+[^>]*href=["'](https?:\/\/multishows\.top\/(?:movie|tv-show)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = cardRegex.exec(html)) !== null) {
      const detailUrl = m[1].trim();
      if (seenUrls.has(detailUrl)) continue;

      const inner = m[2];
      // Title from alt or inner text
      const altM = inner.match(/alt=["']([^"']+)["']/i);
      const posterM = inner.match(/data-src=["']([^"']+)["']/i) || inner.match(/src=["']([^"']+)["']/i);
      
      // Look for title text in surrounding card if alt is missing or placeholder
      let title = altM ? altM[1].trim() : '';
      if (!title || title.toLowerCase() === 'poster') {
        const titleM = inner.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i);
        if (titleM) {
          title = titleM[1].replace(/<[^>]+>/g, '').trim();
        }
      }

      // If title still not extracted from anchor, derive from slug
      if (!title) {
        const slug = detailUrl.split('/').pop().replace(/-/g, ' ');
        title = slug.charAt(0).toUpperCase() + slug.slice(1);
      }

      const isSeries = detailUrl.includes('/tv-show/');
      const type = isSeries ? 'Web Series' : 'Movie';

      // Year from surrounding text or URL
      const yearM = inner.match(/\b(19\d{2}|20\d{2})\b/) || detailUrl.match(/\b(19\d{2}|20\d{2})\b/);
      const year = yearM ? yearM[1] : '';

      seenUrls.add(detailUrl);
      results.push({
        detailUrl,
        title: titleDecoder.cleanTitle(title),
        normalizedTitle: this.normalizeTitle(title),
        year,
        type,
        poster: posterM ? posterM[1].trim() : null
      });
    }

    // Pattern 2: Also check <h3> tags inside the same container
    const h3Regex = /<h3[^>]*class="[^"]*text-gray-300[^"]*"[^>]*>([\s\S]*?)<\/h3>/gi;
    const h3Titles = [];
    let h3M;
    while ((h3M = h3Regex.exec(html)) !== null) {
      h3Titles.push(h3M[1].replace(/<[^>]+>/g, '').trim());
    }
    // Correlate titles if alt wasn't populated
    if (h3Titles.length === results.length) {
      for (let i = 0; i < results.length; i++) {
        if (!results[i].title || results[i].title === 'Poster') {
          results[i].title = titleDecoder.cleanTitle(h3Titles[i]);
          results[i].normalizedTitle = this.normalizeTitle(h3Titles[i]);
        }
      }
    }

    return results;
  }

  /**
   * Parse detail page HTML to extract verified download links and quality variants
   */
  parseDetailHtml(html, detailUrl) {
    if (!html || typeof html !== 'string') {
      return { success: false, error: 'empty_html', verifiedLinks: [] };
    }

    if (html.includes('challenge-platform') || html.includes('cf-browser-verification')) {
      return {
        success: false,
        error: 'anti_bot_challenge_inconclusive',
        status: 'blocked',
        verifiedLinks: []
      };
    }

    // Extract title
    let title = '';
    const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1M) {
      title = h1M[1].replace(/<[^>]+>/g, '').trim();
    } else {
      const ogTitleM = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
      if (ogTitleM) title = ogTitleM[1].trim();
    }
    title = titleDecoder.cleanTitle(title);

    // Extract year
    let year = '';
    const yearM = html.match(/\b(19\d{2}|20\d{2})\b/);
    if (yearM) year = yearM[1];

    // Extract poster
    let poster = null;
    const posterM = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) ||
                    html.match(/data-src="([^"]+)"/i);
    if (posterM) poster = posterM[1].trim();

    const isSeries = detailUrl.includes('/tv-show/') || detailUrl.includes('/episode/');
    const type = isSeries ? 'Web Series' : 'Movie';

    // Extract download links
    // On MultiShows, download links are structured inside list items with download button:
    // <div>Quality / specs</div> ... <a href="download_url">Download</a>
    const verifiedLinks = [];
    const seenLinks = new Set();
    const rawQualities = [];

    // Find all download button anchors
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let liM;
    while ((liM = liRegex.exec(html)) !== null) {
      const liContent = liM[1];
      const anchorM = liContent.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!anchorM) continue;

      const href = anchorM[1].trim();
      const anchorText = anchorM[2].replace(/<[^>]+>/g, '').trim();

      // Check if it's a download action
      if (!anchorText.toLowerCase().includes('download') && !href.includes('/file/') && !href.includes('/drive/')) {
        continue;
      }

      // Quality and metadata description from preceding div
      const divM = liContent.match(/<div>([\s\S]*?)<\/div>/i);
      const descText = divM ? divM[1].replace(/<[^>]+>/g, '').trim() : '';

      // Skip non-storage links (e.g. Telegram community links)
      if (href.includes('t.me') || href.includes('telegram') || href.includes('discord')) {
        continue;
      }

      // Check destination verification
      const verification = resolver.classifyLinkVerification(href, detailUrl);
      if (verification.status !== 'verified') {
        continue;
      }

      const quality = this.normalizeQuality(descText || anchorText);
      rawQualities.push(descText || quality);

      // Episode vs complete series packaging for Web Series
      let epLabel = undefined;
      let packageType = undefined;
      let season = undefined;

      if (isSeries) {
        const epM = descText.match(/\bep(?:isode)?\s*0*(\d+)\b/i) || detailUrl.match(/\/(\d+)-(\d+)/);
        const seasonM = descText.match(/\bseason\s*0*(\d+)\b/i) || detailUrl.match(/\/(\d+)-\d+/);
        if (seasonM) season = `Season ${parseInt(seasonM[1], 10)}`;

        if (descText.toLowerCase().includes('complete') || descText.toLowerCase().includes('pack') || descText.toLowerCase().includes('all episodes')) {
          packageType = 'complete_season';
          epLabel = 'COMPLETE SEASON';
        } else if (epM) {
          packageType = 'individual_episode';
          const epNum = epM[2] ? epM[2] : epM[1];
          epLabel = `EPISODE ${parseInt(epNum, 10)}`;
        } else {
          packageType = 'complete_season';
          epLabel = 'COMPLETE SEASON';
        }
      }

      const dedupKey = `${href}__${quality}__${epLabel || ''}`;
      if (!seenLinks.has(dedupKey)) {
        seenLinks.add(dedupKey);
        verifiedLinks.push({
          sourceName: 'MultiShows',
          provider: 'MultiShows',
          downloadUrl: href,
          resolution: quality,
          rawQuality: descText || quality,
          episode: epLabel,
          packageType: isSeries ? packageType : undefined,
          season: isSeries ? (season || 'Season 1') : undefined,
          format: 'WEB-DL',
          verificationStatus: 'verified',
          verificationEvidence: verification.evidence || 'verified_storage_destination'
        });
      }
    }

    // Also look for standalone download anchors that might not be in standard <li>
    if (verifiedLinks.length === 0) {
      const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let aM;
      while ((aM = anchorRegex.exec(html)) !== null) {
        const href = aM[1].trim();
        const text = aM[2].replace(/<[^>]+>/g, '').trim();

        if (href.includes('t.me') || href.includes('telegram')) continue;

        const verification = resolver.classifyLinkVerification(href, detailUrl);
        if (verification.status === 'verified') {
          const quality = this.normalizeQuality(text);
          const dedupKey = `${href}__${quality}`;
          if (!seenLinks.has(dedupKey)) {
            seenLinks.add(dedupKey);
            verifiedLinks.push({
              sourceName: 'MultiShows',
              provider: 'MultiShows',
              downloadUrl: href,
              resolution: quality,
              rawQuality: text || quality,
              format: 'WEB-DL',
              verificationStatus: 'verified',
              verificationEvidence: verification.evidence || 'verified_storage_destination'
            });
          }
        }
      }
    }

    return {
      success: true,
      status: verifiedLinks.length > 0 ? 'links_found' : 'no_eligible_links',
      detailUrl,
      title: title || '',
      year: year || '',
      type,
      poster,
      verifiedLinks,
      rawQualities
    };
  }

  /**
   * Search MultiShows for a query term
   */
  async search(query, options = {}) {
    if (options.mockFailure) {
      return {
        success: false,
        status: options.mockFailure.status || 'unavailable',
        error: options.mockFailure.error || 'Mocked provider network failure',
        results: []
      };
    }

    if (options.mockResults) {
      return {
        success: true,
        status: 'ok',
        results: options.mockResults
      };
    }

    if (options.mockHtml) {
      try {
        const results = this.parseSearchHtml(options.mockHtml);
        return { success: true, status: 'ok', results };
      } catch (err) {
        return { success: false, status: 'blocked', error: err.message, results: [] };
      }
    }

    const cleanQuery = typeof query === 'object' ? (query.displayTitle || query.title) : query;
    const url = `https://multishows.top/search/${encodeURIComponent(cleanQuery)}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.rateLimit.timeoutMs || 10000);
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.status === 403) {
        return {
          success: false,
          status: 'blocked',
          error: 'MultiShows HTTP 403 Forbidden / Anti-Bot Challenge',
          results: []
        };
      }

      if (res.status >= 500) {
        return {
          success: false,
          status: 'unavailable',
          error: `MultiShows HTTP ${res.status} Server Error`,
          results: []
        };
      }

      const html = await res.text();
      const results = this.parseSearchHtml(html);
      return { success: true, status: 'ok', results };
    } catch (err) {
      const isTimeout = err.name === 'AbortError' || err.message.includes('timeout');
      return {
        success: false,
        status: isTimeout ? 'timeout' : 'unavailable',
        error: `MultiShows request error: ${err.message}`,
        results: []
      };
    }
  }

  /**
   * Fetch detail page and parse download links
   */
  async fetchDetail(url, options = {}) {
    if (options.mockFailure) {
      return {
        success: false,
        status: options.mockFailure.status || 'unavailable',
        error: options.mockFailure.error || 'Mocked detail fetch failure',
        verifiedLinks: []
      };
    }

    if (options.mockHtml) {
      return this.parseDetailHtml(options.mockHtml, url);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.rateLimit.timeoutMs || 10000);
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.status === 403) {
        return {
          success: false,
          status: 'blocked',
          error: 'MultiShows detail HTTP 403 Forbidden',
          verifiedLinks: []
        };
      }

      if (res.status >= 500) {
        return {
          success: false,
          status: 'unavailable',
          error: `MultiShows detail HTTP ${res.status} Server Error`,
          verifiedLinks: []
        };
      }

      const html = await res.text();
      return this.parseDetailHtml(html, url);
    } catch (err) {
      const isTimeout = err.name === 'AbortError' || err.message.includes('timeout');
      return {
        success: false,
        status: isTimeout ? 'timeout' : 'unavailable',
        error: `MultiShows detail error: ${err.message}`,
        verifiedLinks: []
      };
    }
  }

  /**
   * Main conditional fallback entrypoint:
   * Queries MultiShows for matching title and returns verified fallback records ONLY if matched.
   *
   * @param {Object} candidate - { displayTitle, year, type, season }
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async queryMatchingFallback(candidate, options = {}) {
    if (!candidate || !candidate.displayTitle) {
      return { success: false, status: 'invalid_candidate', matched: false };
    }

    const opts = options.multishowsOptions || options;
    const searchRes = await this.search(candidate.displayTitle, opts);
    if (!searchRes.success) {
      // Inconclusive/blocked/timeout scan must NOT be treated as zero results
      return {
        success: false,
        status: searchRes.status,
        error: searchRes.error,
        matched: false,
        verifiedLinks: []
      };
    }

    const results = searchRes.results || [];
    if (results.length === 0) {
      return {
        success: true,
        status: 'no_match',
        matched: false,
        verifiedLinks: []
      };
    }

    // Match candidate title against search results
    const candNorm = this.normalizeTitle(candidate.displayTitle);
    let matchedItem = null;

    for (const r of results) {
      // 1. Content type check
      if (!this.isTypeMatch(candidate.type, r.type)) continue;

      // 2. Year check
      if (candidate.year && r.year && !this.isYearMatch(candidate.year, r.year)) continue;

      // 3. Title check
      const rNorm = this.normalizeTitle(r.title);
      if (rNorm === candNorm || rNorm.includes(candNorm) || candNorm.includes(rNorm)) {
        matchedItem = r;
        break;
      }
    }

    if (!matchedItem) {
      return {
        success: true,
        status: 'no_match',
        matched: false,
        verifiedLinks: []
      };
    }

    // Fetch detail page
    const detailRes = await this.fetchDetail(matchedItem.detailUrl, opts);
    if (!detailRes.success) {
      return {
        success: false,
        status: detailRes.status,
        error: detailRes.error,
        matched: true,
        matchedUrl: matchedItem.detailUrl,
        verifiedLinks: []
      };
    }

    const verifiedLinks = detailRes.verifiedLinks || [];

    return {
      success: true,
      status: verifiedLinks.length > 0 ? 'links_found' : 'no_eligible_links',
      matched: true,
      provider: 'MultiShows',
      sourceUrl: matchedItem.detailUrl,
      title: detailRes.title || matchedItem.title,
      year: detailRes.year || matchedItem.year || candidate.year,
      type: detailRes.type || matchedItem.type || candidate.type,
      poster: detailRes.poster || matchedItem.poster,
      verifiedLinks: verifiedLinks,
      variant: {
        sourceId: null, // Assigned on ingestion
        sourceUrl: matchedItem.detailUrl,
        source: 'multishows',
        originalSourceTitle: detailRes.title || matchedItem.title,
        languages: ['Hindi', 'English'],
        qualities: (detailRes.rawQualities || []).map(q => ({
          resolution: this.normalizeQuality(q),
          label: q
        })),
        releaseType: 'WEB-DL',
        poster: detailRes.poster || matchedItem.poster
      }
    };
  }
}

module.exports = MultiShowsAdapter;
