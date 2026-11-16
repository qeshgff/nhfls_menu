#!/usr/bin/env python3
"""Import every published middle-school menu in one academic semester."""
import argparse
import datetime as dt
import json
import hashlib
from pathlib import Path
import re
import sys
import time
from urllib.request import Request, urlopen
from urllib.parse import urljoin, urlsplit

from fetch_menu import Document, INDEX, ROOT, clean, discover, download, parse_menu, period, save_weeks, source_url


def semester_key(title):
    match = re.search(r'(20\d{2})\s*[-—–]\s*(20\d{2})\s*(?:学年)?\s*第?\s*([一二12])\s*学期', title)
    if not match:
        return None
    first, second, term = match.groups()
    if int(second) != int(first) + 1:
        return None
    return int(first), 1 if term in {'一', '1'} else 2


def next_page(html, base):
    for anchor in Document(html).root.nodes('a'):
        marker = clean(anchor.text()) + ' ' + anchor.attrs.get('class', '') + ' ' + anchor.attrs.get('title', '')
        href = anchor.attrs.get('href', '')
        if ('下一页' in marker or re.search(r'\bnext\b', marker, re.I)) and href and not href.startswith(('#', 'javascript:')):
            url = source_url(urljoin(base, href))
            if re.fullmatch(r'/mzsp/list\d*\.htm', urlsplit(url).path):
                return url
    return None


def collect_links(target, fetch=download):
    links, visited = {}, set()
    url = INDEX
    while url:
        if url in visited or len(visited) >= 30:
            raise ValueError('目录分页重复或超过 30 页，无法确认学期完整性')
        visited.add(url)
        html = fetch(url)
        page_links = discover(html, url)
        for item in page_links:
            if semester_key(item['title']) == target:
                links[item['url']] = item
        # The official list is reverse chronological. Finish only after crossing
        # the semester boundary, or reaching its actual final page.
        keys = [semester_key(item['title']) for item in page_links]
        if any(key is not None and key < target for key in keys):
            return sorted(links.values(), key=lambda item: item['start']), len(visited)
        following = next_page(html, url)
        if not following:
            # A visible next-page control with no usable URL is not a final page.
            if '下一页' in Document(html).root.text() and re.search(r'(?:javascript:|href=[\"\']#)', html):
                raise ValueError('官网分页链接无法识别，停止导入以免遗漏')
            return sorted(links.values(), key=lambda item: item['start']), len(visited)
        url = following
        time.sleep(0.5)
    return [], len(visited)


_images = {}


def read_image(url):
    source_url(url)
    if url not in _images:
        with urlopen(Request(url, headers={'User-Agent': 'NHFLS-Menu/1.0'}), timeout=25) as response:
            source_url(response.url)
            raw = response.read(5_000_001)
        if len(raw) > 5_000_000:
            raise ValueError('菜谱图片超过 5 MB')
        _images[url] = raw
    return _images[url]


def parse_or_curated(html, url, title, curated_dir=ROOT / 'scripts/curated'):
    try:
        return parse_menu(html, url, title)
    except ValueError:
        start, end = period(title)
        path = curated_dir / f'{start.isoformat()}.json'
        if not path.exists():
            raise
        record = json.loads(path.read_text('utf-8'))
        week = record['week']
        sources = {urljoin(url, image.attrs.get('original-src') or image.attrs.get('src', ''))
                   for image in Document(html).root.nodes('img')}
        if record['imageUrl'] not in sources or week['source'] != url:
            raise ValueError('人工核对图片的来源与官网不一致')
        if hashlib.sha256(read_image(record['imageUrl'])).hexdigest() != record['sha256']:
            raise ValueError('官网菜谱图片已变化，需重新核对，保留旧数据')
        expected_dates = [(start + dt.timedelta(days=i)).isoformat() for i in range((end-start).days+1)]
        if week['start'] != str(start) or week['end'] != str(end) or [day['date'] for day in week['days']] != expected_dates:
            raise ValueError('人工核对菜单日期不一致')
        if any(not 2 <= len(day['meals'].get(meal, [])) <= 40 for day in week['days'] for meal in ['breakfast','lunch','dinner']):
            raise ValueError('人工核对菜单餐次不完整')
        return week


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--semester', required=True, help='例如 2026-2027-1')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/data/menus.json')
    parser.add_argument('--report', type=Path, default=ROOT / 'docs/data/import-report.json')
    parser.add_argument('--archive', type=Path, help='保留抓取的官网 HTML，供核对')
    args = parser.parse_args()
    match = re.fullmatch(r'(20\d{2})-(20\d{2})-([12])', args.semester)
    if not match or int(match[2]) != int(match[1]) + 1:
        parser.error('学期格式应为 2026-2027-1')
    report = {'semester': args.semester, 'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
              'catalogComplete': False, 'catalogPages': 0, 'discovered': [], 'imported': [], 'failed': []}

    def fetch(url):
        print(f'读取 {url}', flush=True)
        html = download(url)
        if args.archive:
            # A few official menus are images rather than HTML tables.
            # Keep their original pixels as well as the surrounding page.
            for image in Document(html).root.nodes('img'):
                src = image.attrs.get('original-src') or image.attrs.get('src', '')
                if not src.startswith('/_upload/article/images/'):
                    continue
                image_url = source_url(urljoin(url, src))
                raw = read_image(image_url)
                args.archive.mkdir(parents=True, exist_ok=True)
                (args.archive / Path(urlsplit(image_url).path).name).write_bytes(raw)
            args.archive.mkdir(parents=True, exist_ok=True)
            name = urlsplit(url).path.strip('/').replace('/', '_') + '.html'
            (args.archive / name).write_text(html, encoding='utf-8')
        return html

    try:
        links, pages = collect_links((int(match[1]), int(match[3])), fetch)
        if not links:
            raise ValueError('没有发现指定学期的中学部菜单')
        report.update(catalogComplete=True, catalogPages=pages, discovered=links)
        weeks = []
        for item in links:
            try:
                week = parse_or_curated(fetch(item['url']), item['url'], item['title'])
                weeks.append(week)
                report['imported'].append({'id': week['id'], 'label': week['label'], 'days': len(week['days']), 'source': week['source']})
                print(f"解析成功 {week['label']} {week['start']}—{week['end']}", flush=True)
            except (OSError, ValueError, RuntimeError) as exc:
                report['failed'].append({'url': item['url'], 'title': item['title'], 'error': str(exc)})
                print(f'解析失败 {item["url"]}: {exc}', file=sys.stderr, flush=True)
            time.sleep(0.5)
        if weeks:
            save_weeks(args.output, weeks)
    except (OSError, ValueError, RuntimeError) as exc:
        report['failed'].append({'url': INDEX, 'error': str(exc)})
        print(f'补录失败: {exc}', file=sys.stderr, flush=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report['failed'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
