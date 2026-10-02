import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import json
import re
from collections import Counter
from crawler.normalizer import normalize_text, clean_display_title

def to_alpha(s):
    return re.sub(r'[^a-z0-9]', '', str(s).lower())

with open('data/catalog.json', 'r', encoding='utf-8') as f:
    catalog = json.load(f)

with open('data/source-records.json', 'r', encoding='utf-8') as f:
    source_records = json.load(f)

with open('data/source-to-praflix-map.json', 'r', encoding='utf-8') as f:
    source_to_praflix = json.load(f)

s_to_c = {}
if isinstance(source_to_praflix, list):
    for entry in source_to_praflix:
        s_to_c[entry.get('sourceRecordId')] = entry.get('canonicalId')
elif isinstance(source_to_praflix, dict):
    for k, v in source_to_praflix.items():
        s_to_c[k] = v.get('canonicalId') if isinstance(v, dict) else v

cat_by_id = {c['id']: c for c in catalog}

# Build strict indices
# 1. Exact match index: (norm_title, year, type) -> c
exact_movie_idx = {}
exact_series_idx = {} # (norm_title, season) -> c

# Also alpha index
alpha_movie_idx = {}
alpha_series_idx = {}

for c in catalog:
    cid = c['id']
    c_type = c.get('type')
    dt = c.get('displayTitle', '')
    cdt = clean_display_title(dt)
    yr = str(c.get('year') or '').strip()
    sn = c.get('season')
    
    # Extract season int if present
    sn_int = None
    if sn:
        m = re.search(r'\b(?:Season|Series)\s*(\d+)\b', str(sn), re.I)
        if m:
            sn_int = int(m.group(1))
        elif str(sn).isdigit():
            sn_int = int(sn)

    nt_dt = normalize_text(dt)
    nt_cdt = normalize_text(cdt)
    alpha_dt = to_alpha(dt)
    alpha_cdt = to_alpha(cdt)

    if c_type == 'Movie':
        if yr:
            exact_movie_idx.setdefault((nt_dt, yr), []).append(c)
            if nt_cdt != nt_dt:
                exact_movie_idx.setdefault((nt_cdt, yr), []).append(c)
            alpha_movie_idx.setdefault((alpha_dt, yr), []).append(c)
            if alpha_cdt != alpha_dt:
                alpha_movie_idx.setdefault((alpha_cdt, yr), []).append(c)
    else: # Web Series
        if sn_int is not None:
            exact_series_idx.setdefault((nt_dt, sn_int), []).append(c)
            if nt_cdt != nt_dt:
                exact_series_idx.setdefault((nt_cdt, sn_int), []).append(c)
            alpha_series_idx.setdefault((alpha_dt, sn_int), []).append(c)
            if alpha_cdt != alpha_dt:
                alpha_series_idx.setdefault((alpha_cdt, sn_int), []).append(c)

print(f'Indexed {len(exact_movie_idx)} exact movie keys, {len(exact_series_idx)} exact series keys.')
