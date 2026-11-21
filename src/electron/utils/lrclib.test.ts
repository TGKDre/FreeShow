import { describe, expect, it } from "vitest"
import { activeLineIndex, fetchSyncedLyrics, parseLrc, pickBestMatch } from "./lrclib"

describe("lrclib LRC parsing", () => {
    it("parses simple timestamped lines in order", () => {
        const lrc = ["[00:12.30]first line", "[00:18.90]second line", "[00:25.00]third line"].join("\n")
        expect(parseLrc(lrc)).toEqual([
            { timeMs: 12300, text: "first line" },
            { timeMs: 18900, text: "second line" },
            { timeMs: 25000, text: "third line" }
        ])
    })

    it("expands lines carrying several stamps and skips metadata", () => {
        const lrc = ["[ar:Artist]", "[ti:Song]", "[00:10.00][00:40.00]chorus", "[00:30.50]verse"].join("\n")
        expect(parseLrc(lrc)).toEqual([
            { timeMs: 10000, text: "chorus" },
            { timeMs: 30500, text: "verse" },
            { timeMs: 40000, text: "chorus" }
        ])
    })

    it("sorts unsorted files and keeps instrumental gaps that lead somewhere", () => {
        const lrc = ["[01:00.00]late", "[00:05.00]", "[00:20.00]early", "[01:30.00]"].join("\n")
        const lines = parseLrc(lrc)
        expect(lines[0]).toEqual({ timeMs: 5000, text: "" })
        expect(lines.map((line) => line.text)).toEqual(["", "early", "late"])
    })

    it("handles hours, three digit fractions and CRLF", () => {
        const lrc = "[01:02:03.456]long\r\n[00:00.999]start"
        expect(parseLrc(lrc)).toEqual([
            { timeMs: 999, text: "start" },
            { timeMs: 3723456, text: "long" }
        ])
    })

    it("returns nothing for empty or plain text lyrics", () => {
        expect(parseLrc("")).toEqual([])
        expect(parseLrc("just words, no stamps")).toEqual([])
        expect(parseLrc(null as unknown as string)).toEqual([])
    })
})

describe("lrclib record selection", () => {
    const query = { title: "Song", artist: "Artist", durationMs: 200000 }

    it("prefers the record closest in duration", () => {
        const records = [
            { trackName: "Song", duration: 260, syncedLyrics: "[00:01.00]live" },
            { trackName: "Song", duration: 200, syncedLyrics: "[00:01.00]studio" },
            { trackName: "Song", duration: 201, syncedLyrics: "[00:01.00]studio alt" }
        ]
        expect(pickBestMatch(records, query)?.syncedLyrics).toContain("studio")
    })

    it("skips instrumentals and empty records when something usable exists", () => {
        const records = [
            { trackName: "Song", duration: 200, instrumental: true, syncedLyrics: "[00:01.00]la" },
            { trackName: "Song", duration: 200, plainLyrics: "words only", syncedLyrics: null },
            { trackName: "Song", duration: 230, syncedLyrics: "[00:01.00]real" }
        ]
        expect(pickBestMatch(records, query)?.syncedLyrics).toContain("real")
    })

    it("returns null for an empty list", () => {
        expect(pickBestMatch([], query)).toBeNull()
    })
})

describe("lrclib network path", () => {
    it("returns parsed synced lyrics from the exact endpoint", async () => {
        const calls: string[] = []
        const fetcher = async (url: string) => {
            calls.push(url)
            return {
                ok: true,
                status: 200,
                json: async () => ({ trackName: "Song", artistName: "Artist", duration: 200, syncedLyrics: "[00:01.00]hello" })
            }
        }

        const result = await fetchSyncedLyrics({ title: "Song", artist: "Artist", durationMs: 200000 }, fetcher)
        expect(result?.lines).toEqual([{ timeMs: 1000, text: "hello" }])
        expect(result?.hasTimestamps).toBe(true)
        expect(calls[0]).toContain("track_name=Song")
        expect(calls[0]).toContain("artist_name=Artist")
        expect(calls[0]).toContain("duration=200")
    })

    it("falls back to search when the exact lookup misses", async () => {
        const fetcher = async (url: string) => {
            if (url.includes("/api/get")) return { ok: false, status: 404, json: async () => ({}) }
            return {
                ok: true,
                status: 200,
                json: async () => [
                    { trackName: "Song", duration: 260, syncedLyrics: "[00:02.00]wrong take" },
                    { trackName: "Song", duration: 200, syncedLyrics: "[00:02.00]right take" }
                ]
            }
        }

        const result = await fetchSyncedLyrics({ title: "Song", artist: "Artist", durationMs: 200000 }, fetcher)
        expect(result?.lines[0].text).toBe("right take")
    })

    it("returns null instead of throwing when the network fails", async () => {
        const fetcher = async () => {
            throw new Error("offline")
        }
        await expect(fetchSyncedLyrics({ title: "Song", artist: "Artist" }, fetcher)).resolves.toBeNull()
    })

    it("does nothing when no title is given", async () => {
        let called = false
        const fetcher = async () => {
            called = true
            return { ok: true, status: 200, json: async () => ({}) }
        }
        await expect(fetchSyncedLyrics({ title: "", artist: "Artist" }, fetcher)).resolves.toBeNull()
        expect(called).toBe(false)
    })
})

describe("playback position to lyric line", () => {
    const lines = [
        { timeMs: 5000, text: "a" },
        { timeMs: 9000, text: "b" },
        { timeMs: 13000, text: "c" }
    ]

    it("finds the active line", () => {
        expect(activeLineIndex(lines, 0)).toBe(-1)
        expect(activeLineIndex(lines, 5000)).toBe(0)
        expect(activeLineIndex(lines, 12000)).toBe(1)
        expect(activeLineIndex(lines, 999999)).toBe(2)
    })

    it("handles an empty sheet", () => {
        expect(activeLineIndex([], 1000)).toBe(-1)
    })
})
