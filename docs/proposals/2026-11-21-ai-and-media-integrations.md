# Proposal: spoken-reference scripture, media panel parity, and BibleShow parity

Status: proposal, no code yet. Written 2026-11-21 after reverse engineering the three apps Grace City
actually runs beside FreeShow. Evidence for every claim below came from the shipped binaries with REA
(opens, managed-metadata inspection, embedded string and descriptor scans), not from marketing pages.

## What the three binaries are

| App | Binary | What REA found |
| --- | --- | --- |
| Pewbeam | `D:\Applications\Pewbeam.exe`, 76.6 MB | Tauri 1 shell over WebView2 plus a Rust core with `wgpu`. Not .NET, no CLI directory. Ships **local Whisper** (`resources/whisper-ggml-turbo/ggml-large-v3-turbo-q5_0.bin`, 547 MB), **EmbeddingGemma q4 ONNX** (188 MB) plus a 91 MB `verses_mapsorted_f32.bin` vector index, a 22 MB **cross-encoder int8 ONNX** for reranking, `mappings/dual_embeddinggemma_map.json` to map vector rows to verse references, language packs for en, fr, es, yo, ig, and full bible JSON per translation. Endpoints in the binary: `licensing.pewbeam.com/v1/accounts`, `slides.pewbeam.com`, `downloads.pewbeam.com`, `pewbeam.vercel.app/api/{deepgram-token,openai,assets,config}`, `v1/asr/realtime`, `v1/listen`. NDI output (1,362 NDI string hits). |
| Spotifast | `spotifast.exe`, 36.5 MB, Rust | librespot client, not a remote control: `login5.spotify.com/v3/login`, `apresolve.spotify.com`, `clienttoken.spotify.com`, WASAPI audio host, symphonia decoder. Uses the Web API too (`api.spotify.com/v1`, `accounts.spotify.com/api/token`), loopback OAuth on `127.0.0.1:34254`, and `lrclib.net/api` for lyrics. Local state as `app.ron`, `credentials`, `web_api_token`, `liked-songs`. |
| BibleShow 5.4 | `C:\BibleShow5\BibleShow.exe`, 1.7 MB | Managed **.NET Framework 4.5.2**, 114 types, 5,713 methods. NDI output through the official SDK P/Invoke (`NDI\Processing.NDI.Lib.x86.dll`, `NDIlib_send_video_v2`, FourCC BGRA/UYVY, tally). Types: `LoadVerses`, `SortBooks`, `TrBooks`, `RefBookLbl`, `DataOutput`, `DisplayEffect`, `Transition_SlideEffect`, `SlideAmount`, `ShowDuration`, `ApplyTheme`/`LoadTheme`, `OpenPlaylist`, `PlaylistModified`, `SystemEvents_DisplaySettingsChanged`. |

The interesting part is what each one solves that FreeShow does not.

## A. Spoken-reference scripture, offline (from Pewbeam)

Pewbeam's whole trick is a three stage retrieval pipeline that runs on the church PC with no cloud
round trip, and every stage is visible in its file layout:

1. **Transcribe** with local Whisper large-v3-turbo. It also has Deepgram and AssemblyAI paths for cloud,
   but the default is local.
2. **Embed** the transcript with EmbeddingGemma and compare against a precomputed vector per verse, in the
   `verses_mapsorted_f32.bin` index with a `map.json` row to reference.
3. **Rerank** the top candidates with a cross-encoder, which is the step that stops "John 3:16" and
   "1 John 3:16" from colliding.

Then it renders the winning verse and pushes it out over NDI.

We can build the same shape without Pewbeam's assets or licence:

- Transcription: `whisper.cpp` through its Node binding, or `nodejs-whisper`, on the same ggml large-v3-turbo
  weights (Whisper is MIT licensed; the ggml quantised weights are freely redistributable).
- Embedding and rerank: `onnxruntime-node` with either all-MiniLM (22 MB, Apache 2.0) or EmbeddingGemma q4
  if the Gemma Terms are acceptable. MiniLM is enough for verse matching and a seventh of the size.
- Vector index: build it at import time from the bibles FreeShow already imports, so no 91 MB sidecar and
  no licensing question about a third party's index. KJV is public domain; store one float32 vector per
  verse in a binary file next to the bible, rebuilt only when the bible changes.
- Reference parsing: regex pass first for explicit spoken references ("turn with me to Romans eight
  twenty-eight", ordinals, "chapter", "verse", "through"), embeddings only for the vague phrasing ("the
  one about all things working together"). Explicit references should never touch the model.

Effort: about a day for the ASR bridge and reference parser, a second for the index build and search, a
third for the settings, gating and the operator preview. Risk sits in false positives, so the feature must
be operator-confirmed by default: a candidate appears in a dock, one key sends it live. Never auto-send.

Value at Grace City: the pastor reads a reference aloud and the verse is on the wall without anyone typing.
That is the single biggest gap between us and Pewbeam.

## B. Media panel parity (from Spotifast)

Our fork already has `spotifyAuth.ts` (PKCE on the loopback literal) and `spotifyApi.ts`. Spotifast shows
the three things we are missing, all of them visible in its strings and state files:

- **Synced lyrics** from lrclib, which is free and unauthenticated: `lrclib.net/api/get` by track, title,
  artist and duration, returning timestamped lines. That gives us lyric display on the stage screen and a
  progress bar that matches the song, without Spotify's own lyric endpoint.
- **Local playback vs remote control**. Spotifast is a Connect device itself, so it plays audio directly.
  Our integration currently remote-controls whichever Spotify client is active. Both are valid, but the
  panel must say which it is doing, and a "play in this app" path needs librespot or a bundled player.
  Recommendation: stay remote-control for now, and be explicit in the UI.
- **Queue, device switch and liked songs** as first class controls, with `liked-songs` and `web_api_token`
  cached locally so the panel opens instantly and survives a token refresh.

Effort: half a day for lrclib lyrics plus tests, half a day for queue and device controls.

## C. BibleShow parity checklist

Nothing here is large, and two of the three are already done in this branch:

- NDI out: FreeShow already outputs NDI. Confirm the source name is stable so BibleShow era workflows that
  pointed at a source keep working.
- Playlists as service order: done (`propresenterPlaylist.ts`, playlists become Projects).
- Themes: done (themes become Templates, with the font fallback chains).
- Still missing: verse **range** display (`SlideAmount`, "show 3 verses per slide") and a duration readout
  per item (`ShowDuration`). Both are small additions to the verse picker and the show list.

## Recommendation

Build A first, because it is the only one that changes how a service runs, and it is the one thing the
other two apps do that we cannot do at all today. B next, since the plumbing is already in the fork. C last,
as cleanup.

Nothing in A or B needs a licence from Pewbeam or Spotifast, and neither binary is redistributed: they were
read, not copied.
