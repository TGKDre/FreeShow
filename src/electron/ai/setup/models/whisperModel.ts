// The pinned files themselves, kept free of electron imports so they can be tested and reused.
// Whisper large-v3-turbo, int8, exported for sherpa-onnx. This is the model Pewbeam uses as its
// accuracy reference, and it is a batch recogniser rather than a streaming one: it decodes a whole
// utterance once the VAD says the speaker stopped. Slower to the first word than Nemotron, sharper on
// long sermons and on names.
//
// Hosted as individual files on Hugging Face, pinned to a revision, so what lands is exactly what was
// measured here (0% word error on the model's own 0.wav, 6% on 1.wav, spelling aside).
export const MODEL_REVISION = "2ca6ff69fc878651b770880507669577ac41c2ff"
const MODEL_REPO = "csukuangfj/sherpa-onnx-whisper-turbo"
export const MODEL_BASE_URL = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}`

// sizes are the real byte counts of the pinned files, so the progress bar adds up and a truncated
// download is caught before the model is offered
export const WHISPER_MODEL_FILES = {
    encoder: { file: "turbo-encoder.int8.onnx", sha256: "b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b", size: 674_716_297 },
    decoder: { file: "turbo-decoder.int8.onnx", sha256: "20accd02388482eb3a46bd615631adfdc85e1eb2c7db9ea3f02a40ffe6b81547", size: 361_080_764 },
    tokens: { file: "turbo-tokens.txt", sha256: "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126", size: 816_730 }
}

export const WHISPER_VAD_FILE = "silero_vad.onnx"
export const WHISPER_VAD_SHA256 = "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"
export const VAD_MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"

export const WHISPER_VAD_BYTES = 643_854

export const WHISPER_MODEL_BYTES = Object.values(WHISPER_MODEL_FILES).reduce((total, entry) => total + entry.size, 0) + WHISPER_VAD_BYTES

export type ModelIntegrity = "ok" | "missing" | "outdated"
