import re
import unicodedata

def normalize_text(text):
    """
    Standardize text for search normalization and matching:
    - lowercase
    - strip diacritics
    - replace hyphens, underscores, punctuation with single spaces
    - collapse whitespace
    """
    if not text:
        return ""
    # Normalize unicode (decompose accents)
    text = unicodedata.normalize('NFKD', str(text))
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    # Replace separators and punctuation with space
    text = re.sub(r'[\-_/\\:\.,;!\?\'\"`\(\)\[\]\{\}\|+~*@#$%^&=<>\ufffd’‘“”–—―]+', ' ', text)
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def slugify(text, max_len=60):
    """
    Generate clean alphanumeric slug for filenames and IDs.
    """
    if not text:
        return ""
    text = normalize_text(text)
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text).strip('-')
    return text[:max_len]

def clean_display_title(raw_title, existing_year="", existing_season=""):
    """
    Extract clean display title from raw source title.
    Removes technical tags, resolutions, audio codecs, release types, and episode tags,
    while preserving meaningful words that are part of the title.
    """
    if not raw_title:
        return ""
    
    title = raw_title.strip()
    
    # Strip leading 18+ / Adult markers
    title = re.sub(r'^(?:18\+\s*(?:\[Adult\])?\s*|Adult\s*:\s*)', '', title, flags=re.I).strip(' -:|')
    
    # Identify cutoff point: where year in paren/brackets, or explicit season, or technical block starts
    m_year_paren = re.search(r'\s*[\(\[]\s*(19\d\d|20[0-3]\d)\s*[\)\]]', title)
    m_season_paren = re.search(r'[\(\[]?\s*\b(?:Season|Series)\s*\d+', title, flags=re.I)
    
    cutoff_pos = None
    if m_season_paren and m_year_paren:
        cutoff_pos = min(m_season_paren.start(), m_year_paren.start())
    elif m_season_paren and m_season_paren.start() > 2:
        cutoff_pos = m_season_paren.start()
    elif m_year_paren and m_year_paren.start() > 2:
        cutoff_pos = m_year_paren.start()
        
    if cutoff_pos is not None and cutoff_pos > 2:
        clean = title[:cutoff_pos]
    else:
        # Check standalone 4-digit year followed by technical keywords or language tags
        clean = title
        for m_year_word in re.finditer(r'\b(19\d\d|20[0-3]\d)\b', title):
            if m_year_word.start() > 2:
                rest = title[m_year_word.end():]
                if re.search(r'\b(?:Hindi|English|Tamil|Telugu|Punjabi|Bengali|Marathi|Gujarati|Malayalam|Kannada|Bhojpuri|South|Dual Audio|Multi Audio|WEB|BluRay|HDRip|480p|720p|1080p|2160p|4K|Full Movie|Series|Movie|Download|Free Movie)\b', rest, flags=re.I):
                    clean = title[:m_year_word.start()]
                    break

    # Strip trailing technical tags that might have appeared before year or in base title
    tech_patterns = [
        r'\s*([\|\-\–]\s*)?[\(\[]?\b(HQ-?HDTC|HDTC|HDCAM|CAMRip|WEB-?DL|WEB-?Rip|WEBRip|BluRay|BRRip|HDRip|DVDRip|HDTV|DS4K|4K|2160p|1440p|1080p|720p|480p|360p|x264|x265|HEVC|10Bit|Dual Audio|Multi Audio|Full Movie|Full Series|All Episodes?|UNCUT|UNRATED)\b.*$',
        r'\[(Hindi|English|Tamil|Telugu|Malayalam|Kannada|Punjabi|Bengali|Dual Audio|Multi Audio|DD\d.*?)\]',
        r'\((Hindi|English|Tamil|Telugu|Malayalam|Kannada|Punjabi|Bengali|Dual Audio|Multi Audio|DD\d.*?)\)',
        r'\s*\|\s*(?:Full Movie|Full Series|Complete|All Episodes).*$',
        r'\s*\|\s*(?:Netflix|Prime Video|SonyLIV|ZEE5|JioHotstar|Paramount\+|Disney\+).*$'
    ]
    for pat in tech_patterns:
        clean = re.sub(pat, '', clean, flags=re.I)

    # Clean punctuation and brackets
    clean = re.sub(r'[\s\|\-\–\:\,]+$', '', clean).strip()
    clean = re.sub(r'^[\s\|\-\–\:\,]+', '', clean).strip()
    
    # Fix unbalanced brackets
    if clean.count('[') > clean.count(']'):
        clean += ']'
    if clean.count('(') > clean.count(')'):
        clean += ')'
    if clean.count(']') > clean.count('['):
        clean = clean.replace(']', '')
    if clean.count(')') > clean.count('('):
        clean = clean.replace(')', '')
        
    clean = re.sub(r'\s+', ' ', clean).strip()
    
    if not clean:
        clean = raw_title.strip()
        
    return clean
