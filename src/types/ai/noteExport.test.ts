import { describe, expect, it } from "vitest"
import type { SermonNote } from "./Sermon"
import { escapeHtml, noteToHtml, noteToText } from "./noteExport"

const note: SermonNote = {
    id: "2026-11-22-test",
    title: "Grace & Truth",
    date: "2026-11-22",
    startedAt: 0,
    transcript: "long transcript",
    summary: "Grace frees us from sin's dominion.",
    outline: [
        { heading: "Grace is unearned", points: ["Not by works", "Freely given"] },
        { heading: "Truth anchors us", points: ["The word is truth"] }
    ],
    scripture: ["John 1:17", "Ephesians 2:8-9"],
    devotionals: [],
    quiz: [],
    tags: ["grace", "truth"]
}

describe("plain text note", () => {
    it("carries the title, summary, scripture and outline", () => {
        const text = noteToText(note)
        expect(text).toContain("Grace & Truth")
        expect(text).toContain("2026-11-22")
        expect(text).toContain("Grace frees us from sin's dominion.")
        expect(text).toContain("- John 1:17")
        expect(text).toContain("Grace is unearned")
        expect(text).toContain("- Not by works")
    })

    it("has no markup, so it survives a chat message", () => {
        expect(noteToText(note)).not.toContain("<")
        expect(noteToText(note)).not.toContain("#")
    })
})

describe("shared page", () => {
    it("is a whole document with the outline in order", () => {
        const html = noteToHtml(note)
        expect(html.startsWith("<!doctype html>")).toBe(true)
        expect(html).toContain("<h1>Grace &amp; Truth</h1>")
        expect(html.indexOf("Grace is unearned")).toBeLessThan(html.indexOf("Truth anchors us"))
        expect(html).toContain("John 1:17")
    })

    it("escapes anything a preacher might have said", () => {
        const risky: SermonNote = { ...note, summary: 'He said "<script>alert(1)</script>" & moved on' }
        const html = noteToHtml(risky)
        expect(html).not.toContain("<script>alert(1)</script>")
        expect(html).toContain("&lt;script&gt;")
        expect(html).toContain("&amp; moved on")
    })

    it("stands alone: no network fonts, no scripts", () => {
        const html = noteToHtml(note)
        expect(html).not.toContain("<script")
        expect(html).not.toContain("http://")
        expect(html).not.toContain("https://")
    })

    it("escapes a bare string", () => {
        expect(escapeHtml("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;")
    })
})
