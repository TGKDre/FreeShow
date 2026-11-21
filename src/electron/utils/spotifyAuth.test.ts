import { describe, expect, it } from "vitest"
import {
    buildAuthorizeUrl,
    codeChallenge,
    createCodeVerifier,
    exchangeCode,
    isExpired,
    loopbackRedirectUri,
    parseCallback,
    refreshAccessToken,
    startLoopbackListener,
    tokensFromResponse,
    type Fetcher
} from "./spotifyAuth"

function fakeFetcher(payload: any, status = 200) {
    const calls: { url: string; init?: any }[] = []
    const fetcher: Fetcher = async (url, init) => {
        calls.push({ url, init })
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: { get: () => null },
            json: async () => payload
        }
    }
    return { fetcher, calls }
}

describe("pkce", () => {
    // RFC 7636 appendix B
    it("matches the RFC 7636 test vector", () => {
        expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    })

    it("creates url safe verifiers of legal length", () => {
        const verifier = createCodeVerifier()
        expect(verifier.length).toBeGreaterThanOrEqual(43)
        expect(verifier.length).toBeLessThanOrEqual(128)
        expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/)
        expect(createCodeVerifier()).not.toBe(verifier)
    })
})

describe("authorize url", () => {
    it("carries every parameter Spotify needs", () => {
        const url = new URL(
            buildAuthorizeUrl({
                clientId: "client-123",
                redirectUri: loopbackRedirectUri(),
                challenge: "challenge",
                state: "state",
                scopes: ["user-read-playback-state", "playlist-read-private"]
            })
        )
        expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize")
        expect(url.searchParams.get("response_type")).toBe("code")
        expect(url.searchParams.get("client_id")).toBe("client-123")
        expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8899/callback")
        expect(url.searchParams.get("code_challenge_method")).toBe("S256")
        expect(url.searchParams.get("scope")).toBe("user-read-playback-state playlist-read-private")
    })

    it("never uses localhost, which Spotify rejects", () => {
        expect(loopbackRedirectUri(8989, "/login")).toBe("http://127.0.0.1:8989/login")
    })
})

describe("callback parsing", () => {
    it("reads code and state", () => {
        expect(parseCallback("/callback?code=abc&state=xyz")).toEqual({ code: "abc", state: "xyz", error: undefined })
    })

    it("surfaces a denial", () => {
        expect(parseCallback("/callback?error=access_denied&state=xyz").error).toBe("access_denied")
    })
})

describe("token lifetime", () => {
    const now = 1_700_000_000_000

    it("treats a missing token set as expired", () => {
        expect(isExpired(null, 60_000, now)).toBe(true)
    })

    it("treats a token inside the skew window as expired", () => {
        expect(isExpired({ accessToken: "a", expiresAt: now + 30_000 }, 60_000, now)).toBe(true)
        expect(isExpired({ accessToken: "a", expiresAt: now + 120_000 }, 60_000, now)).toBe(false)
    })

    it("keeps the previous refresh token when the response omits one", () => {
        const tokens = tokensFromResponse({ access_token: "new", expires_in: 3600 }, { accessToken: "old", refreshToken: "keep", expiresAt: 0 }, now)
        expect(tokens.refreshToken).toBe("keep")
        expect(tokens.expiresAt).toBe(now + 3_600_000)
    })

    it("takes the rotated refresh token when one is returned", () => {
        const tokens = tokensFromResponse({ access_token: "new", refresh_token: "rotated", expires_in: 3600 }, { accessToken: "old", refreshToken: "old-r", expiresAt: 0 }, now)
        expect(tokens.refreshToken).toBe("rotated")
    })
})

describe("token requests", () => {
    it("exchanges an authorization code with the verifier and redirect", async () => {
        const { fetcher, calls } = fakeFetcher({ access_token: "at", refresh_token: "rt", expires_in: 3600 })
        const tokens = await exchangeCode({ clientId: "cid", code: "the-code", verifier: "the-verifier", redirectUri: loopbackRedirectUri(), fetcher, now: 1000 })
        expect(tokens.accessToken).toBe("at")
        expect(tokens.refreshToken).toBe("rt")
        expect(tokens.expiresAt).toBe(1000 + 3_600_000)
        expect(calls[0].url).toBe("https://accounts.spotify.com/api/token")
        const body = new URLSearchParams(calls[0].init.body)
        expect(body.get("grant_type")).toBe("authorization_code")
        expect(body.get("code_verifier")).toBe("the-verifier")
        expect(body.get("redirect_uri")).toBe("http://127.0.0.1:8899/callback")
    })

    it("raises the Spotify error description", async () => {
        const { fetcher } = fakeFetcher({ error: "invalid_grant", error_description: "Refresh token revoked" }, 400)
        await expect(refreshAccessToken({ clientId: "cid", refreshToken: "rt", fetcher })).rejects.toThrow("Refresh token revoked")
    })

    it("refuses to refresh without a stored refresh token", async () => {
        const { fetcher, calls } = fakeFetcher({})
        await expect(refreshAccessToken({ clientId: "cid", refreshToken: "", fetcher })).rejects.toThrow("no refresh token")
        expect(calls).toHaveLength(0)
    })
})

describe("loopback listener", () => {
    const port = 45871

    it("captures the code when state matches", async () => {
        const listener = startLoopbackListener({ port, expectedState: "expected", timeoutMs: 5000 })
        await listener.ready
        const res = await fetch(`http://127.0.0.1:${port}/callback?code=the-code&state=expected`)
        expect(res.status).toBe(200)
        expect((await res.text()).toLowerCase()).toContain("spotify connected")
        await expect(listener.result).resolves.toEqual({ code: "the-code", state: "expected" })
    })

    it("rejects a mismatched state and does not hand over the code", async () => {
        const listener = startLoopbackListener({ port: port + 1, expectedState: "expected", timeoutMs: 5000 })
        await listener.ready
        // attach the handler before the request so the rejection is never unhandled
        const outcome: Promise<Error> = listener.result.then(
            () => new Error("resolved unexpectedly"),
            (error: Error) => error
        )
        const res = await fetch(`http://127.0.0.1:${port + 1}/callback?code=the-code&state=wrong`)
        expect(res.status).toBe(400)
        expect((await outcome).message).toContain("state mismatch")
    })

    it("answers unrelated paths with 404 so a stray port probe cannot fake a code", async () => {
        const listener = startLoopbackListener({ port: port + 2, expectedState: "expected", timeoutMs: 5000 })
        await listener.ready
        const outcome: Promise<Error> = listener.result.then(
            () => new Error("resolved unexpectedly"),
            (error: Error) => error
        )
        const res = await fetch(`http://127.0.0.1:${port + 2}/anything`)
        expect(res.status).toBe(404)
        listener.close()
        expect((await outcome).message).toContain("cancelled")
    })
})
