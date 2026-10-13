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
    if (!providerConfig) {
      const { getProviderConfig } = require('../provider_registry');
      providerConfig = getProviderConfig('HDHub4u');
    }
    super(providerConfig);
  }

  parseHomePageListings(html, pageUrl = '') {
    return this.parseListingPage(html, pageUrl);
  }

  filterEligibleDownloadLinks(urls = []) {
    return (urls || []).filter(u => u && typeof u === 'string' && u.startsWith('https://hubdrive.pics/file/'));
  }

  parseDetailPage(html, pageUrl = '') {
    const detail = this.parseTitlePage(html, pageUrl);
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const rawHeading = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';
    const meta = this.extractTitleMetadata(rawHeading);
    const yearMatch = rawHeading.match(/\b(19\d{2}|20\d{2})\b/);
    const year = meta.year || (yearMatch ? yearMatch[1] : '');
    const cleanTitle = meta.displayTitle || this.cleanTitle(rawHeading);
    const type = this.detectContentType(rawHeading, '', pageUrl);

    const imdbMatch = html.match(/tt\d{7,8}/i);
    const imdbId = imdbMatch ? imdbMatch[0].toLowerCase() : null;

    const posterMatch = html.match(/<img[^>]+src="([^">]+\.(?:jpg|jpeg|png|webp))"[^>]*>/i);
    const posterUrl = posterMatch ? posterMatch[1] : '';

    const links = [];
    const linkRegex = /<a[^>]+href="([^">]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      const href = m[1].trim();
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      if (href.startsWith('https://hubdrive.pics/file/')) {
        const val = this.validateLink({ downloadUrl: href, rawQuality: text }, pageUrl);
        const lower = text.toLowerCase();
        let quality = val.resolution || '1080p';
        if (lower.includes('4k') || lower.includes('2160p')) quality = '4K';
        else if (lower.includes('1080p')) quality = '1080p';
        else if (lower.includes('720p')) quality = '720p';
        else if (lower.includes('480p')) quality = '480p';

        links.push({
          url: href,
          label: text || quality,
          quality: quality,
          codec: lower.includes('hevc') || lower.includes('x265') ? 'HEVC' : 'x264',
          fileSize: (text.match(/\[([^\]]+)\]/) || [])[1] || 'Unknown'
        });
      }
    }

    return {
      title: cleanTitle,
      year: year,
      type: type,
      imdbId: imdbId,
      posterUrl: posterUrl,
      sourceUrl: pageUrl,
      downloadOptions: detail.downloadOptions,
      links: links
    };
  }

  /**
   * Parse listing page HTML to extract candidate articles
   */
  parseListingPage(html, pageUrl = '') {
    const items = [];
    if (!html) return items;

    const baseUrl = pageUrl || this.config?.baseUrl || 'https://new7.hdhub4u.cl/';

    // Anti-bot challenge detector
    if (html.includes('challenge-platform') || html.includes('Just a moment...') || html.includes('cf-browser-verification')) {
      throw new Error(`HDHub4u crawler encountered anti-bot verification challenge (INCONCLUSIVE)`);
    }

    const seenUrls = new Set();

    const addItem = (sourceUrlRaw, posterRaw, rawTitle) => {
      if (!sourceUrlRaw || !rawTitle) return;
      let sourceUrl = sourceUrlRaw.trim();
      if (sourceUrl.includes('disclaimer') || sourceUrl.includes('apk') || sourceUrl.includes('how-to') ||
          sourceUrl.includes('join') || sourceUrl.includes('contact') || sourceUrl.includes('/category/') ||
          sourceUrl.includes('/tag/') || sourceUrl === '/' || sourceUrl.startsWith('#')) {
        return;
      }

      if (!sourceUrl.startsWith('http')) {
        try {
          sourceUrl = new URL(sourceUrl, baseUrl).href;
        } catch (_) {
          sourceUrl = `${baseUrl.replace(/\/+$/, '')}/${sourceUrl.replace(/^\/+/, '')}`;
        }
      }

      let sourcePosterUrl = (posterRaw || '').trim();
      if (sourcePosterUrl.startsWith('http://')) {
        sourcePosterUrl = sourcePosterUrl.replace(/^http:\/\//i, 'https://');
      }

      const cleanT = rawTitle.replace(/&#038;/g, '&').replace(/&#8217;/g, "'").replace(/&#8211;/g, '-').replace(/&amp;/g, '&').trim();
      if (!cleanT || (sourcePosterUrl && sourcePosterUrl.includes('logo'))) return;

      if (!seenUrls.has(sourceUrl)) {
        seenUrls.add(sourceUrl);

        const meta = this.extractTitleMetadata(cleanT);
        const yearMatch = cleanT.match(/\b(19\d{2}|20\d{2})\b/);
        const year = meta.year || (yearMatch ? yearMatch[1] : '');
        const type = this.detectContentType(cleanT, '', sourceUrl);
        const cleanTitle = meta.displayTitle || this.cleanTitle(cleanT);

        items.push({
          provider: this.displayName,
          providerId: this.id,
          source: 'hdhub4u',
          originalSourceTitle: this.cleanTitle(cleanT),
          displayTitle: cleanTitle,
          title: cleanTitle,
          year: year,
          type: type,
          season: type === 'Web Series' ? this.extractSeason(cleanT) : null,
          sourceUrl: sourceUrl,
          url: sourceUrl,
          sourcePosterUrl: sourcePosterUrl,
          screenshots: [],
          qualities: [
            { resolution: '720p', label: '720p' },
            { resolution: '1080p', label: '1080p' }
          ]
        });
      }
    };

    // Strategy 1: Modern thumb / figure card layout (recent-movies li.thumb or li.thumb)
    const liRegex = /<li[^>]*class="[^"]*thumb[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch;
    while ((liMatch = liRegex.exec(html)) !== null) {
      const block = liMatch[1];
      const linkMatch = block.match(/<figure>[\s\S]*?<a\s+[^>]*href="([^"]+)"[^>]*>/i) || block.match(/<a\s+[^>]*href="([^"]+)"[^>]*>/i);
      const imgMatch = block.match(/<img\s+[^>]*src="([^"]+)"[^>]*>/i);
      const titleMatch = block.match(/<figcaption>[\s\S]*?<p>([\s\S]*?)<\/p>/i) ||
                         block.match(/alt="([^"]+)"/i) ||
                         block.match(/title="([^"]+)"/i);
      if (linkMatch && titleMatch) {
        const rawTitle = titleMatch[1].replace(/<[^>]+>/g, '').trim();
        addItem(linkMatch[1], imgMatch ? imgMatch[1] : '', rawTitle);
      }
    }

    // Strategy 2: Legacy article tag layout: <article ...> ... </article>
    if (items.length === 0) {
      const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
      let artMatch;
      while ((artMatch = articleRegex.exec(html)) !== null) {
        const block = artMatch[1];
        const linkMatch = block.match(/<a\s+[^>]*href="([^"]+)"[^>]*>/i);
        const imgMatch = block.match(/<img\s+[^>]*src="([^"]+)"[^>]*>/i);
        const titleMatch = block.match(/alt="([^"]+)"/i) || block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
        if (linkMatch && titleMatch) {
          addItem(linkMatch[1], imgMatch ? imgMatch[1] : '', titleMatch[1]);
        }
      }
    }

    // Safety completeness check: Reachable page with 0 parsed items cannot be reported as successful
    if (items.length === 0 && html && html.trim().length > 0) {
      throw new Error(`Reachable site ${this.displayName} returned 0 parsed titles: parser layout mismatch or incomplete scan (INCONCLUSIVE / PARSING_FAILED)`);
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

      // For HDHub4u, import only download URLs whose exact prefix is https://hubdrive.pics/file/
      if (!href.startsWith('https://hubdrive.pics/file/')) {
        continue;
      }

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

    const candidateUrls = this.config.candidateBaseUrls || [
      this.config.baseUrl,
      'https://new7.hdhub4u.cl/',
      'https://new2.hdhub4u.free/'
    ];

    const timeoutMs = options.timeoutMs || this.config.rateLimit.timeoutMs || 8000;
    let lastError = null;

    for (const testUrl of candidateUrls) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(testUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (PRAFLIX-Bot/1.0)'
          }
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          lastError = new Error(`HTTP ${res.status} from ${testUrl}`);
          continue;
        }

        const html = await res.text();
        const items = this.parseListingPage(html, testUrl);

        return {
          pagesDiscovered: 1,
          pagesProcessed: 1,
          items: items,
          activeUrl: testUrl,
          completeness: 'COMPLETE'
        };
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;
        // If anti-bot challenge or layout mismatch, propagate immediately
        if (err.message.includes('INCONCLUSIVE')) {
          throw err;
        }
      }
    }

    throw new Error(`Failed to discover from ${this.displayName}: ${lastError ? lastError.message : 'All candidate endpoints unreachable'}`);
  }
}

module.exports = HDHub4uAdapter;
