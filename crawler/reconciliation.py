import json
from .normalizer import normalize_text

REASON_CODES = {
    "NOT_CRAWLED": "Archive page was never fetched or failed network request",
    "EXTRACTION_FAILED": "Listing element could not be parsed from source HTML",
    "NORMALIZATION_FAILED": "Title normalization failed or produced empty title",
    "DUPLICATE": "Identical listing already imported under canonical record",
    "VARIANT_GROUPED": "Grouped as an edition or release variant under a canonical title",
    "AMBIGUOUS_MATCH": "Multiple possible matches or title sequel conflict requiring review",
    "INVALID_SOURCE_RECORD": "Source record lacked valid detail URL or title metadata",
    "POSTER_FAILURE": "Broken poster causing rendering exclusion",
    "UI_FILTERED": "Imported in database but hidden by frontend year or category filtering",
    "SEARCH_INDEX_FAILURE": "Imported in database but missing from search tokens",
    "IMPORT_FAILURE": "Record encountered an unhandled exception during pipeline execution",
    "UNKNOWN": "Unexplained absence requiring manual verification"
}

class ReconciliationEngine:
    def __init__(self, source_inventory, canonical_catalog):
        """
        source_inventory: list or dict of raw source listings
        canonical_catalog: list of canonical records in PRAFLIX master catalog
        """
        if isinstance(source_inventory, dict):
            self.source_inventory = list(source_inventory.values())
        else:
            self.source_inventory = source_inventory
            
        self.canonical_catalog = canonical_catalog
        
        # Build indexes for fast and reliable lookup
        self.canonical_urls = set()
        self.variant_urls = set()
        self.canonical_by_title_year = {}
        self.canonical_by_source_id = {}
        
        for can in self.canonical_catalog:
            # Check variants
            for v in can.get("variants", []):
                v_url = v.get("sourceUrl")
                if v_url:
                    self.variant_urls.add(v_url)
                v_sid = v.get("sourceId")
                if v_sid:
                    self.canonical_by_source_id[v_sid] = can
                    
            # Title + Year index
            norm_title = can.get("normalizedTitle") or normalize_text(can.get("displayTitle", ""))
            yr = str(can.get("year") or "").strip()
            self.canonical_by_title_year[(norm_title, yr)] = can

    def reconcile(self):
        """
        Compare SOURCE INVENTORY against PRAFLIX MASTER CATALOG.
        Returns:
            report: summary metrics dictionary
            missing_records: list of missing records with explicit reason codes
        """
        matched_count = 0
        grouped_variants_count = 0
        duplicate_count = 0
        ambiguous_count = 0
        missing_count = 0
        failed_count = 0
        
        missing_records = []
        matched_records = []
        
        for src in self.source_inventory:
            url = src.get("sourceUrl", "")
            raw_title = src.get("rawTitle", "")
            page = src.get("sourceArchivePage", 1)
            discovered_from = src.get("discoveryMethod", "archive")
            
            # Check 1: Empty or invalid URL
            if not url or not url.startswith("http"):
                missing_records.append({
                    "sourceUrl": url,
                    "rawTitle": raw_title,
                    "reason": "INVALID_SOURCE_RECORD",
                    "reasonDescription": REASON_CODES["INVALID_SOURCE_RECORD"],
                    "discoveredFrom": discovered_from,
                    "page": page
                })
                failed_count += 1
                continue

            # Check 2: Matched as variant or primary canonical
            if url in self.variant_urls:
                matched_count += 1
                matched_records.append({
                    "sourceUrl": url,
                    "rawTitle": raw_title,
                    "status": "MATCHED_VARIANT",
                    "page": page
                })
                continue
                
            # Check 3: Check by normalized title and year
            norm_title = normalize_text(raw_title)
            # Try to match in canonical map
            found_canon = None
            for (c_title, c_yr), c_rec in self.canonical_by_title_year.items():
                if c_title in norm_title or norm_title in c_title:
                    found_canon = c_rec
                    break
                    
            if found_canon:
                # Grouped variant or duplicate
                grouped_variants_count += 1
                matched_records.append({
                    "sourceUrl": url,
                    "rawTitle": raw_title,
                    "status": "GROUPED_UNDER_CANONICAL",
                    "canonicalId": found_canon.get("canonicalId"),
                    "canonicalTitle": found_canon.get("displayTitle"),
                    "page": page
                })
            else:
                # If truly absent from canonical records
                missing_count += 1
                missing_records.append({
                    "sourceUrl": url,
                    "rawTitle": raw_title,
                    "reason": "NOT_CRAWLED" if not raw_title else "EXTRACTION_FAILED",
                    "reasonDescription": REASON_CODES["NOT_CRAWLED" if not raw_title else "EXTRACTION_FAILED"],
                    "discoveredFrom": discovered_from,
                    "page": page
                })

        report = {
            "sourceListings": len(self.source_inventory),
            "canonicalRecords": len(self.canonical_catalog),
            "matched": matched_count,
            "duplicates": duplicate_count,
            "groupedVariants": grouped_variants_count,
            "missing": missing_count,
            "ambiguous": ambiguous_count,
            "failed": failed_count
        }

        return report, missing_records, matched_records
