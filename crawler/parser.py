import re
import warnings
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from .config import BASE_URL, PLATFORM_CATEGORIES
from .normalizer import clean_display_title, normalize_text

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

def parse_items_from_html(html, source_archive="global_catalog", page_num=1):
    """
    Extract all catalog cards/listings from archive or category page HTML.
    """
    if not html or "sitemap" in str(source_archive).lower() or html.strip().startswith("<?xml"):
        return []
    
    soup = BeautifulSoup(html, "html.parser")
    thumbs = soup.find_all("li", class_="thumb")
    items = []
    
    for t in thumbs:
        # 1. URL
        a_tag = t.find("a")
        url = ""
        if a_tag and a_tag.get("href"):
            url = a_tag.get("href").strip()
            if url.startswith("/"):
                url = BASE_URL.rstrip("/") + url
                
        # 2. Poster Image URL
        img = t.find("img")
        poster_url = None
        alt_text = ""
        img_title = ""
        if img:
            poster_url = img.get("src") or img.get("data-src") or img.get("data-lazy-src")
            if poster_url and poster_url.startswith("//"):
                poster_url = "https:" + poster_url
            elif poster_url and poster_url.startswith("/"):
                poster_url = BASE_URL.rstrip("/") + poster_url
            alt_text = img.get("alt", "").strip()
            img_title = img.get("title", "").strip()
                
        # 3. Raw Title Text
        fig = t.find("figcaption")
        title_text = ""
        if fig:
            title_text = fig.get_text(strip=True)
        if not title_text and img_title:
            title_text = img_title
        if not title_text and alt_text:
            title_text = alt_text
        if not title_text and a_tag:
            title_text = a_tag.get("title", "") or a_tag.get_text(strip=True)
            
        clean_raw_title = " ".join(title_text.split())
        
        if clean_raw_title and url:
            items.append({
                "sourceUrl": url,
                "rawTitle": clean_raw_title,
                "posterUrl": poster_url,
                "altText": alt_text,
                "sourceArchive": source_archive,
                "sourceArchivePage": page_num
            })
            
    return items

def extract_year(raw_title, source_url="", poster_url=""):
    """
    Extract 4-digit release year from title, URL, or poster path.
    Never manufactures or guesses a year. Returns None if unknown.
    """
    # 1. Title in parentheses or brackets: (2026) or [2026]
    m_paren = re.search(r'[\(\[]\s*(19\d\d|20[0-3]\d)\s*[\)\]]', raw_title)
    if m_paren:
        return m_paren.group(1)
        
    # 2. Standalone 4-digit year in title
    m_word = re.search(r'\b(19\d\d|20[0-3]\d)\b', raw_title)
    if m_word and m_word.start() > 2:
        return m_word.group(1)
        
    # 3. Year in detail URL slug: -2026- or -2026/
    if source_url:
        m_url = re.search(r'-(19\d\d|20[0-3]\d)(?:-|\/)', source_url)
        if m_url:
            return m_url.group(1)
            
    # 4. Year in poster path URL: /2026/
    if poster_url:
        m_poster = re.search(r'\/(19\d\d|20[0-3]\d)\/', poster_url)
        if m_poster:
            return m_poster.group(1)
            
    return None

def extract_season(raw_title):
    """
    Extract explicit season number or range.
    STRICT: Returns None if not explicitly present. NEVER manufactures 'Season 1'.
    """
    # Check "Season 1", "Season 1-2", "Season 02", "Series 1"
    s_match = re.search(r'\b(?:Season|Series)\s*(\d+(?:\s*[-–&]\s*(?:Season\s*)?\d+)?)\b', raw_title, re.I)
    if s_match:
        val = s_match.group(1).strip()
        # If single digit with leading zero, normalize to standard integer
        if val.isdigit():
            return f"Season {int(val)}"
        return f"Season {val}"
        
    # Check "S01", "S1", "S02" preceded by space, bracket, or paren
    s_code = re.search(r'[\(\[\s]\bS(\d{1,2})\b', raw_title, re.I)
    if s_code:
        return f"Season {int(s_code.group(1))}"
        
    return None

def extract_episode_status(raw_title):
    """
    Extract episode update markers like EP-02 Added, Episode 5 Added, etc.
    """
    m = re.search(r'\[?(?:EP|Episode)\s*[-:]?\s*0*(\d+)\s*(?:ADDED|Added)?\]?', raw_title, re.I)
    if m:
        try:
            ep_num = int(m.group(1))
            return {
                "latestEpisode": ep_num,
                "raw": m.group(0).strip('[] ')
            }
        except ValueError:
            pass
    return None

