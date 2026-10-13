/**
 * PRAFLIX — HDWall Provider Adapter
 * A PRAVERSE Company
 *
 * Implements discovery, poster/screenshot extraction, and link verification for HDWall.
 */

const BaseAdapter = require('./base_adapter');

class HDWallAdapter extends BaseAdapter {
  constructor(providerConfig) {
    super(providerConfig);
  }

  /**
   * Parse listing page HTML to extract candidate articles and screenshots
   * Supports both legacy DataLife Engine (.custom-poster) and modern (.thumb / figure) layouts,
   * handling multi-line attributes and varying tag orders.
   */
  parseListingPage(html, pageUrl = '') {
    if (!html) return [];
    if (html.includes('challenge-platform') || html.includes('cf-chl') || html.includes('Just a moment...') || html.includes('cf-browser-verification')) {
      throw new Error(`HTTP 200 with anti-bot verification challenge from ${this.displayName} (INCONCLUSIVE)`);
    }

    const items = [];

    // Resolve base origin for relative URLs
    let baseOrigin = 'https://hdhub.club';
    if (pageUrl) {
      try {
        const parsedUrl = new URL(pageUrl);
        baseOrigin = `${parsedUrl.protocol}//${parsedUrl.host}`;
      } catch (_) {}
    }

    // Strategy 1: Modern card layout (<li class="thumb..."> or <figure>)
    const cardRegex = /<li[^>]*class="[^"]*thumb[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let cardMatch;
    while ((cardMatch = cardRegex.exec(html)) !== null) {
      const cardContent = cardMatch[1];
      const aMatch = cardContent.match(/<a[^>]+href="([^"]+\.html)"/i);
      const imgMatch = cardContent.match(/<img[\s\S]*?src="([^"]+)"[\s\S]*?alt="([^"]+)"/i) ||
                       cardContent.match(/<img[\s\S]*?alt="([^"]+)"[\s\S]*?src="([^"]+)"/i);

      if (aMatch && imgMatch) {
        let sourceUrl = aMatch[1].trim();
        if (sourceUrl.startsWith('/')) {
          sourceUrl = `${baseOrigin}${sourceUrl}`;
        }

        let sourcePosterUrl = (imgMatch[1].startsWith('/') ? `${baseOrigin}${imgMatch[1]}` : imgMatch[1]).trim();
        let rawTitle = imgMatch[2].replace(/&amp;/g, '&').replace(/&#038;/g, '&').replace(/&#xE02C;/g, '').trim();

        let screenshotUrl = null;
        if (sourcePosterUrl.includes('/uploads/posts/covers/photo_')) {
          screenshotUrl = sourcePosterUrl.replace('/uploads/posts/covers/photo_', '/uploads/posts/screenshot/screenshot_');
        }

        const meta = this.extractTitleMetadata(rawTitle);
        const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
        const year = meta.year || (yearMatch ? yearMatch[1] : '');
        const type = this.detectContentType(rawTitle, '', sourceUrl);
        const cleanTitle = meta.displayTitle || this.cleanTitle(rawTitle);

        items.push({
          provider: this.displayName,
          providerId: this.id,
          source: 'hdwall',
          originalSourceTitle: this.cleanTitle(rawTitle),
          displayTitle: cleanTitle,
          year: year,
          type: type,
          season: type === 'Web Series' ? this.extractSeason(rawTitle) : null,
          sourceUrl: sourceUrl,
          sourcePosterUrl: sourcePosterUrl,
          screenshots: screenshotUrl ? [screenshotUrl] : [],
          qualities: [
            { resolution: '720p', label: 'HD' }
          ]
        });
      }
    }

    // Strategy 2: Legacy layout (<div class="custom-poster">)
    if (items.length === 0) {
      const legacyRegex = /<div class="custom-poster"[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<img [^>]*src="([^"]+)"[^>]*alt="([^"]+)"/g;
      let match;
      while ((match = legacyRegex.exec(html)) !== null) {
        let sourceUrl = match[1].trim();
        if (sourceUrl.startsWith('/')) {
          sourceUrl = `${baseOrigin}${sourceUrl}`;
        }

        let sourcePosterUrl = (match[2].startsWith('/') ? `${baseOrigin}${match[2]}` : match[2]).trim();
        let rawTitle = match[3].replace(/&amp;/g, '&').replace(/&#038;/g, '&').replace(/&#xE02C;/g, '').trim();

        let screenshotUrl = null;
        if (sourcePosterUrl.includes('/uploads/posts/covers/photo_')) {
          screenshotUrl = sourcePosterUrl.replace('/uploads/posts/covers/photo_', '/uploads/posts/screenshot/screenshot_');
        }

        const meta = this.extractTitleMetadata(rawTitle);
        const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
        const year = meta.year || (yearMatch ? yearMatch[1] : '');
        const type = this.detectContentType(rawTitle, '', sourceUrl);
        const cleanTitle = meta.displayTitle || this.cleanTitle(rawTitle);

        items.push({
          provider: this.displayName,
          providerId: this.id,
          source: 'hdwall',
          originalSourceTitle: this.cleanTitle(rawTitle),
          displayTitle: cleanTitle,
          year: year,
          type: type,
          season: type === 'Web Series' ? this.extractSeason(rawTitle) : null,
          sourceUrl: sourceUrl,
          sourcePosterUrl: sourcePosterUrl,
          screenshots: screenshotUrl ? [screenshotUrl] : [],
          qualities: [
            { resolution: '720p', label: 'HD' }
          ]
        });
      }
    }

    return items;
  }

  /**
   * Parse detail page HTML to extract verified download options
   */
  parseDetailPage(html, pageUrl = '') {
    const downloadOptions = [];
    if (!html) return downloadOptions;

    // Direct download link buttons (<div class="dlink dl"><a href="...">...</div>)
    const dlinkRegex = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<div class="dll"[^>]*>([\s\S]*?)<\/div>/gi;
    let m;
    while ((m = dlinkRegex.exec(html)) !== null) {
      const linkUrl = m[1].trim();
      const btnText = m[2].replace(/\s+/g, ' ').trim();
      const resMatch = btnText.match(/(480p|720p|1080p|4k|2160p)/i);
      const res = resMatch ? resMatch[1].toLowerCase() : '720p';
      downloadOptions.push({
        link: linkUrl,
        downloadUrl: linkUrl,
        quality: res,
        rawText: btnText,
        isComplete: true
      });
    }

    // Direct CDN / drive links fallback
    if (downloadOptions.length === 0) {
      const linkRegex = /<a[^>]+href="(https:\/\/(?:hubcdn\.[a-z]+|hubcloud\.[a-z]+|filesdl\.[a-z]+|drive\.google\.com)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let lm;
      while ((lm = linkRegex.exec(html)) !== null) {
        const linkUrl = lm[1].trim();
        const text = lm[2].replace(/<[^>]+>/g, '').trim();
        const resMatch = text.match(/(480p|720p|1080p|4k|2160p)/i) || linkUrl.match(/(480p|720p|1080p|4k|2160p)/i);
        downloadOptions.push({
          link: linkUrl,
          downloadUrl: linkUrl,
          quality: resMatch ? resMatch[1].toLowerCase() : '720p',
          rawText: text,
          isComplete: true
        });
      }
    }

    return downloadOptions;
  }

  /**
   * Discover latest items from HDWall with completeness & zero-title verification
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
      const url = `${this.config.baseUrl}page/1/`;
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
      const items = this.parseListingPage(html, res.url || url);

      // Guard: Reachable website returning 0 parsed items must NOT be claimed as successful complete scan
      if (items.length === 0 && html.length > 500) {
        const isChallenge = html.includes('challenge-platform') || html.includes('cf-chl') || html.includes('Just a moment...');
        const errReason = isChallenge
          ? `HTTP 200 with anti-bot verification challenge from ${this.displayName} (INCONCLUSIVE)`
          : `Reachable site ${this.displayName} returned 0 parsed titles: parser layout mismatch or incomplete scan (INCONCLUSIVE / PARSING_FAILED)`;
        throw new Error(errReason);
      }

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

module.exports = HDWallAdapter;
