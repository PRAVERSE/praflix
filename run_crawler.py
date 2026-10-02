#!/usr/bin/env python3
"""
PRAFLIX — A PRAVERSE Company
Source Discovery & Crawl Engine

Usage:
    python run_crawler.py                  # Full dynamic discovery & crawl
    python run_crawler.py --max-pages 50   # Crawl up to N archive pages for testing
"""

import sys
import os
import argparse
import asyncio
import aiohttp
import json
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')

from crawler.config import BASE_URL, CONCURRENCY, SOURCE_INVENTORY_JSON, CRAWL_AUDIT_JSON
from crawler.discovery import discover_max_archive_page, crawl_all_archive_pages, crawl_category_surfaces, discover_sitemap_urls
from crawler.fetcher import ResilientFetcher
from crawler.inventory import SourceInventoryBuilder

async def run_crawler(max_pages_limit=None):
    print("=" * 65)
    print("PRAFLIX SOURCE CRAWLER & DISCOVERY ENGINE")
    print("A PRAVERSE Company")
    print("=" * 65)

    t0 = time.time()
    fetcher = ResilientFetcher(concurrency=CONCURRENCY, use_cache=True)
    inventory_builder = SourceInventoryBuilder()

    connector = aiohttp.TCPConnector(limit=CONCURRENCY + 5, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        # Step 1: Dynamic Page Discovery
        print("\n--- 1. Discovering Current Archive Pages ---")
        max_page = await discover_max_archive_page(session, fetcher)
        print(f"Dynamically discovered final archive page: {max_page}")

        target_pages = min(max_page, max_pages_limit) if max_pages_limit else max_page
        print(f"\n--- 2. Crawling Global Archive Pages (1 to {target_pages}) ---")
        
        def on_prog(done, total, count, dt):
            if done % 100 == 0 or done == total:
                print(f"  Progress: {done}/{total} pages ({done/total*100:.1f}%) in {dt:.1f}s - {count:,} listings discovered")

        listings = await crawl_all_archive_pages(session, fetcher, target_pages, progress_cb=on_prog)
        for item in listings:
            inventory_builder.add_sighting(item)
        print(f"Total listings extracted from global archive: {len(listings):,}")

        # Step 3: Crawl Category Surfaces
        print("\n--- 3. Auditing Categories & Platforms ---")
        cat_listings = await crawl_category_surfaces(session, fetcher)
        for item in cat_listings:
            inventory_builder.add_sighting(item)
        print(f"Total listings extracted from categories: {len(cat_listings):,}")

        # Step 4: Sitemaps
        print("\n--- 4. Auditing Post Sitemaps ---")
        sitemap_entries = await discover_sitemap_urls(session, fetcher)
        for item in sitemap_entries:
            inventory_builder.add_sighting(item)
        print(f"Total listings extracted from sitemaps: {len(sitemap_entries):,}")

    # Step 5: Baseline Cross-Referencing & Zero Data Loss Preservation
    print("\n--- 5. Inventory Cross-Referencing & Baseline Preservation ---")
    if os.path.exists("data/master_url_inventory.backup.json"):
        with open("data/master_url_inventory.backup.json", "r", encoding="utf-8") as f:
            prev = json.load(f)
            prev_added = 0
            for u, d in prev.items():
                if u not in inventory_builder.inventory:
                    title = d.get("titles", [""])[0] if d.get("titles") else ""
                    poster = d.get("posters", [None])[0] if d.get("posters") else None
                    inventory_builder.add_sighting({
                        "sourceUrl": u,
                        "rawTitle": title,
                        "posterUrl": poster,
                        "sourceArchive": d.get("source_archives", ["archive"])[0],
                        "sourceArchivePage": d.get("page_num", 1),
                        "discoveryMethod": "historical_baseline"
                    })
                    prev_added += 1
            if prev_added > 0:
                print(f"Preserved {prev_added:,} historical baseline listings not currently in active crawl.")

    # Save Crawl Audit
    audit_summary = fetcher.generate_crawl_audit_summary()
    audit_summary["crawlDurationSeconds"] = round(time.time() - t0, 2)
    audit_summary["archivePagesDiscovered"] = max_page
    inv_summary = inventory_builder.get_summary()
    audit_summary["rawListings"] = inv_summary["rawListings"]
    audit_summary["uniqueSourceUrls"] = inv_summary["uniqueSourceUrls"]
    audit_summary["duplicateSourceUrls"] = inv_summary["duplicateSourceUrls"]
    audit_summary["duplicateSightings"] = inv_summary["duplicateSightings"]

    with open(CRAWL_AUDIT_JSON, "w", encoding="utf-8") as f:
        json.dump(audit_summary, f, indent=2)
    print(f"\nSaved Crawl Audit to: {CRAWL_AUDIT_JSON}")

    # Save Master Source Inventory
    all_records = inventory_builder.get_all_records()
    with open(SOURCE_INVENTORY_JSON, "w", encoding="utf-8") as f:
        json.dump(all_records, f, indent=2, ensure_ascii=False)
    print(f"Saved Master Source Inventory ({len(all_records):,} unique listings) to: {SOURCE_INVENTORY_JSON}")

    print("\nSOURCE CRAWL AUDIT:")
    print(f"  Pages Discovered:    {max_page}")
    print(f"  Archive Pages:       {audit_summary.get('archivePagesCrawled')}")
    print(f"  Category Pages:      {audit_summary.get('categoryPagesCrawled')}")
    print(f"  Sitemap Pages:       {audit_summary.get('sitemapPagesCrawled')}")
    print(f"  Raw Listings:        {inv_summary['rawListings']:,}")
    print(f"  Unique Source URLs:  {inv_summary['uniqueSourceUrls']:,}")
    print(f"  Duplicate URLs:      {inv_summary['duplicateSourceUrls']:,}")
    print(f"  Completed in:        {audit_summary['crawlDurationSeconds']}s")
    print("=" * 65)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="PRAFLIX Source Discovery & Crawler")
    parser.add_argument("--max-pages", type=int, default=None, help="Limit archive pages to crawl")
    args = parser.parse_args()
    asyncio.run(run_crawler(args.max_pages))