def classify_type(raw_title, season=None, episode_status=None, source_url="", category=""):
    """
    Multi-signal classification: 'movie' | 'series' | 'unknown'.
    """
    if season is None:
        season = extract_season(raw_title)
    if episode_status is None:
        episode_status = extract_episode_status(raw_title)
        
    if season or episode_status:
        return "series"
        
    raw_lower = raw_title.lower()
    url_lower = (source_url or "").lower()
    cat_lower = (category or "").lower()
    
    series_keywords = [
        "series", "web-series", "web series", "all episodes", "alll episodes",
        "complete season", "full series", "full season", "episodes",
        "k-drama", "c-drama", "drama series", "tv-shows", "tv show"
    ]
    
    if any(k in raw_lower for k in series_keywords):
        return "series"
    if any(k in url_lower for k in ["-series-", "-season-", "-all-episodes", "-full-series", "-full-season"]):
        return "series"
    if cat_lower in ["web series", "tv-shows", "wrestling-shows"]:
        return "series"
        
    movie_keywords = [
        "full movie", "movie", "bluray", "hdtc", "camrip", "dvdrip"
    ]
    if any(k in raw_lower for k in movie_keywords):
        return "movie"
        
    return "movie"

def extract_qualities(raw_title):
    """
    Dynamically extract available resolutions. Never invents qualities.
    Returns sorted list of {resolution, label}.
    """
    qualities = []
    seen = set()
    
    # 4K / 2160p
    if re.search(r'\b(4k|2160p|ds4k|uhd)\b', raw_title, re.I):
        seen.add("2160p")
        qualities.append({"resolution": "2160p", "label": "4K"})
    # 1440p
    if re.search(r'\b1440p\b', raw_title, re.I):
        seen.add("1440p")
        qualities.append({"resolution": "1440p", "label": "1440p"})
    # 1080p
    if re.search(r'\b(1080p|fhd)\b', raw_title, re.I):
        seen.add("1080p")
        qualities.append({"resolution": "1080p", "label": "1080p"})
    # 720p
    if re.search(r'\b720p\b', raw_title, re.I):
        seen.add("720p")
        qualities.append({"resolution": "720p", "label": "720p"})
    # 480p
    if re.search(r'\b480p\b', raw_title, re.I):
        seen.add("480p")
        qualities.append({"resolution": "480p", "label": "480p"})
    # 360p
    if re.search(r'\b360p\b', raw_title, re.I):
        seen.add("360p")
        qualities.append({"resolution": "360p", "label": "360p"})
        
    # Sort ascending by resolution number
    def get_res_num(q):
        m = re.search(r'\d+', q["resolution"])
        return int(m.group(0)) if m else 0
        
    qualities.sort(key=get_res_num)
    return qualities

def extract_release_type(raw_title):
    """
    Extract release type separated from resolution.
    """
    if re.search(r'\bHQ-?HDTC\b', raw_title, re.I):
        return "HQ-HDTC"
    if re.search(r'\bHDTC\b', raw_title, re.I):
        return "HDTC"
    if re.search(r'\b(WEB-?DL)\b', raw_title, re.I):
        return "WEB-DL"
    if re.search(r'\b(WEB-?Rip|WEBRip)\b', raw_title, re.I):
        return "WEBRip"
    if re.search(r'\b(BluRay|BRRip|BD-?Rip)\b', raw_title, re.I):
        return "BluRay"
    if re.search(r'\bHDRip\b', raw_title, re.I):
        return "HDRip"
    if re.search(r'\b(HDCAM|CAMRip)\b', raw_title, re.I):
        return "HDCAM"
    if re.search(r'\bDVDRip\b', raw_title, re.I):
        return "DVDRip"
    if re.search(r'\bHDTV\b', raw_title, re.I):
        return "HDTV"
    return None

def extract_encoding(raw_title):
    """
    Extract video encoding / bit depth.
    """
    encs = []
    if re.search(r'\b10Bit\b', raw_title, re.I):
        encs.append("10Bit")
    if re.search(r'\bHEVC\b', raw_title, re.I):
        encs.append("HEVC")
    elif re.search(r'\bx265\b', raw_title, re.I):
        encs.append("x265")
    if re.search(r'\bx264\b', raw_title, re.I):
        encs.append("x264")
    return " / ".join(encs) if encs else None

