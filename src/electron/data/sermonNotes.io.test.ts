import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { SermonNote } from "../../types/ai/Sermon"
import { deleteNote, listNotes, loadNote, saveNote } from "./sermonNotes"

const note = (title: string, date: string): SermonNote => ({
    id: "",
    title,
    date,
    startedAt: 0,
    transcript: `${title} transcript`,
    summary: `${title} summary`,
    outline: [{ heading: "Point", points: ["one"] }],
    scripture: ["Romans 6:14"],
    devotionals: [],
    quiz: [],
    tags: []
})

let dir = ""

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sermon-notes-"))
})

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
})

describe("sermon note archive", () => {
    it("saves, lists and loads a note", () => {
        const file = saveNote(dir, note("Grace Over Sin", "2026-11-22"))
        expect(fs.existsSync(file)).toBe(true)

        const listed = listNotes(dir)
        expect(listed).toHaveLength(1)
        expect(listed[0]).toMatchObject({ date: "2026-11-22", title: "Grace Over Sin" })

        const loaded = loadNote(dir, listed[0].id)
        expect(loaded?.summary).toBe("Grace Over Sin summary")
        expect(loaded?.outline).toEqual([{ heading: "Point", points: ["one"] }])
    })

    it("lists newest first", () => {
        saveNote(dir, note("Older", "2026-11-01"))
        saveNote(dir, note("Newer", "2026-11-22"))
        expect(listNotes(dir).map((entry) => entry.title)).toEqual(["Newer", "Older"])
    })

    it("returns an empty list for a folder that does not exist", () => {
        expect(listNotes(path.join(dir, "missing"))).toEqual([])
    })

    it("returns null for a missing note and deletes an existing one", () => {
        saveNote(dir, note("Temp", "2026-11-22"))
        const [entry] = listNotes(dir)
        expect(deleteNote(dir, entry.id)).toBe(true)
        expect(loadNote(dir, entry.id)).toBeNull()
        expect(deleteNote(dir, entry.id)).toBe(false)
    })

    it("overwrites a note with the same title and date instead of duplicating", () => {
        saveNote(dir, note("Same", "2026-11-22"))
        const updated = { ...note("Same", "2026-11-22"), summary: "revised" }
        saveNote(dir, updated)
        expect(listNotes(dir)).toHaveLength(1)
        expect(loadNote(dir, listNotes(dir)[0].id)?.summary).toBe("revised")
    })
})
