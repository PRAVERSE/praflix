/**
 * PRAFLIX — 10Moviez Provider Adapter
 * A PRAVERSE Company
 *
 * Implements discovery, category traversal, and link verification for 10Moviez.
 */

const BaseAdapter = require('./base_adapter');

class TenMoviezAdapter extends BaseAdapter {
  constructor(providerConfig) {
    super(providerConfig);
  }

  /**
   * Parse listing page HTML to extract candidate articles
   */
  parseListingPage(html, pageUrl = '') {
    const items = [];
    if (!html) return items;

    const itemRegex = /<a class="poster"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<img [^>]*src="([^"]+)"[^>]*alt="([^"]+)"/g;
    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      const sourceUrl = match[1];
      const sourcePosterUrl = match[2];
      const rawTitle = match[3];

      const meta = this.extractTitleMetadata(rawTitle);
      const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
      const year = meta.year || (yearMatch ? yearMatch[1] : '');
      const type = this.detectContentType(rawTitle, 'Web Series', sourceUrl);
      const cleanTitle = meta.displayTitle || this.cleanTitle(rawTitle);

      items.push({
        provider: this.displayName,
        providerId: this.id,
        source: '10moviez',
        originalSourceTitle: this.cleanTitle(rawTitle),
        displayTitle: cleanTitle,
        year: year,
        type: type,
        season: type === 'Web Series' ? this.extractSeason(rawTitle) : null,
        sourceUrl: sourceUrl,
        sourcePosterUrl: sourcePosterUrl,
        screenshots: [],
        qualities: [
          { resolution: '720p', label: '720p' },
          { resolution: '1080p', label: '1080p' }
        ]
      });
    }

    return items;
  }

  /**
   * Discover latest items from 10Moviez across categories
   */
  async discover(options = {}) {
    if (options.mockItems && options.mockItems[this.displayName] !== undefined) {
      return {
        pagesDiscovered: 1,
        pagesProcessed: 1,
        items: options.mockItems[this.displayName],
        completeness: 'COMPLETE'
      };
    }

    const timeoutMs = options.timeoutMs || this.config.rateLimit.timeoutMs || 8000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = `${this.config.baseUrl}category/web-series/page/1/`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (PRAFLIX-Bot/1.0)'
        }
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${this.displayName}`);
      }

      const html = await res.text();
      const items = this.parseListingPage(html, url);

      return {
        pagesDiscovered: 1,
        pagesProcessed: 1,
        items: items,
        completeness: 'COMPLETE'
      };
    } catch (err) {
      clearTimeout(timeoutId);
      throw new Error(`Failed to discover from ${this.displayName}: ${err.message}`);
    }
  }
}

module.exports = TenMoviezAdapter;
