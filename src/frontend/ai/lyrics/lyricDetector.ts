/**
 * Lyric recognition for worship.
 *
 * FreeShow already guesses when worship is happening (the AI prompt has a "lyrics" type) but nothing
 * matched what is actually being sung against the songs in the library. This does that locally: the
 * live transcript window is scored against every lyric line of the songs in the service, and the best
 * line wins only when enough of its words are really there.
 *
 * Deliberately lexical, not a model: worship lines are short and repetitive, so word coverage with a
 * bigram bonus is both cheap and accurate, and it works with no download.
 */

export interface LyricSong {
    id: string
    title: string
    lines: string[]
}

export interface LyricMatch {
    songId: string
    title: string
    lineIndex: number
    line: string
    confidence: number
}

// Only true filler. Pronouns and auxiliaries stay: in worship lines they carry the identity of a
// phrase ("you are here" versus "here you are"), and dropping them made every short line unmatchable.
const STOPWORDS = new Set(["the", "and", "a", "an", "oh", "ooh", "yeah", "hey", "ah", "la", "na", "amen"])

export function tokenize(text: string): string[] {
    return (text || "")
        .toLowerCase()
        .replace(/[’'`]/g, "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((word) => word.length > 1 && !STOPWORDS.has(word))
}

function bigrams(tokens: string[]): Set<string> {
    const pairs = new Set<string>()
    for (let i = 0; i < tokens.length - 1; i++) pairs.add(`${tokens[i]} ${tokens[i + 1]}`)
    return pairs
}

/**
 * Score one lyric line against the transcript window.
 * Coverage counts how much of the line is present; the bigram bonus rewards words in the right order,
 * which is what separates the verse from the chorus of a repetitive song.
 */
export function scoreLine(windowTokens: Set<string>, windowBigrams: Set<string>, line: string): { score: number; matched: number } {
    const lineTokens = tokenize(line)
    if (!lineTokens.length) return { score: 0, matched: 0 }

    let matched = 0
    for (const token of lineTokens) if (windowTokens.has(token)) matched++

    const coverage = matched / lineTokens.length
    if (!matched) return { score: 0, matched: 0 }

    let bigramHits = 0
    const lineBigrams = bigrams(lineTokens)
    for (const pair of lineBigrams) if (windowBigrams.has(pair)) bigramHits++
    const orderBonus = lineBigrams.size ? (bigramHits / lineBigrams.size) * 0.25 : 0

    return { score: Math.min(1, coverage + orderBonus), matched }
}

export interface LyricMatchOptions {
    /** how many trailing transcript words to consider */
    windowSize?: number
    /** share of a line's words that must be present */
    minCoverage?: number
    /** absolute floor of matching words, so one common word cannot trigger a slide */
    minMatched?: number
    /** ignore the line already on screen, so a repeated chorus does not re-fire */
    excludeLine?: { songId: string; lineIndex: number }
}

/** Best matching lyric line for what is being sung right now, or null when nothing is convincing. */
export function findLyricMatch(transcript: string, songs: LyricSong[], options: LyricMatchOptions = {}): LyricMatch | null {
    const { windowSize = 25, minCoverage = 0.6, minMatched = 4, excludeLine } = options
    if (!transcript || !songs?.length) return null

    const recent = tokenize(transcript).slice(-windowSize)
    if (recent.length < minMatched) return null

    const windowTokens = new Set(recent)
    const windowBigrams = bigrams(recent)

    let best: LyricMatch | null = null
    for (const song of songs) {
        const lines = song.lines || []
        for (let index = 0; index < lines.length; index++) {
            if (excludeLine && excludeLine.songId === song.id && excludeLine.lineIndex === index) continue
            const { score, matched } = scoreLine(windowTokens, windowBigrams, lines[index])
            if (matched < minMatched || score < minCoverage) continue
            if (best && score <= best.confidence / 100) continue
            best = {
                songId: song.id,
                title: song.title,
                lineIndex: index,
                line: lines[index],
                confidence: Math.round(score * 100)
            }
        }
    }

    return best
}
