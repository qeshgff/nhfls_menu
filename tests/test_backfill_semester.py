import hashlib
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('backfill', ROOT / 'scripts/backfill_semester.py')
backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backfill)
import fetch_menu


def link(year, term, week, date, dept='中学部'):
    return f'<a href="/{year}/0901/c88a{week}/page.htm">{dept}{year}-{year+1}学年第二学期第{week}周食谱{date}</a>'.replace('第二学期', f'第{term}学期')


class BackfillTests(unittest.TestCase):
    def test_multiple_pages_stop_at_previous_semester(self):
        pages = {
            backfill.INDEX: link(2026, '一', 12, '2026.11.16-11.20') + '<a class="next" href="/mzsp/list2.htm">下一页</a>',
            'https://www.nhfls.com.cn/mzsp/list2.htm': link(2026, '一', 1, '2026.9.1-9.4') + link(2025, '二', 20, '2026.6.29-7.3').replace('学年', '') + '<a class="next" href="/mzsp/list3.htm">下一页</a>',
        }
        links, count = backfill.collect_links((2026, 1), pages.__getitem__)
        self.assertEqual(count, 2)
        self.assertEqual([item['start'] for item in links], ['2026-09-01', '2026-11-16'])

    def test_primary_school_not_imported(self):
        html = link(2026, '一', 12, '2026.11.16-11.20') + link(2026, '一', 11, '2026.11.9-11.13', '小学部')
        links, _ = backfill.collect_links((2026, 1), lambda url: html)
        self.assertEqual(len(links), 1)

    def test_repeated_pagination_rejected(self):
        html = link(2026, '一', 12, '2026.11.16-11.20') + '<a class="next" href="/mzsp/list.htm">下一页</a>'
        with self.assertRaises(ValueError):
            backfill.collect_links((2026, 1), lambda url: html)

    def test_reject_foreign_next_page(self):
        with self.assertRaises(ValueError):
            backfill.next_page('<a class="next" href="https://example.org/mzsp/list2.htm">下一页</a>', backfill.INDEX)

    def test_semester_key(self):
        self.assertEqual(backfill.semester_key('中学部2026-2027学年第一学期第第7周'), (2026, 1))
        self.assertEqual(backfill.semester_key('中学部2025—2026学年第二学期'), (2025, 2))
        self.assertIsNone(backfill.semester_key('中学部2026-2028学年第一学期'))

class ImageMenuTests(unittest.TestCase):
    def test_curated_image_requires_exact_source_and_hash(self):
        import json
        from unittest.mock import patch
        record = json.loads((ROOT / 'scripts/curated/2026-10-08.json').read_text())
        html = f'<img original-src="{record["imageUrl"]}">'
        class Digest:
            def hexdigest(self): return record['sha256']
        with patch.object(fetch_menu, 'read_image', return_value=b'official image'), patch.object(hashlib, 'sha256', return_value=Digest()):
            week = backfill.parse_or_curated(html, record['week']['source'], record['week']['title'])
            self.assertEqual(len(week['days']), 3)
            self.assertEqual(sum(len(v) for day in week['days'] for v in day['meals'].values()), 90)
        with patch.object(fetch_menu, 'read_image', return_value=b'changed image'):
            with self.assertRaisesRegex(ValueError, '图片已变化'):
                backfill.parse_or_curated(html, record['week']['source'], record['week']['title'])
        with self.assertRaisesRegex(ValueError, '来源与官网不一致'):
            backfill.parse_or_curated('<img src="/other.png">', record['week']['source'], record['week']['title'])
