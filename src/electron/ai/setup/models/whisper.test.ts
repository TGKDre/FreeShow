import { describe, expect, it } from "vitest"
import { WHISPER_MODEL_BYTES, WHISPER_MODEL_FILES, WHISPER_VAD_BYTES, WHISPER_VAD_FILE, WHISPER_VAD_SHA256 } from "./whisperModel"

describe("whisper model spec", () => {
    it("pins a sha256 for every file", () => {
        const entries = [...Object.values(WHISPER_MODEL_FILES)]
        expect(entries).toHaveLength(3)
        for (const entry of entries) {
            expect(entry.file).toMatch(/\.(onnx|txt)$/)
            expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/)
            expect(entry.size).toBeGreaterThan(1000)
        }
    })

    it("pins the voice activity model too", () => {
        expect(WHISPER_VAD_FILE).toBe("silero_vad.onnx")
        expect(WHISPER_VAD_SHA256).toMatch(/^[0-9a-f]{64}$/)
    })

    it("has no duplicate files or hashes", () => {
        const entries = [...Object.values(WHISPER_MODEL_FILES)]
        expect(new Set(entries.map((entry) => entry.file)).size).toBe(entries.length)
        expect(new Set(entries.map((entry) => entry.sha256)).size).toBe(entries.length)
    })

    it("reports a total that matches the parts", () => {
        const parts = Object.values(WHISPER_MODEL_FILES).reduce((total, entry) => total + entry.size, 0)
        expect(WHISPER_MODEL_BYTES).toBe(parts + WHISPER_VAD_BYTES)
        // just over a gigabyte, which is what the download button warns about
        expect(WHISPER_MODEL_BYTES).toBeGreaterThan(1_000_000_000)
        expect(WHISPER_MODEL_BYTES).toBeLessThan(1_100_000_000)
    })
})
