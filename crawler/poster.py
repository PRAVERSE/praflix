import os
import re
import json
import time
import asyncio
import aiohttp
from .config import POSTER_DIR, FALLBACK_POSTER, POSTER_AUDIT_JSON

def is_valid_image(data):
    """
    Verify actual image bytes and headers.
    """
    if not data or len(data) < 500:
        return False
    # Check JPEG, PNG, WEBP signatures
    is_jpeg = data.startswith(b'\xff\xd8\xff')
    is_png = data.startswith(b'\x89PNG\r\n\x1a\n')
    is_webp = b'WEBP' in data[:20] and data.startswith(b'RIFF')
    return is_jpeg or is_png or is_webp

def verify_local_poster(fpath):
    """
    Check if a local poster file exists, has valid header and non-trivial size.
    """
    if not os.path.exists(fpath):
        return False
    size = os.path.getsize(fpath)
    if size < 500:
        return False
    try:
        with open(fpath, "rb") as f:
            header = f.read(32)
        return is_valid_image(header + b'\x00' * 500)
    except Exception:
        return False

async def audit_and_cache_posters(canonical_catalog, concurrency=25, download_missing=False):
    """
    Audit all posters in catalog, download missing ones if remote URL is available,
    validate local files, and assign fallback.svg for failed/missing ones.
    """
    total = len(canonical_catalog)
    verified = 0
    fallback = 0
    failed = 0
    missing_urls = []
    
    # 1. Inspect local assets
    local_files = set(os.listdir(POSTER_DIR)) if os.path.exists(POSTER_DIR) else set()
    
    needed_downloads = []
    
    for item in canonical_catalog:
        p_path = item.get("poster") or ""
        fname = os.path.basename(p_path)
        full_path = os.path.join(POSTER_DIR, fname) if fname else ""
        
        if fname and fname != "fallback.svg" and fname in local_files and verify_local_poster(full_path):
            item["poster"] = f"assets/posters/{fname}"
            verified += 1
        else:
            remote_url = item.get("sourcePosterUrl") or ""
            if download_missing and remote_url and remote_url.startswith("http"):
                needed_downloads.append((item, remote_url, fname))
            else:
                item["poster"] = FALLBACK_POSTER
                fallback += 1

    # 2. Asynchronously download missing images if requested
    if download_missing and needed_downloads:
        sem = asyncio.Semaphore(concurrency)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': 'https://new1.hdhub4u.free/'
        }
        timeout = aiohttp.ClientTimeout(total=15)
        conn = aiohttp.TCPConnector(ssl=False, limit=concurrency)
        
        async with aiohttp.ClientSession(connector=conn, headers=headers, timeout=timeout) as session:
            async def download_one(item, url, fname):
                nonlocal verified, fallback, failed
                if not fname or fname == "fallback.svg":
                    fname = f"poster-{item.get('canonicalId', 1)}.jpg"
                fpath = os.path.join(POSTER_DIR, fname)
                
                async with sem:
                    for attempt in range(3):
                        try:
                            async with session.get(url) as resp:
                                if resp.status == 200:
                                    data = await resp.read()
                                    if is_valid_image(data):
                                        with open(fpath, "wb") as f_out:
                                            f_out.write(data)
                                        item["poster"] = f"assets/posters/{fname}"
                                        verified += 1
                                        return
                        except Exception:
                            pass
                        await asyncio.sleep(1.0 * (attempt + 1))
                        
                # Failed
                item["poster"] = FALLBACK_POSTER
                failed += 1
                fallback += 1
                missing_urls.append(url)

            # Process in chunks
            chunk_size = 200
            for i in range(0, len(needed_downloads), chunk_size):
                chunk = needed_downloads[i:i + chunk_size]
                await asyncio.gather(*(download_one(item, u, f) for item, u, f in chunk))

    audit_report = {
        "total": total,
        "totalRecords": total,
        "unique_remote_urls": total,
        "downloaded": 0,
        "already_local": verified,
        "total_local_available": verified,
        "verified": verified,
        "fallback": fallback,
        "failed": failed,
        "missingUrlsSample": missing_urls[:50]
    }
    
    with open(POSTER_AUDIT_JSON, "w", encoding="utf-8") as f:
        json.dump(audit_report, f, indent=2)
        
    return audit_report
