/**
 * PRAFLIX Ingestion Pipeline V2 — Resilient Page & Category Crawler
 * A PRAVERSE Company
 *
 * Capabilities:
 * - Scans paginated HTML listing and category pages.
 * - Extracts candidate article URLs independently from detail page parsing.
 * - Respects polite rate-limits and bounded retries with exponential backoff.
 * - Detects and flags anti-bot challenges (CF challenge, turnstile, 403) explicitly.
 * - Deduplicates URLs across pagination sweeps.
 */

class PageCrawler {
  /**
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=10000]
   * @param {number} [options.delayMs=500]
   * @param {number} [options.maxRetries=2]
   * @param {string[]} [options.allowedDomains]
   * @param {Function} [options.fetchFn]
   */
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 10000;
    this.delayMs = options.delayMs || 500;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
    this.allowedDomains = (options.allowedDomains || []).map(d => d.toLowerCase());
    this.fetch = options.fetchFn || global.fetch;
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (PRAFLIX-Bot/2.0)';
  }

  /**
   * Sleep helper for rate limiting
   * @param {number} ms
   */
  async sleep(ms) {
    if (ms <= 0) return;
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Checks if an HTML string represents an anti-bot challenge
   * @param {string} html
   * @returns {boolean}
   */
  isChallenge(html) {
    if (!html) return false;
    return (
      html.includes('challenge-platform') ||
      html.includes('cf-chl') ||
      html.includes('Just a moment...') ||
      html.includes('cf-browser-verification') ||
      html.includes('Attention Required! | Cloudflare')
    );
  }

  /**
   * Extract links from HTML based on common movie site patterns
   * @param {string} html
   * @param {string} pageUrl
   * @param {Object} [rules]
   * @returns {Array<{ url: string, rawTitle?: string, posterUrl?: string }>}
   */
  extractCandidateLinks(html, pageUrl, rules = {}) {
    const candidates = [];
    const seen = new Set();
    const parsedBase = new URL(pageUrl);
    const origin = `${parsedBase.protocol}//${parsedBase.host}`;

    // Regex 1: <a> tags with href and img
    const cardRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;

    while ((match = cardRegex.exec(html)) !== null) {
      let rawHref = match[1].trim();
      const innerHtml = match[2];

      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) continue;

      let fullUrl;
      try {
        fullUrl = new URL(rawHref, origin).href;
      } catch (_) {
        continue;
      }

      // Check domain match
      const urlHost = new URL(fullUrl).hostname.toLowerCase();
      if (this.allowedDomains.length > 0 && !this.allowedDomains.some(d => urlHost === d || urlHost.endsWith(`.${d}`))) {
        continue;
      }

      // Ignore common navigation, pagination, category, tag, and static asset links
      const pathLower = new URL(fullUrl).pathname.toLowerCase();
      if (
        pathLower === '/' ||
        pathLower.includes('/category/') ||
        pathLower.includes('/genre/') ||
        pathLower.includes('/tag/') ||
        pathLower.includes('/page/') ||
        pathLower.includes('/feed/') ||
        pathLower.includes('/sitemap') ||
        pathLower.includes('/wp-content/') ||
        pathLower.includes('/wp-json/') ||
        pathLower.includes('/about') ||
        pathLower.includes('/contact') ||
        pathLower.includes('/disclaimer') ||
        pathLower.includes('/how-to-download') ||
        pathLower.includes('/join-telegram') ||
        /\.(css|js|png|jpg|jpeg|gif|webp|svg|xml|json|zip|apk)$/i.test(pathLower)
      ) {
        continue;
      }

      if (seen.has(fullUrl)) continue;

      // Extract raw title and poster if present in innerHtml
      const imgMatch = innerHtml.match(/<img\s+[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']+)["']/i) ||
                       innerHtml.match(/<img\s+[^>]*alt=["']([^"']+)["'][^>]*src=["']([^"']+)["']/i);

      let posterUrl = null;
      let rawTitle = null;

      if (imgMatch) {
        // determine which group is src and which is alt
        if (imgMatch[1].startsWith('http') || imgMatch[1].startsWith('/')) {
          posterUrl = imgMatch[1];
          rawTitle = imgMatch[2];
        } else {
          rawTitle = imgMatch[1];
          posterUrl = imgMatch[2];
        }
      } else {
        const textOnly = innerHtml.replace(/<[^>]+>/g, '').trim();
        if (textOnly.length > 3) {
          rawTitle = textOnly;
        }
      }

      seen.add(fullUrl);
      candidates.push({
        url: fullUrl,
        rawTitle: rawTitle ? rawTitle.trim() : null,
        posterUrl: posterUrl ? new URL(posterUrl, origin).href : null,
        discoveredFrom: pageUrl
      });
    }

    return candidates;
  }

  /**
   * Fetches a single page with bounded retries and exponential backoff
   * @param {string} url
   * @returns {Promise<{ ok: boolean, status: number, html: string, isChallenge: boolean, error?: string }>}
   */
  async fetchPage(url) {
    let attempt = 0;
    let lastErr = null;

    while (attempt <= this.maxRetries) {
      if (attempt > 0) {
        await this.sleep(this.delayMs * Math.pow(2, attempt));
      }
      attempt++;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const res = await this.fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
        clearTimeout(timeoutId);

        const html = await res.text();
        const challenge = this.isChallenge(html);

        return {
          ok: res.ok && !challenge,
          status: res.status,
          html,
          isChallenge: challenge,
          error: challenge ? 'Cloudflare anti-bot challenge detected' : (!res.ok ? `HTTP ${res.status}` : undefined)
        };
      } catch (err) {
        lastErr = err;
      }
    }

    return {
      ok: false,
      status: 0,
      html: '',
      isChallenge: false,
      error: lastErr ? lastErr.message : 'Unknown network failure'
    };
  }

  /**
   * Crawls a sequence of paginated URLs for a listing
   * @param {string} pageUrlTemplate - e.g. "https://example.com/page/{page}/"
   * @param {number} [startPage=1]
   * @param {number} [maxPages=3]
   * @returns {Promise<{ success: boolean, pagesInspected: number, candidates: Array<any>, failedPages: Array<{ page: number, url: string, reason: string }> }>}
   */
  async crawlPagination(pageUrlTemplate, startPage = 1, maxPages = 3) {
    const allCandidates = [];
    const seenUrls = new Set();
    const failedPages = [];
    let inspectedCount = 0;

    for (let page = startPage; page < startPage + maxPages; page++) {
      const targetUrl = pageUrlTemplate.replace('{page}', String(page));
      await this.sleep(this.delayMs);

      const res = await this.fetchPage(targetUrl);
      inspectedCount++;

      if (!res.ok) {
        failedPages.push({
          page,
          url: targetUrl,
          reason: res.error || `HTTP ${res.status}`
        });
        // Stop pagination if blocked by challenge or 404
        if (res.isChallenge || res.status === 404) {
          break;
        }
        continue;
      }

      const extracted = this.extractCandidateLinks(res.html, targetUrl);
      if (extracted.length === 0) {
        // Empty page encountered, reached end of pagination
        break;
      }

      for (const cand of extracted) {
        if (!seenUrls.has(cand.url)) {
          seenUrls.add(cand.url);
          allCandidates.push(cand);
        }
      }
    }

    return {
      success: allCandidates.length > 0,
      pagesInspected: inspectedCount,
      candidates: allCandidates,
      failedPages: failedPages,
      totalDiscovered: allCandidates.length
    };
  }
}

module.exports = {
  PageCrawler
};
