import { describe, expect, it } from "vitest"
import { SEARCH_PAGE_LIMIT, SpotifyApi, SpotifyApiError } from "./spotifyApi"
import type { TokenSet } from "./spotifyAuth"

const NOW = 1_700_000_000_000
const live = (): TokenSet => ({ accessToken: "access-1", refreshToken: "refresh-1", expiresAt: NOW + 3_600_000 })
const stale = (): TokenSet => ({ accessToken: "expired", refreshToken: "refresh-1", expiresAt: NOW - 1_000 })

function response(status: number, json?: any, headers: Record<string, string> = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
        json: async () => json
    }
}

interface HarnessOptions {
    tokens?: TokenSet | null
    api?: (url: string, init: any, callIndex: number) => any
    token?: (init: any) => any
}

function harness(options: HarnessOptions = {}) {
    const calls: { url: string; init: any }[] = []
    let tokens = options.tokens === undefined ? live() : options.tokens
    const saved: TokenSet[] = []
    const slept: number[] = []
    let apiCallIndex = 0

    const fetcher = async (url: string, init: any = {}) => {
        calls.push({ url, init })
        if (url.startsWith("https://accounts.spotify.com")) {
            return options.token ? options.token(init) : response(200, { access_token: "access-2", expires_in: 3600, refresh_token: "refresh-2" })
        }
        const index = apiCallIndex++
        return options.api ? options.api(url, init, index) : response(200, { ok: true })
    }

    const api = new SpotifyApi({
        getTokens: () => tokens,
        saveTokens: (next) => {
            tokens = next
            saved.push(next)
        },
        clientId: () => "client-1",
        fetcher,
        sleep: async (ms) => {
            slept.push(ms)
        },
        now: () => NOW
    })

    return { api, calls, saved, slept, getTokens: () => tokens }
}

describe("requests", () => {
    it("caps search at the development mode page size", async () => {
        const h = harness({ api: () => response(200, { tracks: { items: [] } }) })
        await h.api.search("hillsong", "track", 50)
        const url = new URL(h.calls[0].url)
        expect(url.pathname).toBe("/v1/search")
        expect(url.searchParams.get("limit")).toBe(String(SEARCH_PAGE_LIMIT))
        expect(url.searchParams.get("q")).toBe("hillsong")
        expect(h.calls[0].init.headers.Authorization).toBe("Bearer access-1")
    })

    it("skips an empty query instead of spending quota", async () => {
        const h = harness()
        expect(await h.api.search("   ")).toBeNull()
        expect(h.calls).toHaveLength(0)
    })

    it("encodes playlist ids into the path", async () => {
        const h = harness({ api: () => response(200, { items: [] }) })
        await h.api.playlistItems("abc/def?x", 100, 0)
        expect(new URL(h.calls[0].url).pathname).toBe("/v1/playlists/abc%2Fdef%3Fx/items")
    })

    it("resolves playback calls that answer 204", async () => {
        const h = harness({ api: () => response(204) })
        await expect(h.api.play({ contextUri: "spotify:playlist:123" })).resolves.toBeUndefined()
        const body = JSON.parse(h.calls[0].init.body)
        expect(body.context_uri).toBe("spotify:playlist:123")
    })
})

describe("token handling", () => {
    it("refreshes before the call when the access token is stale", async () => {
        const h = harness({ tokens: stale(), api: () => response(200, { items: [] }) })
        await h.api.myPlaylists()
        expect(h.calls[0].url).toBe("https://accounts.spotify.com/api/token")
        expect(h.saved[0].accessToken).toBe("access-2")
        expect(h.calls[1].init.headers.Authorization).toBe("Bearer access-2")
    })

    it("refreshes once on a 401 and retries the same request", async () => {
        const h = harness({ api: (_url, _init, index) => (index === 0 ? response(401, { error: { message: "The access token expired" } }) : response(200, { items: ["ok"] })) })
        await expect(h.api.myPlaylists()).resolves.toEqual({ items: ["ok"] })
        expect(h.saved).toHaveLength(1)
        expect(h.calls.filter((c) => c.url.includes("/api/token"))).toHaveLength(1)
    })

    it("gives up with a reconnect message when there is no refresh token", async () => {
        const h = harness({ tokens: { accessToken: "a", expiresAt: NOW - 1 } })
        await expect(h.api.myPlaylists()).rejects.toThrow("Connect again")
    })

    it("collapses concurrent refreshes into one token request", async () => {
        const h = harness({ tokens: stale(), api: () => response(200, { items: [] }) })
        await Promise.all([h.api.myPlaylists(), h.api.devices(), h.api.search("grace")])
        expect(h.calls.filter((c) => c.url.includes("/api/token"))).toHaveLength(1)
    })
})

describe("rate limits", () => {
    it("honours Retry-After and retries", async () => {
        const h = harness({ api: (_url, _init, index) => (index === 0 ? response(429, {}, { "retry-after": "2" }) : response(200, { items: ["after"] })) })
        await expect(h.api.myPlaylists()).resolves.toEqual({ items: ["after"] })
        expect(h.slept).toEqual([2000])
    })

    it("reports a spent developer quota in plain words", async () => {
        const h = harness({ api: () => response(429, { error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" } }), tokens: live() })
        const error = await h.api.myPlaylists().catch((e) => e)
        expect(error).toBeInstanceOf(SpotifyApiError)
        expect(error.reason).toBe("QUOTA_EXCEEDED")
        expect(error.message).toContain("Library stays on the last cached copy")
    })

    it("does not loop forever on repeated 429s", async () => {
        const h = harness({ api: () => response(429, { error: { message: "Too many requests" } }, { "retry-after": "1" }) })
        await expect(h.api.myPlaylists()).rejects.toBeInstanceOf(SpotifyApiError)
        expect(h.slept).toHaveLength(2)
    })
})
