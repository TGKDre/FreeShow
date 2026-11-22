import fs from "fs"
import path from "path"
import { noteFileName, parseNote, serializeNote } from "../../types/ai/sermonFormat"
import type { SermonNote } from "../../types/ai/Sermon"
import { noteToHtml } from "../../types/ai/noteExport"

export * from "../../types/ai/sermonFormat"
export type { SermonDevotional, SermonNote, SermonQuizQuestion } from "../../types/ai/Sermon"

export interface NoteSummary {
    id: string
    title: string
    date: string
    file: string
}

/** Write the note as markdown into the archive directory. Returns the file path. */
export function saveNote(dir: string, note: SermonNote): string {
    fs.mkdirSync(dir, { recursive: true })
    const file = noteFileName(note.title, note.date)
    const fullPath = path.join(dir, file)
    fs.writeFileSync(fullPath, serializeNote(note), "utf8")
    return fullPath
}

/**
 * The same note as a page the congregation can open on a phone.
 *
 * Saved beside the markdown so one note stays one thing on disk, named the same, and the operator can
 * send the file, print it, or open it in front of the room.
 */
export function saveNotePage(dir: string, note: SermonNote): string {
    fs.mkdirSync(dir, { recursive: true })
    const fullPath = path.join(dir, noteFileName(note.title, note.date).replace(/\.md$/i, ".html"))
    fs.writeFileSync(fullPath, noteToHtml(note), "utf8")
    return fullPath
}

/** Newest first, read from the file names so listing stays cheap on a large archive. */
export function listNotes(dir: string): NoteSummary[] {
    if (!fs.existsSync(dir)) return []
    const files = fs.readdirSync(dir).filter((file) => file.toLowerCase().endsWith(".md"))

    return files
        .map((file) => {
            const stem = file.replace(/\.md$/i, "")
            const match = stem.match(/^(\d{4}-\d{2}-\d{2})\s+(.*)$/)
            return {
                id: stem,
                date: match ? match[1] : "",
                title: (match ? match[2] : stem) || "Untitled sermon",
                file
            }
        })
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title)))
}

export function loadNote(dir: string, id: string): SermonNote | null {
    const file = path.join(dir, id.endsWith(".md") ? id : `${id}.md`)
    if (!fs.existsSync(file)) return null
    try {
        return parseNote(fs.readFileSync(file, "utf8"), path.basename(file))
    } catch (error) {
        console.warn("could not read sermon note:", error)
        return null
    }
}

export function deleteNote(dir: string, id: string): boolean {
    const file = path.join(dir, id.endsWith(".md") ? id : `${id}.md`)
    if (!fs.existsSync(file)) return false
    fs.unlinkSync(file)
    return true
}
