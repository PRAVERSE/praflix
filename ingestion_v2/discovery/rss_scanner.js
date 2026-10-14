/**
 * PRAFLIX Ingestion Pipeline V2 — RSS 2.0 & Atom Feed Scanner
 * A PRAVERSE Company
 *
 * Capabilities:
 * - Parses standard RSS 2.0 (<channel><item>) and Atom 1.0 (<feed><entry>).
 * - Extracts clean title, canonical link, publication timestamp, categories, and descriptions.
 * - Decodes CDATA wrappers, numeric and named HTML entities.
 * - Gracefully handles HTTP errors (500, 403, Cloudflare challenges) and malformed XML.
 */

function cleanXmlText(raw) {
  if (!raw) return '';
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8211;/g, '-')
    .replace(/&#8212;/g, '—')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

class RssScanner {
  /**
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=10000]
   * @param {string[]} [options.allowedDomains]
   * @param {Function} [options.fetchFn]
   */
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 10000;
    this.allowedDomains = (options.allowedDomains || []).map(d => d.toLowerCase());
    this.fetch = options.fetchFn || global.fetch;
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (PRAFLIX-Bot/2.0)';
  }

  /**
   * Parses XML feed string into structured items
   * @param {string} xmlText
   * @param {string} sourceUrl
   * @returns {{ success: boolean, feedType: 'rss2'|'atom'|'unknown', channelTitle: string, items: Array<any>, error?: string }}
   */
  parseFeed(xmlText, sourceUrl = '') {
    if (!xmlText || typeof xmlText !== 'string' || xmlText.trim().length === 0) {
      return { success: false, feedType: 'unknown', channelTitle: '', items: [], error: 'Empty feed content' };
    }

    const trimmed = xmlText.trim();
    if (trimmed.includes('challenge-platform') || trimmed.includes('Just a moment...') || trimmed.includes('cf-browser-verification')) {
      return { success: false, feedType: 'unknown', channelTitle: '', items: [], error: 'Encountered Cloudflare anti-bot verification challenge (INCONCLUSIVE)' };
    }

    const isRss = /<rss\b/i.test(trimmed) || /<channel\b/i.test(trimmed);
    const isAtom = /<feed\b/i.test(trimmed) && /xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/i.test(trimmed);

    if (!isRss && !isAtom) {
      return { success: false, feedType: 'unknown', channelTitle: '', items: [], error: 'Document is neither valid RSS 2.0 nor Atom feed' };
    }

    const items = [];

    if (isRss) {
      // Extract channel title
      const channelTitleMatch = trimmed.match(/<channel[\s\S]*?<title>([\s\S]*?)<\/title>/i);
      const channelTitle = channelTitleMatch ? cleanXmlText(channelTitleMatch[1]) : '';

      // Match each <item>
      const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
      let itemMatch;
      while ((itemMatch = itemRegex.exec(trimmed)) !== null) {
        const itemBlock = itemMatch[1];

        const titleM = itemBlock.match(/<title>([\s\S]*?)<\/title>/i);
        const linkM = itemBlock.match(/<link>([\s\S]*?)<\/link>/i) || itemBlock.match(/<guid[^>]*isPermaLink="true"[^>]*>([\s\S]*?)<\/guid>/i);
        const guidM = itemBlock.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
        const pubDateM = itemBlock.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || itemBlock.match(/<dc:date>([\s\S]*?)<\/dc:date>/i);
        const descM = itemBlock.match(/<description>([\s\S]*?)<\/description>/i);

        // Categories
        const categories = [];
        const catRegex = /<category[^>]*>([\s\S]*?)<\/category>/gi;
        let catMatch;
        while ((catMatch = catRegex.exec(itemBlock)) !== null) {
          const c = cleanXmlText(catMatch[1]);
          if (c) categories.push(c);
        }

        const rawTitle = titleM ? cleanXmlText(titleM[1]) : '';
        const rawLink = linkM ? cleanXmlText(linkM[1]) : '';
        const rawGuid = guidM ? cleanXmlText(guidM[1]) : '';
        const rawPubDate = pubDateM ? cleanXmlText(pubDateM[1]) : null;
        const rawDesc = descM ? cleanXmlText(descM[1]) : '';

        if (rawTitle && rawLink) {
          items.push({
            title: rawTitle,
            link: rawLink,
            guid: rawGuid || rawLink,
            pubDate: rawPubDate,
            description: rawDesc,
            categories: categories,
            feedType: 'rss2',
            sourceFeedUrl: sourceUrl
          });
        }
      }

      return {
        success: items.length > 0,
        feedType: 'rss2',
        channelTitle,
        items,
        totalCount: items.length
      };
    } else {
      // Atom 1.0 parsing
      const feedTitleMatch = trimmed.match(/<feed[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
      const channelTitle = feedTitleMatch ? cleanXmlText(feedTitleMatch[1]) : '';

      const entryRegex = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
      let entryMatch;
      while ((entryMatch = entryRegex.exec(trimmed)) !== null) {
        const entryBlock = entryMatch[1];

        const titleM = entryBlock.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const linkM = entryBlock.match(/<link[^>]+href="([^"]+)"/i);
        const idM = entryBlock.match(/<id>([\s\S]*?)<\/id>/i);
        const updatedM = entryBlock.match(/<updated>([\s\S]*?)<\/updated>/i) || entryBlock.match(/<published>([\s\S]*?)<\/published>/i);
        const summaryM = entryBlock.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || entryBlock.match(/<content[^>]*>([\s\S]*?)<\/content>/i);

        const rawTitle = titleM ? cleanXmlText(titleM[1]) : '';
        const rawLink = linkM ? cleanXmlText(linkM[1]) : '';

        if (rawTitle && rawLink) {
          items.push({
            title: rawTitle,
            link: rawLink,
            guid: idM ? cleanXmlText(idM[1]) : rawLink,
            pubDate: updatedM ? cleanXmlText(updatedM[1]) : null,
            description: summaryM ? cleanXmlText(summaryM[1]) : '',
            categories: [],
            feedType: 'atom',
            sourceFeedUrl: sourceUrl
          });
        }
      }

      return {
        success: items.length > 0,
        feedType: 'atom',
        channelTitle,
        items,
        totalCount: items.length
      };
    }
  }

  /**
   * Fetches and parses a live feed URL
   * @param {string} feedUrl
   * @returns {Promise<{ success: boolean, items: Array<any>, error?: string }>}
   */
  async scan(feedUrl) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      const res = await this.fetch(feedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
        }
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        return {
          success: false,
          feedType: 'unknown',
          channelTitle: '',
          items: [],
          error: `HTTP ${res.status} from feed ${feedUrl}`
        };
      }

      const text = await res.text();
      return this.parseFeed(text, feedUrl);
    } catch (err) {
      return {
        success: false,
        feedType: 'unknown',
        channelTitle: '',
        items: [],
        error: `Network failure fetching feed ${feedUrl}: ${err.message}`
      };
    }
  }
}

module.exports = {
  RssScanner,
  cleanXmlText
};
