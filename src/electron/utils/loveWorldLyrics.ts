/**
 * LoveWorld Singers lyrics, read from loveworldlyrics.com.
 *
 * Grace City sings almost entirely from this catalogue, and no general lyrics service carries it, so
 * the site itself is the source of truth. Everything here is parsing and matching: nothing is bundled
 * or vendored, the text is fetched when the operator asks for it.
 */

export interface LoveWorldSongRef {
    slug: string
    title: string
    meta: string
    /** First sung line, so a song can be found by how it starts rather than by its title. */
    opening?: string
}

export interface LoveWorldSection {
    label: string
    lines: string[]
}

export interface LoveWorldSong extends LoveWorldSongRef {
    sections: LoveWorldSection[]
}

const SECTION_LABELS = ["verse", "chorus", "bridge", "pre-chorus", "pre chorus", "prechorus", "intro", "outro", "vamp", "hook", "tag", "refrain", "interlude", "instrumental", "turnaround", "chant", "response", "call", "solo"]

const ENTITIES: { [key: string]: string } = {
    "&amp;": "&",
    "&#x27;": "'",
    "&#39;": "'",
    "&apos;": "'",
    "&quot;": '"',
    "&#34;": '"',
    "&lt;": "<",
    "&gt;": ">",
    "&nbsp;": " "
}

export function decodeEntities(text: string): string {
    return text.replace(/&(?:amp|#x27|#39|apos|quot|#34|lt|gt|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
}

export function isSectionLabel(line: string): boolean {
    const clean = line.trim().toLowerCase().replace(/[0-9]/g, "").replace(/[:\-–—]/g, " ").replace(/\s+/g, " ").trim()
    if (!clean || clean.length > 24) return false
    return SECTION_LABELS.some((label) => clean === label || clean === label + " " || clean.startsWith(label + " "))
}

/** The A–Z index page: one anchor per song, title in the first inline block and album or lead in the second. */
export function parseIndex(html: string): LoveWorldSongRef[] {
    const songs: LoveWorldSongRef[] = []
    const seen = new Set<string>()
    const chunks = (html || "").split('href="/song/')

    for (const chunk of chunks.slice(1)) {
        const slug = chunk.slice(0, chunk.indexOf('"'))
        if (!slug || seen.has(slug)) continue

        const blocks = [...chunk.slice(0, 2000).matchAll(/<span class="inline-block">([\s\S]*?)<\/span>/g)].map((match) => decodeEntities(match[1].replace(/<[^>]+>/g, "")).trim())
        if (!blocks.length || !blocks[0]) continue

        seen.add(slug)
        songs.push({ slug, title: blocks[0], meta: blocks[1] || "" })
    }

    return songs
}

/** A song page, reduced to its tagged blocks. */
export function parseSections(html: string): LoveWorldSection[] {
    // block level tags become line breaks so verses stay distinguishable after the tags are gone
    const text = decodeEntities(
        (html || "")
            .replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi, " ")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(?:p|div|h[1-6]|li|span)>/gi, "\n")
            .replace(/<[^>]+>/g, "")
    )

    const lines = text
        .split("\n")
        .map((line) => line.replace(/\u00a0/g, " ").replace(/\s+$/g, "").replace(/^\s+/, ""))
        .filter((line) => line.length)

    const sections: LoveWorldSection[] = []
    let current: LoveWorldSection | null = null

    for (const line of lines) {
        // the page ends its lyrics with links out; nothing after these belongs to the song
        if (/^report an issue$/i.test(line) || /^more from /i.test(line) || /^download /i.test(line)) break

        if (isSectionLabel(line) && line.length <= 30) {
            current = { label: normalizeLabel(line), lines: [] }
            sections.push(current)
            continue
        }

        if (!current) continue
        current.lines.push(line)
    }

    return sections.filter((section) => section.lines.length)
}

export function normalizeLabel(label: string): string {
    return label
        .trim()
        .replace(/[:\-–—]+$/, "")
        .replace(/\s+/g, " ")
        .replace(/^./, (first) => first.toUpperCase())
}

export function parseSong(html: string, ref: { slug: string; title: string; meta?: string }): LoveWorldSong {
    const titleMatch = (html || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    const title = (titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, "")).trim() : ref.title).replace(/\s+lyrics$/i, "")

    return { slug: ref.slug, title: title || ref.title, meta: ref.meta || "", sections: parseSections(html) }
}

/**
 * One slide per section, blank line between sections, which is the shape the show converter splits on.
 * The label stays on the slide because a worship leader wants to see "Chorus" before singing it.
 */
export function songToShowText(song: LoveWorldSong): string {
    return song.sections
        .map((section) => [section.label, ...section.lines].join("\n"))
        .join("\n\n")
        .trim()
}

function normalize(text: string): string {
    return text
        .toLowerCase()
        .replace(/&#x27;|['’`]/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

/** Title and opening line matches, best first. A title hit always outranks a lyric hit. */
export function matchSongs(index: LoveWorldSongRef[], query: string, limit = 8): LoveWorldSongRef[] {
    const needle = normalize(query)
    if (!needle) return []

    const words = needle.split(" ")
    const scored = index
        .map((song) => {
            const title = normalize(song.title)
            if (!title) return { song, score: 0 }

            let score = 0
            if (title === needle) score = 100
            else if (title.startsWith(needle)) score = 80
            else if (title.includes(needle)) score = 65
            else if (words.every((word) => title.includes(word))) score = 45
            else {
                const hits = words.filter((word) => title.includes(word)).length
                score = hits ? Math.round((hits / words.length) * 30) : 0
            }

            // falling back to the opening line: "there was a big star" should find the song even
            // though nothing in the title says so, which is how a worship leader actually remembers it
            if (score < 45 && song.opening) {
                const opening = normalize(song.opening)
                if (opening.includes(needle)) score = Math.max(score, 42)
                else if (words.length > 1 && words.every((word) => opening.includes(word))) score = Math.max(score, 34)
            }

            // a shorter title is a closer match when scores tie, so "Holy" beats "Holy Are You Lord"
            return { song, score: score ? score - Math.min(3, title.length / 40) : 0 }
        })
        .filter((entry) => entry.score > 25)

    return scored
        .sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title))
        .slice(0, limit)
        .map((entry) => entry.song)
}
