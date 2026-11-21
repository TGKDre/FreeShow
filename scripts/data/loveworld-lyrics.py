#!/usr/bin/env python3
"""
Build the bundled LoveWorld lyrics pack.

Reads the A-Z index at loveworldlyrics.com, then every song page, and writes one JSON file the app
ships with so all 1,500+ songs are searchable the moment it opens, with no network at service time.

Text and catalogue belong to LoveWorld Music Ministry (loveworldlyrics.com). This pack is for the
church's own build; the attribution travels inside the JSON and is shown in the app.
"""
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from html import unescape
from urllib.request import Request, urlopen

SITE = "https://loveworldlyrics.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "data", "loveworld-songs.json")

SECTION_RE = re.compile(
    r"^(verse|chorus|bridge|pre[- ]?chorus|intro|outro|vamp|hook|tag|refrain|interlude|instrumental|turnaround|chant|response|call|solo)\s*\d*\s*[:\-]?$",
    re.I,
)


def fetch(url: str, tries: int = 3) -> str:
    for attempt in range(tries):
        try:
            request = Request(url, headers={"User-Agent": UA})
            with urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8", "ignore")
        except Exception as error:  # noqa: BLE001 - retried, then reported
            if attempt == tries - 1:
                print(f"failed {url}: {error}", file=sys.stderr)
                return ""
            time.sleep(1.5 * (attempt + 1))
    return ""


def parse_index(html: str):
    songs, seen = [], set()
    for chunk in html.split('href="/song/')[1:]:
        slug = chunk.split('"', 1)[0]
        if not slug or slug in seen:
            continue
        blocks = re.findall(r'<span class="inline-block">(.*?)</span>', chunk[:2000], re.S)
        blocks = [re.sub(r"<[^>]+>", "", unescape(b)).strip() for b in blocks]
        if not blocks or not blocks[0]:
            continue
        seen.add(slug)
        songs.append({"slug": slug, "title": blocks[0], "meta": blocks[1] if len(blocks) > 1 else ""})
    return songs


def parse_song(html: str):
    text = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", html, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</(p|div|h[1-6]|li|span)>", "\n", text, flags=re.I)
    text = unescape(re.sub(r"<[^>]+>", "", text))

    sections, current = [], None
    for raw in text.split("\n"):
        line = raw.replace("\u00a0", " ").strip()
        if not line:
            continue
        if re.match(r"^(report an issue|more from |download )", line, re.I):
            break
        if SECTION_RE.match(line) and len(line) <= 30:
            label = line.rstrip(":-").strip()
            label = label[:1].upper() + label[1:]
            current = {"label": label, "lines": []}
            sections.append(current)
            continue
        if current is not None:
            current["lines"].append(line)

    return [section for section in sections if section["lines"]]


def main():
    index_html = fetch(f"{SITE}/songs")
    songs = parse_index(index_html)
    print(f"index: {len(songs)} songs", flush=True)
    if not songs:
        sys.exit("index returned nothing")

    def work(song):
        html = fetch(f"{SITE}/song/{song['slug']}")
        return {
            **song,
            "sections": parse_song(html) if html else [],
        }

    done = 0
    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(work, songs):
            results.append(result)
            done += 1
            if done % 100 == 0:
                print(f"{done}/{len(songs)}", flush=True)

    complete = [song for song in results if song["sections"]]
    pack = {
        "source": SITE,
        "attribution": "Lyrics and catalogue: LoveWorld Music Ministry, loveworldlyrics.com",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": len(complete),
        "songs": complete,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(pack, handle, ensure_ascii=False, separators=(",", ":"))

    print(f"wrote {OUT}: {len(complete)} songs with lyrics, {os.path.getsize(OUT) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
