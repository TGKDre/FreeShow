// OAuth (PKCE) plumbing for the Spotify Web API.
//
// Why PKCE and not a client secret: Grace City Presenter is a desktop app, so any bundled secret is public.
// Spotifast and every other native Spotify client use the same model: the user registers their own Spotify
// developer app, approves once in a browser, and the app keeps a refresh token in protected storage.
//
// The redirect must be a loopback IP literal over HTTP (Spotify forbids "localhost" and requires HTTPS for
// anything that is not a loopback address).
//
// Nothing here imports electron, so it is unit-testable. The electron-specific token storage lives in
// spotifyStore.ts.

import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"

export const AUTH_HOST = "https://accounts.spotify.com"
export const API_HOST = "https://api.spotify.com/v1"
export const LOOPBACK_HOST = "127.0.0.1"
export const LOOPBACK_PORT = 8899
export const CALLBACK_PATH = "/callback"

// Everything needed to read a library, drive playback and edit playlists.
export const SPOTIFY_SCOPES = [
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "playlist-read-private",
    "playlist-read-collaborative",
    "playlist-modify-private",
    "playlist-modify-public",
    "user-library-read"
]

export interface TokenSet {
    accessToken: string
    refreshToken?: string
    // epoch ms
    expiresAt: number
    scope?: string
}

export interface HttpResponseLike {
    ok: boolean
    status: number
    headers: { get(name: string): string | null }
    json(): Promise<any>
}

export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<HttpResponseLike>

export function loopbackRedirectUri(port = LOOPBACK_PORT, path = CALLBACK_PATH) {
    return `http://${LOOPBACK_HOST}:${port}${path}`
}

