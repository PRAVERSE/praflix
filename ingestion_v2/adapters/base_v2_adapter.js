/**
 * PRAFLIX Ingestion Pipeline V2 — Base Provider Adapter
 * A PRAVERSE Company
 *
 * Defines the unified contract and common utilities for V2 provider adapters.
 * Reuses existing proven modules safely:
 * - scripts/title_decoder.js
 * - destination_resolver.js
 */

const path = require('path');
const BASE_DIR = path.resolve(__dirname, '../../');
const titleDecoder = require(path.join(BASE_DIR, 'scripts/title_decoder'));
const resolver = require(path.join(BASE_DIR, 'destination_resolver'));

class BaseV2Adapter {
  constructor(providerConfig = {}) {
    this.config = providerConfig;
    this.id = providerConfig.id || 'provider';
    this.displayName = providerConfig.displayName || this.id;
  }

  cleanTitle(rawTitle) {
    return titleDecoder.cleanTitle(rawTitle);
  }

  extractTitleMetadata(rawTitle) {
    return titleDecoder.extractTitleMetadata(rawTitle);
  }

  detectContentType(title, category = '', url = '') {
    const t = (title || '').toLowerCase();
    const c = (category || '').toLowerCase();
    const u = (url || '').toLowerCase();

    if (
      t.includes('season') ||
      t.includes('series') ||
      t.includes('episode') ||
      t.includes('s01') ||
      t.includes('s02') ||
      t.includes('s03') ||
      c.includes('web series') ||
      c.includes('tv series') ||
      c.includes('series') ||
      u.includes('season-') ||
      u.includes('all-episodes') ||
      u.includes('full-series') ||
      u.includes('web-series')
    ) {
      return 'Web Series';
    }
    return 'Movie';
  }

  normalizeQuality(raw) {
    if (!raw) return '720p';
    const s = String(raw).toLowerCase().trim();
    if (s.includes('2160') || s.includes('4k') || s.includes('uhd')) return '4K';
    if (s.includes('1080') || s.includes('fhd') || s.includes('full hd')) return '1080p';
    if (s.includes('720') || s.includes('hd')) return '720p';
    if (s.includes('480') || s.includes('sd')) return '480p';
    return '720p';
  }

  /**
   * Validates a candidate link against destination_resolver and provider eligibility rules
   * @param {Object|string} candidate
   * @param {string} sourceUrl
   * @returns {{ isValid: boolean, status: string, resolution?: string, reason?: string, evidence?: string }}
   */
  validateLink(candidate, sourceUrl) {
    const rawUrl = typeof candidate === 'string'
      ? candidate
      : (candidate.downloadUrl || candidate.url || candidate.link || '');

    if (!rawUrl || typeof rawUrl !== 'string') {
      return { isValid: false, status: 'rejected', reason: 'empty_url' };
    }

    const trimmedUrl = rawUrl.trim();

    // Provider specific prefix rules (e.g. HDHub4u HubDrive restriction)
    if (this.config.eligibilityRules && this.config.eligibilityRules.requireExactHubDrivePrefix) {
      const requiredPrefix = this.config.eligibilityRules.requiredHubDrivePrefix || 'https://hubdrive.pics/file/';
      if (!trimmedUrl.startsWith(requiredPrefix)) {
        return { isValid: false, status: 'rejected', reason: 'rejected_hubdrive_prefix_violation' };
      }
    }

    // Series complete-season policy: filter out loose individual episodes
    const isSeries = typeof candidate === 'object' && (candidate.isSeries || candidate.type === 'Web Series');
    if (isSeries && typeof candidate === 'object') {
      const epDesc = candidate.episode || candidate.rawLabel || candidate.label || '';
      if (epDesc && !resolver.isCompleteSeason(candidate)) {
        return { isValid: false, status: 'rejected', reason: 'rejected_incomplete_season_episode' };
      }
    }

    const classification = resolver.classifyLinkVerification(candidate, sourceUrl);
    if (classification.status !== 'verified') {
      return { isValid: false, status: classification.status, reason: classification.reason || 'unverified_destination' };
    }

    const res = this.normalizeQuality(candidate.resolution || candidate.quality || candidate.rawQuality || '720p');
    return {
      isValid: true,
      status: 'verified',
      resolution: res,
      evidence: classification.evidence || 'destination_resolved'
    };
  }

  /**
   * Must be implemented by subclasses
   */
  async discover(options = {}) {
    throw new Error(`[Adapter Error] discover() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Must be implemented by subclasses
   */
  parseDetailPage(html, pageUrl = '') {
    throw new Error(`[Adapter Error] parseDetailPage() must be implemented by ${this.constructor.name}`);
  }
}

module.exports = {
  BaseV2Adapter
};
