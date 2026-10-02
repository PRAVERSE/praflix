import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding='utf-8')

from crawler.parser import parse_listing_metadata

def test_samples():
    samples = [
        ('The Paradise (2026) HQ-HDTC [Hindi - Telugu] (LiNE) 1080p 720p & 480p Dual Audio [x264/HEVC] | Full Movie', 'https://new1.hdhub4u.free/the-paradise-2026-hindi-line-hdtc-full-movie/'),
        ('The Paradise (2026) HQ-HDTC [Tamil] (LiNE) 1080p 720p & 480p [x264/HEVC] | Full Movie', 'https://new1.hdhub4u.free/the-paradise-2026-tamil-line-hdtc-full-movie/'),
        ('Hunkkaar: The Roar (Season 1) DS4K WEB-DL [Hindi DD5.1] 4K 1080p 720p & 480p [x264/10Bit-HEVC] | Full Series', 'https://new1.hdhub4u.free/hunkkaar-the-roar-season-1-hindi-webrip-all-episodes/'),
        ('Habeebi (2026) DS4K WEB-DL [Hindi (DD5.1) & Tamil] 4K 1080p 720p & 480p Dual Audio [x264/10Bit-HEVC] | Full Movie', 'https://new1.hdhub4u.free/habeebi-2026-hindi-webrip-full-movie/'),
        ('MobLand (Season 2) WEB-DL [Hindi (2.0) & English] 4K 1080p 720p & 480p [x264/10Bit-HEVC] | Paramount+ Series | [EP-02 Added]', 'https://new1.hdhub4u.free/mobland-season-2-hindi-webrip-all-episodes/'),
        ('Bigg Boss (Season 20) WEB-DL [Hindi DD5.1] 1080p 720p & 480p', 'https://new1.hdhub4u.free/bigg-boss-season-20/'),
        ('Main Ladega (2024) WEB-DL [Hindi DD5.1] 1080p 720p & 480p [x264/HEVC] | Full Movie', 'https://new1.hdhub4u.free/main-ladega-2024-hindi-webrip-full-movie/'),
        ('Awarapan 2 (2026) WEB-DL [Hindi DD5.1] 1080p 720p & 480p [x264/HEVC] | Full Movie', 'https://new1.hdhub4u.free/awarapan-2-2026-hindi-webrip-full-movie/'),
        ('The Punisher (Season 1) Complete English WEB-DL 1080p', 'https://new1.hdhub4u.free/the-punisher-season-1/')
    ]

    for title, url in samples:
        res = parse_listing_metadata(title, source_url=url)
        print(f"Title: '{res['displayTitle']}' | Year: '{res['year']}' | Type: '{res['type']}' | Season: '{res['season']}'")
        print(f"  Qualities: {[q['label'] for q in res['qualities']]} | RelType: {res['releaseType']} | Ep: {res['episodeStatus']}")
        print(f"  Audio: {res['audioTracks']} | Langs: {res['languages']}\n")

if __name__ == '__main__':
    test_samples()
