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
    .replace(/\b(1080p|720p|480p|4k|2160p|web-?dl|webrip|bluray|hdr|hevc|x264|x265|dd5\.1|dd2\.0|clean|clean-audio|line|esubs?|hc-esubs?|dual\s*audio)\b.*/gi, '')
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
 * Extract display title and year from raw string
 * @param {string} raw
 * @returns {{ displayTitle: string, year: string, type: string }}
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

  return {
    displayTitle: display || cleaned,
    year,
    type: isSeries ? 'Web Series' : 'Cinema'
  };
}

module.exports = {
  decodeHtmlEntities,
  stripGlyphsAndResidualEntities,
  cleanTitle,
  normalizeForMatching,
  extractTitleMetadata
};
