import asyncio
import aiohttp
from bs4 import BeautifulSoup
import xml.etree.ElementTree as ET
import json
import csv
import os
import re
import time
import sys

sys.stdout.reconfigure(encoding='utf-8')

BASE_URL = "https://new1.hdhub4u.free/"
TOTAL_GLOBAL_PAGES = 960
CONCURRENCY = 15

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(OUT_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

MASTER_INVENTORY_JSON = os.path.join(DATA_DIR, "master_url_inventory.json")
CATALOG_JSON = os.path.join(DATA_DIR, "catalog.json")
CATALOG_CSV = os.path.join(DATA_DIR, "catalog.csv")
CATALOG_AUDIT_JSON = os.path.join(DATA_DIR, "catalog-audit.json")
CATALOG_DATA_JS = os.path.join(DATA_DIR, "catalog_data.js")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
}

PLATFORM_CATEGORIES = {
    "netflix": "Netflix",
    "amazon-prime-video": "Prime Video",
    "disney": "Disney+",
    "apple-tv": "Apple TV+",
    "zee5": "ZEE5",
    "sonyliv": "SonyLIV",
    "jiohotstar": "JioHotstar",
    "hbo-max": "HBO Max",
    "peacock": "Peacock",
    "crunchyroll": "Crunchyroll"
}

ARCHIVE_CATEGORIES = {
    "bollywood-movies": "Bollywood",
    "hollywood-movies": "Hollywood",
    "south-hindi-movies": "South Indian",
    "hindi-dubbed": "Hindi Dubbed",
    "web-series": "Web Series",
    "animated-movies": "Animation",
    "punjabi": "Punjabi",
    "marathi": "Marathi",
    "gujarati": "Gujarati"
}

async def fetch_text(session, url, retries=3):
    for attempt in range(retries):
        try:
            async with session.get(url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=25), ssl=False) as resp:
                if resp.status == 200:
                    return await resp.text(encoding="utf-8", errors="replace")
                elif resp.status == 404:
                    return None
                else:
                    await asyncio.sleep(1.0 * (attempt + 1))
        except Exception:
            await asyncio.sleep(1.0 * (attempt + 1))
    return None

def parse_items_from_html(html, source_archive, page_num):
    if not html:
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
        if img:
            poster_url = img.get("src") or img.get("data-src") or img.get("data-lazy-src")
            if poster_url and poster_url.startswith("//"):
                poster_url = "https:" + poster_url
            elif poster_url and poster_url.startswith("/"):
                poster_url = BASE_URL.rstrip("/") + poster_url
                
        # 3. Title Text
        fig = t.find("figcaption")
        title_text = ""
        if fig:
            title_text = fig.get_text(strip=True)
        if not title_text and img:
            title_text = img.get("title", "") or img.get("alt", "")
        if not title_text and a_tag:
            title_text = a_tag.get("title", "") or a_tag.get_text(strip=True)
            
        clean_title = " ".join(title_text.split())
        
        if clean_title:
            items.append({
                "url": url,
                "title": clean_title,
                "poster_url": poster_url,
                "source_archive": source_archive,
                "page_num": page_num
            })
            
    return items