def extract_languages(raw_title):
    """
    Extract clean list of audio languages.
    """
    langs = []
    known_langs = [
        "Hindi", "English", "Tamil", "Telugu", "Malayalam", "Kannada",
        "Punjabi", "Marathi", "Gujarati", "Bengali", "Korean", "Spanish",
        "French", "German", "Japanese", "Chinese"
    ]
    for lang in known_langs:
        if re.search(r'\b' + lang + r'\b', raw_title, re.I):
            langs.append(lang)
            
    if re.search(r'\b(dual audio)\b', raw_title, re.I):
        if not langs:
            langs = ["Dual Audio"]
        elif "Dual Audio" not in langs and len(langs) >= 2:
            pass # Already explicit languages
    elif re.search(r'\b(multi audio)\b', raw_title, re.I):
        if not langs:
            langs = ["Multi Audio"]
            
    if not langs:
        langs = ["Hindi"]
    return langs

def extract_audio_tracks(raw_title):
    """
    Extract audio channel and track descriptors.
    """
    tracks = []
    if re.search(r'\bdd[\s\.\-]?5\.1\b|\b5\.1\b', raw_title, re.I):
        tracks.append("DD 5.1")
    elif re.search(r'\bdd[\s\.\-]?2\.0\b|\b2\.0\b', raw_title, re.I):
        tracks.append("DD 2.0")
        
    if re.search(r'\b(org|original)\b', raw_title, re.I):
        tracks.append("ORG")
    if re.search(r'\b(studio-dub|proper)\b', raw_title, re.I):
        tracks.append("Studio Dub")
    elif re.search(r'\b(voiceover|dubbed)\b', raw_title, re.I):
        tracks.append("VoiceOver")
    if re.search(r'\bclean\b', raw_title, re.I):
        tracks.append("Clean")
    if re.search(r'\bline\b', raw_title, re.I):
        tracks.append("LiNE")
        
    return tracks

def extract_genres(raw_title):
    """
    Infer genres from keywords in raw title.
    """
    genres = []
    raw_lower = raw_title.lower()
    mapping = {
        "Action": ['action', 'mission', 'battle', 'war', 'strike', 'combat', 'assassin'],
        "Comedy": ['comedy', 'dhamaal', 'golmaal', 'housefull', 'laughter', 'funny'],
        "Horror": ['horror', 'ghost', 'haunted', 'evil', 'conjuring', 'demon', 'curse', 'zombie'],
        "Romance": ['romance', 'love', 'ishq', 'dil', 'pyaar', 'romantic', 'prem'],
        "Crime": ['crime', 'murder', 'killer', 'gangster', 'mafia', 'cop', 'heist'],
        "Thriller": ['thriller', 'mystery', 'suspense', 'detective', 'secret'],
        "Sci-Fi": ['sci-fi', 'space', 'alien', 'future', 'robot', 'cyber', 'monster'],
        "Animation": ['animation', 'anime', 'cartoon', 'disney', 'pixar'],
        "Drama": ['drama', 'story', 'kahani', 'life', 'true story']
    }
    for g, keywords in mapping.items():
        if any(k in raw_lower for k in keywords):
            genres.append(g)
            
    if not genres:
        genres.append("Cinema")
    return genres

def extract_platform(raw_title, source_url="", category=""):
    """
    Extract platform association if present.
    """
    combined = f"{raw_title} {source_url} {category}".lower()
    for slug, name in PLATFORM_CATEGORIES.items():
        if slug in combined or name.lower() in combined:
            return name
    if "paramount+" in combined or "paramount" in combined:
        return "Paramount+"
    if "hotstar" in combined:
        return "JioHotstar"
    return None

def parse_listing_metadata(raw_title, source_url="", poster_url="", category=""):
    """
    Complete structured extraction pipeline for a single source listing.
    """
    clean_title = clean_display_title(raw_title)
    year = extract_year(raw_title, source_url, poster_url)
    season = extract_season(raw_title)
    ep_status = extract_episode_status(raw_title)
    content_type = classify_type(raw_title, season, ep_status, source_url, category)
    qualities = extract_qualities(raw_title)
    release_type = extract_release_type(raw_title)
    encoding = extract_encoding(raw_title)
    languages = extract_languages(raw_title)
    audio_tracks = extract_audio_tracks(raw_title)
    genres = extract_genres(raw_title)
    platform = extract_platform(raw_title, source_url, category)
    
    return {
        "displayTitle": clean_title,
        "originalSourceTitle": raw_title,
        "normalizedTitle": normalize_text(clean_title),
        "year": year,
        "type": content_type,
        "season": season,
        "episodeStatus": ep_status,
        "genres": genres,
        "languages": languages,
        "audioTracks": audio_tracks,
        "audio": " | ".join(audio_tracks) if audio_tracks else "Standard",
        "platform": platform,
        "releaseType": release_type,
        "encoding": encoding,
        "qualities": qualities,
        "sourceUrl": source_url,
        "posterUrl": poster_url
    }
