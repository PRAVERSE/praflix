/**
 * PRAFLIX Ingestion Pipeline V2 — 10Moviez Provider Adapter
 * A PRAVERSE Company
 *
 * Discovery Vectors:
 * 1. RSS Feed: https://10moviez.biz/feed/ (Primary, clean XML, bypassing HTML anti-bot challenge)
 * 2. Sitemap Index: https://10moviez.biz/sitemap.xml
 * 3. Web-Series Category Crawler (supplementary fallback)
 */

const { BaseV2Adapter } = require('./base_v2_adapter');
const { RssScanner } = require('../discovery/rss_scanner');
const { SitemapScanner } = require('../discovery/sitemap_scanner');
const { PageCrawler } = require('../discovery/page_crawler');

class TenMoviezV2Adapter extends BaseV2Adapter {
  constructor(providerConfig = {}) {
    const config = {
      id: '10moviez',
      displayName: '10Moviez',
      baseUrl: 'https://10moviez.biz/',
      allowedDomains: ['10moviez.biz', '10moviez.org', '10moviez.net'],
      feeds: ['https://10moviez.biz/feed/'],
      sitemaps: ['https://10moviez.biz/sitemap.xml'],
      ...providerConfig
    };
    super(config);
    this.rssScanner = new RssScanner({ allowedDomains: this.config.allowedDomains });
    this.sitemapScanner = new SitemapScanner({ allowedDomains: this.config.allowedDomains });
    this.pageCrawler = new PageCrawler({ allowedDomains: this.config.allowedDomains });
  }

  /**
   * Multi-vector discovery: prioritizes clean RSS feed, falls back to sitemaps and category pagination
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

    // Vector 1: RSS Feed (Most reliable, free of Cloudflare challenge)
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
          break;
        }
      } catch (_) {}
    }

    // Vector 2: Sitemap if RSS was sparse or failed
    if (candidateMap.size < 5) {
      for (const smUrl of this.config.sitemaps) {
        try {
          const smRes = await this.sitemapScanner.scan(smUrl);
          if (smRes.success && smRes.entries.length > 0) {
            methodsUsed.push(`sitemap:${smUrl}`);
            for (const entry of smRes.entries) {
              if (!candidateMap.has(entry.loc)) {
                candidateMap.set(entry.loc, {
                  url: entry.loc,
                  lastmod: entry.lastmod,
                  discoveredVia: 'sitemap'
                });
              }
            }
          }
        } catch (_) {}
      }
    }

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
   * Parses an article detail page or RSS item into a structured candidate
   * @param {string} html
   * @param {string} pageUrl
   */
  parseDetailPage(html, pageUrl = '') {
    if (!html || typeof html !== 'string') return null;

    if (html.includes('challenge-platform') || html.includes('Just a moment...') || html.includes('cf-browser-verification')) {
      throw new Error(`10Moviez encountered anti-bot verification challenge on ${pageUrl} (INCONCLUSIVE)`);
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
    const type = this.detectContentType(rawHeading, 'Web Series', pageUrl);

    const posterMatch = html.match(/<img[^>]+src="([^">]+\.(?:jpg|jpeg|png|webp))"[^>]*>/i);
    const posterUrl = posterMatch ? posterMatch[1].trim() : null;

    // Extract links
    const verifiedLinks = [];
    const linkRegex = /<a[^>]+href="([^">]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      const href = m[1].trim();
      const text = m[2].replace(/<[^>]+>/g, '').trim();

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

    return {
      provider: this.displayName,
      providerId: this.id,
      originalSourceTitle: rawHeading,
      displayTitle: cleanTitle,
      year: year,
      type: type,
      sourceUrl: pageUrl,
      sourcePosterUrl: posterUrl,
      downloadLinks: verifiedLinks,
      verifiedCount: verifiedLinks.length
    };
  }
}

module.exports = {
  TenMoviezV2Adapter
};
