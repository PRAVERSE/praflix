/**
 * PRAFLIX Ingestion Pipeline V2 — HDHub4u Provider Adapter
 * A PRAVERSE Company
 *
 * Discovery Vectors:
 * 1. Post Sitemap: https://new7.hdhub4u.cl/post-sitemap.xml
 * 2. Sitemap Index: https://new7.hdhub4u.cl/sitemap.xml
 * 3. Paginated Listings & Category Pages (fallback / deep crawl)
 *
 * Strict Link Rules:
 * - Direct download destinations require https://hubdrive.pics/file/ prefix.
 * - Web Series requires complete-season packages only.
 */

const { BaseV2Adapter } = require('./base_v2_adapter');
const { SitemapScanner } = require('../discovery/sitemap_scanner');
const { PageCrawler } = require('../discovery/page_crawler');

class HDHub4uV2Adapter extends BaseV2Adapter {
  constructor(providerConfig = {}) {
    const config = {
      id: 'hdhub4u',
      displayName: 'HDHub4u',
      baseUrl: 'https://new7.hdhub4u.cl/',
      allowedDomains: ['new7.hdhub4u.cl', 'hdhub4u.cl', 'new1.hdhub4u.free', 'new2.hdhub4u.free'],
      sitemaps: [
        'https://new7.hdhub4u.cl/post-sitemap.xml',
        'https://new7.hdhub4u.cl/sitemap.xml'
      ],
      categories: [
        'category/bollywood-movies/',
        'category/hollywood-movies/',
        'category/web-series/'
      ],
      eligibilityRules: {
        requireExactHubDrivePrefix: true,
        requiredHubDrivePrefix: 'https://hubdrive.pics/file/'
      },
      ...providerConfig
    };
    super(config);
    this.sitemapScanner = new SitemapScanner({ allowedDomains: this.config.allowedDomains });
    this.pageCrawler = new PageCrawler({ allowedDomains: this.config.allowedDomains });
  }

  /**
   * Multi-vector discovery: checks sitemap first, supplements with pagination if needed
   * @param {Object} [options]
   * @returns {Promise<{ success: boolean, methodsUsed: string[], candidates: Array<any>, status: string }>}
   */
  async discover(options = {}) {
    // For mocked testing
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

    // Vector 1: Listing Crawler (Freshest releases from homepage and category listings)
    try {
      const crawlRes = await this.pageCrawler.crawlPagination(
        `${this.config.baseUrl}page/{page}/`,
        1,
        options.maxPages || 2
      );
      if (crawlRes.success) {
        methodsUsed.push('pagination:latest_movies');
        for (const cand of crawlRes.candidates) {
          candidateMap.set(cand.url, {
            url: cand.url,
            rawTitle: cand.rawTitle,
            posterUrl: cand.posterUrl,
            discoveredVia: 'pagination'
          });
        }
      }
    } catch (_) {}

    // Vector 2: Post Sitemap (Archive & deep URL discovery)
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
          break; // First working sitemap succeeded
        }
      } catch (_) {}
    }

    const candidates = Array.from(candidateMap.values());
    let status = 'SUCCESS';
    if (candidates.length === 0) {
      status = sitemapSuccess ? 'INCONCLUSIVE' : 'FAILED';
    }

    return {
      success: candidates.length > 0,
      methodsUsed,
      candidates,
      totalCount: candidates.length,
      status
    };
  }

  /**
   * Parses an HDHub4u article detail page HTML
   * @param {string} html
   * @param {string} pageUrl
   * @returns {Object|null}
   */
  parseDetailPage(html, pageUrl = '') {
    if (!html || typeof html !== 'string') return null;

    if (html.includes('challenge-platform') || html.includes('Just a moment...') || html.includes('cf-browser-verification')) {
      throw new Error(`HDHub4u crawler encountered anti-bot verification challenge on ${pageUrl} (INCONCLUSIVE)`);
    }

    // Extract raw title from <h1> or <title>
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const rawHeading = h1Match
      ? h1Match[1].replace(/<[^>]+>/g, '').trim()
      : (titleTagMatch ? titleTagMatch[1].replace(/<[^>]+>/g, '').trim() : '');

    if (!rawHeading) return null;

    const meta = this.extractTitleMetadata(rawHeading);
    const yearMatch = rawHeading.match(/\b(19\d{2}|20\d{2})\b/);
    const year = meta.year || (yearMatch ? yearMatch[1] : '');
    const cleanTitle = meta.displayTitle || this.cleanTitle(rawHeading);
    const type = this.detectContentType(rawHeading, '', pageUrl);

    // IMDb ID
    const imdbMatch = html.match(/tt\d{7,8}/i);
    const imdbId = imdbMatch ? imdbMatch[0].toLowerCase() : null;

    // Poster artwork
    const posterMatch = html.match(/<img[^>]+src="([^">]+\.(?:jpg|jpeg|png|webp))"[^>]*>/i);
    const posterUrl = posterMatch ? posterMatch[1].trim() : null;

    // Extract download links
    const verifiedLinks = [];
    const linkRegex = /<a[^>]+href="([^">]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      const href = m[1].trim();
      const text = m[2].replace(/<[^>]+>/g, '').trim();

      if (href.startsWith('https://hubdrive.pics/file/')) {
        const val = this.validateLink({
          downloadUrl: href,
          rawQuality: text,
          isSeries: type === 'Web Series',
          type: type,
          titleContext: rawHeading
        }, pageUrl);

        if (val.isValid) {
          const lower = text.toLowerCase();
          verifiedLinks.push({
            url: href,
            downloadUrl: href,
            quality: val.resolution,
            rawQuality: text || val.resolution,
            sourceLabel: text,
            hasQualityConflict: val.hasQualityConflict || false,
            resolutionSource: val.resolutionSource || 'unknown',
            codec: lower.includes('hevc') || lower.includes('x265') ? 'HEVC' : 'x264',
            fileSize: (text.match(/\[([^\]]+)\]/) || [])[1] || 'Unknown',
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
      imdbId: imdbId,
      sourceUrl: pageUrl,
      sourcePosterUrl: posterUrl,
      downloadLinks: verifiedLinks,
      verifiedCount: verifiedLinks.length
    };
  }
}

module.exports = {
  HDHub4uV2Adapter
};
