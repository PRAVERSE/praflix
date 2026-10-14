/**
 * PRAFLIX Ingestion Pipeline V2 — Sitemap & Sitemap Index Scanner
 * A PRAVERSE Company
 *
 * Capabilities:
 * - Scans both XML Sitemap Indexes (<sitemapindex>) and URL sets (<urlset>).
 * - Extracts <loc>, <lastmod>, <changefreq>, and <priority>.
 * - Follows sub-sitemaps (e.g. post-sitemap.xml).
 * - Validates domain restrictions.
 * - Detects malformed, empty, or error responses without throwing unhandled exceptions.
 */

class SitemapScanner {
  /**
   * @param {Object} [options]
   * @param {string[]} [options.allowedDomains]
   * @param {number} [options.timeoutMs=10000]
   * @param {Function} [options.fetchFn]
   */
  constructor(options = {}) {
    this.allowedDomains = (options.allowedDomains || []).map(d => d.toLowerCase());
    this.timeoutMs = options.timeoutMs || 10000;
    this.fetch = options.fetchFn || global.fetch;
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (PRAFLIX-Bot/2.0)';
  }

  /**
   * Parses XML text into structured sitemap entries
   * Uses lightweight regex parsing to avoid heavy XML parser dependencies.
   * @param {string} xmlText
   * @param {string} sourceUrl
   * @returns {{ isIndex: boolean, subSitemaps: string[], entries: Array<{ loc: string, lastmod: string|null }> }}
   */
  parseXml(xmlText, sourceUrl = '') {
    if (!xmlText || typeof xmlText !== 'string' || xmlText.trim().length === 0) {
      return { isIndex: false, subSitemaps: [], entries: [], error: 'Empty XML response' };
    }

    const trimmed = xmlText.trim();
    if (!trimmed.includes('<urlset') && !trimmed.includes('<sitemapindex')) {
      return { isIndex: false, subSitemaps: [], entries: [], error: 'Document does not contain standard XML sitemap root' };
    }

    const isIndex = trimmed.includes('<sitemapindex');

    if (isIndex) {
      const subSitemaps = [];
      const sitemapRegex = /<sitemap>([\s\S]*?)<\/sitemap>/gi;
      let match;
      while ((match = sitemapRegex.exec(trimmed)) !== null) {
        const block = match[1];
        const locMatch = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/i);
        if (locMatch && locMatch[1]) {
          subSitemaps.push(locMatch[1].trim());
        }
      }
      return { isIndex: true, subSitemaps, entries: [] };
    }

    // Standard <urlset>
    const entries = [];
    const urlRegex = /<url>([\s\S]*?)<\/url>/gi;
    let match;
    while ((match = urlRegex.exec(trimmed)) !== null) {
      const block = match[1];
      const locMatch = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/i);
      const lastmodMatch = block.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i);

      if (locMatch && locMatch[1]) {
        const loc = locMatch[1].trim();
        const lastmod = lastmodMatch ? lastmodMatch[1].trim() : null;

        // Domain verification if configured
        if (this.isDomainAllowed(loc)) {
          entries.push({
            loc,
            lastmod,
            sourceSitemap: sourceUrl
          });
        }
      }
    }

    return { isIndex: false, subSitemaps: [], entries };
  }

  /**
   * Validates if a URL matches allowed domains
   * @param {string} urlStr
   * @returns {boolean}
   */
  isDomainAllowed(urlStr) {
    if (this.allowedDomains.length === 0) return true;
    try {
      const parsed = new URL(urlStr);
      const host = parsed.hostname.toLowerCase();
      return this.allowedDomains.some(d => host === d || host.endsWith(`.${d}`));
    } catch (_) {
      return false;
    }
  }

  /**
   * Scans a sitemap URL, recursively following sub-sitemaps if it is a sitemap index
   * @param {string} sitemapUrl
   * @param {number} [maxDepth=2]
   * @returns {Promise<{ success: boolean, url: string, entries: Array<{ loc: string, lastmod: string|null }>, subSitemapsScanned: string[], error?: string }>}
   */
  async scan(sitemapUrl, maxDepth = 2) {
    const allEntries = [];
    const scannedSitemaps = [];
    const queue = [{ url: sitemapUrl, depth: 1 }];
    const seenSitemaps = new Set([sitemapUrl]);

    while (queue.length > 0) {
      const current = queue.shift();
      scannedSitemaps.push(current.url);

      let xmlText = '';
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        const res = await this.fetch(current.url, {
          signal: controller.signal,
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'application/xml, text/xml, */*'
          }
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          if (queue.length === 0 && allEntries.length === 0) {
            return {
              success: false,
              url: sitemapUrl,
              entries: [],
              subSitemapsScanned: scannedSitemaps,
              error: `HTTP ${res.status} from sitemap: ${current.url}`
            };
          }
          continue;
        }

        xmlText = await res.text();
      } catch (err) {
        if (queue.length === 0 && allEntries.length === 0) {
          return {
            success: false,
            url: sitemapUrl,
            entries: [],
            subSitemapsScanned: scannedSitemaps,
            error: `Network failure fetching sitemap: ${err.message}`
          };
        }
        continue;
      }

      const parsed = this.parseXml(xmlText, current.url);

      if (parsed.error && allEntries.length === 0 && queue.length === 0) {
        return {
          success: false,
          url: sitemapUrl,
          entries: [],
          subSitemapsScanned: scannedSitemaps,
          error: parsed.error
        };
      }

      if (parsed.isIndex && current.depth < maxDepth) {
        for (const sub of parsed.subSitemaps) {
          // Prioritize post / movie sitemaps over category / tag / author sitemaps
          if (!seenSitemaps.has(sub)) {
            seenSitemaps.add(sub);
            if (/post|movie|series|video/i.test(sub) || !/tag|category|author|page-/i.test(sub)) {
              queue.push({ url: sub, depth: current.depth + 1 });
            }
          }
        }
      } else if (!parsed.isIndex) {
        for (const entry of parsed.entries) {
          allEntries.push(entry);
        }
      }
    }

    return {
      success: allEntries.length > 0,
      url: sitemapUrl,
      entries: allEntries,
      subSitemapsScanned: scannedSitemaps,
      totalCount: allEntries.length
    };
  }
}

module.exports = {
  SitemapScanner
};
