/**
 * PRAFLIX Ingestion Pipeline V2 — HDWall Provider Adapter
 * A PRAVERSE Company
 *
 * Discovery Vectors:
 * 1. DataLife Engine Native RSS: https://hdwall.xyz/rss.xml
 * 2. Paginated Listing Crawler: https://hdwall.xyz/page/{page}/
 *
 * Capabilities:
 * - Extracts high-resolution screenshot stills (/uploads/posts/screenshot/).
 * - Extracts poster covers and clean release titles.
 * - Supports modern (.thumb / figure) and legacy (.custom-poster) layouts.
 */

const { BaseV2Adapter } = require('./base_v2_adapter');
const { RssScanner } = require('../discovery/rss_scanner');
const { PageCrawler } = require('../discovery/page_crawler');

class HDWallV2Adapter extends BaseV2Adapter {
  constructor(providerConfig = {}) {
    const config = {
      id: 'hdwall',
      displayName: 'HDWall',
      baseUrl: 'https://hdwall.xyz/',
      allowedDomains: ['hdwall.xyz', 'hdhub.club'],
      feeds: ['https://hdwall.xyz/rss.xml'],
      ...providerConfig
    };
    super(config);
    this.rssScanner = new RssScanner({ allowedDomains: this.config.allowedDomains });
    this.pageCrawler = new PageCrawler({ allowedDomains: this.config.allowedDomains });
  }

  /**
   * Multi-vector discovery: checks DataLife Engine RSS feed first, supplements with pagination
   * @param {Object} [options]
   */
  async discover(options = {}) {
    if (options.mockCandidates) {
      return {
        success: true,
        methodsUsed: ['mock'],
        candidates: options.mockCandidates,
        status: 'SUCCESS'
      };
    }

    const methodsUsed = [];
    const candidateMap = new Map();

    // Vector 1: RSS Feed
    for (const feedUrl of this.config.feeds) {
      try {
        const feedRes = await this.rssScanner.scan(feedUrl);
        if (feedRes.success && feedRes.items.length > 0) {
          methodsUsed.push(`rss:${feedUrl}`);
          for (const item of feedRes.items) {
            candidateMap.set(item.link, {
              url: item.link,
              rawTitle: item.title,
              pubDate: item.pubDate,
              categories: item.categories,
              discoveredVia: 'rss'
            });
          }
        }
      } catch (_) {}
    }

    // Vector 2: Paginated listing crawl
    try {
      const crawlRes = await this.pageCrawler.crawlPagination(
        `${this.config.baseUrl}page/{page}/`,
        1,
        options.maxPages || 2
      );
      if (crawlRes.success) {
        methodsUsed.push('pagination:catalog');
        for (const cand of crawlRes.candidates) {
          if (!candidateMap.has(cand.url)) {
            candidateMap.set(cand.url, {
              url: cand.url,
              rawTitle: cand.rawTitle,
              posterUrl: cand.posterUrl,
              discoveredVia: 'pagination'
            });
          }
        }
      }
    } catch (_) {}

    const candidates = Array.from(candidateMap.values());
    return {
      success: candidates.length > 0,
      methodsUsed,
      candidates,
      totalCount: candidates.length,
      status: candidates.length > 0 ? 'SUCCESS' : 'FAILED'
    };
  }

  /**
   * Parses an HDWall movie article HTML
   * @param {string} html
   * @param {string} pageUrl
   */
  parseDetailPage(html, pageUrl = '') {
    if (!html || typeof html !== 'string') return null;

    if (html.includes('challenge-platform') || html.includes('Just a moment...') || html.includes('cf-browser-verification')) {
      throw new Error(`HDWall encountered anti-bot verification challenge on ${pageUrl} (INCONCLUSIVE)`);
    }

    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const rawHeading = h1Match
      ? h1Match[1].replace(/<[^>]+>/g, '').trim()
      : (titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '');

    if (!rawHeading) return null;

    const meta = this.extractTitleMetadata(rawHeading);
    const yearMatch = rawHeading.match(/\b(19\d{2}|20\d{2})\b/);
    const year = meta.year || (yearMatch ? yearMatch[1] : '');
    const cleanTitle = meta.displayTitle || this.cleanTitle(rawHeading);
    const type = this.detectContentType(rawHeading, '', pageUrl);

    // Posters & Screenshots
    let posterUrl = null;
    let screenshotUrl = null;

    const imgMatches = html.matchAll(/<img[^>]+src="([^">]+)"[^>]*>/gi);
    for (const m of imgMatches) {
      const src = m[1].trim();
      if (src.includes('/uploads/posts/covers/photo_') && !posterUrl) {
        posterUrl = src.startsWith('/') ? `https://hdhub.club${src}` : src;
        screenshotUrl = posterUrl.replace('/uploads/posts/covers/photo_', '/uploads/posts/screenshot/screenshot_');
      } else if (src.includes('/uploads/posts/screenshot/') && !screenshotUrl) {
        screenshotUrl = src.startsWith('/') ? `https://hdhub.club${src}` : src;
      }
    }

    // Extract download links
    const verifiedLinks = [];

    // Strategy 1: HDWall button cards: <a href="...">...<div class="dll">...</div>
    const dlinkRegex = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<div class="dll"[^>]*>([\s\S]*?)<\/div>/gi;
    let m;
    while ((m = dlinkRegex.exec(html)) !== null) {
      const href = m[1].trim();
      const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const val = this.validateLink({
        downloadUrl: href,
        rawQuality: text,
        isSeries: type === 'Web Series',
        type: type,
        titleContext: rawHeading
      }, pageUrl);

      if (val.isValid) {
        verifiedLinks.push({
          url: href,
          downloadUrl: href,
          quality: val.resolution,
          rawQuality: text || val.resolution,
          sourceLabel: text,
          hasQualityConflict: val.hasQualityConflict || false,
          resolutionSource: val.resolutionSource || 'unknown',
          evidence: val.evidence
        });
      }
    }

    // Strategy 2: Direct CDN / drive links fallback
    if (verifiedLinks.length === 0) {
      const linkRegex = /<a[^>]+href="([^">]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let lm;
      while ((lm = linkRegex.exec(html)) !== null) {
        const href = lm[1].trim();
        const text = lm[2].replace(/<[^>]+>/g, '').trim();
        if (href.startsWith('/') || href.startsWith('#') || href.startsWith('javascript:')) continue;

        const val = this.validateLink({
          downloadUrl: href,
          rawQuality: text,
          isSeries: type === 'Web Series',
          type: type,
          titleContext: rawHeading
        }, pageUrl);

        if (val.isValid) {
          verifiedLinks.push({
            url: href,
            downloadUrl: href,
            quality: val.resolution,
            rawQuality: text || val.resolution,
            sourceLabel: text,
            hasQualityConflict: val.hasQualityConflict || false,
            resolutionSource: val.resolutionSource || 'unknown',
            evidence: val.evidence
          });
        }
      }
    }

    return {
      provider: this.displayName,
      providerId: this.id,
      originalSourceTitle: rawHeading,
      displayTitle: cleanTitle,
      year: year,
      type: type,
      sourceUrl: pageUrl,
      sourcePosterUrl: posterUrl,
      screenshots: screenshotUrl ? [screenshotUrl] : [],
      downloadLinks: verifiedLinks,
      verifiedCount: verifiedLinks.length
    };
  }
}

module.exports = {
  HDWallV2Adapter
};
