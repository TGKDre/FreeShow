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
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "data", "loveworld-songs.json")

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

    kept = [section for section in sections if section["lines"]]
    if kept:
        return kept

    # pages for some renditions carry no Verse/Chorus labels at all; the lyric block is still there,
    # directly above the "Report an issue" row, so take what survives the navigation furniture
    noise = re.compile(r"^(home|songs|albums|listen|subscribe|search|log ?in|sign ?in|copy|share|download|loveworld|play|next|previous|report an issue|more from)", re.I)
    lines = [clean for raw in text.split("\n") if (clean := raw.replace("\u00a0", " ").strip())]
    stop = next((index for index, line in enumerate(lines) if re.match(r"^report an issue", line, re.I)), len(lines))
    body = [line for line in lines[:stop] if len(line) > 2 and not noise.match(line)]

    # the page repeats its own chrome before the words: the title, the download line, the assistant
    # buttons, and then a literal "Lyrics" heading. Everything above the last of those is not the song.
    chrome = re.compile(r"(lyrics ?& ?audio download|loveworld lyrics|^ask$|^lyrics ai$|^from loveworld)", re.I)
    body = [line for line in body if not chrome.match(line) or line.strip().lower() == "lyrics"]
    cut = max((index for index, line in enumerate(body) if line.strip().lower() == "lyrics"), default=-1)
    body = body[cut + 1:] if cut >= 0 else body

    return stanzas_from_html(html, text, noise) or group_stanzas(body)


def stanzas_from_html(html, text, noise):
    """The unlabelled pages do bunch the words: one <p class="whitespace-pre-line"> per stanza."""
    blocks = re.findall(r'<p class="whitespace-pre-line">(.*?)</p>', html, re.S)
    stanzas = []

    for block in blocks:
        plain = unescape(re.sub(r"<[^>]+>", "", block))
        lines = [part.strip() for part in re.split(r"\\n|\n", plain)]
        lines = [line for line in lines if len(line) > 1 and not noise.match(line)]
        if lines:
            stanzas.append(lines)

    if len(stanzas) < 2:
        return []

    # some pages put one line per paragraph, which leaves nothing to bunch: rebuild in fours
    if sorted(len(stanza) for stanza in stanzas)[len(stanzas) // 2] <= 1:
        flat_lines = [line for stanza in stanzas for line in stanza]
        stanzas = [flat_lines[i:i + 4] for i in range(0, len(flat_lines), 4)]

    counts = {}
    for stanza in stanzas:
        counts[" ".join(stanza).lower()] = counts.get(" ".join(stanza).lower(), 0) + 1

    sections, verses, choruses = [], 0, 0
    for stanza in stanzas:
        repeated = counts[" ".join(stanza).lower()] > 1

        if repeated:
            choruses += 1
            label = "Chorus" if choruses == 1 else f"Chorus {choruses}"
        else:
            verses += 1
            label = f"Verse {verses}"
        sections.append({"label": label, "lines": stanza})

    return sections


def group_stanzas(lines):
    """Label a flat lyric block the way a song is actually bunched.

    A stanza that comes back later is the chorus; the first appearance of each unrepeated stanza is a
    verse, in order. That reproduces the grouping Grace City already made by hand in ProPresenter
    without needing their binary files.
    """
    if len(lines) < 2:
        return [{"label": "Lyrics", "lines": lines}]

    # the page separates stanzas with <p> blocks; the flat list lost those, so rebuild on repetition:
    # walk forward and cut a stanza every time the next line has already appeared earlier in the song
    stanzas, current = [], []
    seen = set()
    for line in lines:
        key = re.sub(r"[^a-z0-9 ]", "", line.lower()).strip()
        if current and key in seen:
            stanzas.append(current)
            current = []
        current.append(line)
        seen.add(key)
    if current:
        stanzas.append(current)

    # a single long stanza means the cut found nothing useful; "bunch" it into four line blocks
    if len(stanzas) == 1 and len(lines) > 4:
        stanzas = [lines[i:i + 4] for i in range(0, len(lines), 4)]

    counts = {}
    for stanza in stanzas:
        key = " ".join(stanza).lower()
        counts[key] = counts.get(key, 0) + 1

    sections, verses, choruses = [], 0, 0
    for stanza in stanzas:
        key = " ".join(stanza).lower()
        if counts[key] > 1:
            choruses += 1
            label = "Chorus" if choruses == 1 else f"Chorus {choruses}"
        else:
            verses += 1
            label = f"Verse {verses}"
        sections.append({"label": label, "lines": stanza})

    return sections


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
