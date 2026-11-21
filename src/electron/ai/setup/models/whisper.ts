import fs from "fs"
import path from "path"
import { ToMain } from "../../../../types/IPC/ToMain"
import { sendToMain } from "../../../IPC/main"
import { DownloadManager } from "../DownloadManager"
import type { ModelIntegrity } from "./whisperModel"
import { MODEL_BASE_URL, MODEL_REVISION, WHISPER_MODEL_BYTES, WHISPER_MODEL_FILES, WHISPER_VAD_FILE, WHISPER_VAD_SHA256, VAD_MODEL_URL } from "./whisperModel"

export { WHISPER_MODEL_BYTES, WHISPER_MODEL_FILES, WHISPER_VAD_FILE } from "./whisperModel"
export type { ModelIntegrity } from "./whisperModel"

const PINNED_FILES = [...Object.values(WHISPER_MODEL_FILES), { file: WHISPER_VAD_FILE, sha256: WHISPER_VAD_SHA256 }]
const STAMP_FILE = "model.json"

export class WhisperSetupManager {
    static isPlatformSupported(): boolean {
        return true
    }

    static getBinaryName() {
        return "whisper"
    }

    private static engineDLM: DownloadManager | null = null
    static getDownloadManager() {
        if (!this.engineDLM) this.engineDLM = new DownloadManager("whisper", "Whisper model")
        return this.engineDLM
    }

    static async downloadEngine(outputFolder: string) {
        const dlm = this.getDownloadManager()
        const jobs = [...Object.values(WHISPER_MODEL_FILES).map((entry) => ({ url: `${MODEL_BASE_URL}/${entry.file}`, ...entry })), { url: VAD_MODEL_URL, file: WHISPER_VAD_FILE, sha256: WHISPER_VAD_SHA256 }]
        const digests: Record<string, string> = {}
        let completedBytes = 0

        for (const job of jobs) {
            const target = path.join(outputFolder, job.file)

            if (await this.verifyEngine(target)) {
                const digest = await dlm.computeSha256(target)
                if (digest === job.sha256) {
                    digests[job.file] = digest
                    completedBytes += fs.statSync(target).size
                    continue
                }
                dlm.safeUnlink(target)
            }

            const base = completedBytes
            try {
                await dlm.downloadFile(job.url, target, {
                    onProgress: (bytes) => {
                        sendToMain(ToMain.MEDIA_DOWNLOAD_PROGRESS, {
                            url: dlm.key,
                            name: dlm.name,
                            progress: base + bytes,
                            total: WHISPER_MODEL_BYTES,
                            status: "downloading"
                        })
                    }
                })

                const digest = await dlm.computeSha256(target)
                if (digest !== job.sha256) {
                    dlm.safeUnlink(target)
                    throw new Error(`Downloaded ${job.file} failed checksum verification`)
                }
                digests[job.file] = digest
            } catch (err) {
                if (dlm.isAbortError(err)) return { ok: false, error: "Download was cancelled." }
                return dlm.reportError(`Failed to download the Whisper model: ${dlm.errorMessage(err)}`)
            }
            completedBytes = base + fs.statSync(target).size
        }

        await this.checkIntegrity(outputFolder, digests)
        return dlm.reportComplete()
    }

    static cancelEngineDownload() {
        this.getDownloadManager().cancel()
    }

    static async verifyEngine(binaryPath: string) {
        return Boolean(binaryPath && fs.existsSync(binaryPath) && fs.statSync(binaryPath).size > 1024)
    }

    static async checkIntegrity(modelDir: string, knownDigests?: Record<string, string>): Promise<ModelIntegrity> {
        if (!knownDigests && this.isStampValid(modelDir)) return "ok"

        const files: Record<string, { sha256: string; size: number; mtimeMs: number }> = {}
        let outdated = false

        for (const entry of PINNED_FILES) {
            const file = path.join(modelDir, entry.file)
            if (!fs.existsSync(file)) return "missing"

            const stats = fs.statSync(file)
            const digest = knownDigests?.[entry.file] ?? (await this.getDownloadManager().computeSha256(file))
            if (digest !== entry.sha256) outdated = true

            files[entry.file] = { sha256: digest, size: stats.size, mtimeMs: stats.mtimeMs }
        }

        if (outdated) return "outdated"

        try {
            fs.writeFileSync(path.join(modelDir, STAMP_FILE), JSON.stringify({ revision: MODEL_REVISION, files }, null, 4))
        } catch (err) {
            console.error("[whisper] Could not write the model stamp:", err)
        }
        return "ok"
    }

    private static isStampValid(modelDir: string): boolean {
        try {
            const stamp = JSON.parse(fs.readFileSync(path.join(modelDir, STAMP_FILE), "utf8"))
            if (stamp.revision !== MODEL_REVISION || !stamp.files) return false

            return PINNED_FILES.every((entry) => {
                const stamped = stamp.files[entry.file]
                if (!stamped || stamped.sha256 !== entry.sha256) return false
                const stats = fs.statSync(path.join(modelDir, entry.file))
                return stats.size === stamped.size && stats.mtimeMs === stamped.mtimeMs
            })
        } catch {
            return false
        }
    }
}
