/**
 * PRAFLIX — Title Entity Decoder and Normalizer
 * A PRAVERSE Company
 *
 * Implements robust decoding and normalization for:
 * - HTML named entities (&amp;, &quot;, &apos;, &lt;, &gt;, &nbsp;)
 * - HTML decimal entities (&#8217;, &#8211;, &#8230;, &#038;, &#215;, etc.)
 * - HTML hex entities (&#xE02C;, &#x27;, etc.)
 * - WordPress theme glyph artifacts and private-use Unicode (\uE000-\uF8FF)
 * - Residual text corruptions (xE02C, 8217, 8211, 8230, 038)
 */

// Common decimal and hex entity mapping for fast, safe resolution
const KNOWN_ENTITIES = {
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&ndash;': '–',
  '&mdash;': '—',
  '&hellip;': '…',
  '&lsquo;': "'",
  '&rsquo;': "'",
  '&ldquo;': '"',
  '&rdquo;': '"',
  '&times;': '×'
};

/**
 * Safely decode all HTML entities (named, decimal, hex)
 * @param {string} str
 * @returns {string}
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  let s = String(str);

  // 1. Named entities
  for (const [entity, char] of Object.entries(KNOWN_ENTITIES)) {
    s = s.split(entity).join(char);
  }

  // 2. Hexadecimal entities: &#x[0-9a-fA-F]+;
  s = s.replace(/&#x([0-9a-fA-F]+);/gi, (match, hex) => {
    try {
      const code = parseInt(hex, 16);
      // If code is in Private Use Area (\uE000-\uF8FF), drop it (theme icon font glyph)
      if (code >= 0xe000 && code <= 0xf8ff) {
        return '';
      }
      return String.fromCodePoint(code);
    } catch {
      return '';
    }
  });

  // 3. Decimal entities: &#([0-9]+);
  s = s.replace(/&#([0-9]+);/g, (match, dec) => {
    try {
      const code = parseInt(dec, 10);
      // Private use area
      if (code >= 0xe000 && code <= 0xf8ff) {
        return '';
      }
      // Common special mappings
      if (code === 8217 || code === 8216) return "'";
      if (code === 8220 || code === 8221) return '"';
      if (code === 8211 || code === 8212) return '-';
      if (code === 8230) return '...';
      if (code === 38) return '&';
      if (code === 215) return 'x';
      return String.fromCodePoint(code);
    } catch {
      return '';
    }
  });

  return s;
}

/**
 * Remove icon font glyphs, Private Use Unicode, and stray entity strings
 * @param {string} str
 * @returns {string}
 */
function stripGlyphsAndResidualEntities(str) {
  if (!str) return '';
  let s = String(str);

  // Remove Private Use Area Unicode characters (\uE000 - \uF8FF)
  s = s.replace(/[\uE000-\uF8FF]/g, '');

  // Strip leading or residual xE02C / xe02c (from unescaped &#xE02C;)
  s = s.replace(/\b[xX][eE]02[cC]\b/g, '');
  s = s.replace(/^[xX][eE]02[cC]\s*/g, '');

  // Strip or convert stray numeric entities that lost their prefix
  // e.g. "Papa 8217 s Friend" -> "Papa's Friend"
  s = s.replace(/\s*8217\s*s\b/gi, "'s");
  s = s.replace(/\b8217\b/g, "'");
  s = s.replace(/\b8216\b/g, "'");
  s = s.replace(/\s*8211\s*/g, ' - ');
  s = s.replace(/\s*8212\s*/g, ' - ');
  s = s.replace(/\b8230\b/g, '...');
  // e.g. "Above 038 Below" -> "Above & Below"
  s = s.replace(/\s*038\s*/g, ' & ');

  return s;
}

/**
 * Clean and normalize a raw title for display or title list entry
 * @param {string} rawTitle
 * @returns {string}
 */
