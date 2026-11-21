// Spotify Web API client for the media library panel.
//
// Limits this respects (Spotify Development Mode, which is the only mode a church-sized app can have):
// - /search page size is capped at 10, so callers page explicitly.
// - batch endpoints (GET /tracks, /albums, /artists) are gone; fetch single items.
// - playlist contents come back only for playlists the account owns or collaborates on.
// - quota buckets answer 429 with reason QUOTA_EXCEEDED, so cache at the call site and never poll search.
//
// No electron import: the token access is injected, so this is unit-testable.

import { API_HOST, type Fetcher, type TokenSet, isExpired, refreshAccessToken } from "./spotifyAuth"

export const SEARCH_PAGE_LIMIT = 10

export class SpotifyApiError extends Error {
    status: number
    reason?: string
    constructor(message: string, status = 0, reason?: string) {
        super(message)
        this.name = "SpotifyApiError"
        this.status = status
        this.reason = reason
    }
}

export interface SpotifyApiOptions {
    getTokens: () => TokenSet | null
    saveTokens: (tokens: TokenSet) => void
    clientId: () => string | null
    fetcher: Fetcher
    apiBase?: string
    // injected so tests do not sleep
    sleep?: (ms: number) => Promise<void>
    now?: () => number
    maxRetries?: number
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class SpotifyApi {
    private options: SpotifyApiOptions
    private refreshing: Promise<TokenSet> | null = null

    constructor(options: SpotifyApiOptions) {
        this.options = options
    }

    private get apiBase() {
        return this.options.apiBase ?? API_HOST
    }

    private get sleep() {
        return this.options.sleep ?? wait
    }

    private async accessToken(): Promise<string> {
        const tokens = this.options.getTokens()
        if (tokens && !isExpired(tokens, 60_000, (this.options.now ?? Date.now)())) return tokens.accessToken
        const refreshed = await this.refresh()
        return refreshed.accessToken
    }

    private refresh(): Promise<TokenSet> {
        // collapse concurrent refreshes so a page load does not spend five rotations
        if (this.refreshing) return this.refreshing
        this.refreshing = (async () => {
            const tokens = this.options.getTokens()
            const clientId = this.options.clientId()
            if (!tokens?.refreshToken) throw new SpotifyApiError("Spotify session expired. Connect again from Settings.", 401, "NOT_CONNECTED")
            if (!clientId) throw new SpotifyApiError("No Spotify client ID configured.", 401, "NO_CLIENT_ID")
            try {
                const fresh = await refreshAccessToken({
                    clientId,
                    refreshToken: tokens.refreshToken,
                    fetcher: this.options.fetcher,
                    previous: tokens,
                    now: (this.options.now ?? Date.now)()
                })
                this.options.saveTokens(fresh)
                return fresh
            } catch (error: any) {
                throw new SpotifyApiError(error?.message || "Spotify session could not be refreshed.", 401, "REFRESH_FAILED")
            } finally {
                this.refreshing = null
            }
        })()
        return this.refreshing
    }

    private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>) {
        const url = new URL(path.startsWith("http") ? path : `${this.apiBase}${path}`)
        if (query) {
            for (const [key, value] of Object.entries(query)) {
                if (value === undefined || value === null || value === "") continue
                url.searchParams.set(key, String(value))
            }
        }
        return url.toString()
    }

