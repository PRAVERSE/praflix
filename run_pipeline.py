#!/usr/bin/env python3
"""
PRAFLIX — A PRAVERSE Company
Master Catalog Discovery, Normalization, & Reconciliation Engine

Usage:
    python run_pipeline.py                 # Full master pipeline with discovery & reconciliation
    python run_pipeline.py --skip-crawl    # Fast pipeline run on local inventory baseline
    python run_pipeline.py --download-posters # Also download missing remote poster files
"""

import sys
import os
import argparse
import asyncio

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')

from crawler.pipeline import run_praflix_master_pipeline

def main():
    parser = argparse.ArgumentParser(description="PRAFLIX Master Catalog Pipeline - A PRAVERSE Company")
    parser.add_argument("--skip-crawl", action="store_true", help="Skip remote page fetching and build from inventory baseline")
    parser.add_argument("--download-posters", action="store_true", help="Attempt remote download of missing poster images")
    
    args = parser.parse_args()
    
    asyncio.run(run_praflix_master_pipeline(
        skip_crawl=args.skip_crawl,
        download_posters=args.download_posters
    ))

if __name__ == '__main__':
    main()
