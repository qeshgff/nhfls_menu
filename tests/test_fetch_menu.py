import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fetch_menu', ROOT / 'scripts/fetch_menu.py')
fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch)
FIXTURE = (ROOT / 'tests/fixtures/reconstructed-week12.html').read_text('utf-8')
URL = 'https://www.nhfls.com.cn/2026/1113/c88a4916/page.htm'


class MenuParserTests(unittest.TestCase):
    def test_rowspan_colspan_and_all_days(self):
        week = fetch.parse_menu(FIXTURE, URL)
        self.assertEqual(week['start'], '2026-11-16')
        self.assertEqual(week['publishedAt'], '2026-11-13')
        self.assertEqual(len(week['days']), 5)
        self.assertEqual(sum(len(v) for d in week['days'] for v in d['meals'].values()), 155)
        self.assertEqual(week['days'][1]['meals']['lunch'][0]['name'], '椒盐羊排')
        self.assertEqual(week['days'][4]['meals']['dinner'][0]['name'], '茶树菇烧鸭')

    def test_missing_meal_is_rejected(self):
        with self.assertRaises(ValueError):
            fetch.parse_menu(FIXTURE.replace('晚餐', '未知餐'), URL)

    def test_last_breakfast_row_with_blank_meal_label(self):
        html = FIXTURE.replace('rowspan="11">早餐', 'rowspan="10">早餐', 1)
        marker = '<tr>\n<td><p>鲜牛奶/酸奶</p>'
        html = html.replace(marker, '<tr>\n<td></td>\n<td><p>鲜牛奶/酸奶</p>', 1)
        week = fetch.parse_menu(html, URL)
        self.assertEqual(week['days'][0]['meals']['breakfast'][-1]['name'], '鲜牛奶/酸奶')

    def test_missing_day_is_rejected(self):
        with self.assertRaises(ValueError):
            fetch.parse_menu(FIXTURE.replace('星期五', '未知列'), URL)

    def test_broken_column_mapping_is_rejected(self):
        with self.assertRaises(ValueError):
            fetch.parse_menu(FIXTURE.replace('鲜肉包', '100g'), URL)

    def test_discover_only_middle_school_and_sort_dates(self):
        html = '''<a href="/2026/1113/c88a4916/page.htm">中学部第12周食谱2026.11.16-11.20</a>
        <a href="/primary/page.htm">小学部第13周食谱2026.11.23-11.27</a>
        <a href="/older/page.htm">中学部第11周食谱2026.11.9-11.13</a>'''
        links = fetch.discover(html)
        self.assertEqual(len(links), 2)
        self.assertEqual(links[0]['start'], '2026-11-16')

    def test_reject_unexpected_source(self):
        for url in ['http://www.nhfls.com.cn/a', 'https://evil.example/a', 'https://www.nhfls.com.cn.evil.example/a']:
            with self.assertRaises(ValueError):
                fetch.source_url(url)

    def test_cross_year_period(self):
        start, end = fetch.period('中学部第18周食谱2026.12.28-1.1')
        self.assertEqual(str(start), '2026-12-28')
        self.assertEqual(str(end), '2027-01-01')

    def test_no_change_keeps_timestamp_and_bytes(self):
        week = fetch.parse_menu(FIXTURE, URL)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'menus.json'
            self.assertTrue(fetch.save_weeks(path, [week]))
            before = path.read_bytes()
            self.assertFalse(fetch.save_weeks(path, [week]))
            self.assertEqual(path.read_bytes(), before)
            updated = copy.deepcopy(week)
            updated['days'][0]['meals']['lunch'][0]['name'] = '官网更正菜名'
            self.assertTrue(fetch.save_weeks(path, [updated]))
            self.assertEqual(len(json.loads(path.read_text())['weeks']), 1)

    def test_bad_fetch_does_not_replace_existing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'menus.json'
            path.write_text('{"keep":"old data"}')
            with patch.object(fetch, 'download', return_value='<html>暂时无法访问</html>'), patch('sys.argv', ['fetch_menu.py', '--output', str(path)]):
                self.assertEqual(fetch.main(), 1)
            self.assertEqual(path.read_text(), '{"keep":"old data"}')

    def test_short_holiday_week_uses_actual_weekdays(self):
        html = FIXTURE.replace('2026.11.16-11.20', '2026.11.19-11.20')
        week = fetch.parse_menu(html, URL)
        self.assertEqual([d['date'] for d in week['days']], ['2026-11-19', '2026-11-20'])
        self.assertEqual(week['days'][0]['meals']['lunch'][0]['name'], '糖醋大虾')


if __name__ == '__main__':
    unittest.main()