function cleanTitle(rawTitle) {
  if (!rawTitle) return '';
  let s = decodeHtmlEntities(rawTitle);
  s = stripGlyphsAndResidualEntities(s);

  // Remove common prefix markers
  s = s
    .replace(/^\[duplicate\]\s*/i, '')
    .replace(/^free\s+/i, '')
    .replace(/\[https?:\/\/[^\]]+\]/gi, ' ')
    .replace(/\|.*$/g, '')
    .replace(/\[(all\s*episodes|nf\s*series|full\s*movie|full\s*show|exclusively\s*on\s*[^\]]+)\]/gi, '')
    .replace(/\b(1080p|720p|480p|4k|2160p|ds-?4k|ds4k|web-?dl|webrip|bluray|hdr|hevc|x264|x265|dd5\.1|dd2\.0|clean|clean-audio|line|esubs?|hc-esubs?|dual\s*audio|hdtc|hq-hdtc|hdts|predvd|dvdrip|v\d+)\b.*/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—:\s]+/, '')
    .replace(/[-–—:\s]+$/, '')
    .trim();

  // If over-cleaned, restore decoded string with simple whitespace normalization
  if (!s || s.length < 2) {
    s = decodeHtmlEntities(rawTitle)
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/\b[xX][eE]02[cC]\b/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return s;
}

/**
 * Extract canonical matching key from a title string
 * @param {string} title
 * @returns {string}
 */
function normalizeForMatching(title, optionalYear) {
  if (!title) return '';
  let s = cleanTitle(title);

  let year = optionalYear ? String(optionalYear).trim() : '';
  if (!year) {
    const ym = s.match(/\b(19\d{2}|20\d{2})\b/);
    if (ym) year = ym[1];
  }

  let main = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(download|watch|online|full|movie|series|season\s*\d+|part\s*\d+|hindi|dubbed|dual\s*audio|esub|hevc|web-?dl|bluray|hdrip|hd|480p|720p|1080p|2160p|4k)\b/gi, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ');

  if (year) {
    main = main.replace(new RegExp(`\\b${year}\\b`, 'g'), ' ');
  }

  main = main
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return year ? `${main} ${year}` : main;
}

/**
 * Extract distinct edition information from raw title string
 * @param {string} raw
 * @returns {string|null}
 */
