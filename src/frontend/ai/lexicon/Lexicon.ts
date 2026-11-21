import type { LexiconEntry, LexiconFile, LexiconLanguage } from "../../../../types/ai/Lexicon"

/**
 * Greek and Hebrew word study, from Strong's.
 *
 * The data is the Open Scriptures JSON transcription of Strong's dictionaries (Greek 5,523 entries,
 * Hebrew 8,674), shipped as two files under public/lexicon. Definitions are historical lexicography
 * and carry the CC-BY-SA attribution stored inside each file.
 */

const STRONGS_PATTERN = /^([GH])?\s*0*(\d{1,5})$/i

/** "g3875" | "3875" | "G3875" -> canonical strongs id when the language is known or implied. */
export function normalizeStrongs(input: string, fallbackLanguage?: LexiconLanguage): string | null {
    const match = (input || "").trim().match(STRONGS_PATTERN)
    if (!match) return null

    let prefix = match[1]?.toUpperCase()
    if (!prefix) {
        if (!fallbackLanguage) return null
        prefix = fallbackLanguage === "greek" ? "G" : "H"
    }
    const number = Number(match[2])
    if (!number) return null
    return `${prefix}${number}`
}

/** Fold accents and case so "theos" finds "theós" and "ruwach" finds "rûwach". */
export function fold(text: string): string {
    return (text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[ʼ'’`]/g, "")
        .toLowerCase()
        .trim()
}

export function toEntry(file: LexiconFile, strongs: string): LexiconEntry | null {
    const raw = file.entries[strongs]
    if (!raw) return null
    return { strongs, language: file.language, ...raw }
}

/**
 * Search by Strong's number, then transliteration, then lemma, then English definition.
 *
 * The order matters in practice: an operator typing "26" wants G26, and one typing "agape" wants
 * agápē long before any definition that happens to contain the word.
 */
export function searchLexicon(file: LexiconFile, query: string, limit = 20): LexiconEntry[] {
    const trimmed = (query || "").trim()
    if (!trimmed) return []

    const byStrongs = normalizeStrongs(trimmed, file.language)
    const exact = byStrongs ? toEntry(file, byStrongs) : null
    if (exact) return [exact]

    const folded = fold(trimmed)
    if (!folded) return []

    const translit: LexiconEntry[] = []
    const lemma: LexiconEntry[] = []
    const definition: LexiconEntry[] = []

    for (const strongs of Object.keys(file.entries)) {
        const entry = toEntry(file, strongs)!
        if (fold(entry.translit) === folded || fold(entry.translit).replace(/\s/g, "") === folded.replace(/\s/g, "")) translit.push(entry)
        else if (fold(entry.lemma) === folded) lemma.push(entry)
        else if (definition.length < limit && fold(entry.definition).includes(folded)) definition.push(entry)
        if (translit.length >= limit) break
    }

    return [...translit, ...lemma, ...definition].slice(0, limit)
}

export interface LexiconSlide {
    title: string
    subtitle: string
    body: string
}

/**
 * Shape an entry for on-screen display the way a word study is normally shown: the original word
 * large, the transliteration and Strong's number under it, then the definition.
 */
export function formatEntryForSlide(entry: LexiconEntry): LexiconSlide {
    const subtitle = [entry.translit, entry.pron && `/${entry.pron}/`, entry.strongs].filter(Boolean).join(" · ")
    const definition = (entry.definition || "").replace(/\s+/g, " ").trim()
    const kjv = (entry.kjv || "").replace(/\s+/g, " ").trim()
    const body = [definition, kjv && `KJV: ${kjv}`].filter(Boolean).join("\n\n")
    return { title: entry.lemma, subtitle, body }
}

const cache = new Map<LexiconLanguage, LexiconFile>()

/** Load a lexicon file once and keep it, since each one is over a megabyte. */
export async function loadLexicon(language: LexiconLanguage, fetcher?: (url: string) => Promise<LexiconFile>): Promise<LexiconFile | null> {
    const cached = cache.get(language)
    if (cached) return cached

    const url = `lexicon/${language}.json`
    try {
        const file = fetcher
            ? await fetcher(url)
            : await fetch(url.startsWith("/") ? url : `/${url}`).then((response) => {
                  if (!response.ok) throw new Error(`lexicon ${language}: HTTP ${response.status}`)
                  return response.json()
              })
        if (!file?.entries) return null
        cache.set(language, file)
        return file
    } catch (error) {
        console.warn("lexicon load failed:", error)
        return null
    }
}

/** Try both languages, Greek first, which is what preaching references far more often. */
export async function lookupAnywhere(query: string, fetcher?: (url: string) => Promise<LexiconFile>): Promise<LexiconEntry[]> {
    for (const language of ["greek", "hebrew"] as LexiconLanguage[]) {
        const file = await loadLexicon(language, fetcher)
        if (!file) continue
        const results = searchLexicon(file, query)
        if (results.length) return results
    }
    return []
}
