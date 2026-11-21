import { net } from "electron"
import type { LoveWorldSongRef } from "./loveWorldLyrics"
import { matchSongs, parseIndex, parseSong, songToShowText } from "./loveWorldLyrics"

/**
 * Fetches the LoveWorld catalogue from loveworldlyrics.com and keeps it in memory.
 *
 * The index is about 200 KB for 1,500 songs, so one fetch per session is enough; the TTL keeps a long
 * day from serving a stale list without hammering their server on every keystroke.
 */

const SITE = "https://loveworldlyrics.com"
const INDEX_TTL = 6 * 60 * 60 * 1000
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

let cache: { at: number; songs: LoveWorldSongRef[] } | null = null
let inFlight: Promise<LoveWorldSongRef[]> | null = null

async function fetchHtml(url: string): Promise<string> {
    const response = await net.fetch(url, { headers: { "User-Agent": USER_AGENT } })
    if (!response.ok) throw new Error(`loveworldlyrics.com answered ${response.status}`)
    return await response.text()
}

export class LoveWorldCatalogue {
    static async getIndex(force = false): Promise<LoveWorldSongRef[]> {
        if (!force && cache && Date.now() - cache.at < INDEX_TTL) return cache.songs
        if (inFlight) return inFlight

        inFlight = (async () => {
            try {
                const songs = parseIndex(await fetchHtml(`${SITE}/songs`))
                if (songs.length) cache = { at: Date.now(), songs }
                return songs
            } catch (error) {
                console.error("Could not load the LoveWorld catalogue:", error)
                // a stale list beats an empty one when their server is having a bad morning
                return cache?.songs || []
            } finally {
                inFlight = null
            }
        })()

        return inFlight
    }

    static async search(query: string, limit = 8): Promise<LoveWorldSongRef[]> {
        const index = await this.getIndex()
        return matchSongs(index, query, limit)
    }

    /** Full lyrics for one song, as slide text with a blank line between sections. */
    static async getLyrics(song: { slug: string; title: string; meta?: string }): Promise<string> {
        try {
            const html = await fetchHtml(`${SITE}/song/${encodeURIComponent(song.slug)}`)
            return songToShowText(parseSong(html, song))
        } catch (error) {
            console.error("Could not load LoveWorld lyrics:", error)
            return ""
        }
    }
}
