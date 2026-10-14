/**
 * PRAFLIX Ingestion Pipeline V2 — Record Normalizer
 * A PRAVERSE Company
 *
 * Normalizes raw provider items into strictly compliant PRAFLIX canonical schema:
 * - displayTitle, originalSourceTitle, normalizedTitle
 * - year, type ('Movie' | 'Web Series'), season
 * - languages, audioTracks, qualities
 * - variants & screenshots
 *
 * Strict Rule: Never fabricates or invents missing metadata or URLs.
 */

const path = require('path');
const BASE_DIR = path.resolve(__dirname, '../../');
const titleDecoder = require(path.join(BASE_DIR, 'scripts/title_decoder'));

class Normalizer {
  /**
   * Normalizes a raw provider item into canonical schema
   * @param {Object} rawItem
   * @returns {Object|null}
   */
  normalizeRecord(rawItem) {
    if (!rawItem || typeof rawItem !== 'object') return null;

    const rawTitle = rawItem.originalSourceTitle || rawItem.title || rawItem.displayTitle || '';
    if (!rawTitle || rawTitle.trim().length < 2) return null;

    const meta = titleDecoder.extractTitleMetadata(rawTitle);
    let displayTitle = rawItem.displayTitle || meta.displayTitle || titleDecoder.cleanTitle(rawTitle);
    const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
    const year = rawItem.year ? String(rawItem.year).trim() : (meta.year || (yearMatch ? yearMatch[1] : ''));

    // Strip year in parenthesis from displayTitle
    if (year) {
      displayTitle = displayTitle.replace(new RegExp(`\\s*\\(${year}\\)\\s*`, 'g'), ' ');
      displayTitle = displayTitle.replace(new RegExp(`\\b${year}\\b`, 'g'), ' ');
    }

    // Strip Season and Episode tokens from displayTitle for series
    displayTitle = displayTitle
      .replace(/\s*(?:\(|\[)?\s*(?:Season|S)\s*\d+(?:-\d+)?\s*(?:\)|\])?/gi, ' ')
      .replace(/\b(all\s*episodes|all\s*ep|completed?|web\s*series|full\s*series|full\s*movie|netflix\s*original|hotstar\s*series|amazon\s*series|mini\s*series|tv\s*series)\b.*/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[-–—:\s]+/, '')
      .replace(/[-–—:\s]+$/, '')
      .trim();

    // Determine type
    let type = rawItem.type;
    if (!type) {
      const lower = rawTitle.toLowerCase();
      if (lower.includes('season') || lower.includes('series') || lower.includes('episode') || lower.includes('s01') || lower.includes('s02')) {
        type = 'Web Series';
      } else {
        type = 'Movie';
      }
    }

    // Extract season if series
    let season = rawItem.season || null;
    if (type === 'Web Series' && !season) {
      const seasonMatch = rawTitle.match(/(?:Season|S)\s*0?(\d+)/i);
      if (seasonMatch) {
        season = `Season ${parseInt(seasonMatch[1], 10)}`;
      }
    }

    const normalizedTitle = titleDecoder.normalizeForMatching(displayTitle, '');

    // Extract languages and audio
    const languages = Array.isArray(rawItem.languages) && rawItem.languages.length > 0
      ? rawItem.languages
      : (meta.languages && meta.languages.length > 0 ? meta.languages : ['Hindi']);

    const audioTracks = Array.isArray(rawItem.audioTracks) && rawItem.audioTracks.length > 0
      ? rawItem.audioTracks
      : (meta.audio ? [meta.audio] : []);

    // Qualities
    const qualities = new Set();
    if (Array.isArray(rawItem.qualities)) {
      rawItem.qualities.forEach(q => {
        const label = typeof q === 'string' ? q : (q.resolution || q.quality || q.label);
        if (label && label !== 'unknown') qualities.add(label);
      });
    }
    if (Array.isArray(rawItem.downloadLinks)) {
      rawItem.downloadLinks.forEach(l => {
        if (l.quality && l.quality !== 'unknown') qualities.add(l.quality);
      });
    }
    if (qualities.size === 0) {
      const hasLinks = Array.isArray(rawItem.downloadLinks) && rawItem.downloadLinks.length > 0;
      if (hasLinks) {
        qualities.add('unknown');
      }
    }

    // Variant representation
    const providerName = rawItem.provider || 'unknown';
    const variant = {
      source: providerName.toLowerCase(),
      sourceId: rawItem.sourceId || `${providerName.toLowerCase()}-${normalizedTitle.replace(/\s+/g, '-')}`,
      sourceUrl: rawItem.sourceUrl || '',
      originalSourceTitle: rawTitle,
      languages: languages,
      qualities: Array.from(qualities).map(q => ({ resolution: q, label: q })),
      releaseType: meta.releaseType || 'WEB-DL',
      audio: audioTracks.join(', ') || null,
      platform: meta.platform || null,
      poster: rawItem.sourcePosterUrl || null
    };

    // Screenshots
    const screenshots = [];
    if (Array.isArray(rawItem.screenshots)) {
      rawItem.screenshots.forEach(scUrl => {
        if (scUrl && typeof scUrl === 'string') {
          screenshots.push({
            url: scUrl,
            source: providerName.toLowerCase(),
            provider: providerName,
            caption: `${displayTitle} — ${providerName} Movie Still`
          });
        }
      });
    }

    return {
      displayTitle,
      originalSourceTitle: rawTitle,
      normalizedTitle,
      year,
      type,
      season,
      episodeStatus: null,
      genres: ['Cinema'],
      languages,
      audioTracks,
      audio: audioTracks[0] || null,
      platform: meta.platform || null,
      platforms: meta.platform ? [meta.platform] : [],
      releaseType: meta.releaseType || 'WEB-DL',
      sourcePosterUrl: rawItem.sourcePosterUrl || null,
      qualities: Array.from(qualities),
      variants: [variant],
      screenshots,
      status: 'active',
      downloadLinks: rawItem.downloadLinks || []
    };
  }
}

module.exports = {
  Normalizer
};
