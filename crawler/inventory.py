import re
import hashlib
import time
from .config import BASE_URL

def generate_source_id(url, raw_title=""):
    """
    Generate stable sourceId from detail URL slug or normalized identifier.
    Never uses just the title.
    """
    if url:
        # Extract slug from URL: e.g. https://new1.hdhub4u.free/the-paradise-2026/ -> the-paradise-2026
        slug = url.strip().rstrip("/").split("/")[-1]
        slug = re.sub(r'[^a-zA-Z0-9\-]', '', slug).strip('-').lower()
        if slug:
            return f"src-{slug}"
    # Fallback to MD5 of URL or composite
    source_key = f"{url}|{raw_title}"
    md5_hash = hashlib.md5(source_key.encode('utf-8')).hexdigest()[:12]
    return f"src-{md5_hash}"

class SourceInventoryBuilder:
    def __init__(self):
        # url -> listing record with sightings
        self.inventory = {}
        self.raw_listings = []

    def add_sighting(self, raw_item):
        """
        Record a discovered listing sighting from any surface.
        """
        self.raw_listings.append(raw_item)
        url = raw_item.get("sourceUrl") or ""
        if not url:
            return
            
        source_id = generate_source_id(url, raw_item.get("rawTitle", ""))
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        surface = raw_item.get("sourceArchive") or "global_archive"
        page = raw_item.get("sourceArchivePage") or 1
        method = raw_item.get("discoveryMethod") or "archive"
        raw_title = raw_item.get("rawTitle") or ""
        poster_url = raw_item.get("posterUrl")
        
        sighting = {
            "surface": surface,
            "page": page,
            "discoveredAt": timestamp,
            "discoveryMethod": method
        }

        if url not in self.inventory:
            self.inventory[url] = {
                "sourceId": source_id,
                "sourceUrl": url,
                "sourceArchiveUrl": f"{BASE_URL}page/{page}/" if surface == "global_archive" else f"{BASE_URL}category/{surface}/",
                "sourceArchivePage": page,
                "rawTitle": raw_title,
                "posterUrl": poster_url,
                "discoveredAt": timestamp,
                "discoveryMethod": method,
                "crawlStatus": "discovered",
                "sightings": [sighting]
            }
        else:
            entry = self.inventory[url]
            # Update rawTitle if previous was empty or shorter
            if raw_title and len(raw_title) > len(entry.get("rawTitle", "")):
                entry["rawTitle"] = raw_title
            # Update poster if previous was empty
            if poster_url and not entry.get("posterUrl"):
                entry["posterUrl"] = poster_url
            entry["sightings"].append(sighting)

    def get_all_records(self):
        return list(self.inventory.values())

    def get_all_raw_listings(self):
        return self.raw_listings

    def get_summary(self):
        total_unique = len(self.inventory)
        with_titles = sum(1 for item in self.inventory.values() if item.get("rawTitle"))
        with_posters = sum(1 for item in self.inventory.values() if item.get("posterUrl"))
        total_raw = len(self.raw_listings)
        duplicate_urls = sum(1 for item in self.inventory.values() if len(item.get("sightings", [])) > 1)
        duplicate_sightings = total_raw - total_unique

        return {
            "rawListings": total_raw,
            "uniqueSourceUrls": total_unique,
            "duplicateSourceUrls": duplicate_urls,
            "duplicateSightings": duplicate_sightings,
            "withRawTitles": with_titles,
            "withPosters": with_posters
        }

