import os from "os"
import path from "path"
import type { DriverCallbacks, TranscriberSegment, TranscriptionDriver } from "../sttHelper"

/**
 * Whisper as a live engine.
 *
 * Whisper cannot stream, so silero VAD decides where a speaker stopped and each completed utterance is
 * decoded in one go. The cost is latency: nothing appears until the speaker pauses. The gain is
 * accuracy on exactly what a church cares about, long stretches of speech and proper nouns.
 */

const WHISPER_FILES = {
    encoder: "turbo-encoder.int8.onnx",
    decoder: "turbo-decoder.int8.onnx",
    tokens: "turbo-tokens.txt",
    vad: "silero_vad.onnx"
} as const

export type WhisperWorkerRequest = { type: "start"; language?: string; modelDir?: string } | { type: "audio"; data: Uint8Array } | { type: "stop" }
export type WhisperWorkerResponse = { type: "ready" } | { type: "segment"; segment: TranscriberSegment } | { type: "interim"; text: string } | { type: "error"; message: string } | { type: "stopped" }

const SAMPLE_RATE = 16000
const VAD_THRESHOLD = 0.3
const VAD_MIN_SILENCE = 0.5
const VAD_MIN_SPEECH = 0.15
// hard split for a speaker who never pauses; whisper degrades past 30 seconds
const VAD_MAX_SPEECH = 20
const QUEUE_SECONDS = 60

type WhisperOptions = DriverCallbacks & { language?: string; modelDir?: string; sherpa?: any }

// whisper wants the languages it knows by name, not by ISO code
const LANGUAGE_NAMES: Record<string, string> = {
    en: "en",
    eng: "en",
    es: "es",
    spa: "es",
    fr: "fr",
    fra: "fr",
    de: "de",
    deu: "de",
    pt: "pt",
    por: "pt",
    yo: "yo",
    yor: "yo",
    ig: "ig",
    ibo: "ig",
    ar: "ar",
    zh: "zh",
    hi: "hi",
    ru: "ru",
    ko: "ko",
    ja: "ja",
    it: "it",
    nl: "nl",
    tr: "tr"
}

export function whisperLanguage(language?: string): string {
    const key = (language || "en").toLowerCase().split("-")[0]
    return LANGUAGE_NAMES[key] || "en"
}

/** Whisper's own ceiling: longer audio loses accuracy, so the thread count stays modest on small machines. */
export function whisperThreads(cpus = os.cpus().length): number {
    return Math.max(2, Math.min(4, Math.max(2, cpus - 1)))
}

export class WhisperDriver implements TranscriptionDriver {
    private options: WhisperOptions
    private recognizer: any = null
    private vad: any = null
    private stopped = false
    private totalSamples = 0
    private decodedUtterances = 0

    constructor(options: WhisperOptions) {
        this.options = options
    }

    async start(): Promise<void> {
        if (this.stopped) throw new Error("Driver already stopped")

        const sherpa = this.options.sherpa || require("sherpa-onnx-node")
        const { modelDir } = this.options
        if (!modelDir) throw new Error("Whisper model files are missing")

        this.recognizer = new sherpa.OfflineRecognizer({
            featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
            modelConfig: {
                whisper: {
                    encoder: path.join(modelDir, WHISPER_FILES.encoder),
                    decoder: path.join(modelDir, WHISPER_FILES.decoder),
                    language: whisperLanguage(this.options.language),
                    task: "transcribe",
                    tailPaddings: -1
                },
                tokens: path.join(modelDir, WHISPER_FILES.tokens),
                numThreads: whisperThreads(),
                provider: "cpu",
                debug: 0
            },
            decodingMethod: "greedy_search"
        })

        this.vad = new sherpa.Vad(
            {
                sileroVad: {
                    model: path.join(modelDir, WHISPER_FILES.vad),
                    threshold: VAD_THRESHOLD,
                    minSilenceDuration: VAD_MIN_SILENCE,
                    minSpeechDuration: VAD_MIN_SPEECH,
                    maxSpeechDuration: VAD_MAX_SPEECH,
                    windowSize: 512
                },
                sampleRate: SAMPLE_RATE,
                numThreads: 1,
                provider: "cpu"
            },
            QUEUE_SECONDS
        )
    }

    async stop(): Promise<void> {
        if (this.stopped) return
        this.stopped = true

        try {
            // the detector holds the last utterance until it is flushed
            this.vad?.flush()
            this.drain()
        } catch (err) {
            console.error("[whisper] Failed to flush the final utterance:", err)
        }

        this.recognizer = null
        this.vad = null
    }

    pushAudio(buffer: Uint8Array): void {
        if (this.stopped || !this.recognizer || !this.vad) return

        const samples = int16ToFloat32(buffer)
        if (!samples.length) return

        try {
            this.vad.acceptWaveform(samples)
            this.totalSamples += samples.length
            this.drain()
        } catch (err) {
            this.options.onError(String((err as Error)?.message || err))
        }
    }

    /** Decode every utterance the detector has finished. */
    private drain() {
        while (!this.vad.isEmpty()) {
            const segment = this.vad.front()
            this.vad.pop()
            if (!segment?.samples?.length) continue

            const stream = this.recognizer.createStream()
            stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: segment.samples })
            this.recognizer.decode(stream)
            const result = this.recognizer.getResult(stream)
            const text = (result?.text || "").trim()

            this.decodedUtterances++
            if (!text) continue

            const startMs = Math.round((segment.start / SAMPLE_RATE) * 1000)
            const endMs = Math.round(((segment.start + segment.samples.length) / SAMPLE_RATE) * 1000)

            this.options.onSegment({ text, startMs, endMs, utteranceEnd: true, language: whisperLanguage(this.options.language) })
        }
    }

    /** Number of utterances decoded so far, for the stall watchdog. */
    get decoded() {
        return this.decodedUtterances
    }

    get currentMs() {
        return Math.round((this.totalSamples / SAMPLE_RATE) * 1000)
    }
}

function int16ToFloat32(buffer: Uint8Array): Float32Array {
    const count = Math.floor(buffer.byteLength / 2)
    const samples = new Float32Array(count)
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    for (let i = 0; i < count; i++) {
        samples[i] = view.getInt16(i * 2, true) / 32768
    }
    return samples
}

// IPC Utility Process Worker Entrypoint
const parentPort = (process as any).parentPort
if (parentPort) {
    let driver: WhisperDriver | null = null
    const post = (msg: WhisperWorkerResponse) => parentPort.postMessage(msg)

    parentPort.on("message", async ({ data }: { data: WhisperWorkerRequest }) => {
        try {
            if (data.type === "start") {
                driver = new WhisperDriver({
                    language: data.language,
                    modelDir: data.modelDir,
                    onSegment: (segment) => post({ type: "segment", segment }),
                    onError: (message) => post({ type: "error", message })
                })
                await driver.start()
                post({ type: "ready" })
            } else if (data.type === "audio") {
                driver?.pushAudio(data.data)
            } else if (data.type === "stop") {
                await driver?.stop()
                driver = null
                post({ type: "stopped" })
            }
        } catch (err) {
            post({ type: "error", message: String((err as Error)?.message || err) })
        }
    })
}
