/**
 * Synced lyrics from LRCLIB.
 *
 * LRCLIB is free, needs no key and no OAuth, and returns timestamped LRC for a track. That is the one
 * thing Spotify's own Web API does not give us, so the media panel can show where a song is in the
 * words instead of guessing.
 *
 * API shape (verified against lrclib.net docs):
 *   GET /api/get?artist_name=&track_name=&album_name=&duration=   one exact record or 404
 *   GET /api/search?track_name=&artist_name=                      a list to choose from
 */

import type { SyncedLyricLine, SyncedLyricsQuery, SyncedLyricsResult } from "../../types/Main"

export type { SyncedLyricLine, SyncedLyricsQuery, SyncedLyricsResult }

// optional hour group: "[01:02:03.456]" as well as "[02:03.45]"
const LRC_TIME = /\[(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const LRC_META = /^\[(ar|al|ti|by|offset|re|ve|length):.*\]$/i

/** "03:15.42" or "1:02:03.5" style stamps to milliseconds. */
function stampToMs(hours: string | undefined, minutes: string, seconds: string, fraction?: string): number {
    let ms = (hours ? Number(hours) * 3600000 : 0) + Number(minutes) * 60000 + Number(seconds) * 1000
    if (fraction) ms += Number(fraction.padEnd(3, "0").slice(0, 3))
    return ms
}

/**
 * Parse an LRC document into ordered, timestamped lines.
 *
 * Real files put several stamps on one line ("[00:12.30][01:30.10]same line"), carry metadata lines
 * like "[ar:Artist]", and include blank entries for instrumental gaps. All three are handled, and the
 * output is sorted because files are not always in order.
 */
export function parseLrc(lrc: string): SyncedLyricLine[] {
    if (!lrc || typeof lrc !== "string") return []

    const lines: SyncedLyricLine[] = []
    for (const raw of lrc.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || LRC_META.test(line)) continue

        LRC_TIME.lastIndex = 0
        const stamps: number[] = []
        let match: RegExpExecArray | null
        while ((match = LRC_TIME.exec(line))) stamps.push(stampToMs(match[1], match[2], match[3], match[4]))
        if (!stamps.length) continue

        const text = line.replace(LRC_TIME, "").trim()
        // an empty stamp is a musical gap, keep it only when something follows it later
        for (const timeMs of stamps) lines.push({ timeMs, text })
    }

    const sorted = lines.sort((a, b) => a.timeMs - b.timeMs)
    // drop gap markers that have no text unless a later line exists (a trailing empty line is noise)
    return sorted.filter((line, index) => line.text !== "" || index < sorted.length - 1)
}

/** LRCLIB record as it arrives over the wire. */
interface LrclibRecord {
    trackName?: string
    artistName?: string
    albumName?: string
    duration?: number
    instrumental?: boolean
    plainLyrics?: string | null
    syncedLyrics?: string | null
}

/**
 * Choose the closest record when several exist.
 *
 * Duration is the reliable discriminator between a studio track, a live cut and a remix with the same
 * name, so records within three seconds of the playing track win, then the nearest duration overall.
 */
export function pickBestMatch(records: LrclibRecord[], query: SyncedLyricsQuery): LrclibRecord | null {
    if (!records?.length) return null
    const wantedSeconds = query.durationMs ? query.durationMs / 1000 : undefined

    const usable = records.filter((record) => (record.syncedLyrics || record.plainLyrics) && !record.instrumental)
    const pool = usable.length ? usable : records
    if (!wantedSeconds) return pool[0]

    const score = (record: LrclibRecord) => Math.abs((record.duration || 0) - wantedSeconds)
    const close = pool.filter((record) => score(record) <= 3 && (record.syncedLyrics || "").length > 0)
    if (close.length) return close.sort((a, b) => score(a) - score(b))[0]

    const synced = pool.filter((record) => (record.syncedLyrics || "").length > 0)
    return (synced.length ? synced : pool).sort((a, b) => score(a) - score(b))[0]
}

function toResult(record: LrclibRecord): SyncedLyricsResult {
    const lines = parseLrc(record.syncedLyrics || "")
    return {
        title: record.trackName || "",
        artist: record.artistName || "",
        album: record.albumName,
        durationMs: record.duration ? record.duration * 1000 : undefined,
        instrumental: !!record.instrumental,
        lines,
        hasTimestamps: lines.length > 0
    }
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/**
 * Look up synced lyrics for a track. Returns null rather than throwing when LRCLIB has nothing,
 * because a missing lyric sheet is normal and must not break the media panel.
 */
export async function fetchSyncedLyrics(query: SyncedLyricsQuery, fetcher?: Fetcher): Promise<SyncedLyricsResult | null> {
    if (!query?.title) return null
    const doFetch: Fetcher = fetcher || ((url) => fetch(url, { headers: { "User-Agent": "GraceCityPresenter/1.0 (https://github.com/TGKDre/FreeShow)" } }))

    const exact = new URL("https://lrclib.net/api/get")
    exact.searchParams.set("track_name", query.title)
    exact.searchParams.set("artist_name", query.artist || "")
    if (query.album) exact.searchParams.set("album_name", query.album)
    if (query.durationMs) exact.searchParams.set("duration", String(Math.round(query.durationMs / 1000)))

    try {
        const response = await doFetch(exact.toString())
        if (response.ok) {
            const result = toResult((await response.json()) as LrclibRecord)
            if (result.hasTimestamps) return result
        }
    } catch (error) {
        console.warn("lrclib exact lookup failed:", error)
    }

    // no exact record: search, then keep the record whose duration matches what is playing
    const search = new URL("https://lrclib.net/api/search")
    search.searchParams.set("track_name", query.title)
    if (query.artist) search.searchParams.set("artist_name", query.artist)

    try {
        const response = await doFetch(search.toString())
        if (!response.ok) return null
        const list = (await response.json()) as LrclibRecord[]
        const best = pickBestMatch(Array.isArray(list) ? list : [], query)
        if (!best) return null
        const result = toResult(best)
        return result.hasTimestamps || (best.plainLyrics || "").length ? result : null
    } catch (error) {
        console.warn("lrclib search failed:", error)
        return null
    }
}

/** Index of the line that should be highlighted at a playback position, or -1 before the first line. */
export function activeLineIndex(lines: SyncedLyricLine[], positionMs: number): number {
    if (!lines?.length) return -1
    let index = -1
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].timeMs <= positionMs) index = i
        else break
    }
    return index
}
