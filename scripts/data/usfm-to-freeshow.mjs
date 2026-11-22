#!/usr/bin/env node
/**
 * Convert a USFM bible into FreeShow's bible JSON.
 *
 * Written for the Yoruba Contemporary Bible from eBible (CC BY-SA 4.0), but nothing here is Yoruba
 * specific: give it a folder of .usfm files named with a sortable prefix and it produces one bible.
 *
 * Usage: node scripts/data/usfm-to-freeshow.mjs <source dir> <output file> <id> "<full name>" "<copyright>"
 */
import fs from "fs"
import path from "path"

const [source, outFile, id, fullName, copyright] = process.argv.slice(2)
if (!source || !outFile || !id) {
    console.error('usage: usfm-to-freeshow.mjs <source dir> <output .json> <id> "<name>" "<copyright>"')
    process.exit(1)
}

const files = fs
    .readdirSync(source)
    .filter((file) => /\.(usfm|sfm)$/i.test(file))
    .sort((a, b) => {
        const na = parseInt(a, 10) || 0
        const nb = parseInt(b, 10) || 0
        return na - nb || a.localeCompare(b)
    })

/** Footnote and cross reference spans, then inline character markers, then paragraph markers. */
function clean(text) {
    return text
        .replace(/\\f\s[\s\S]*?\\f\*/g, "")
        .replace(/\\x\s[\s\S]*?\\x\*/g, "")
        .replace(/\\w\s([^|\\]*)(\|[^\\]*)?\\w\*/g, "$1")
        .replace(/\\\+?[a-z]{1,3}\d?\s?/gi, "")
        .replace(/\s+/g, " ")
        .replace(/[|]/g, " ")
        .trim()
}

function parseBook(file) {
    const raw = fs.readFileSync(file, "utf8")
    let name = ""
    let abbreviation = ""
    let code = ""

    const chapters = []
    let chapter = null
    let verse = null

    for (const line of raw.split(/\r?\n/)) {
        const marker = line.match(/^\\(\w+)\d?\*?\s*(.*)$/)
        if (!marker) {
            // a wrapped continuation of the verse before it
            if (verse && line.trim()) verse.text += " " + line
            continue
        }

        const [, tag, rest] = marker

        if (tag === "id") code = rest.split(/\s+/)[0] || ""
        else if (tag === "h" && !name) name = clean(rest)
        else if (tag === "toc2" && !name) name = clean(rest)
        else if (tag === "toc3" && !abbreviation) abbreviation = clean(rest)
        else if (tag === "c") {
            const number = parseInt(rest, 10)
            if (Number.isFinite(number)) {
                chapter = { number, verses: [] }
                chapters.push(chapter)
                verse = null
            }
        } else if (tag === "v") {
            const match = rest.match(/^(\d+)\s*([\s\S]*)$/)
            if (match && chapter) {
                verse = { number: parseInt(match[1], 10), text: match[2] || "" }
                chapter.verses.push(verse)
            }
        } else if (verse && /^(p|q\d?|m|mi|pi\d?|li\d?|nb|pc|pr|cls|qr|qc|qm\d?|d|sp)$/.test(tag)) {
            if (rest.trim()) verse.text += " " + rest
        }
        // section headings, titles and introductions are dropped: a slide needs the verse, not the heading
    }

    const verses = chapters.flatMap((chapter) => chapter.verses).filter((verse) => verse.text.trim())
    if (!verses.length) return null

    return {
        code,
        name: name || path.basename(file, path.extname(file)),
        abbreviation,
        chapters: chapters
            .map((chapter) => ({
                number: chapter.number,
                verses: chapter.verses.map((verse) => ({ number: verse.number, text: clean(verse.text) })).filter((verse) => verse.text)
            }))
            .filter((chapter) => chapter.verses.length)
    }
}

const books = []
for (const file of files) {
    const book = parseBook(path.join(source, file))
    if (!book) continue
    books.push({
        number: books.length + 1,
        name: book.name,
        abbreviation: book.abbreviation || undefined,
        chapters: book.chapters
    })
}

const totalVerses = books.reduce((sum, book) => sum + book.chapters.reduce((inner, chapter) => inner + chapter.verses.length, 0), 0)

const bible = {
    id,
    name: fullName || id,
    metadata: { abbreviation: id, source: "eBible USFM" },
    copyright: copyright || "",
    books
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(bible), "utf8")
console.log(`${id}: ${books.length} books, ${totalVerses} verses, ${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB`)