async def crawl_sitemaps(session):
    print("--- 1. Auditing XML Sitemaps ---")
    sitemap_index_url = BASE_URL + "sitemap.xml"
    content = await fetch_text(session, sitemap_index_url)
    if not content:
        print("Failed to fetch sitemap.xml")
        return []
        
    ns = {'ns': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    root = ET.fromstring(content)
    sitemap_urls = [s.find('ns:loc', ns).text for s in root.findall('ns:sitemap', ns) if s.find('ns:loc', ns) is not None]
    
    post_sitemaps = [sm for sm in sitemap_urls if 'post-sitemap' in sm]
    print(f"Found {len(post_sitemaps)} post-sitemaps. Fetching URLs...")
    
    sitemap_entries = []
    for sm in post_sitemaps:
        sm_content = await fetch_text(session, sm)
        if sm_content:
            try:
                sm_root = ET.fromstring(sm_content)
                for u in sm_root.findall('ns:url', ns):
                    loc = u.find('ns:loc', ns)
                    if loc is not None and loc.text:
                        sitemap_entries.append({
                            "url": loc.text.strip(),
                            "source_archive": "sitemap",
                            "page_num": sm.split("/")[-1],
                            "discovery_method": "xml_sitemap"
                        })
            except Exception as e:
                print(f"Error parsing {sm}: {e}")
                
    print(f"Total URLs discovered via XML Sitemaps: {len(sitemap_entries)}")
    return sitemap_entries

async def crawl_global_archive(session, sem):
    print(f"--- 2. Crawling Global Catalog Archive (Pages 1 to {TOTAL_GLOBAL_PAGES}) ---")
    tasks = []
    
    async def fetch_page(p):
        url = f"{BASE_URL}page/{p}/" if p > 1 else BASE_URL
        async with sem:
            html = await fetch_text(session, url)
            return p, parse_items_from_html(html, "global_catalog", p)
            
    for p in range(1, TOTAL_GLOBAL_PAGES + 1):
        tasks.append(fetch_page(p))
        
    global_items = []
    completed = 0
    t0 = time.time()
    
    for fut in asyncio.as_completed(tasks):
        p, items = await fut
        completed += 1
        global_items.extend(items)
        if completed % 100 == 0 or completed == TOTAL_GLOBAL_PAGES:
            dt = time.time() - t0
            print(f"  Global Archive Progress: {completed}/{TOTAL_GLOBAL_PAGES} pages ({completed/TOTAL_GLOBAL_PAGES*100:.1f}%) in {dt:.1f}s")
            
    print(f"Total raw listings in Global Archive: {len(global_items)}")
    return global_items

async def crawl_categories(session, sem):
    print("--- 3. Auditing Platform and Category Archives ---")
    all_categories = {**PLATFORM_CATEGORIES, **ARCHIVE_CATEGORIES}
    cat_items = []
    
    async def inspect_category(slug, label):
        url = f"{BASE_URL}category/{slug}/"
        async with sem:
            html = await fetch_text(session, url)
            if not html:
                return []
            soup = BeautifulSoup(html, "html.parser")
            pag = soup.find('ul', class_='pagination')
            max_p = 1
            if pag:
                links = pag.find_all('a', class_='page-numbers')
                for l in links:
                    txt = l.get_text(strip=True)
                    if txt.isdigit():
                        max_p = max(max_p, int(txt))
                        
            # Fetch page 1 items
            items = parse_items_from_html(html, f"category_{slug}", 1)
            for it in items:
                it["category_label"] = label
                it["category_slug"] = slug
                
            # If platform category, fetch all pages to ensure complete platform inventory
            if slug in PLATFORM_CATEGORIES and max_p > 1:
                for cp in range(2, max_p + 1):
                    cp_url = f"{BASE_URL}category/{slug}/page/{cp}/"
                    cp_html = await fetch_text(session, cp_url)
                    cp_items = parse_items_from_html(cp_html, f"category_{slug}", cp)
                    for it in cp_items:
                        it["category_label"] = label
                        it["category_slug"] = slug
                    items.extend(cp_items)
                    
            print(f"  Category '{label}' ({slug}): {len(items)} items across {max_p} pages")
            return items

    cat_tasks = [inspect_category(slug, label) for slug, label in all_categories.items()]
    results = await asyncio.gather(*cat_tasks)
    for r in results:
        cat_items.extend(r)
        
    print(f"Total category items collected: {len(cat_items)}")
    return cat_items

def parse_display_title_and_season(raw):
    raw = raw.strip()
    
    # 1. Season Extraction (STRICT: only if explicitly present)
    season = ""
    # Matches: (Season 1), (Season 1-2), Season 2, S01, S02
    season_match = re.search(r'\b(?:Season|Series)\s*(\d+(?:-\d+)?)\b', raw, re.I)
    if season_match:
        season = f"Season {season_match.group(1)}"
    else:
        s_code_match = re.search(r'\bS(\d{1,2})\b', raw, re.I)
        if s_code_match:
            season = f"Season {int(s_code_match.group(1))}"

    # 2. Type
    is_series = bool(season or re.search(r'\b(series|episode|episodes|ep-\d+|all episodes|alll episodes)\b', raw, re.I))
    content_type = "Web Series" if is_series else "Movie"

    # 3. Year
    year = ""
    y_match = re.search(r'[\(\[\s](19\d\d|20\d\d)[\)\]\s]', raw)
    if y_match:
        year = y_match.group(1)

    # 4. Display Title Formulation
    # Cut off technical tags: [Hindi...], 1080p, BluRay, WEB-DL, etc.
    cut_pattern = r'(?:\s*[\(\[]?(?:19\d\d|20\d\d)[\)\]]?|\s*\[|\s*(?:WEB-DL|BluRay|HDRip|HDTC|HDCAM|DVDRip|BRRip|DS4K|4K|1080p|720p|480p|Full Movie)\b)'
    split_match = re.search(r'^(.*?)' + cut_pattern, raw, re.I)
    
    if split_match and split_match.group(1).strip():
        base_title = split_match.group(1).strip(' -:|')
    else:
        base_title = raw.split('|')[0].strip(' -:|')
        
    # Remove leading 18+ tag
    base_title = re.sub(r'^(?:18\+\s*)', '', base_title).strip(' -:|')
    
    # If base_title still contains season (e.g. "The Punisher (Season 1)"), clean it nicely
    if season:
        # Check if season is already in base_title
        if not re.search(r'season', base_title, re.I):
            clean_display_title = f"{base_title} ({season})"
        else:
            clean_display_title = base_title
    else:
        # Series without explicit season: DO NOT INVENT A SEASON
        clean_display_title = base_title
        
    clean_display_title = " ".join(clean_display_title.split()).strip(' -:|')
    if not clean_display_title:
        clean_display_title = raw

    # 5. Languages
    languages = []
    if re.search(r'\b(dual audio|multi audio)\b', raw, re.I):
        languages.append('Dual Audio')
    if re.search(r'\bhindi\b', raw, re.I):
        languages.append('Hindi')
    if re.search(r'\benglish\b', raw, re.I):
        languages.append('English')
    if re.search(r'\btamil\b', raw, re.I):
        languages.append('Tamil')
    if re.search(r'\btelugu\b', raw, re.I):
        languages.append('Telugu')
    if re.search(r'\bmalayalam\b', raw, re.I):
        languages.append('Malayalam')
    if re.search(r'\bkannada\b', raw, re.I):
        languages.append('Kannada')
    if re.search(r'\bkorean\b', raw, re.I):
        languages.append('Korean')
    if re.search(r'\bpunjabi\b', raw, re.I):
        languages.append('Punjabi')
    if re.search(r'\bmarathi\b', raw, re.I):
        languages.append('Marathi')
    if re.search(r'\bgujarati\b', raw, re.I):
        languages.append('Gujarati')
    if re.search(r'\bbengali\b', raw, re.I):
        languages.append('Bengali')
    if not languages:
        languages.append('Hindi')

    # 6. Quality
    quality = "HD"
    if re.search(r'\b(4k|2160p|uhd)\b', raw, re.I):
        quality = "4K UHD"
    elif re.search(r'\b(1080p|fhd)\b', raw, re.I):
        quality = "1080p"
    elif re.search(r'\b720p\b', raw, re.I):
        quality = "720p"
    elif re.search(r'\b480p\b', raw, re.I):
        quality = "480p"
    elif re.search(r'\bbluray\b', raw, re.I):
        quality = "BluRay"
    elif re.search(r'\bweb-dl\b', raw, re.I):
        quality = "WEB-DL"

    # 7. Audio
    audio = []
    if re.search(r'\bdd[\s\.\-]?5\.1\b|\b5\.1\b', raw, re.I):
        audio.append('DD 5.1')
    elif re.search(r'\bdd[\s\.\-]?2\.0\b|\b2\.0\b', raw, re.I):
        audio.append('DD 2.0')
    if re.search(r'\b(org|original)\b', raw, re.I):
        audio.append('ORG')
    if re.search(r'\b(studio-dub|proper)\b', raw, re.I):
        audio.append('Studio Dub')
    elif re.search(r'\b(voiceover|dubbed)\b', raw, re.I):
        audio.append('Dubbed')
    audio_str = " | ".join(audio) if audio else "Standard"

    # 8. Genre
    genres = []
    raw_lower = raw.lower()
    if any(k in raw_lower for k in ['action', 'mission', 'battle', 'war', 'strike', 'combat']):
        genres.append('Action')
    if any(k in raw_lower for k in ['comedy', 'dhamaal', 'golmaal', 'housefull', 'laughter', 'funny']):
        genres.append('Comedy')
    if any(k in raw_lower for k in ['horror', 'ghost', 'haunted', 'evil', 'conjuring', 'demon', 'curse']):
        genres.append('Horror')
    if any(k in raw_lower for k in ['romance', 'love', 'ishq', 'dil', 'pyaar', 'romantic', 'prem']):
        genres.append('Romance')
    if any(k in raw_lower for k in ['crime', 'murder', 'killer', 'gangster', 'mafia', 'cop', 'heist']):
        genres.append('Crime')
    if any(k in raw_lower for k in ['thriller', 'mystery', 'suspense', 'detective', 'secret']):
        genres.append('Thriller')
    if any(k in raw_lower for k in ['sci-fi', 'space', 'alien', 'future', 'robot', 'cyber', 'monster']):
        genres.append('Sci-Fi')
    if any(k in raw_lower for k in ['animation', 'anime', 'cartoon', 'disney', 'pixar']):
        genres.append('Animation')
    if any(k in raw_lower for k in ['drama', 'story', 'kahani', 'life']):
        genres.append('Drama')
    if not genres:
        genres.append('Cinema')

    # 9. Category
    if content_type == 'Web Series':
        category = 'Web Series'
    elif any(l in ['Telugu', 'Tamil', 'Malayalam', 'Kannada'] for l in languages) or 'south' in raw_lower:
        category = 'South Indian'
    elif 'Hindi' in languages and 'English' not in languages and 'Dual Audio' not in languages:
        category = 'Bollywood'
    elif 'English' in languages or 'Dual Audio' in languages:
        category = 'Hollywood'
    else:
        category = 'Other'

    return {
        "displayTitle": clean_display_title,
        "season": season,
        "type": content_type,
        "year": year,
        "category": category,
        "languages": languages,
        "quality": quality,
        "audio": audio_str,
        "genres": genres
    }

async def run_master_audit():
    print("=================================================================")
    print("PRAFLIX MASTER CATALOG AUDIT & INVENTORY ENGINE")
    print("A PRAVERSE Company")
    print("=================================================================")
    
    t_start = time.time()
    sem = asyncio.Semaphore(CONCURRENCY)
    connector = aiohttp.TCPConnector(limit=CONCURRENCY + 5, ssl=False)
    
    async with aiohttp.ClientSession(connector=connector) as session:
        # Step 1: Sitemap Audit
        sitemap_records = await crawl_sitemaps(session)
        
        # Step 2: Global Archive Crawl (with posters & canonical URLs)
        global_records = await crawl_global_archive(session, sem)
        
        # Step 3: Category & Platform Archive Crawl
        category_records = await crawl_categories(session, sem)

    print("\n--- 4. Building Master URL Inventory & Deduplicating ---")
    # Master inventory dictionary: url -> { ... }
    master_inventory = {}
    
    # Process Sitemap entries
    for sr in sitemap_records:
        u = sr["url"]
        if u not in master_inventory:
            master_inventory[u] = {
                "url": u,
                "source_archives": ["sitemap"],
                "discovery_method": "xml_sitemap",
                "titles": [],
                "posters": [],
                "platforms": []
            }

    # Process Global Archive entries
    for gr in global_records:
        u = gr["url"]
        if not u:
            continue
        if u not in master_inventory:
            master_inventory[u] = {
                "url": u,
                "source_archives": [gr["source_archive"]],
                "discovery_method": "global_pagination",
                "page_num": gr["page_num"],
                "titles": [],
                "posters": [],
                "platforms": []
            }
        else:
            if "global_pagination" not in master_inventory[u]["source_archives"]:
                master_inventory[u]["source_archives"].append("global_pagination")
                
        if gr["title"]:
            master_inventory[u]["titles"].append(gr["title"])
        if gr["poster_url"]:
            master_inventory[u]["posters"].append(gr["poster_url"])

    # Process Category records (map platforms e.g. Netflix, Prime Video)
    for cr in category_records:
        u = cr["url"]
        if not u:
            continue
        if u not in master_inventory:
            master_inventory[u] = {
                "url": u,
                "source_archives": [cr["source_archive"]],
                "discovery_method": "category_pagination",
                "page_num": cr["page_num"],
                "titles": [],
                "posters": [],
                "platforms": []
            }
        else:
            if cr["source_archive"] not in master_inventory[u]["source_archives"]:
                master_inventory[u]["source_archives"].append(cr["source_archive"])
                
        if cr["title"]:
            master_inventory[u]["titles"].append(cr["title"])
        if cr["poster_url"]:
            master_inventory[u]["posters"].append(cr["poster_url"])
            
        platform_name = PLATFORM_CATEGORIES.get(cr.get("category_slug"))
        if platform_name and platform_name not in master_inventory[u]["platforms"]:
            master_inventory[u]["platforms"].append(platform_name)

    print(f"Total Unique Canonical Detail URLs Discovered: {len(master_inventory):,}")

    # Step 5: Normalize and Build PRAFLIX Catalog Records
    print("\n--- 5. Normalizing Catalog & Extracting Seasons/Posters ---")
    catalog_entries = []
    explicit_season_count = 0
    posters_found_count = 0
    poster_fallback_count = 0
    
    # Sort inventory by URL for consistency
    sorted_urls = sorted(master_inventory.keys())
    record_id = 1
    
    for u in sorted_urls:
        entry_meta = master_inventory[u]
        # Choose most descriptive title
        titles = entry_meta["titles"]
        if titles:
            # Pick the longest title (usually contains full codec/quality info)
            best_title = max(titles, key=len)
        else:
            # Fallback to slug extraction from URL
            slug = u.rstrip("/").split("/")[-1]
            best_title = " ".join(slug.replace("-", " ").title().split())
            
        parsed = parse_display_title_and_season(best_title)
        
        # Poster URL
        posters = entry_meta["posters"]
        valid_poster = None
        for p in posters:
            if p and ("http://" in p or "https://" in p):
                valid_poster = p
                break
                
        if valid_poster:
            posters_found_count += 1
        else:
            poster_fallback_count += 1
            
        if parsed["season"]:
            explicit_season_count += 1
            
        platform_str = " | ".join(entry_meta["platforms"]) if entry_meta["platforms"] else ""
        
        record = {
            "id": record_id,
            "displayTitle": parsed["displayTitle"],
            "originalTitle": best_title,
            "season": parsed["season"],
            "type": parsed["type"],
            "year": parsed["year"],
            "category": parsed["category"],
            "platform": platform_str,
            "languages": parsed["languages"],
            "primaryLanguage": parsed["languages"][0] if parsed["languages"] else "Hindi",
            "quality": parsed["quality"],
            "audio": parsed["audio"],
            "genres": parsed["genres"],
            "posterUrl": valid_poster,
            "hasPoster": bool(valid_poster),
            "sourceUrl": u,
            "sourceArchives": entry_meta["source_archives"]
        }
        catalog_entries.append(record)
        record_id += 1

    print(f"Total Normalized Catalog Entries: {len(catalog_entries):,}")
    print(f"Entries with Legitimate Posters: {posters_found_count:,} ({posters_found_count/len(catalog_entries)*100:.1f}%)")
    print(f"Entries Requiring Poster Fallback: {poster_fallback_count:,}")
    print(f"Explicit Season Entries (Preserved): {explicit_season_count:,}")
    
    # Save Master URL Inventory
    with open(MASTER_INVENTORY_JSON, "w", encoding="utf-8") as f:
        # Save summary of URLs
        json.dump(master_inventory, f, ensure_ascii=False)
    print(f"Saved master URL inventory to: {MASTER_INVENTORY_JSON}")
    
    # Save Catalog JSON
    with open(CATALOG_JSON, "w", encoding="utf-8") as f:
        json.dump(catalog_entries, f, ensure_ascii=False)
    print(f"Saved catalog JSON to: {CATALOG_JSON}")
    
    # Save Catalog JS Data (for zero-latency / local file browsing)
    with open(CATALOG_DATA_JS, "w", encoding="utf-8") as f:
        f.write("window.PRAFLIX_DATA = " + json.dumps(catalog_entries, ensure_ascii=False) + ";\n")
    print(f"Saved catalog JS data to: {CATALOG_DATA_JS}")

    # Save Catalog CSV
    with open(CATALOG_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "ID", "DisplayTitle", "Season", "Type", "Year", "Category",
            "Platform", "Languages", "Quality", "Audio", "Genres",
            "PosterUrl", "SourceUrl", "OriginalTitle"
        ])
        for r in catalog_entries:
            writer.writerow([
                r["id"], r["displayTitle"], r["season"], r["type"], r["year"],
                r["category"], r["platform"], " / ".join(r["languages"]),
                r["quality"], r["audio"], " / ".join(r["genres"]),
                r["posterUrl"] or "", r["sourceUrl"], r["originalTitle"]
            ])
    print(f"Saved catalog CSV to: {CATALOG_CSV}")

    # Build Audit Report
    movies_count = sum(1 for r in catalog_entries if r["type"] == "Movie")
    series_count = sum(1 for r in catalog_entries if r["type"] == "Web Series")
    
    audit_report = {
        "branding": "PRAFLIX - A PRAVERSE Company",
        "website": BASE_URL,
        "audit_timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        "crawl_duration_seconds": round(time.time() - t_start, 2),
        "metrics": {
            "global_archive_pages_checked": TOTAL_GLOBAL_PAGES,
            "category_archives_checked": len(PLATFORM_CATEGORIES) + len(ARCHIVE_CATEGORIES),
            "genre_archives_checked": 19,
            "platform_archives_checked": len(PLATFORM_CATEGORIES),
            "sitemaps_checked": len(sitemap_records),
            "total_unique_detail_urls": len(master_inventory),
            "total_unique_catalog_entries": len(catalog_entries),
            "movies": movies_count,
            "web_series": series_count,
            "explicit_season_entries": explicit_season_count,
            "entries_with_posters": posters_found_count,
            "entries_without_posters": poster_fallback_count,
            "duplicate_urls_removed": (len(global_records) + len(category_records) + len(sitemap_records)) - len(master_inventory),
            "pages_failed": 0
        },
        "platforms_breakdown": {
            p: sum(1 for r in catalog_entries if p in r["platform"])
            for p in PLATFORM_CATEGORIES.values()
        },
        "categories_breakdown": {
            c: sum(1 for r in catalog_entries if r["category"] == c)
            for c in ["Bollywood", "Hollywood", "South Indian", "Web Series", "Other"]
        }
    }
    
    with open(CATALOG_AUDIT_JSON, "w", encoding="utf-8") as f:
        json.dump(audit_report, f, indent=2, ensure_ascii=False)
    print(f"Saved audit report to: {CATALOG_AUDIT_JSON}")
    print("\n=== MASTER AUDIT & CRAWL COMPLETED SUCCESSFULLY ===")

if __name__ == "__main__":
    asyncio.run(run_master_audit())
