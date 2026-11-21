#!/usr/bin/env node
/**
 * Convert BibleShow's Access databases (.bib) into FreeShow bible JSON.
 *
 * BibleShow keeps everything in one table: Bible(ID, Book, Chapter, Verse, Scripture, Sync), with the
 * book list in Structure and the name in Info. That maps straight onto FreeShow's
 * books[].chapters[].verses[] shape, so nothing is lost and no scraping is involved.
 *
 * Usage: node scripts/data/bibleshow-to-freeshow.mjs <source dir> <output dir>
 */
import fs from "fs"
import path from "path"
import MDBReader from "mdb-reader"

const source = path.resolve(process.argv[2] || "")
const output = path.resolve(process.argv[3] || path.join(import.meta.dirname, "..", "assets", "data", "bibles"))

if (!source || !fs.existsSync(source)) {
    console.error("usage: bibleshow-to-freeshow.mjs <source dir> <output dir>")
    process.exit(1)
}

fs.mkdirSync(output, { recursive: true })

function readInfo(table) {
    const info = {}
    for (const row of table.getData()) {
        if (row.Parameter) info[String(row.Parameter).toLowerCase()] = String(row.Value ?? "").trim()
    }
    return info
}

function convert(file) {
    const id = path.basename(file, path.extname(file))
    const db = new MDBReader(fs.readFileSync(file))

    if (!db.getTableNames().includes("Bible")) {
        console.warn(`skip ${id}: no Bible table`)
        return null
    }

    const info = readInfo(db.getTable("Info"))
    const structure = db
        .getTable("Structure")
        .getData()
        .sort((a, b) => Number(a.BibPosition) - Number(b.BibPosition))

    const books = structure.map((row) => ({
        number: Number(row.BibPosition),
        name: String(row.DisplayTitle || row.FullTitle || row.ListTitle || `Book ${row.BibPosition}`),
        abbreviation: row.Abbreviation ? String(row.Abbreviation).replace(/\.$/, "") : undefined,
        chapters: []
    }))

    const byNumber = new Map(books.map((book) => [book.number, book]))
    const chapterLookup = new Map()

    for (const row of db.getTable("Bible").getData()) {
        const book = byNumber.get(Number(row.Book))
        if (!book) continue

        const chapterNumber = Number(row.Chapter)
        let chapter = chapterLookup.get(`${book.number}:${chapterNumber}`)
        if (!chapter) {
            chapter = { number: chapterNumber, verses: [] }
            chapterLookup.set(`${book.number}:${chapterNumber}`, chapter)
            book.chapters.push(chapter)
        }

        const text = String(row.Scripture ?? "").trim()
        if (!text) continue
        chapter.verses.push({ number: Number(row.Verse), text })
    }

    for (const book of books) {
        book.chapters.sort((a, b) => a.number - b.number)
        for (const chapter of book.chapters) chapter.verses.sort((a, b) => a.number - b.number)
    }

    const clean = books
        .filter((book) => book.chapters.length)
        .map((book) => (book.abbreviation ? book : { ...book, abbreviation: undefined }))

    const bible = {
        id,
        name: info.biblefullname || info.bibleshortname || id,
        metadata: { abbreviation: info.bibleshortname || id, source: "BibleShow" },
        copyright: info.copyright || info.copyrightinfo || "",
        books: clean
    }

    const target = path.join(output, `${id}.json`)
    fs.writeFileSync(target, JSON.stringify(bible), "utf8")

    const verses = clean.reduce((total, book) => total + book.chapters.reduce((sum, chapter) => sum + chapter.verses.length, 0), 0)
    console.log(`${id}: ${clean.length} books, ${verses} verses, ${(fs.statSync(target).size / 1e6).toFixed(1)} MB`)
    return { id, books: clean.length, verses, copyright: bible.copyright }
}

const files = fs.readdirSync(source).filter((file) => file.toLowerCase().endsWith(".bib"))
const summary = []
for (const file of files) {
    try {
        const result = convert(path.join(source, file))
        if (result) summary.push(result)
    } catch (error) {
        console.warn(`failed ${file}: ${error.message}`)
    }
}

fs.writeFileSync(path.join(output, "index.json"), JSON.stringify(summary, null, 2), "utf8")
console.log(`\n${summary.length} bibles written to ${output}`)