function extractEdition(raw) {
  if (!raw) return null;
  const s = String(raw);
  const m = s.match(/\b(director'?s\s*cut|extended\s*(?:cut|edition)|unrated(?:\s*cut)?|uncut|special\s*edition|theatrical\s*(?:cut|edition)|remastered(?:\s*edition)?|ultimate\s*edition|criterion(?:\s*collection|\s*edition)?|imax\s*(?:enhanced|edition)?)\b/i);
  if (!m) return null;
  const matchStr = m[1].toLowerCase();
  if (matchStr.includes('director')) return "Director's Cut";
  if (matchStr.includes('extended')) return "Extended Edition";
  if (matchStr.includes('unrated') || matchStr.includes('uncut')) return "Unrated Cut";
  if (matchStr.includes('special')) return "Special Edition";
  if (matchStr.includes('theatrical')) return "Theatrical Cut";
  if (matchStr.includes('remastered')) return "Remastered Edition";
  if (matchStr.includes('ultimate')) return "Ultimate Edition";
  if (matchStr.includes('criterion')) return "Criterion Collection";
  if (matchStr.includes('imax')) return "IMAX Edition";
  return m[1];
}

/**
 * Extract audio languages from raw title string
 * @param {string} raw
 * @returns {Array<string>}
 */
function extractLanguages(raw) {
  if (!raw) return [];
  const s = String(raw).toLowerCase();
  const langs = new Set();

  const langPatterns = [
    { pattern: /\bhindi\b/i, name: 'Hindi' },
    { pattern: /\benglish\b/i, name: 'English' },
    { pattern: /\btamil\b/i, name: 'Tamil' },
    { pattern: /\btelugu\b/i, name: 'Telugu' },
    { pattern: /\bmalayalam\b/i, name: 'Malayalam' },
    { pattern: /\bkannada\b/i, name: 'Kannada' },
    { pattern: /\bbengali\b/i, name: 'Bengali' },
    { pattern: /\bmarathi\b/i, name: 'Marathi' },
    { pattern: /\bpunjabi\b/i, name: 'Punjabi' },
    { pattern: /\bgujarati\b/i, name: 'Gujarati' },
    { pattern: /\bkorean\b/i, name: 'Korean' },
    { pattern: /\bjapanese\b/i, name: 'Japanese' },
    { pattern: /\bchinese\b/i, name: 'Chinese' },
    { pattern: /\bspanish\b/i, name: 'Spanish' },
    { pattern: /\bfrench\b/i, name: 'French' },
    { pattern: /\bgerman\b/i, name: 'German' }
  ];

  for (const { pattern, name } of langPatterns) {
    if (pattern.test(s)) {
      langs.add(name);
    }
  }

  if (langs.size === 0 && (s.includes('dual audio') || s.includes('multi audio'))) {
    langs.add('Hindi');
    langs.add('English');
  }

  return Array.from(langs);
}

/**
 * Extract season information for web series
 * @param {string} raw
 * @returns {string|null}
 */
function extractSeasonInfo(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(?:Season|S)\s*0*(\d+)/i);
  return m ? `Season ${parseInt(m[1], 10)}` : null;
}

/**
 * Extract display title, year, season, edition, and metadata from raw string
 * @param {string} raw
 * @returns {{ displayTitle: string, year: string, type: string, season: string|null, edition: string|null, languages: Array<string>, audio: string|null, platform: string|null, releaseType: string|null }}
 */
function extractTitleMetadata(raw) {
  const cleaned = cleanTitle(raw);
  const ym = cleaned.match(/\b(19\d{2}|20\d{2})\b/);
  const year = ym ? ym[1] : '';

  // Remove year from display title if at end
  let display = cleaned.replace(/\s*\((19\d{2}|20\d{2})\)\s*$/, '').trim();
  if (display.endsWith(year)) {
    display = display.slice(0, -year.length).trim();
  }

  const isSeries = /season|series|episode|s\d{2}/i.test(raw);
  const season = isSeries ? extractSeasonInfo(raw) : null;
  const edition = extractEdition(raw);
  const languages = extractLanguages(raw);

  // Platform detection
  let platform = null;
  const rLower = String(raw).toLowerCase();
  if (rLower.includes('netflix')) platform = 'Netflix';
  else if (rLower.includes('prime') || rLower.includes('amazon')) platform = 'Amazon Prime';
  else if (rLower.includes('hotstar') || rLower.includes('disney')) platform = 'Disney+ Hotstar';
  else if (rLower.includes('sonyliv')) platform = 'SonyLIV';
  else if (rLower.includes('zee5')) platform = 'Zee5';
  else if (rLower.includes('jiocinema') || rLower.includes('jio')) platform = 'JioCinema';

  // Release type
  let releaseType = 'WEB-DL';
  if (/\bbluray\b/i.test(raw)) releaseType = 'BluRay';
  else if (/\bwebrip\b/i.test(raw)) releaseType = 'WEBRip';
  else if (/\bhdrip\b/i.test(raw)) releaseType = 'HDRip';

  return {
    displayTitle: display || cleaned,
    year,
    type: isSeries ? 'Web Series' : 'Cinema',
    season,
    edition,
    languages: languages.length > 0 ? languages : ['Hindi'],
    audio: languages.length > 1 ? 'Dual Audio' : (languages[0] || null),
    platform,
    releaseType
  };
}

module.exports = {
  decodeHtmlEntities,
  stripGlyphsAndResidualEntities,
  cleanTitle,
  normalizeForMatching,
  extractEdition,
  extractLanguages,
  extractSeasonInfo,
  extractTitleMetadata
};

