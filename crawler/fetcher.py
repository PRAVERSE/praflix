import os
import hashlib
import time
import asyncio
import aiohttp
from .config import (
    BASE_URL, HEADERS, CONCURRENCY, REQUEST_TIMEOUT,
    MAX_RETRIES, BACKOFF_FACTOR, PAGE_CACHE_DIR, CRAWL_AUDIT_JSON
)
from .parser import parse_items_from_html

def get_cache_path(url):
    url_hash = hashlib.md5(url.encode('utf-8')).hexdigest()
    return os.path.join(PAGE_CACHE_DIR, f"{url_hash}.html")

class ResilientFetcher:
    def __init__(self, concurrency=CONCURRENCY, use_cache=True):
        self.concurrency = concurrency
        self.use_cache = use_cache
        self.sem = asyncio.Semaphore(concurrency)
        self.page_audit = []
        self.failed_pages = []

    async def fetch_page(self, session, url, page_type="archive", page_num=1):
        """
        Fetch HTML with disk caching, retry, exponential backoff, and accounting.
        """
        cache_path = get_cache_path(url)
        if self.use_cache and os.path.exists(cache_path) and os.path.getsize(cache_path) > 200:
            try:
                with open(cache_path, "r", encoding="utf-8", errors="replace") as f:
                    cached_html = f.read()
                items = parse_items_from_html(cached_html, page_type, page_num)
                audit_entry = {
                    "url": url,
                    "status": 200,
                    "type": page_type,
                    "page": page_num,
                    "listingsFound": len(items),
                    "fromCache": True,
                    "error": None,
                    "responseTime": 0.0,
                    "retries": 0
                }
                self.page_audit.append(audit_entry)
                return items, audit_entry, cached_html
            except Exception:
                pass

        t0 = time.time()
        last_error = None
        retries = 0

        for attempt in range(MAX_RETRIES):
            async with self.sem:
                try:
                    timeout = aiohttp.ClientTimeout(total=REQUEST_TIMEOUT)
                    async with session.get(url, headers=HEADERS, timeout=timeout, ssl=False) as resp:
                        resp_time = round(time.time() - t0, 3)
                        if resp.status == 200:
                            html = await resp.text(encoding="utf-8", errors="replace")
                            items = parse_items_from_html(html, page_type, page_num)
                            
                            # Cache to disk
                            if self.use_cache and len(html) > 500:
                                try:
                                    with open(cache_path, "w", encoding="utf-8") as f:
                                        f.write(html)
                                except Exception:
                                    pass

                            audit_entry = {
                                "url": url,
                                "status": 200,
                                "type": page_type,
                                "page": page_num,
                                "listingsFound": len(items),
                                "fromCache": False,
                                "error": None,
                                "responseTime": resp_time,
                                "retries": attempt
                            }
                            self.page_audit.append(audit_entry)
                            return items, audit_entry, html
                        elif resp.status == 404:
                            audit_entry = {
                                "url": url,
                                "status": 404,
                                "type": page_type,
                                "page": page_num,
                                "listingsFound": 0,
                                "fromCache": False,
                                "error": "Not Found (404)",
                                "responseTime": resp_time,
                                "retries": attempt
                            }
                            self.page_audit.append(audit_entry)
                            return [], audit_entry, None
                        else:
                            last_error = f"HTTP {resp.status}"
                            retries = attempt + 1
                except Exception as e:
                    last_error = str(e)
                    retries = attempt + 1

            # Exponential backoff
            await asyncio.sleep(BACKOFF_FACTOR * (attempt + 1))

        # If all retries failed
        resp_time = round(time.time() - t0, 3)
        fail_entry = {
            "url": url,
            "status": 0,
            "type": page_type,
            "page": page_num,
            "listingsFound": 0,
            "fromCache": False,
            "error": last_error,
            "responseTime": resp_time,
            "retries": retries
        }
        self.page_audit.append(fail_entry)
        self.failed_pages.append(fail_entry)
        return [], fail_entry, None

    def generate_crawl_audit_summary(self):
        total_attempted = len(self.page_audit)
        successful = sum(1 for e in self.page_audit if e["status"] == 200)
        failed = sum(1 for e in self.page_audit if e["status"] != 200)
        empty = sum(1 for e in self.page_audit if e["status"] == 200 and e["listingsFound"] == 0)
        from_cache = sum(1 for e in self.page_audit if e.get("fromCache"))
        total_listings = sum(e["listingsFound"] for e in self.page_audit)

        archive_attempted = sum(1 for e in self.page_audit if "archive" in e.get("type", ""))
        archive_successful = sum(1 for e in self.page_audit if "archive" in e.get("type", "") and e["status"] == 200)
        archive_failed = sum(1 for e in self.page_audit if "archive" in e.get("type", "") and e["status"] != 200)

        category_pages = sum(1 for e in self.page_audit if str(e.get("type", "")).startswith("category"))
        sitemap_pages = sum(1 for e in self.page_audit if "sitemap" in str(e.get("type", "")))

        return {
            "pagesAttempted": total_attempted,
            "pagesSuccessful": successful,
            "pagesFailed": failed,
            "pagesEmpty": empty,
            "pagesFromCache": from_cache,
            "archivePagesCrawled": archive_successful,
            "archivePagesFailed": archive_failed,
            "categoryPagesCrawled": category_pages,
            "sitemapPagesCrawled": sitemap_pages,
            "listingsDiscovered": total_listings,
            "failedEntries": self.failed_pages
        }

