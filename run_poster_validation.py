#!/usr/bin/env python3
"""
PRAFLIX — A PRAVERSE Company
Poster Validation & Asset Audit Engine

Usage:
    python run_poster_validation.py [--download-missing]
"""

import sys
import os
import argparse
import asyncio
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')

from crawler.config import CATALOG_JSON, POSTER_DIR, POSTER_AUDIT_JSON
from crawler.poster import audit_and_cache_posters

async def main(download_missing=False):
    print("=" * 65)
    print("PRAFLIX POSTER VALIDATION & ASSET AUDIT")
    print("A PRAVERSE Company")
    print("=" * 65)

    if not os.path.exists(CATALOG_JSON):
        print(f"Error: {CATALOG_JSON} not found. Run pipeline first.")
        sys.exit(1)

    with open(CATALOG_JSON, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    print(f"Auditing posters for {len(catalog):,} canonical catalog titles...")
    audit = await audit_and_cache_posters(catalog, concurrency=25, download_missing=download_missing)

    print("\n--------------------------------")
    print("POSTER AUDIT SUMMARY")
    print("--------------------------------")
    print(f"Total Titles Audited:     {audit['totalRecords']:,}")
    print(f"Verified Local Posters:   {audit['verified']:,} ({audit['verified']/audit['totalRecords']*100:.1f}%)")
    print(f"Procedural Fallbacks:     {audit['fallback']:,} ({audit['fallback']/audit['totalRecords']*100:.1f}%)")
    print(f"Failed Download Attempts: {audit['failed']:,}")
    print("--------------------------------")
    print(f"Saved audit report to: {POSTER_AUDIT_JSON}")
    print("=" * 65)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="PRAFLIX Poster Validation")
    parser.add_argument("--download-missing", action="store_true", help="Download missing remote posters")
    args = parser.parse_args()
    asyncio.run(main(args.download_missing))
