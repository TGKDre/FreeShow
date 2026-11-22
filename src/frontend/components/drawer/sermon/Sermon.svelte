<script lang="ts">
    import type { LexiconEntry } from "../../../../types/ai/Lexicon"
    import type { SermonNote } from "../../../../types/ai/Sermon"
    import { Main } from "../../../../types/IPC/Main"
    import { noteToText } from "../../../../types/ai/noteExport"
    import { assembleNote, buildChunkSummaryPrompt, buildDevotionalPrompt, buildMergePrompt, buildNotesPrompt, buildQuizPrompt, chunkTranscript, parseModelJson } from "../../../../types/ai/sermonFormat"
    import { convertText } from "../../../converters/txt"
    import { getFirstActiveOutput } from "../../helpers/output"
    import { getLayoutRef } from "../../helpers/show"
    import { updateOut } from "../../helpers/showActions"
    import { getLLMManager } from "../../../ai/llm/llmManager"
    import { lookupAnywhere } from "../../../ai/lexicon/Lexicon"
    import { requestMain } from "../../../IPC/main"
    import { drawerTabsData, sttTranscript } from "../../../stores"
    import MaterialButton from "../../inputs/MaterialButton.svelte"

    export let active: string | null

    let mode: "notes" | "study" | "announce" = active === "study" ? "study" : "notes"
    let status = ""
    let busy = false

    // --- sermon notes ---
    let notes: { id: string; title: string; date: string }[] = []
    let selected: SermonNote | null = null

    async function refreshNotes() {
        notes = (await requestMain(Main.LIST_SERMON_NOTES)) || []
    }

    async function openNote(id: string) {
        selected = await requestMain(Main.LOAD_SERMON_NOTE, { id })
        status = ""
    }

    // the transcript is editable before it is written into the archive: one misheard name would
    // otherwise live in the note forever
    let transcriptDraft = ""
    let transcriptTouched = false

    function liveTranscript(): string {
        const { finalized = "", unprocessed = "" } = $sttTranscript || {}
        return `${finalized} ${unprocessed}`.trim()
    }

    // follow the live transcript until somebody edits it, then leave their text alone
    $: if (!transcriptTouched && $sttTranscript) transcriptDraft = liveTranscript()

    function useLiveTranscript() {
        transcriptTouched = false
        transcriptDraft = liveTranscript()
        status = transcriptDraft ? "Transcript reloaded." : "Speech to text has not produced anything yet."
    }

    function transcriptText(): string {
        return (transcriptDraft || "").trim()
    }

    // request() already returns parsed JSON, but a provider that ignores the schema can still hand
    // back a string, so both paths go through the same reader
    function readModelResult(raw: any): any {
        if (!raw) return null
        return typeof raw === "string" ? parseModelJson(raw) : raw
    }

    async function saveNote(note: SermonNote, message: string) {
        const saved = await requestMain(Main.SAVE_SERMON_NOTE, note)
        await refreshNotes()
        if (saved?.path) {
            selected = note
            status = message
        } else status = "Could not write the note. Check the Sermon Notes folder."
    }

    /** A page the congregation can open on a phone or print, written beside the markdown. */
    async function shareNote() {
        if (!selected) return
        const result = await requestMain(Main.SHARE_SERMON_NOTE, selected)
        status = result?.path ? `Page written: ${result.path.split(/[\\/]/).pop()}` : "Could not write the page."
    }

    /** The same note as plain text, for WhatsApp or a message to the team. */
    async function copyNoteText() {
        if (!selected) return
        try {
            await navigator.clipboard.writeText(noteToText(selected))
            status = "Note copied as text."
        } catch {
            status = "The clipboard refused. Try Share page instead."
        }
    }

    async function generateNote() {
        const transcript = transcriptText()
        if (!transcript) {
            status = "There is no transcript yet. Turn on speech to text and let it listen first."
            return
        }

        const llm = getLLMManager()
        if (!llm) {
            status = "Choose an AI provider in Settings > AI first."
            return
        }

        busy = true
        try {
            // a long service does not fit one prompt, so each part is summarised first and the
            // summaries are merged; the middle of the sermon is exactly what gets lost otherwise
            const chunks = chunkTranscript(transcript)
            let prompt = buildNotesPrompt(transcript)

            if (chunks.length > 1) {
                const summaries: string[] = []
                for (let index = 0; index < chunks.length; index++) {
                    status = `Reading part ${index + 1} of ${chunks.length}...`
                    const summary = await llm.requestText({ prompt: buildChunkSummaryPrompt(chunks[index], index + 1, chunks.length) })
                    if (summary) summaries.push(summary.trim())
                }

                if (!summaries.length) {
                    status = "The model did not return anything usable."
                    return
                }
                prompt = buildMergePrompt(summaries)
            }

            status = "Writing the note..."
            const parsed = readModelResult(await llm.request<any>({ prompt }))
            if (!parsed) {
                status = "The model did not return usable JSON. Try again, or with a stronger model."
                return
            }

            const now = new Date()
            const note = assembleNote({
                id: "",
                title: parsed.title || "Untitled sermon",
                date: now.toISOString().slice(0, 10),
                startedAt: now.getTime(),
                endedAt: now.getTime(),
                transcript,
                summary: parsed.summary || "",
                outline: parsed.outline || [],
                scripture: parsed.scripture || [],
                tags: parsed.tags || []
            })
            await saveNote(note, "Note saved.")
        } finally {
            busy = false
        }
    }

    async function addDevotionals(days: number) {
        if (!selected) return
        const llm = getLLMManager()
        if (!llm) return

        busy = true
        status = `Writing ${days} days...`
        try {
            const outline = selected.outline.map((section) => section.heading).join("; ")
            const parsed = readModelResult(await llm.request<any>({ prompt: buildDevotionalPrompt(selected.summary, outline, days) }))
            const devotionals = parsed?.devotionals
            if (!Array.isArray(devotionals) || !devotionals.length) {
                status = "The model did not return usable devotionals."
                return
            }
            await saveNote({ ...selected, devotionals }, "Devotionals added.")
        } finally {
            busy = false
        }
    }

    async function addQuiz(count: number) {
        if (!selected) return
        const llm = getLLMManager()
        if (!llm) return

        busy = true
        status = "Writing questions..."
        try {
            const outline = selected.outline.map((section) => section.heading).join("; ")
            const parsed = readModelResult(await llm.request<any>({ prompt: buildQuizPrompt(selected.summary, outline, count) }))
            const quiz = parsed?.quiz
            if (!Array.isArray(quiz) || !quiz.length) {
                status = "The model did not return usable questions."
                return
            }
            await saveNote({ ...selected, quiz }, "Quiz added.")
        } finally {
            busy = false
        }
    }

    // --- announcements ---
    let announcement = ""
    // what was on screen before the announcement, so a wrong click is one click to undo
    let previousSlide: { id: string; index: number } | null = null

    function sendAnnouncement() {
        const text = announcement.trim()
        if (!text) return

        const output = getFirstActiveOutput()
        const slide = output?.out?.slide
        previousSlide = slide?.id && slide.index !== undefined ? { id: slide.id, index: slide.index } : null

        // convertText opens the created show, and a slide with no bindings goes to every active output
        convertText({ name: "Announcement", category: null, text })
        announcement = ""
        status = "Sent."
    }

    function backToPrevious() {
        if (!previousSlide) return

        const layout = getLayoutRef(previousSlide.id)
        if (!layout.length) {
            status = "That slide is no longer loaded."
            return
        }

        updateOut(previousSlide.id, previousSlide.index, layout)
        status = "Back to the previous slide."
    }

    // --- word study ---
    let query = ""
    let results: LexiconEntry[] = []
    let entry: LexiconEntry | null = null
    let studyStatus = ""

    async function search() {
        const text = query.trim()
        if (!text) return
        studyStatus = "Looking..."
        results = await lookupAnywhere(text)
        entry = results[0] || null
        studyStatus = results.length ? "" : "Nothing found. Try a Strong's number like G26 or a word."
    }

    function presentEntry() {
        if (!entry) return

        const lines = [entry.lemma, `${entry.strongs} · ${entry.translit}${entry.pron ? ` · ${entry.pron}` : ""}`, entry.definition, entry.kjv ? `KJV: ${entry.kjv}` : ""].filter(Boolean)
        convertText({ name: entry.strongs, category: null, text: lines.join("\n") })
        studyStatus = "Sent to the screens."
    }

    function copy(text: string) {
        navigator.clipboard?.writeText(text)
        studyStatus = "Copied."
    }

    // the drawer assumes every tab id has an entry before it reads activeSubTab
    drawerTabsData.update((a) => {
        if (!a.sermon) a.sermon = { enabled: true, activeSubTab: null }
        return a
    })

    refreshNotes()
