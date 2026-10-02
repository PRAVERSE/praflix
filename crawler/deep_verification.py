import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import json
import re

with open('data/catalog.json', 'r', encoding='utf-8') as f:
    catalog = json.load(f)

with open('data/source-records.json', 'r', encoding='utf-8') as f:
    source_records = json.load(f)

results = {
    'narnia': [],
    'dangerous': [],
    'double_trouble': [],
    'dream': [],
    'iifa': [],
    'romeo': [],
    'skyfire': [],
    'trapped': [],
    'vikings': []
}

for c in catalog:
    nt = c.get('normalizedTitle', '')
    if 'narnia' in nt or 'caspian' in nt or 'treader' in nt:
        results['narnia'].append({'id': c['id'], 'displayTitle': c.get('displayTitle'), 'year': c.get('year'), 'type': c.get('type')})
    if nt == 'dangerous':
        results['dangerous'].append({'id': c['id'], 'displayTitle': c.get('displayTitle'), 'year': c.get('year'), 'type': c.get('type'), 'season': c.get('season')})
    if 'double trouble' in nt:
        results['double_trouble'].append({'id': c['id'], 'displayTitle': c.get('displayTitle'), 'year': c.get('year'), 'type': c.get('type'), 'season': c.get('season')})
    if nt == 'dream':
        results['dream'].append({'id': c['id'], 'displayTitle': c.get('displayTitle'), 'year': c.get('year'), 'type': c.get('type')})
    if 'iifa' in nt:
        results['iifa'].append({'id': c['id'], 'displayTitle': c.get('displayTitle'), 'year': c.get('year')})
    if 'romeo' in nt:
        results['romeo'].append({'id': c['id'], 'displayTitle': c.get('displayTitle'), 'year': c.get('year'), 'type': c.get('type'), 'season': c.get('season')})
    if 'skyfire' in nt:
        results['skyfire'].append({'id': c['id'], 'displayTitle': c.get('displayTitle'), 'year': c.get('year'), 'type': c.get('type'), 'season': c.get('season')})
    if nt == 'trapped':
        results['trapped'].append({'id': c['id'], 'displayTitle': c.get('displayTitle'), 'year': c.get('year'), 'type': c.get('type')})
    if 'vikings' in nt:
        results['vikings'].append({'id': c['id'], 'displayTitle': c.get('displayTitle'), 'year': c.get('year'), 'type': c.get('type'), 'season': c.get('season')})

with open('data/deep_verification_out.json', 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print('Saved deep verification results to data/deep_verification_out.json')