    /**
     * One authenticated request: refreshes an expired token, retries once on 401 after a refresh,
     * and backs off on 429 using Retry-After.
     */
    async request<T = any>(path: string, init: { method?: string; body?: any; query?: Record<string, string | number | boolean | undefined> } = {}): Promise<T> {
        const maxRetries = this.options.maxRetries ?? 2
        let attempt = 0
        let refreshedFor401 = false

        while (true) {
            const token = await this.accessToken()
            const res = await this.options.fetcher(this.buildUrl(path, init.query), {
                method: init.method ?? "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(init.body ? { "Content-Type": "application/json" } : {})
                },
                body: init.body ? JSON.stringify(init.body) : undefined
            })

            if (res.status === 401 && !refreshedFor401) {
                refreshedFor401 = true
                await this.refresh()
                continue
            }

            if (res.status === 429 && attempt < maxRetries) {
                // A spent daily developer quota is not going to clear in a second, so do not retry it.
                const quotaBody = await res.json().catch(() => null)
                if (quotaBody?.error?.reason === "QUOTA_EXCEEDED") throw new SpotifyApiError("Spotify developer quota for today is used up. Library stays on the last cached copy.", 429, "QUOTA_EXCEEDED")
                attempt++
                const retryAfter = Number(res.headers.get("Retry-After"))
                const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 1000 * attempt
                await this.sleep(delay)
                continue
            }

            // 204 No Content (playback and queue calls)
            if (res.status === 204 || (res.ok && res.status === 202)) return undefined as unknown as T

            const json = await res.json().catch(() => null)
            if (!res.ok) {
                const message = json?.error?.message || `Spotify request failed (HTTP ${res.status})`
                const reason = json?.error?.reason
                if (reason === "QUOTA_EXCEEDED") throw new SpotifyApiError("Spotify developer quota for today is used up. Library stays on the last cached copy.", 429, reason)
                throw new SpotifyApiError(message, res.status, reason)
            }
            return json as T
        }
    }

    async search(query: string, types = "track,album,artist,playlist", limit = SEARCH_PAGE_LIMIT, offset = 0) {
        if (!query.trim()) return null
        return this.request<any>("/search", {
            query: { q: query.trim(), type: types, limit: Math.min(limit, SEARCH_PAGE_LIMIT), offset }
        })
    }

    async myPlaylists(limit = 50, offset = 0) {
        return this.request<any>("/me/playlists", { query: { limit, offset } })
    }

    async playlistItems(playlistId: string, limit = 100, offset = 0) {
        return this.request<any>(`/playlists/${encodeURIComponent(playlistId)}/items`, { query: { limit, offset } })
    }

    async likedSongs(limit = 50, offset = 0) {
        return this.request<any>("/me/tracks", { query: { limit, offset } })
    }

    async savedAlbums(limit = 50, offset = 0) {
        return this.request<any>("/me/albums", { query: { limit, offset } })
    }

    async album(albumId: string) {
        return this.request<any>(`/albums/${encodeURIComponent(albumId)}`)
    }

    async artist(artistId: string) {
        return this.request<any>(`/artists/${encodeURIComponent(artistId)}`)
    }

    async artistAlbums(artistId: string, limit = 10, offset = 0) {
        return this.request<any>(`/artists/${encodeURIComponent(artistId)}/albums`, { query: { include_groups: "album,single", limit, offset } })
    }

    async devices() {
        return this.request<any>("/me/player/devices")
    }

    async playbackState() {
        return this.request<any>("/me/player")
    }

    async transfer(deviceId: string, play = false) {
        return this.request<void>("/me/player", { method: "PUT", body: { device_ids: [deviceId], play } })
    }

    /** Play a context (playlist/album/artist URI) or an explicit list of track URIs. */
    async play(options: { contextUri?: string; uris?: string[]; offset?: number; deviceId?: string; positionMs?: number }) {
        const body: any = {}
        if (options.contextUri) body.context_uri = options.contextUri
        if (options.uris?.length) body.uris = options.uris
        if (typeof options.offset === "number") body.offset = { position: options.offset }
        if (typeof options.positionMs === "number") body.position_ms = options.positionMs
        return this.request<void>("/me/player/play", { method: "PUT", body, query: { device_id: options.deviceId } })
    }

    async pause(deviceId?: string) {
        return this.request<void>("/me/player/pause", { method: "PUT", query: { device_id: deviceId } })
    }

    async next(deviceId?: string) {
        return this.request<void>("/me/player/next", { method: "POST", query: { device_id: deviceId } })
    }

    async previous(deviceId?: string) {
        return this.request<void>("/me/player/previous", { method: "POST", query: { device_id: deviceId } })
    }

    async seek(positionMs: number, deviceId?: string) {
        return this.request<void>("/me/player/seek", { method: "PUT", query: { position_ms: Math.max(0, Math.round(positionMs)), device_id: deviceId } })
    }

    async setVolume(percent: number, deviceId?: string) {
        return this.request<void>("/me/player/volume", { method: "PUT", query: { volume_percent: Math.max(0, Math.min(100, Math.round(percent))), device_id: deviceId } })
    }

    async queue(uri: string, deviceId?: string) {
        return this.request<void>("/me/player/queue", { method: "POST", query: { uri, device_id: deviceId } })
    }

    async createPlaylist(name: string, description = "", isPublic = false) {
        return this.request<any>("/me/playlists", { method: "POST", body: { name, description, public: isPublic } })
    }

    async addPlaylistItems(playlistId: string, uris: string[], position?: number) {
        return this.request<any>(`/playlists/${encodeURIComponent(playlistId)}/items`, { method: "POST", body: { uris, ...(typeof position === "number" ? { position } : {}) } })
    }

    async removePlaylistItems(playlistId: string, uris: string[]) {
        return this.request<any>(`/playlists/${encodeURIComponent(playlistId)}/items`, { method: "DELETE", body: { items: uris.map((uri) => ({ uri })) } })
    }
}
