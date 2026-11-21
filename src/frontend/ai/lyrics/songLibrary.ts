import { get } from "svelte/store"
import type { Line, Show, Slide } from "../../../types/Show"
import { showsCache } from "../../stores"
import type { LyricSong } from "./lyricDetector"

/**
 * Turns the shows FreeShow already has loaded into the shape the lyric detector wants.
 *
 * Only shows opened in this session live in showsCache, which is the right trade: the songs of the
 * service being run are exactly the ones that get opened, and this never touches the disk mid-sermon.
 */

/** Plain text of one lyric line, with parts joined and whitespace collapsed. */
export function lineText(line: Line | undefined): string {
    if (!line?.text?.length) return ""
    return line.text
        .map((part) => part.value || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
}

/** Every non-empty lyric line of a show, in slide order. */
export function lyricLinesFromShow(show: Pick<Show, "slides"> | undefined): string[] {
    if (!show?.slides) return []
    const lines: string[] = []
    for (const slide of Object.values(show.slides) as Slide[]) {
        for (const item of slide?.items || []) {
            for (const line of item.lines || []) {
                const text = lineText(line)
                if (text) lines.push(text)
            }
        }
    }
    return lines
}

export function buildSongLibrary(loadedShows: { [id: string]: Pick<Show, "name" | "slides"> }): LyricSong[] {
    const songs: LyricSong[] = []
    for (const [id, show] of Object.entries(loadedShows || {})) {
        const lines = lyricLinesFromShow(show)
        // fewer than three lines is an announcement or a title card, not a song
        if (lines.length < 3) continue
        songs.push({ id, title: show.name || id, lines })
    }
    return songs
}

let cache: LyricSong[] | null = null

export function getSongLibrary(): LyricSong[] {
    if (cache) return cache
    cache = buildSongLibrary(get(showsCache) as any)
    return cache
}

export function invalidateSongLibrary() {
    cache = null
}
