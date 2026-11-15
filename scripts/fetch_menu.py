#!/usr/bin/env python3
"""Fetch public NHFLS middle-school menus. Python 3.10+, standard library only."""
from __future__ import annotations

import argparse
import datetime as dt
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
INDEX = 'https://www.nhfls.com.cn/mzsp/list.htm'
MEALS = {'早餐': 'breakfast', '中餐': 'lunch', '午餐': 'lunch', '晚餐': 'dinner'}
WEEKDAYS = {'一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '日': 6, '天': 6}


class Node:
    def __init__(self, tag='', attrs=()):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []

    def nodes(self, tag):
        for child in self.children:
            if isinstance(child, Node):
                if child.tag == tag:
                    yield child
                yield from child.nodes(tag)

    def text(self):
        return ''.join(child.text() if isinstance(child, Node) else child for child in self.children)


class Document(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        # Tolerate omitted cell/row end tags in older school CMS tables.
        if tag in {'td', 'th'} and self.stack[-1].tag in {'td', 'th'}:
            self.stack.pop()
        if tag == 'tr':
            while self.stack[-1].tag in {'td', 'th', 'tr'}:
                self.stack.pop()
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag == 'br':
            node.children.append(' ')
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def clean(value):
    return re.sub(r'\s+', ' ', value.replace('\xa0', ' ').replace('\u3000', ' ')).strip()


def compact(value):
    return re.sub(r'\s+', '', value)


def source_url(url):
    parts = urlsplit(url)
    if parts.scheme != 'https' or parts.hostname not in {'www.nhfls.com.cn', 'nhfls.com.cn'} or parts.username or parts.password or parts.port not in {None, 443}:
        raise ValueError(f'拒绝非学校官网 HTTPS 地址: {url}')
    return url


def download(url):
    source_url(url)
    error = None
    for attempt in range(3):
        try:
            request = Request(url, headers={'User-Agent': 'NHFLS-Menu/1.0 (public school menu archive)', 'Accept': 'text/html'})
            with urlopen(request, timeout=25) as response:
                source_url(response.url)
                raw = response.read(3_000_001)
                if len(raw) > 3_000_000:
                    raise ValueError('页面超过 3 MB，停止解析')
                encoding = response.headers.get_content_charset() or 'utf-8'
                return raw.decode(encoding)
        except (OSError, UnicodeError) as exc:
            error = exc
            if attempt < 2:
                time.sleep(attempt + 1)
    raise RuntimeError(f'学校官网访问失败，保留旧数据: {error}')


def period(title):
    text = compact(title)
    matches = list(re.finditer(r'(20\d{2})[.年/\-](\d{1,2})[.月/\-](\d{1,2})日?\s*[-—–~～至]\s*(?:(20\d{2})[.年/\-])?(\d{1,2})[.月/\-](\d{1,2})', text))
    if not matches:
        raise ValueError(f'无法识别食谱日期范围: {title}')
    y, m, d, y2, m2, d2 = matches[-1].groups()
    start = dt.date(int(y), int(m), int(d))
    end = dt.date(int(y2 or y), int(m2), int(d2))
    if not y2 and end < start and start.month == 12 and end.month == 1:
        end = end.replace(year=end.year + 1)
    if not 0 <= (end - start).days <= 6:
        raise ValueError('日期范围超过一周，停止更新')
    return start, end


def discover(html, base=INDEX):
    links = {}
    for anchor in Document(html).root.nodes('a'):
        title = clean(anchor.attrs.get('title') or anchor.text())
        if '中学部' not in title or '食谱' not in title:
            continue
        url = source_url(urljoin(base, anchor.attrs.get('href', '')))
        try:
            start, _ = period(title)
        except ValueError:
            continue
        links[url] = {'url': url, 'title': title, 'start': start.isoformat()}
    if not links:
        raise ValueError('官网列表中没有找到中学部食谱，保留旧数据')
    return sorted(links.values(), key=lambda item: item['start'], reverse=True)


def table_grid(table):
    grid = {}
    rows = list(table.nodes('tr'))
    if len(rows) > 500:
        raise ValueError('表格行数异常')
    for r, row in enumerate(rows):
        col = 0
        cells = [child for child in row.children if isinstance(child, Node) and child.tag in {'td', 'th'}]
        for cell in cells:
            while (r, col) in grid:
                col += 1
            rowspan = int(cell.attrs.get('rowspan', '1'))
            colspan = int(cell.attrs.get('colspan', '1'))
            if not 1 <= rowspan <= 100 or not 1 <= colspan <= 30 or col + colspan > 60:
                raise ValueError('表格合并单元格异常')
            for dr in range(rowspan):
                for dc in range(colspan):
                    key = r + dr, col + dc
                    if key in grid:
                        raise ValueError('表格合并单元格重叠')
                    grid[key] = clean(cell.text())
            col += colspan
    width = max((col for _, col in grid), default=-1) + 1
    return [[grid.get((r, c), '') for c in range(width)] for r in range(len(rows))]


def parse_menu(html, url, title=None):
    root = Document(html).root
    if not title:
        titles = [clean(node.text()) for tag in ['h1', 'h2', 'h3', 'title'] for node in root.nodes(tag)]
        title = next((t for t in titles if '中学部' in t and '食谱' in t), '')
    if '中学部' not in title or '食谱' not in title:
        raise ValueError('页面不是中学部食谱')
    start, end = period(title)
    days = {}
    for table in root.nodes('table'):
        # Ignore a layout table enclosing the actual menu table.
        if next(table.nodes('table'), None) is not None:
            continue
        grid = table_grid(table)
        columns = []
        for row in grid:
            cols, seen = [], set()
            for col, text in enumerate(row):
                match = re.fullmatch(r'(?:星期|周)([一二三四五六日天])', compact(text))
                if match and match.group(1) not in seen:
                    seen.add(match.group(1))
                    cols.append((col, WEEKDAYS[match.group(1)]))
            if cols:
                columns = cols
                break
        if not columns:
            continue
        if any(right[0] - left[0] != 2 for left, right in zip(columns, columns[1:])):
            raise ValueError('日期列跨度变化，无法可靠映射菜名和食材')
        valid_columns = []
        for col, weekday in columns:
            date = start + dt.timedelta(days=(weekday - start.weekday()) % 7)
            if date <= end:
                key = date.isoformat()
                days.setdefault(key, {'date': key, 'meals': {key: [] for key in MEALS.values()}})
                valid_columns.append((col, key))
        current_meal = None
        for row in grid:
            label = compact(row[0]) if row else ''
            if label in MEALS:
                current_meal = MEALS[label]
            elif label:
                current_meal = None
            meal = current_meal
            if not meal:
                continue
            for col, date in valid_columns:
                name = row[col] if col < len(row) else ''
                ingredients = row[col + 1] if col + 1 < len(row) else ''
                if not name:
                    continue
                if re.fullmatch(r'[\d.]+\s*(?:g|克|kg)', name, re.I):
                    raise ValueError('菜名列出现纯克重，列映射可能变化')
                days[date]['meals'][meal].append({'name': compact(name), 'ingredients': ingredients})
    expected = (end - start).days + 1
    if not days or len(days) != expected:
        raise ValueError('菜单日期列缺失，保留旧数据')
    for day in days.values():
        for meal, items in day['meals'].items():
            if len(items) < 2 or len(items) > 40:
                raise ValueError(f'{day["date"]} {meal} 菜品数异常，保留旧数据')
    number = re.search(r'第\s*(?:第\s*)?(\d+)\s*周', title)
    match = re.search(r'/(20\d{2})/(\d{2})(\d{2})/', url)
    published = '-'.join(match.groups()) if match else None
    return {'id': start.isoformat(), 'label': f'第{number.group(1)}周' if number else '每周菜单', 'title': title,
            'start': start.isoformat(), 'end': end.isoformat(), 'source': source_url(url),
            'publishedAt': published, 'days': sorted(days.values(), key=lambda day: day['date'])}


def save_weeks(path, weeks):
    old = json.loads(path.read_text('utf-8')) if path.exists() else {'schemaVersion': 1, 'weeks': []}
    if old.get('schemaVersion') != 1:
        raise ValueError('不支持的已有数据版本')
    merged = {week['id']: week for week in old['weeks']}
    merged.update({week['id']: week for week in weeks})
    new_weeks = sorted(merged.values(), key=lambda week: week['start'])
    if new_weeks == old['weeks']:
        print('菜单没有变化，无需提交。')
        return False
    output = {'schemaVersion': 1, 'school': '南京河西外国语学校', 'department': '中学部',
              'updatedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'weeks': new_weeks}
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.menu-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(output, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(f'已更新 {len(weeks)} 份菜单，累计 {len(new_weeks)} 周。')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', help='指定官网食谱详情页 HTTPS 地址')
    parser.add_argument('--html', type=Path, help='读取本地 HTML（同时指定 --url，用于离线验证）')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/data/menus.json')
    parser.add_argument('--max-weeks', type=int, default=4, help='检查列表中最近几周，默认 4')
    args = parser.parse_args()
    if args.html and not args.url:
        parser.error('--html 需要 --url')
    if not 1 <= args.max_weeks <= 12:
        parser.error('--max-weeks 必须在 1—12 之间')
    try:
        if args.url:
            url = source_url(args.url)
            html = args.html.read_text('utf-8') if args.html else download(url)
            weeks = [parse_menu(html, url)]
        else:
            links = discover(download(INDEX))[:args.max_weeks]
            # Parse every requested page before touching the last successful data file.
            weeks = [parse_menu(download(item['url']), item['url'], item['title']) for item in links]
        save_weeks(args.output, weeks)
    except (OSError, ValueError, RuntimeError) as exc:
        print(f'更新失败: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
