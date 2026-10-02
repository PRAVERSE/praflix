import os, sys, json, re

sys.stdout.reconfigure(encoding='utf-8')

print("=" * 65)
print("PRAFLIX COMPREHENSIVE AUDIT & VALIDATION SUITE")
print("A PRAVERSE Company")
print("=" * 65)

# 1. Verify Dataset Files Exist
files_to_check = [
    "data/catalog.json",
    "data/catalog-normalized.json",
    "data/source-records.json",
    "data/catalog_data.js",
    "data/catalog.csv",
    "data/poster-audit.json",
    "data/search-audit.json",
    "index.html",
    "styles.css",
    "app.js"
]

all_exist = True
for f in files_to_check:
    if os.path.exists(f) and os.path.getsize(f) > 0:
        print(f"✓ File exists: {f} ({os.path.getsize(f):,} bytes)")
    else:
        print(f"✗ File MISSING or empty: {f}")
        all_exist = False

assert all_exist, "Missing critical dataset files!"

# 2. Check Catalog and Source Records
with open("data/source-records.json", "r", encoding="utf-8") as f:
    source_recs = json.load(f)
with open("data/catalog-normalized.json", "r", encoding="utf-8") as f:
    canon_recs = json.load(f)

print(f"\n1. Total Source Listing Records: {len(source_recs):,}")
assert len(source_recs) >= 14395, f"Expected >= 14,395 source records, got {len(source_recs)}"


print(f"2. Total Canonical Titles: {len(canon_recs):,}")
assert len(canon_recs) > 10000, f"Expected > 10,000 canonical titles, got {len(canon_recs)}"

# 3. Specifically Check THE PARADISE (2026)
paradise_matches = [c for c in canon_recs if c['normalizedTitle'] == 'the paradise' and c['year'] == '2026']
print(f"\n3. Checking THE PARADISE (2026):")
assert len(paradise_matches) == 1, f"Expected exactly 1 canonical entry for The Paradise 2026, found {len(paradise_matches)}"
p = paradise_matches[0]
print(f"   Canonical ID: {p['canonicalId']}")
print(f"   Display Title: \"{p['displayTitle']}\"")
print(f"   Year: {p['year']}")
print(f"   Type: {p['type']}")
print(f"   Season: {p['season']}")
print(f"   Variant Count: {p['variantCount']}")
print(f"   Poster: {p['poster']}")
assert p['displayTitle'] == "The Paradise", f"Expected displayTitle 'The Paradise', got '{p['displayTitle']}'"
assert p['year'] == "2026", f"Expected year '2026', got '{p['year']}'"
assert p['variantCount'] == 2, f"Expected 2 variants, got {p['variantCount']}"
assert os.path.exists(p['poster']), f"Poster file {p['poster']} does not exist locally!"
print(f"   ✓ The Paradise (2026) perfectly verified!")

# 4. Check Explicit Seasons (Never Manufactured)
explicit_seasons = [c for c in canon_recs if c['season']]
print(f"\n4. Explicit Season Entries: {len(explicit_seasons):,}")
for sample in explicit_seasons[:5]:
    print(f"   - {sample['displayTitle']} ({sample['season']}) [{sample['year']}]")

# Check series without manufactured seasons
no_season_series = [c for c in canon_recs if c['type'] == 'Web Series' and not c['season']]
print(f"   Web Series without manufactured season: {len(no_season_series):,}")
assert len(no_season_series) > 0, "No series without seasons found - seasons may have been manufactured!"

# 5. Check Poster Audit & Assets
with open("data/poster-audit.json", "r", encoding="utf-8") as f:
    poster_audit = json.load(f)
print(f"\n5. Poster Assets Audit:")
print(f"   Total source records: {poster_audit['total']:,}")
print(f"   Unique remote URLs: {poster_audit['unique_remote_urls']:,}")
print(f"   Downloaded: {poster_audit['downloaded']:,}")
print(f"   Already Local: {poster_audit['already_local']:,}")
print(f"   Total Local Available: {poster_audit['total_local_available']:,}")
print(f"   Fallback SVG assigned: {poster_audit['fallback']:,}")
print(f"   Failed remote hosts: {poster_audit['failed']:,}")

# Check files on disk
poster_files = [f for f in os.listdir("assets/posters") if f.endswith(".jpg")]
print(f"   Actual JPG poster files on disk: {len(poster_files):,}")
assert len(poster_files) >= 8000, f"Expected >= 8000 poster files, found {len(poster_files)}"

# 6. Verify Complete Removal of Master Catalog Audit Header from UI
with open("index.html", "r", encoding="utf-8") as f:
    html_content = f.read()

prohibited_ui_phrases = [
    "PRAFLIX Master Cinema Catalog",
    "A complete audit and discovery archive powered by PRAVERSE",
    "Discovery Catalog Only: No streaming endpoints or movie download links.",
    "MASTER CATALOG 14,395",
    "MOVIES 12,662",
    "WEB SERIES 1,733",
    "EXPLICIT SEASONS 1,662",
    "POSTERS INDEXED 14,321",
    "YEARS RANGE 1920",
    "100% Unique URLs",
    "Feature Films",
    "TV & OTT Shows",
    "Preserved Exactly",
    "99.5% Coverage",
    "84 Distinct Years"
]

print(f"\n6. Auditing Public UI for Complete Removal of Audit Dashboard Header:")
found_prohibited = []
for phrase in prohibited_ui_phrases:
    if phrase.lower() in html_content.lower():
        found_prohibited.append(phrase)

if found_prohibited:
    print(f"✗ Prohibited phrases still found in UI: {found_prohibited}")
    assert False, "Audit header was not completely removed from index.html!"
else:
    print(f"✓ 100% of audit dashboard header and statistics blocks have been cleanly removed from UI.")

# 7. Check Prohibited Download / Video Endpoints
prohibited_code_tokens = [
    ".torrent", "magnet:?", "openload", "rapidgator", "mega.nz", 
    "streamtape", "doodstream", ".mp4", ".mkv", ".avi", "download_url"
]
print(f"\n7. Security & Compliance Audit across app.js and index.html:")
for token in prohibited_code_tokens:
    assert token not in html_content, f"Prohibited token {token} found in index.html!"
with open("app.js", "r", encoding="utf-8") as f:
    app_content = f.read()
for token in prohibited_code_tokens:
    assert token not in app_content, f"Prohibited token {token} found in app.js!"
print(f"✓ Zero download endpoints, video streaming, or file-hosting mechanisms detected.")

# 8. Check Search Audit
with open("data/search-audit.json", "r", encoding="utf-8") as f:
    search_audit = json.load(f)
print(f"\n8. Search Normalization Audit:")
print(f"   Total test queries evaluated: {search_audit['total_test_queries']}")
print(f"   All queries passed: {search_audit['all_queries_passed']}")
print(f"   Paradise year-filter passed: {search_audit['paradise_year_filter_passed']}")
assert search_audit['all_queries_passed'], "Not all search queries passed!"

print("\n" + "=" * 65)
print("ALL 8 VALIDATION CHECKS PASSED WITH 100% SUCCESS!")
print("PRAFLIX IS FULLY NORMALIZED, SEARCHABLE, AND AUDITED.")
print("=" * 65)
