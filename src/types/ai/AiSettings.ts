export interface AiSettings {
    enabled?: boolean
    stt?: SttSettings
    llm?: LlmSettings

    scripture?: AiScriptureSettings
    lyrics?: AiLyricsSettings
}

interface SttSettings {
    // enabled?: boolean
    micDeviceId?: string

    engine?: string
    // per-engine options
    engineOptions?: {
        [key: string]: SttEngineOptions
    }
}

export interface SttEngineOptions {
    customPath?: string

    language?: string // transcription language
    model?: string
    customModelPath?: string

    // WIP interpretationMode
    interpretationMode?: boolean
    listenLanguage?: string
    spokenLanguages?: string[]
}

interface LlmSettings {
    provider?: string
    model?: string
}

export type ConfidenceLevels = "ask" | "highest" | "high" | "medium"
interface AiScriptureSettings {
    confidence?: ConfidenceLevels
}

/** Worship lyric recognition. Off unless a confidence level is chosen, since a wrong lyric is loud. */
interface AiLyricsSettings {
    confidence?: ConfidenceLevels
}
