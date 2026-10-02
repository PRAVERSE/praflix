import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
CACHE_DIR = os.path.join(DATA_DIR, "cache")
PAGE_CACHE_DIR = os.path.join(CACHE_DIR, "pages")
POSTER_DIR = os.path.join(BASE_DIR, "assets", "posters")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(PAGE_CACHE_DIR, exist_ok=True)
os.makedirs(POSTER_DIR, exist_ok=True)

BASE_URL = "https://new1.hdhub4u.free/"
CONCURRENCY = 15
REQUEST_TIMEOUT = 25
MAX_RETRIES = 4
BACKOFF_FACTOR = 1.5

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": BASE_URL
}

# Standard discovery categories
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

FALLBACK_POSTER = "assets/posters/fallback.svg"

# Target file paths
SOURCE_INVENTORY_JSON = os.path.join(DATA_DIR, "source-inventory.json")
MASTER_URL_INVENTORY_JSON = os.path.join(DATA_DIR, "master_url_inventory.json")
SOURCE_RECORDS_JSON = os.path.join(DATA_DIR, "source-records.json")
SOURCE_LEDGER_JSON = os.path.join(DATA_DIR, "source-ledger.json")
CATALOG_JSON = os.path.join(DATA_DIR, "catalog.json")
CATALOG_NORMALIZED_JSON = os.path.join(DATA_DIR, "catalog-normalized.json")
CATALOG_CSV = os.path.join(DATA_DIR, "catalog.csv")
CATALOG_DATA_JS = os.path.join(DATA_DIR, "catalog_data.js")
CRAWL_AUDIT_JSON = os.path.join(DATA_DIR, "crawl-audit.json")
RECONCILIATION_REPORT_JSON = os.path.join(DATA_DIR, "reconciliation-report.json")
RECONCILIATION_DISCREPANCY_REPORT_JSON = os.path.join(DATA_DIR, "reconciliation-discrepancy-report.json")
SOURCE_TO_PRAFLIX_MAP_JSON = os.path.join(DATA_DIR, "source-to-praflix-map.json")
MISSING_FROM_PRAFLIX_JSON = os.path.join(DATA_DIR, "missing-from-praflix.json")
SUSPECTED_BAD_MERGES_JSON = os.path.join(DATA_DIR, "suspected-bad-merges.json")
MISSING_RECORDS_JSON = os.path.join(DATA_DIR, "missing-records.json")
POSTER_AUDIT_JSON = os.path.join(DATA_DIR, "poster-audit.json")
SEARCH_AUDIT_JSON = os.path.join(DATA_DIR, "search-audit.json")
SYNC_STATE_JSON = os.path.join(DATA_DIR, "sync-state.json")

# External master title list reconciliation paths
EXTERNAL_TITLES_DATASET_TXT = os.path.join(DATA_DIR, "external_titles_dataset.txt")
EXTERNAL_MOVIE_RECONCILIATION_JSON = os.path.join(DATA_DIR, "external-movie-reconciliation.json")
EXTERNAL_RECONCILIATION_JSON = EXTERNAL_MOVIE_RECONCILIATION_JSON
EXTERNAL_MISSING_TITLES_JSON = os.path.join(DATA_DIR, "external-missing-titles.json")
EXTERNAL_MANUAL_REVIEW_JSON = os.path.join(DATA_DIR, "external-manual-review.json")
EXTERNAL_SOURCE_COVERAGE_JSON = os.path.join(DATA_DIR, "external-source-coverage.json")


