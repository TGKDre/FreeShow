import path from "path"
import type { SttEngineOptions } from "../../../../types/ai/AiSettings"
import { LocalModelManager } from "../../setup/LocalModelManager"
import type { TranscriberSegment } from "../sttHelper"
import type { WhisperWorkerRequest, WhisperWorkerResponse } from "./whisperWorker"

const WORKER_START_TIMEOUT = 60000
const WORKER_FLUSH_TIMEOUT = 30000

/**
 * Runs Whisper in its own process so a long decode cannot freeze the interface.
 *
 * Whisper decodes whole utterances, so a stop can take seconds; the flush timeout is long for that
 * reason, and audio arriving while a decode is in flight simply queues in the child process.
 */
export class WhisperTranscriber {
    private options: SttEngineOptions
    private onSegment: (segment: TranscriberSegment) => void
    private onError: (message: string) => void

    private child: Electron.UtilityProcess | null = null
    private stopped = false
    private stoppedResolve: (() => void) | null = null
    private readyResolve: ((ok: boolean) => void) | null = null
    private startErrorMessage = ""

    constructor(options: SttEngineOptions, onSegment: (segment: TranscriberSegment) => void, onError: (message: string) => void) {
        this.options = options
        this.onSegment = onSegment
        this.onError = onError
    }

    async start() {
        const modelDir = LocalModelManager.getModelDir("whisper")

        let child: Electron.UtilityProcess
        try {
            const { utilityProcess } = require("electron") as typeof import("electron")
            if (!utilityProcess?.fork) throw new Error("Utility process unavailable")
            child = utilityProcess.fork(path.join(__dirname, "./whisperWorker.js"), [], { serviceName: "FreeShow AI transcription" })
        } catch (err) {
            throw new Error(`Could not start the Whisper process: ${String((err as Error)?.message || err)}`)
        }

        this.child = child
        child.on("message", (msg: WhisperWorkerResponse) => this.handleMessage(msg))
        child.on("exit", (code) => {
            if (this.child !== child) return
            this.child = null
            this.readyResolve?.(false)
            this.stoppedResolve?.()
            if (!this.stopped) this.onError(`Whisper transcription process exited unexpectedly (code ${code})`)
        })

        this.post({ type: "start", language: this.options.language || "en", modelDir })

        const ok = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
                this.readyResolve = null
                resolve(false)
            }, WORKER_START_TIMEOUT)
            this.readyResolve = (value: boolean) => {
                clearTimeout(timer)
                this.readyResolve = null
                resolve(value)
            }
        })

        if (!ok) {
            this.child = null
            try {
                child.kill()
            } catch {}
            throw new Error(this.startErrorMessage || "Whisper could not load its model")
        }

        return true
    }

    async stop() {
        this.stopped = true
        const { child } = this
        this.child = null

        if (child) {
            try {
                this.post({ type: "stop" }, child)
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, WORKER_FLUSH_TIMEOUT)
                    this.stoppedResolve = () => {
                        clearTimeout(timer)
                        resolve()
                    }
                })
            } catch {}
            try {
                child.kill()
            } catch {}
        }

        return true
    }

    pushAudio(buffer: Uint8Array) {
        if (!this.child) return false
        this.post({ type: "audio", data: buffer })
        return true
    }

    private handleMessage(message: WhisperWorkerResponse) {
        if (!message || typeof message !== "object") return

        const handlers: Record<string, () => void> = {
            segment: () => message.type === "segment" && this.onSegment(message.segment),
            ready: () => this.readyResolve?.(true),
            stopped: () => this.stoppedResolve?.(),
            error: () => {
                if (message.type !== "error") return
                if (this.readyResolve) {
                    this.startErrorMessage = message.message
                    this.readyResolve(false)
                } else if (!this.stopped) {
                    this.onError(message.message)
                }
            }
        }

        handlers[message.type]?.()
    }

    private post(message: WhisperWorkerRequest, child = this.child) {
        try {
            child?.postMessage(message)
        } catch (err) {
            console.error("[whisper] Failed to reach the decode process:", err)
        }
    }
}
