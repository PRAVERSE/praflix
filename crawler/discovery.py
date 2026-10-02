import re
import time
import asyncio
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
from .config import BASE_URL, HEADERS, PLATFORM_CATEGORIES, ARCHIVE_CATEGORIES
from .fetcher import ResilientFetcher
from .parser import parse_items_from_html

async def discover_max_archive_page(session, fetcher):
    """
    Dynamically discover the final archive page using pagination signals.
    Never hardcodes 930 or 960.
    """
    items, audit, html = await fetcher.fetch_page(session, BASE_URL, page_type="homepage", page_num=1)
    if not html:
        return 960 # Fallback safety default
        
    soup = BeautifulSoup(html, "html.parser")
    pag = soup.find("ul", class_="pagination") or soup.find(class_=re.compile(r'pagin', re.I))
    max_p = 1
    if pag:
        for a in pag.find_all(["a", "span"]):
            t = a.get_text(strip=True)
            if t.isdigit():
                max_p = max(max_p, int(t))
                
    # Verify the boundary page
    curr = max_p
    while True:
        url = f"{BASE_URL}page/{curr}/"
        _, _, p_html = await fetcher.fetch_page(session, url, page_type="archive_boundary", page_num=curr)
        if not p_html:
            break
        p_soup = BeautifulSoup(p_html, "html.parser")
        p_pag = p_soup.find("ul", class_="pagination") or p_soup.find(class_=re.compile(r'pagin', re.I))
        higher = curr
        has_next = False
        if p_pag:
            for a in p_pag.find_all("a"):
                t = a.get_text(strip=True)
                if t.isdigit() and int(t) > higher:
                    higher = int(t)
                if "next" in a.get("class", []) or "Next" in t:
                    has_next = True
        if higher > curr:
            curr = higher
        elif has_next:
            curr += 1
        else:
            break
            
    return curr

async def discover_sitemap_urls(session, fetcher):
    """
    Discover all post URLs from XML sitemaps.
    """
    sitemap_index_url = BASE_URL + "sitemap.xml"
    _, _, content = await fetcher.fetch_page(session, sitemap_index_url, page_type="sitemap_index")
    if not content:
        return []
        
    ns = {'ns': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    try:
        root = ET.fromstring(content)
    except Exception:
        return []
        
    sitemap_urls = [s.find('ns:loc', ns).text for s in root.findall('ns:sitemap', ns) if s.find('ns:loc', ns) is not None]
    post_sitemaps = [sm for sm in sitemap_urls if 'post-sitemap' in sm]
    
    entries = []
    for sm in post_sitemaps:
        _, _, sm_content = await fetcher.fetch_page(session, sm, page_type="post_sitemap")
        if sm_content:
            try:
                sm_root = ET.fromstring(sm_content)
                for u in sm_root.findall('ns:url', ns):
                    loc = u.find('ns:loc', ns)
                    if loc is not None and loc.text:
                        url_clean = loc.text.strip()
                        entries.append({
                            "sourceUrl": url_clean,
                            "rawTitle": "",
                            "posterUrl": None,
                            "sourceArchive": "sitemap",
                            "sourceArchivePage": sm.split("/")[-1],
                            "discoveryMethod": "sitemap"
                        })
            except Exception:
                pass
                
    return entries

async def crawl_all_archive_pages(session, fetcher, max_page, progress_cb=None):
    """
    Crawl all dynamic archive pages from 1 to max_page.
    """
    tasks = []
    for p in range(1, max_page + 1):
        url = f"{BASE_URL}page/{p}/" if p > 1 else BASE_URL
        tasks.append((p, url))

    all_listings = []
    completed = 0
    t0 = time.time()
    chunk_size = 50

    for i in range(0, len(tasks), chunk_size):
        chunk = tasks[i:i + chunk_size]
        futs = [fetcher.fetch_page(session, url, page_type="global_archive", page_num=p) for p, url in chunk]
        results = await asyncio.gather(*futs)
        for (p, url), (items, audit, _) in zip(chunk, results):
            completed += 1
            for item in items:
                item["discoveryMethod"] = "archive"
            all_listings.extend(items)

        if progress_cb:
            progress_cb(completed, max_page, len(all_listings), time.time() - t0)

    # Retry any failed pages once more at the end of the pass
    if fetcher.failed_pages:
        failed_to_retry = list(fetcher.failed_pages)
        fetcher.failed_pages.clear()
        for f_entry in failed_to_retry:
            url = f_entry["url"]
            p = f_entry["page"]
            items, audit, _ = await fetcher.fetch_page(session, url, page_type="global_archive_retry", page_num=p)
            for item in items:
                item["discoveryMethod"] = "archive"
            all_listings.extend(items)

    return all_listings

async def crawl_category_surfaces(session, fetcher):
    """
    Crawl category and platform surfaces.
    """
    all_categories = {**PLATFORM_CATEGORIES, **ARCHIVE_CATEGORIES}
    cat_listings = []

    for slug, label in all_categories.items():
        url = f"{BASE_URL}category/{slug}/"
        items, _, html = await fetcher.fetch_page(session, url, page_type=f"category_{slug}", page_num=1)
        for it in items:
            it["categoryLabel"] = label
            it["categorySlug"] = slug
            it["discoveryMethod"] = "category"
        cat_listings.extend(items)

        # For platform categories, also check additional pages if present
        if slug in PLATFORM_CATEGORIES and html:
            soup = BeautifulSoup(html, "html.parser")
            pag = soup.find('ul', class_='pagination')
            max_p = 1
            if pag:
                for l in pag.find_all('a', class_='page-numbers'):
                    txt = l.get_text(strip=True)
                    if txt.isdigit():
                        max_p = max(max_p, int(txt))
            if max_p > 1:
                # Crawl extra platform pages up to 10
                for cp in range(2, min(max_p + 1, 10)):
                    cp_url = f"{BASE_URL}category/{slug}/page/{cp}/"
                    cp_items, _, _ = await fetcher.fetch_page(session, cp_url, page_type=f"category_{slug}", page_num=cp)
                    for it in cp_items:
                        it["categoryLabel"] = label
                        it["categorySlug"] = slug
                        it["discoveryMethod"] = "category"
                    cat_listings.extend(cp_items)

    return cat_listings
