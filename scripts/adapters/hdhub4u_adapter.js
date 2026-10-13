/**
 * PRAFLIX — HDHub4u Provider Adapter
 * A PRAVERSE Company
 *
 * Implements discovery, parsing, and link verification for HDHub4u.
 */

const BaseAdapter = require('./base_adapter');
const path = require('path');
const BASE_DIR = path.dirname(path.dirname(__dirname));

class HDHub4uAdapter extends BaseAdapter {
  constructor(providerConfig) {
    super(providerConfig);
  }

  /**
   * Parse listing page HTML to extract candidate articles
   */
  parseListingPage(html, pageUrl = '') {
    const items = [];
    if (!html) return items;

    const postRegex = /<article[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<img [^>]*src="([^"]+)"[^>]*alt="([^"]+)"/g;
    let match;
    while ((match = postRegex.exec(html)) !== null) {
      const sourceUrl = match[1];
      const sourcePosterUrl = match[2];
      const rawTitle = match[3];

      const meta = this.extractTitleMetadata(rawTitle);
      const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
      const year = meta.year || (yearMatch ? yearMatch[1] : '');
      const type = this.detectContentType(rawTitle, '', sourceUrl);
      const cleanTitle = meta.displayTitle || this.cleanTitle(rawTitle);

      items.push({
        provider: this.displayName,
        providerId: this.id,
        source: 'hdhub4u',
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
   * Parse title details page HTML to extract download options and screenshots
   */
  parseTitlePage(html, pageUrl) {
    const result = {
      sourceUrl: pageUrl,
      downloadOptions: [],
      screenshots: []
    };

    if (!html) return result;

    // Screenshot extraction
    const imgRegex = /<img[^>]+src="([^">]+\.(?:jpg|jpeg|png|webp))"[^>]*>/gi;
    let imgMatch;
    const seenImages = new Set();
    while ((imgMatch = imgRegex.exec(html)) !== null) {
      const src = imgMatch[1];
      if (src.includes('screenshot') || src.includes('extra') || src.includes('proof')) {
        if (!seenImages.has(src)) {
          seenImages.add(src);
          result.screenshots.push(src);
        }
      }
    }

    // Link extraction (anchors pointing to storage endpoints)
    const linkRegex = /<a[^>]+href="([^">]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(html)) !== null) {
      const href = linkMatch[1].trim();
      const text = linkMatch[2].replace(/<[^>]+>/g, '').trim();

      // Check if candidate link is eligible
      const validation = this.validateLink({ downloadUrl: href, rawQuality: text }, pageUrl);
      if (validation.isValid) {
        result.downloadOptions.push({
          downloadUrl: validation.downloadUrl,
          resolution: validation.resolution,
          rawQuality: text || validation.resolution,
          format: 'WEB-DL',
          verificationStatus: 'verified'
        });
      }
    }

    return result;
  }

  /**
   * Discover latest items from HDHub4u
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
      const res = await fetch(this.config.baseUrl, {
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
      const items = this.parseListingPage(html, this.config.baseUrl);

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

module.exports = HDHub4uAdapter;