</script>

<div class="sermon">
    <div class="switch">
        <button class:active={mode === "notes"} on:click={() => (mode = "notes")}>Sermon notes</button>
        <button class:active={mode === "study"} on:click={() => (mode = "study")}>Word study</button>
        <button class:active={mode === "announce"} on:click={() => (mode = "announce")}>Announce</button>
    </div>

    {#if mode === "announce"}
        <p class="empty">Plain text becomes a slide and goes out on every output that has no fixed binding, the same path quick text uses.</p>
        <textarea class="search" rows="6" bind:value={announcement} placeholder="This Sunday: prayer at 9:30, service at 10."></textarea>
        <div class="row">
            <MaterialButton icon="play_arrow" on:click={sendAnnouncement}>Show on all screens</MaterialButton>
            {#if previousSlide}
                <MaterialButton icon="undo" on:click={backToPrevious}>Back to previous slide</MaterialButton>
            {/if}
        </div>
        {#if status}<p class="status">{status}</p>{/if}
    {:else if mode === "notes"}
        <div class="row">
            <MaterialButton icon="add" on:click={generateNote} disabled={busy}>Note from transcript</MaterialButton>
            <MaterialButton icon="refresh" on:click={useLiveTranscript} disabled={busy}>Reload transcript</MaterialButton>
            <MaterialButton icon="refresh" on:click={refreshNotes} disabled={busy}>Refresh notes</MaterialButton>
        </div>

        <details class="transcript">
            <summary>Transcript draft ({transcriptDraft.length} characters)</summary>
            <textarea
                class="search"
                rows="8"
                bind:value={transcriptDraft}
                on:input={() => (transcriptTouched = true)}
                placeholder="The transcript appears here once speech to text is running. Fix names and numbers before saving."
            ></textarea>
        </details>

        {#if status}<p class="status">{status}</p>{/if}

        <div class="columns">
            <div class="list">
                {#each notes as note (note.id)}
                    <button class="item" class:selected={selected?.id === note.id} on:click={() => openNote(note.id)}>
                        <span class="date">{note.date}</span>
                        <span class="title">{note.title}</span>
                    </button>
                {:else}
                    <p class="empty">No notes yet. Turn on speech to text, then press Note from transcript.</p>
                {/each}
            </div>

            <div class="detail">
                {#if selected}
                    <h3>{selected.title}</h3>
                    <p class="meta">{selected.date}{selected.scripture?.length ? ` · ${selected.scripture.join(", ")}` : ""}</p>
                    {#if selected.summary}<p class="summary">{selected.summary}</p>{/if}

                    {#if selected.outline?.length}
                        <ul class="outline">
                            {#each selected.outline as section}
                                <li>
                                    <strong>{section.heading}</strong>
                                    {#if section.points?.length}
                                        <ul>
                                            {#each section.points as point}<li>{point}</li>{/each}
                                        </ul>
                                    {/if}
                                </li>
                            {/each}
                        </ul>
                    {/if}

                    <div class="row">
                        <MaterialButton icon="share" on:click={shareNote} disabled={busy}>Share page</MaterialButton>
                        <MaterialButton icon="copy" on:click={copyNoteText} disabled={busy}>Copy text</MaterialButton>
                    </div>

                    <div class="row">
                        <MaterialButton on:click={() => addDevotionals(3)} disabled={busy}>3 day devotional</MaterialButton>
                        <MaterialButton on:click={() => addDevotionals(7)} disabled={busy}>7 day</MaterialButton>
                        <MaterialButton on:click={() => addQuiz(5)} disabled={busy}>Quiz</MaterialButton>
                    </div>

                    {#if selected.devotionals?.length}
                        {#each selected.devotionals as day}
                            <div class="block">
                                <strong>Day {day.day}: {day.title}</strong>
                                {#if day.scripture}<em>{day.scripture}</em>{/if}
                                <p>{day.body}</p>
                            </div>
                        {/each}
                    {/if}

                    {#if selected.quiz?.length}
                        {#each selected.quiz as question, index}
                            <div class="block">
                                <strong>{index + 1}. {question.question}</strong>
                                {#if question.options?.length}<p>{question.options.join(" / ")}</p>{/if}
                                <p class="answer">Answer: {question.answer}</p>
                            </div>
                        {/each}
                    {/if}
                {:else}
                    <p class="empty">Pick a note to read it, or start a new one from the transcript.</p>
                {/if}
            </div>
        </div>
    {:else}
        <div class="row">
            <input
                class="search"
                placeholder="G26, H430, agape, mercy..."
                bind:value={query}
                on:keydown={(e) => e.key === "Enter" && search()}
            />
            <MaterialButton icon="search" on:click={search}>Search</MaterialButton>
        </div>

        {#if studyStatus}<p class="status">{studyStatus}</p>{/if}

        <div class="columns">
            <div class="list">
                {#each results as result (result.strongs)}
                    <button class="item" class:selected={entry?.strongs === result.strongs} on:click={() => (entry = result)}>
                        <span class="date">{result.strongs}</span>
                        <span class="title">{result.translit || result.lemma}</span>
                    </button>
                {/each}
            </div>

            <div class="detail">
                {#if entry}
                    <h3>{entry.lemma} <span class="meta">{entry.strongs}</span></h3>
                    <p class="meta">{entry.translit}{entry.pron ? ` · ${entry.pron}` : ""}</p>
                    {#if entry.definition}<p class="summary">{entry.definition}</p>{/if}
                    {#if entry.kjv}<p class="meta">KJV: {entry.kjv}</p>{/if}
                    {#if entry.derivation}<p class="meta">{entry.derivation}</p>{/if}
                    <div class="row">
                        <MaterialButton icon="play_arrow" on:click={presentEntry}>Show it</MaterialButton>
                        <MaterialButton on:click={() => copy(`${entry.lemma} (${entry.strongs}) ${entry.translit || ""}: ${entry.definition || ""}`)}>Copy</MaterialButton>
                    </div>
                {:else}
                    <p class="empty">Search a Strong's number, a transliteration like agape, or an English word.</p>
                {/if}
            </div>
        </div>
    {/if}
</div>

<style>
    .sermon {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px;
        height: 100%;
        overflow: hidden;
        color: var(--text);
    }

    .switch {
        display: flex;
        gap: 4px;
    }

    .switch button {
        flex: 1;
        padding: 6px;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--text);
        opacity: 0.6;
        cursor: pointer;
    }

    .switch button.active {
        opacity: 1;
        background: var(--secondary, #333);
        color: var(--secondary-text, #fff);
    }

    .row {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        align-items: center;
    }

    .status {
        margin: 0;
        font-size: 0.85em;
        opacity: 0.8;
    }

    .columns {
        display: flex;
        gap: 8px;
        min-height: 0;
        flex: 1;
    }

    .list {
        width: 40%;
        min-width: 140px;
        overflow-y: auto;
    }

    .item {
        display: flex;
        flex-direction: column;
        width: 100%;
        text-align: left;
        padding: 6px;
        border: none;
        border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.1));
        background: transparent;
        color: var(--text);
        cursor: pointer;
    }

    .item.selected {
        background: var(--secondary, #333);
        color: var(--secondary-text, #fff);
    }

    .date {
        font-size: 0.75em;
        opacity: 0.7;
    }

    .detail {
        flex: 1;
        overflow-y: auto;
        min-width: 0;
    }

    h3 {
        margin: 0 0 2px;
        font-size: 1em;
    }

    .meta {
        margin: 0 0 6px;
        font-size: 0.8em;
        opacity: 0.7;
    }

    .summary {
        margin: 0 0 8px;
        font-size: 0.9em;
    }

    .outline {
        margin: 0 0 8px;
        padding-left: 16px;
        font-size: 0.9em;
    }

    .block {
        margin: 8px 0;
        font-size: 0.9em;
    }

    .block p {
        margin: 2px 0;
    }

    .answer {
        opacity: 0.7;
    }

    .empty {
        font-size: 0.85em;
        opacity: 0.6;
    }

    .transcript {
        font-size: 0.85em;
    }

    .transcript summary {
        cursor: pointer;
        opacity: 0.8;
        margin-bottom: 4px;
    }

    .transcript textarea {
        width: 100%;
        resize: vertical;
    }

    .search {
        flex: 1;
        padding: 6px;
        border-radius: 4px;
        border: 1px solid var(--border, rgba(255, 255, 255, 0.2));
        background: transparent;
        color: var(--text);
    }
</style>
