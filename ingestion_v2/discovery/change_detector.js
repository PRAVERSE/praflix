/**
 * PRAFLIX Ingestion Pipeline V2 — Change Detection & Discovery Ledger
 * A PRAVERSE Company
 *
 * Core Principles:
 * - Tracks URL lifecycle: NEW_PAGE, UNCHANGED, CHANGED, DISAPPEARED.
 * - Deterministic SHA-256 content/metadata fingerprinting.
 * - Invariant: A page disappearing from a listing NEVER triggers catalog deletion.
 * - Preserves discovery audit trail across staging runs.
 */

const crypto = require('crypto');

class ChangeDetector {
  /**
   * @param {Object} [initialLedger] - Pre-loaded ledger state
   * @param {string} [parserVersion='2.0.0']
   */
  constructor(initialLedger = {}, parserVersion = '2.0.0') {
    this.records = new Map(Object.entries(initialLedger || {}));
    this.parserVersion = parserVersion;
  }

  /**
   * Normalizes a URL for stable comparison across trailing slashes, http/https, query params
   * @param {string} urlStr
   * @returns {string}
   */
  normalizeUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return '';
    try {
      const u = new URL(urlStr.trim());
      // Lowercase hostname and remove default ports
      let pathname = u.pathname;
      if (pathname.length > 1 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      return `${u.protocol}//${u.hostname.toLowerCase()}${pathname}`;
    } catch (_) {
      return urlStr.trim().toLowerCase().replace(/\/+$/, '');
    }
  }

  /**
   * Computes SHA-256 fingerprint from title, lastmod, and content indicators
   * @param {Object} item
   * @returns {string}
   */
  computeFingerprint(item) {
    const title = (item.title || item.rawTitle || '').trim().toLowerCase();
    const lastmod = (item.lastmod || item.pubDate || '').trim();
    const poster = (item.posterUrl || item.sourcePosterUrl || '').trim();
    const keyStr = `${title}__${lastmod}__${poster}`;
    return crypto.createHash('sha256').update(keyStr).digest('hex').slice(0, 16);
  }

  /**
   * Evaluates a discovered candidate against the history ledger
   * @param {Object} candidate
   * @param {string} provider
   * @param {string} discoveryMethod - 'sitemap' | 'rss' | 'pagination'
   * @returns {{ status: 'NEW_PAGE'|'CHANGED_PAGE'|'UNCHANGED_PAGE', record: Object }}
   */
  processDiscoveredCandidate(candidate, provider, discoveryMethod) {
    const rawUrl = candidate.url || candidate.link || '';
    const normUrl = this.normalizeUrl(rawUrl);
    const nowIso = new Date().toISOString();
    const fingerprint = this.computeFingerprint(candidate);
    const modTime = candidate.lastmod || candidate.pubDate || null;

    let status = 'NEW_PAGE';
    let record = this.records.get(normUrl);

    if (!record) {
      status = 'NEW_PAGE';
      record = {
        sourceProvider: provider,
        originalSourceUrl: rawUrl,
        normalizedUrl: normUrl,
        firstSeen: nowIso,
        lastSeen: nowIso,
        contentFingerprint: fingerprint,
        sourceModificationTimestamp: modTime,
        lastParseStatus: 'pending',
        parserVersion: this.parserVersion,
        discoveryMethod: discoveryMethod,
        sightingsCount: 1,
        consecutiveFailures: 0
      };
    } else {
      record.lastSeen = nowIso;
      record.sightingsCount = (record.sightingsCount || 1) + 1;
      record.discoveryMethod = discoveryMethod;

      if (record.contentFingerprint !== fingerprint) {
        status = 'CHANGED_PAGE';
        record.contentFingerprint = fingerprint;
        record.sourceModificationTimestamp = modTime || record.sourceModificationTimestamp;
      } else {
        status = 'UNCHANGED_PAGE';
      }
    }

    this.records.set(normUrl, record);
    return { status, record };
  }

  /**
   * Updates parse status for a URL
   * @param {string} urlStr
   * @param {'success'|'failed'|'partial'|'inconclusive'} parseStatus
   * @param {string} [errorMessage]
   */
  recordParseResult(urlStr, parseStatus, errorMessage = null) {
    const normUrl = this.normalizeUrl(urlStr);
    const rec = this.records.get(normUrl);
    if (!rec) return;

    rec.lastParseStatus = parseStatus;
    if (parseStatus === 'success') {
      rec.consecutiveFailures = 0;
      rec.lastError = null;
    } else {
      rec.consecutiveFailures = (rec.consecutiveFailures || 0) + 1;
      rec.lastError = errorMessage;
    }
    this.records.set(normUrl, rec);
  }

  /**
   * Identifies pages that were not seen in the current discovery sweep
   * CRITICAL: These pages are marked as missing from the listing, but NEVER removed from catalog.
   * @param {string} provider
   * @param {Set<string>} seenNormalizedUrlsInCurrentSweep
   * @returns {Array<Object>}
   */
  detectDisappearedFromListing(provider, seenNormalizedUrlsInCurrentSweep) {
    const disappeared = [];
    for (const [normUrl, rec] of this.records.entries()) {
      if (rec.sourceProvider === provider && !seenNormalizedUrlsInCurrentSweep.has(normUrl)) {
        disappeared.push({
          ...rec,
          detectionReason: 'Page absent from latest provider listing/sitemap sweep (preserved in catalog)'
        });
      }
    }
    return disappeared;
  }

  /**
   * Returns serializable JSON snapshot of the ledger
   * @returns {Record<string, Object>}
   */
  toJSON() {
    return Object.fromEntries(this.records);
  }
}

module.exports = {
  ChangeDetector
};
