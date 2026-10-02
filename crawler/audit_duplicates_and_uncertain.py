import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import json
import re
from collections import Counter

with open('data/external-movie-reconciliation.json', 'r', encoding='utf-8') as f:
    recon = json.load(f)

with open('data/catalog.json', 'r', encoding='utf-8') as f:
    catalog = json.load(f)
cat_by_id = {c['id']: c for c in catalog}

dupes = [r for r in recon if r['status'] == 'POSSIBLE_DUPLICATE']
print(f'Total duplicates: {len(dupes)}')

# 1. Episode sightings (177)
episodes = [d for d in dupes if d['matchMethod'] == 'episode_sighting_of_series']
print(f'Episode sightings: {len(episodes)}')
ep_shows = Counter(e['matchedCanonicalTitle'] for e in episodes)
print('Episode sightings by show:', ep_shows)

# 2. Duplicate external entries (464)
ext_dupes = [d for d in dupes if d['matchMethod'] == 'duplicate_external_entry']
print(f'\nDuplicate external entries: {len(ext_dupes)}')

# Find the primary match for each duplicate
# A duplicate was flagged because an earlier entry in recon already matched that canonical ID
recon_by_canonical = {}
for r in recon:
    cid = r.get('matchedCanonicalId')
    if cid:
        recon_by_canonical.setdefault(cid, []).append(r)

# Check pairs/groups
duplicate_groups = {}
for cid, entries in recon_by_canonical.items():
    if len(entries) > 1:
        duplicate_groups[cid] = entries

print(f'Total canonical works with multiple external listings: {len(duplicate_groups)}')

# Let us verify if any of these multi-matches are actually DIFFERENT movies/works!
potential_issues = []
confirmed_duplicate_listings = []
confirmed_release_variants = []

for cid, entries in duplicate_groups.items():
    canon = cat_by_id.get(cid, {})
    canon_title = canon.get('displayTitle', '')
    canon_year = str(canon.get('year', ''))
    canon_type = canon.get('type', '')
    
    primary = entries[0]
    subsequent = entries[1:]
    
    for sub in subsequent:
        sub_raw = sub.get('rawTitle', '')
        sub_yr = str(sub.get('year', ''))
        sub_sec = sub.get('section', '')
        
        # Check if year is different by more than 1 year (e.g. remake)
        if sub_yr.isdigit() and canon_year.isdigit() and abs(int(sub_yr) - int(canon_year)) > 1:
            potential_issues.append({
                'canonicalId': cid,
                'canonicalTitle': canon_title,
                'canonicalYear': canon_year,
                'primaryEntry': primary['rawTitle'],
                'duplicateEntry': sub_raw,
                'duplicateYear': sub_yr,
                'reason': f'Year difference: {sub_yr} vs {canon_year}'
            })
        elif sub_sec == 'series' and canon_type == 'Movie':
            potential_issues.append({
                'canonicalId': cid,
                'canonicalTitle': canon_title,
                'primaryEntry': primary['rawTitle'],
                'duplicateEntry': sub_raw,
                'reason': 'Content type mismatch: Series mapped to Movie'
            })
        else:
            # Check if it is a release variant (480p, 720p, HDRip, Uncut, Dual Audio)
            if re.search(r'\b(480p|720p|1080p|2160p|4K|HDRip|WEB-DL|BluRay|HDTC|CAM|Dual Audio|Uncut|Extended|IMAX)\b', sub_raw, re.I):
                confirmed_release_variants.append({
                    'externalIndex': sub['externalIndex'],
                    'rawTitle': sub_raw,
                    'matchedCanonicalId': cid,
                    'matchedCanonicalTitle': canon_title,
                    'variantType': 'resolution_or_codec_release'
                })
            else:
                confirmed_duplicate_listings.append({
                    'externalIndex': sub['externalIndex'],
                    'rawTitle': sub_raw,
                    'matchedCanonicalId': cid,
                    'matchedCanonicalTitle': canon_title,
                    'primaryTitle': primary['rawTitle']
                })

print(f'\nBreakdown of the {len(potential_issues)} potential issues:')
issue_types = Counter()
non_bb_issues = []

for p in potential_issues:
    if 'bigg boss' in p['duplicateEntry'].lower():
        issue_types['Bigg Boss Season Episodes'] += 1
    else:
        issue_types['Other Titles'] += 1
        non_bb_issues.append(p)

print('Issue types:', issue_types)
print(f'\nAll {len(non_bb_issues)} non-Bigg Boss potential issues:')
for n in non_bb_issues:
    print(f"[{n.get('canonicalId')}] Ext: '{n.get('duplicateEntry')}' (yr {n.get('duplicateYear')}) -> Canon: '{n.get('canonicalTitle')}' (yr {n.get('canonicalYear')}) | Primary: '{n.get('primaryEntry')}' | Reason: {n.get('reason')}")