function base64Url(buf: Buffer) {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// 43-128 chars per RFC 7636; 48 random bytes gives 64 base64url chars.
export function createCodeVerifier() {
    return base64Url(randomBytes(48))
}

export function codeChallenge(verifier: string) {
    return base64Url(createHash("sha256").update(verifier).digest())
}

export function createState() {
    return base64Url(randomBytes(16))
}

export function buildAuthorizeUrl(options: { clientId: string; redirectUri: string; challenge: string; state: string; scopes?: string[] }) {
    const params = new URLSearchParams({
        response_type: "code",
        client_id: options.clientId,
        redirect_uri: options.redirectUri,
        code_challenge_method: "S256",
        code_challenge: options.challenge,
        state: options.state,
        scope: (options.scopes ?? SPOTIFY_SCOPES).join(" ")
    })
    return `${AUTH_HOST}/authorize?${params.toString()}`
}

export function parseCallback(input: string) {
    let url: URL
    try {
        url = new URL(input, loopbackRedirectUri())
    } catch {
        return { error: "invalid_redirect" } as { code?: string; state?: string; error?: string }
    }
    const code = url.searchParams.get("code") ?? undefined
    const state = url.searchParams.get("state") ?? undefined
    const error = url.searchParams.get("error") ?? undefined
    return { code, state, error }
}

export function isExpired(tokens: TokenSet | null, skewMs = 60_000, now = Date.now()) {
    if (!tokens) return true
    if (!tokens.expiresAt) return false
    return tokens.expiresAt - skewMs <= now
}

// Spotify returns expires_in seconds. Keep the old refresh token when a refresh response omits a new one.
export function tokensFromResponse(json: any, previous?: TokenSet, now = Date.now()): TokenSet {
    const expiresIn = Number(json?.expires_in)
    return {
        accessToken: String(json?.access_token || ""),
        refreshToken: json?.refresh_token ? String(json.refresh_token) : previous?.refreshToken,
        expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : previous?.expiresAt ?? 0,
        scope: json?.scope ? String(json.scope) : previous?.scope
    }
}

async function tokenRequest(fetcher: Fetcher, clientId: string, body: Record<string, string>) {
    const res = await fetcher(`${AUTH_HOST}/api/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, ...body }).toString()
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.access_token) {
        const detail = json?.error_description || json?.error || `HTTP ${res.status}`
        throw new Error(`Spotify token request failed: ${detail}`)
    }
    return json
}

export async function exchangeCode(options: { clientId: string; code: string; verifier: string; redirectUri: string; fetcher: Fetcher; now?: number }) {
    const json = await tokenRequest(options.fetcher, options.clientId, {
        grant_type: "authorization_code",
        code: options.code,
        redirect_uri: options.redirectUri,
        code_verifier: options.verifier
    })
    return tokensFromResponse(json, undefined, options.now)
}

export async function refreshAccessToken(options: { clientId: string; refreshToken: string; fetcher: Fetcher; previous?: TokenSet; now?: number }) {
    if (!options.refreshToken) throw new Error("Spotify refresh failed: no refresh token stored")
    const json = await tokenRequest(options.fetcher, options.clientId, {
        grant_type: "refresh_token",
        refresh_token: options.refreshToken
    })
    return tokensFromResponse(json, options.previous, options.now)
}

const SUCCESS_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Grace City Presenter</title>
<style>body{background:#0b0b0b;color:#d6ae31;font-family:system-ui,sans-serif;display:flex;height:100vh;margin:0;
align-items:center;justify-content:center;text-align:center}h1{font-size:20px;font-weight:600}p{color:#bbb;font-size:14px}</style>
</head><body><div><h1>Spotify connected</h1><p>You can close this window and return to Grace City Presenter.</p></div></body></html>`

const FAILURE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Grace City Presenter</title>
<style>body{background:#0b0b0b;color:#e0e0e0;font-family:system-ui,sans-serif;display:flex;height:100vh;margin:0;
align-items:center;justify-content:center;text-align:center}h1{font-size:20px;font-weight:600}p{color:#bbb;font-size:14px}</style>
</head><body><div><h1>Spotify did not approve the sign-in</h1><p>Close this window and try again from the app.</p></div></body></html>`

/**
 * Listens on the loopback callback while the user approves access in their browser.
 * Binds 127.0.0.1 only, accepts exactly one result, then closes.
 */
export function startLoopbackListener(options: { port?: number; path?: string; expectedState: string; timeoutMs?: number }) {
    const port = options.port ?? LOOPBACK_PORT
    const path = options.path ?? CALLBACK_PATH
    const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000

    let resolveResult: (value: { code: string; state: string }) => void
    let rejectResult: (error: Error) => void
    const result = new Promise<{ code: string; state: string }>((resolve, reject) => {
        resolveResult = resolve
        rejectResult = reject
    })

    let settled = false
    const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        server.close()
        fn()
    }

    const server = createServer((req, res) => {
        const requestUrl = req.url || "/"
        const requestPath = requestUrl.split("?")[0]
        if (requestPath !== path) {
            res.writeHead(404, { "Content-Type": "text/plain" })
            res.end("Not found")
            return
        }
        const parsed = parseCallback(`http://${LOOPBACK_HOST}:${port}${requestUrl}`)
        const approved = !!parsed.code && parsed.state === options.expectedState
        res.writeHead(approved ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" })
        res.end(approved ? SUCCESS_PAGE : FAILURE_PAGE)

        if (approved) finish(() => resolveResult({ code: parsed.code!, state: parsed.state! }))
        else finish(() => rejectResult(new Error(parsed.error ? `Spotify returned ${parsed.error}` : "Spotify sign-in could not be verified (state mismatch)")))
    })

    const timer = setTimeout(() => finish(() => rejectResult(new Error("Spotify sign-in timed out"))), timeoutMs)

    const ready = new Promise<void>((resolve, reject) => {
        server.once("error", (error: any) => {
            clearTimeout(timer)
            settled = true
            reject(new Error(`Could not listen for the Spotify sign-in on port ${port}: ${error?.message || error}`))
        })
        server.listen(port, LOOPBACK_HOST, () => resolve())
    })

    return {
        redirectUri: loopbackRedirectUri(port, path),
        result,
        ready,
        close: () => {
            if (!settled) finish(() => rejectResult(new Error("Spotify sign-in cancelled")))
        }
    }
}
