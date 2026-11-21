// Pure sermon note formatting. Lives outside the electron tree so the notes UI can use the same
// prompts, parser and markdown as the archive, without pulling fs into the renderer bundle.
import type { SermonDevotional, SermonNote, SermonQuizQuestion } from "./Sermon"

/**
 * Pewnote parity at the data layer: a sermon becomes a note file the church keeps, with an outline,
 * the scriptures that were actually referenced, a short devotional series and a recall quiz.
 *
 * Everything here is deterministic. The model writes prose; this decides the shape, the file name and
 * the markdown, so a bad model response can fail loudly instead of corrupting the archive.
 */

/** Safe, sortable file name: "2026-11-22 The Life That Purpose Built.md" */
export function noteFileName(title: string, date: string): string {
    const safe = (title || "Sermon")
        .replace(/[\\/:*?"<>|]/g, " ") // windows-illegal characters
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80)
    return `${date || "undated"} ${safe || "Sermon"}.md`
}

function list(items: string[] | undefined, empty = "none"): string {
    const clean = (items || []).map((item) => (item || "").trim()).filter(Boolean)
    return clean.length ? clean.join(", ") : empty
}

/** The note as markdown, which is what the archive holds and what an operator can read or print. */
export function serializeNote(note: SermonNote): string {
    const lines: string[] = []
    lines.push(`# ${note.title || "Untitled sermon"}`)
    lines.push("")
    lines.push(`- Date: ${note.date || "unknown"}`)
    if (note.tags?.length) lines.push(`- Series: ${list(note.tags)}`)
    if (note.scripture?.length) lines.push(`- Scripture: ${list(note.scripture)}`)
    lines.push("")

    if (note.summary) {
        lines.push("## Summary")
        lines.push("")
        lines.push(note.summary.trim())
        lines.push("")
    }

    if (note.outline?.length) {
        lines.push("## Outline")
        lines.push("")
        for (const section of note.outline) {
            lines.push(`### ${section.heading}`)
            for (const point of section.points || []) lines.push(`- ${point}`)
            lines.push("")
        }
    }

    if (note.devotionals?.length) {
        lines.push("## Devotionals")
        lines.push("")
        for (const day of note.devotionals) {
            lines.push(`### Day ${day.day}: ${day.title}`)
            if (day.scripture) lines.push(`*${day.scripture}*`)
            lines.push("")
            lines.push(day.body.trim())
            lines.push("")
        }
    }

    if (note.quiz?.length) {
        lines.push("## Quiz")
        lines.push("")
        note.quiz.forEach((question, index) => {
            lines.push(`${index + 1}. ${question.question}`)
            for (const option of question.options || []) lines.push(`   - ${option}`)
            lines.push(`   - Answer: ${question.answer}`)
        })
        lines.push("")
    }

    lines.push("## Transcript")
    lines.push("")
    lines.push((note.transcript || "").trim())
    lines.push("")

    return lines.join("\n")
}

/** Rebuild a note from its markdown, so the archive is plain files, not a database that can rot. */
export function parseNote(text: string, fallbackFileName = ""): SermonNote {
    const source = text || ""
    const title = (source.match(/^#\s+(.+)$/m) || [])[1]?.trim() || fallbackFileName.replace(/\.md$/, "") || "Untitled sermon"
    const date = (source.match(/^- Date:\s*(.+)$/m) || [])[1]?.trim() || ""
    const seriesLine = (source.match(/^- Series:\s*(.+)$/m) || [])[1]?.trim() || ""
    const scriptureLine = (source.match(/^- Scripture:\s*(.+)$/m) || [])[1]?.trim() || ""

    // split on top level headings; "### x" is a sub-heading and must not split
    const sections = new Map<string, string>()
    let current = ""
    let buffer: string[] = []
    for (const line of source.split("\n")) {
        const heading = line.match(/^##\s+(.+?)\s*$/)
        if (heading) {
            if (current) sections.set(current, buffer.join("\n").trim())
            current = heading[1]
            buffer = []
        } else if (current) buffer.push(line)
    }
    if (current) sections.set(current, buffer.join("\n").trim())

    const section = (heading: string): string => sections.get(heading) || ""

    const summary = section("Summary")
    const transcript = section("Transcript")

    const outline: SermonNote["outline"] = []
    for (const block of section("Outline").split(/^### /m).slice(1)) {
        const [heading, ...rest] = block.split("\n")
        outline.push({
            heading: heading.trim(),
            points: rest.map((line) => line.replace(/^-\s*/, "").trim()).filter(Boolean)
        })
    }

    const devotionals: SermonDevotional[] = []
    for (const block of section("Devotionals").split(/^### Day /m).slice(1)) {
        const [head, ...rest] = block.split("\n")
        const match = head.match(/^\s*(\d+):\s*(.*)$/)
        const bodyText = rest.join("\n").trim()
        const scripture = (bodyText.match(/^\*(.+)\*$/m) || [])[1]
        devotionals.push({
            day: match ? Number(match[1]) : devotionals.length + 1,
            title: match ? match[2].trim() : head.trim(),
            scripture,
            body: bodyText.replace(/^\*.+\*$/m, "").trim()
        })
    }

    const quiz: SermonQuizQuestion[] = []
    for (const line of section("Quiz").split("\n")) {
        const question = line.match(/^\d+\.\s+(.+)$/)
        if (question) quiz.push({ question: question[1].trim(), answer: "" })
        else if (/^\s*-\s*Answer:/i.test(line) && quiz.length) quiz[quiz.length - 1].answer = line.replace(/^\s*-\s*Answer:\s*/i, "").trim()
        else if (/^\s*-\s+/.test(line) && quiz.length) {
            const last = quiz[quiz.length - 1]
            last.options = [...(last.options || []), line.replace(/^\s*-\s+/, "").trim()]
        }
    }

    return {
        id: fallbackFileName.replace(/\.md$/, ""),
        title,
        date,
        startedAt: 0,
        transcript,
        summary,
        outline,
        scripture: scriptureLine ? scriptureLine.split(",").map((item) => item.trim()).filter(Boolean) : [],
        devotionals,
        quiz,
        tags: seriesLine ? seriesLine.split(",").map((item) => item.trim()).filter(Boolean) : []
    }
}

/** Ask for the note. The shape is fixed so the parser above always has something to read. */
export function buildNotesPrompt(transcript: string, title = ""): string {
    return [
        "You are helping a church keep the sermon after the service.",
        "Read the transcript and return ONLY JSON, no prose and no code fence, in this exact shape:",
        '{"title":"","summary":"","outline":[{"heading":"","points":[""]}],"scripture":["Book 1:1"],"tags":[""]}',
        "Rules: summary is 3 to 5 sentences in the preacher's own framing.",
        "outline has 3 to 6 headings, each with up to 4 short points.",
        "scripture lists only references the transcript actually quotes or names.",
        "tags are the theme or series, one or two words each.",
        title ? `The service is titled "${title}".` : "",
        "Transcript:",
        transcript
    ]
        .filter(Boolean)
        .join("\n")
}

export function buildDevotionalPrompt(summary: string, outline: string, days: number): string {
    return [
        `Write a ${days} day devotional series from this sermon.`,
        "Return ONLY JSON:",
        '{"devotionals":[{"day":1,"title":"","scripture":"Book 1:1","body":""}]}',
        "Each body is 120 to 180 words, warm and plain, ending with one question to sit with.",
        `Summary: ${summary}`,
        `Outline: ${outline}`
    ].join("\n")
}

export function buildQuizPrompt(summary: string, outline: string, questions: number): string {
    return [
        `Write ${questions} recall questions from this sermon for a congregation member.`,
        "Return ONLY JSON:",
        '{"quiz":[{"question":"","options":["","",""],"answer":""}]}',
        "Questions must be answerable from the sermon itself, not general Bible knowledge.",
        `Summary: ${summary}`,
        `Outline: ${outline}`
    ].join("\n")
}

/**
 * Read a model response into the shape we asked for.
 *
 * Models wrap JSON in fences, add a sentence before it, or return an array where an object was asked
 * for. All three are recovered here; anything else returns null so the caller can retry or show the
 * raw text rather than writing a broken note.
 */
export function parseModelJson<T = any>(raw: string): T | null {
    if (!raw) return null
    let text = raw.trim()

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenced) text = fenced[1].trim()

    if (!text.startsWith("{") && !text.startsWith("[")) {
        const start = text.search(/[[{]/)
        if (start === -1) return null
        text = text.slice(start)
    }

    const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"))
    if (end === -1) return null
    text = text.slice(0, end + 1)

    try {
        return JSON.parse(text) as T
    } catch {
        return null
    }
}

/** Merge what the model produced into a complete note, keeping the transcript we already have. */
export function assembleNote(draft: Omit<SermonNote, "devotionals" | "quiz">, extras: { devotionals?: SermonDevotional[]; quiz?: SermonQuizQuestion[] } = {}): SermonNote {
    return {
        ...draft,
        summary: (draft.summary || "").trim(),
        outline: (draft.outline || []).filter((section) => section.heading).map((section) => ({ heading: section.heading, points: (section.points || []).filter(Boolean) })),
        scripture: (draft.scripture || []).filter(Boolean),
        tags: (draft.tags || []).filter(Boolean),
        devotionals: extras.devotionals || [],
        quiz: extras.quiz || []
    }
}
