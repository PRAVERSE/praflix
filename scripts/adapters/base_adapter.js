/**
 * PRAFLIX — Base Provider Adapter
 * A PRAVERSE Company
 *
 * Defines the unified contract and common utilities for all provider crawlers & parsers.
 */

const path = require('path');
const BASE_DIR = path.dirname(path.dirname(__dirname));
const titleDecoder = require('../title_decoder');
const resolver = require(path.join(BASE_DIR, 'destination_resolver.js'));

class BaseAdapter {
  constructor(providerConfig = {}) {
    this.config = providerConfig;
    this.id = providerConfig.id || 'HDHub4u';
    this.displayName = providerConfig.displayName || this.id;
  }

  /**
   * Clean raw title string (HTML entities, glyphs, whitespace)
   */
  cleanTitle(rawTitle) {
    return titleDecoder.cleanTitle(rawTitle);
  }

  /**
   * Extract title metadata (clean title, year, tags)
   */
  extractTitleMetadata(rawTitle) {
    return titleDecoder.extractTitleMetadata(rawTitle);
  }

  /**
   * Determine content type (Movie vs Web Series)
   */
  detectContentType(title, category = '', url = '') {
    const t = (title || '').toLowerCase();
    const c = (category || '').toLowerCase();
    const u = (url || '').toLowerCase();

    // Explicit movie indicators take high precedence unless explicit season/series package is present
    const hasExplicitMovie = t.includes('full movie') || t.includes('full-movie') || t.includes('dual audio movie') || u.includes('full-movie');
    const hasExplicitSeries = t.includes('season') || t.includes('all episodes') || t.includes('all-episodes') ||
                              /\bs0*\d+\b/i.test(t) || c.includes('web series') || c.includes('tv series') ||
                              u.includes('season-') || u.includes('all-episodes') || u.includes('web-series');

    if (hasExplicitMovie && !hasExplicitSeries) {
      return 'Movie';
    }

    // Check for movie franchise chapter numbering e.g. "Star Wars Episode I/II/IV/V/VI/IX"
    const isFranchiseEpisodeMovie = /\bepisode\s+[ivxlcdm]+\b/i.test(t) && !hasExplicitSeries;
    if (isFranchiseEpisodeMovie) {
      return 'Movie';
    }

    if (
      hasExplicitSeries ||
      t.includes('series') ||
      c.includes('series') ||
      u.includes('full-series') ||
      /\bepisode\s*\d+\b/i.test(t) ||
      /\bep-?\d+\b/i.test(t)
    ) {
      return 'Web Series';
    }
    return 'Movie';
  }

  /**
   * Normalize resolution labels to canonical standards
   */
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
   * Validate link against destination resolver and provider rules
   */
  validateLink(candidate, sourceUrl) {
    const rawUrl = typeof candidate === 'string'
      ? candidate
      : (candidate.downloadUrl || candidate.url || candidate.link || '');

    if (!rawUrl || typeof rawUrl !== 'string') {
      return { isValid: false, reason: 'empty_url' };
    }

    const trimmedUrl = rawUrl.trim();

    // Provider specific prefix rules (e.g., HDHub4u approved prefixes restriction)
    const approvedPrefixes = this.config.eligibilityRules && (this.config.eligibilityRules.approvedPrefixes || this.config.eligibilityRules.eligibleUrlPrefixes);
    if (Array.isArray(approvedPrefixes) && approvedPrefixes.length > 0) {
      const matchesAny = approvedPrefixes.some(prefix => trimmedUrl.startsWith(prefix));
      if (!matchesAny) {
        return { isValid: false, reason: 'rejected_prefix_violation' };
      }
    } else if (this.config.eligibilityRules && this.config.eligibilityRules.requireExactHubDrivePrefix) {
      const requiredPrefix = this.config.eligibilityRules.requiredHubDrivePrefix || 'https://hubdrive.pics/file/';
      if (!trimmedUrl.startsWith(requiredPrefix)) {
        return { isValid: false, reason: 'rejected_hubdrive_prefix_violation' };
      }
    } else if (this.config.eligibilityRules && this.config.eligibilityRules.requiredHubDrivePrefix) {
      if (trimmedUrl.includes('hubdrive.') && !trimmedUrl.startsWith(this.config.eligibilityRules.requiredHubDrivePrefix)) {
        return { isValid: false, reason: 'rejected_hubdrive_prefix_violation' };
      }
    }

    const classification = resolver.classifyLinkVerification(candidate || trimmedUrl, sourceUrl);
    if (classification.status !== 'verified') {
      return { isValid: false, reason: classification.reason || 'unverified_destination' };
    }

    return {
      isValid: true,
      downloadUrl: trimmedUrl,
      resolution: this.normalizeQuality(candidate.resolution || candidate.quality || candidate.rawQuality),
      rawQuality: candidate.rawQuality || candidate.quality || candidate.resolution || '720p',
      evidence: classification.evidence || 'verified_storage_destination'
    };
  }

  /**
   * Check if a candidate download URL is valid and eligible for this provider
   */
  isValidProviderUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return this.validateLink({ downloadUrl: url }).isValid;
  }

  /**
   * Extract season/episode identifiers
   */
  extractSeason(title, raw = '') {
    const combined = `${title || ''} ${raw || ''}`;
    const m = combined.match(/\bseason\s*0*(\d+)\b/i) || combined.match(/\bs0*(\d+)\b/i);
    return m ? `Season ${parseInt(m[1], 10)}` : null;
  }

  /**
   * Filter web-series links to complete-season packs only
   */
  filterCompleteSeasonOnly(links) {
    if (!Array.isArray(links)) return [];
    return links.filter(l => resolver.isCompleteSeason(l));
  }

  /**
   * Abstract methods to be implemented by provider adapters
   */
  async discover(options = {}) {
    throw new Error(`Adapter for ${this.displayName} must implement discover(options)`);
  }

  parseTitlePage(html, url) {
    throw new Error(`Adapter for ${this.displayName} must implement parseTitlePage(html, url)`);
  }
}

module.exports = BaseAdapter;
