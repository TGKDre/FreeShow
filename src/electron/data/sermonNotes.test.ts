import { describe, expect, it } from "vitest"
import type { SermonNote } from "../../types/ai/Sermon"
import { assembleNote, buildChunkSummaryPrompt, buildDevotionalPrompt, buildMergePrompt, buildNotesPrompt, buildQuizPrompt, chunkTranscript, noteFileName, parseModelJson, parseNote, serializeNote } from "./sermonNotes"

const note: SermonNote = {
    id: "2026-11-22 the-life-that-purpose-built",
    title: "The Life That Purpose Built",
    date: "2026-11-22",
    startedAt: 1,
    endedAt: 2,
    transcript: "Sin shall not have dominion over you.",
    summary: "Grace frees us from sin's dominion.",
    outline: [{ heading: "No longer under law", points: ["Grace abounds", "Sin loses its claim"] }],
    scripture: ["Romans 6:14", "Titus 2:11"],
    devotionals: [{ day: 1, title: "Freed", scripture: "Romans 6:14", body: "You are not under law but under grace." }],
    quiz: [{ question: "What does sin lose?", options: ["Dominion", "Nothing"], answer: "Dominion" }],
    tags: ["Grace", "Romans"]
}

describe("note file names", () => {
    it("prefixes the date and strips characters Windows refuses", () => {
        expect(noteFileName('Faith: what/now? "saves"', "2026-11-22")).toBe("2026-11-22 Faith what now saves.md")
    })

    it("never returns an empty name", () => {
        expect(noteFileName("", "")).toBe("undated Sermon.md")
    })

    it("caps very long titles", () => {
        expect(noteFileName("a".repeat(200), "2026-11-22").length).toBeLessThanOrEqual(120)
    })
})

describe("markdown round trip", () => {
    it("keeps every part of the note", () => {
        const rebuilt = parseNote(serializeNote(note), "2026-11-22 the-life-that-purpose-built.md")

        expect(rebuilt.title).toBe(note.title)
        expect(rebuilt.date).toBe(note.date)
        expect(rebuilt.summary).toBe(note.summary)
        expect(rebuilt.outline).toEqual(note.outline)
        expect(rebuilt.scripture).toEqual(note.scripture)
        expect(rebuilt.tags).toEqual(note.tags)
        expect(rebuilt.devotionals[0]).toMatchObject({ day: 1, title: "Freed", scripture: "Romans 6:14" })
        expect(rebuilt.devotionals[0].body).toContain("not under law but under grace")
        expect(rebuilt.quiz).toEqual(note.quiz)
        expect(rebuilt.transcript).toContain("Sin shall not have dominion")
    })

    it("survives a note with only a title", () => {
        const thin: SermonNote = { ...note, summary: "", outline: [], scripture: [], devotionals: [], quiz: [], tags: [], transcript: "" }
        const rebuilt = parseNote(serializeNote(thin), "x.md")
        expect(rebuilt.title).toBe(note.title)
        expect(rebuilt.outline).toEqual([])
        expect(rebuilt.quiz).toEqual([])
    })
})

describe("prompts", () => {
    it("asks for the exact JSON shape and includes the transcript", () => {
        const prompt = buildNotesPrompt("In Romans six fourteen Paul says sin shall not have dominion.", "Grace")
        expect(prompt).toContain('"outline"')
        expect(prompt).toContain("ONLY JSON")
        expect(prompt).toContain("Romans six fourteen")
        expect(prompt).toContain('"Grace"')
    })

    it("asks for a numbered devotional series and a quiz", () => {
        expect(buildDevotionalPrompt("summary", "outline", 5)).toContain("5 day devotional")
        expect(buildQuizPrompt("summary", "outline", 4)).toContain("4 recall questions")
    })
})

describe("reading model output", () => {
    it("reads plain JSON", () => {
        expect(parseModelJson('{"a":1}')).toEqual({ a: 1 })
    })

    it("unwraps a fenced block with chatter around it", () => {
        expect(parseModelJson('Here you go:\n```json\n{"a":2}\n```\nHope that helps')).toEqual({ a: 2 })
    })

    it("recovers JSON without a code fence", () => {
        expect(parseModelJson('Sure. {"a":3} That is all.')).toEqual({ a: 3 })
    })

    it("returns null when there is no JSON at all", () => {
        expect(parseModelJson("no json here")).toBeNull()
        expect(parseModelJson('{"broken": ')).toBeNull()
        expect(parseModelJson("")).toBeNull()
    })
})

describe("chunking a long service", () => {
    it("leaves a short transcript alone", () => {
        const short = "word ".repeat(200).trim()
        expect(chunkTranscript(short)).toHaveLength(1)
    })

    it("splits a long one with overlap so no sentence is cut in half", () => {
        const words = Array.from({ length: 3000 }, (_, index) => `w${index}`)
        const chunks = chunkTranscript(words.join(" "), 1200, 60)

        expect(chunks.length).toBeGreaterThan(1)
        // every word survives somewhere
        const seen = new Set(chunks.join(" ").split(" "))
        expect(seen.size).toBe(3000)
        // consecutive chunks share the overlap
        const firstTail = chunks[0].split(" ").slice(-1)[0]
        expect(chunks[1].split(" ")).toContain(firstTail)
    })

    it("returns nothing for an empty transcript", () => {
        expect(chunkTranscript("   ")).toEqual([])
    })
})

describe("part prompts", () => {
    it("names the part and asks for prose", () => {
        const prompt = buildChunkSummaryPrompt("the sermon", 2, 5)
        expect(prompt).toContain("part 2 of 5")
        expect(prompt).toContain("plain prose")
        expect(prompt).toContain("the sermon")
    })

    it("asks the merge for the same JSON shape as a single pass", () => {
        const prompt = buildMergePrompt(["first part", "second part"])
        expect(prompt).toContain('"outline"')
        expect(prompt).toContain("ONLY JSON")
        expect(prompt).toContain("Part 1: first part")
        expect(prompt).toContain("Part 2: second part")
    })
})

describe("assembling a note", () => {
    it("drops empty rows instead of storing blanks", () => {
        const draft = {
            id: "1",
            title: "Test",
            date: "2026-11-22",
            startedAt: 0,
            transcript: "t",
            summary: "  s  ",
            outline: [{ heading: "Keep", points: ["a", ""] }, { heading: "", points: ["dropped"] }],
            scripture: ["Romans 6:14", ""],
            tags: ["Grace", ""]
        }
        const built = assembleNote(draft, { devotionals: [{ day: 1, title: "d", body: "b" }] })
        expect(built.summary).toBe("s")
        expect(built.outline).toEqual([{ heading: "Keep", points: ["a"] }])
        expect(built.scripture).toEqual(["Romans 6:14"])
        expect(built.tags).toEqual(["Grace"])
        expect(built.devotionals).toHaveLength(1)
        expect(built.quiz).toEqual([])
    })
})
