/**
 * ProPresenter theme report.
 *
 * Walks a ProPresenter Themes library (the folder that holds one subfolder per theme, each
 * containing a file literally named "Theme") and prints, per theme: slide count, total element
 * count, the distinct font families the theme uses, and how many elements carry an image fill.
 * The point is a fast fidelity inventory before importing anything: which themes are type-only,
 * which depend on brand fonts, and which need media on disk to look right.
 *
 * Usage (Node 22, type stripping is on by default for .ts):
 *   node scripts/propresenter-theme-report.ts /home/ubuntu/grace-city/theme-samples/themes
 *   node scripts/propresenter-theme-report.ts <dir> --json      (machine readable)
 *
 * Expected library (verified on the Grace City pull): 44 theme files, 40 top-level folders plus
 * 4 nested under a category folder such as "Lyric Styles", 340+ slides, 1000+ elements.
 *
 * Reads only. No writes, no network, no dependency on the app being built.
 */

import fs from "fs"
import path from "path"
import protobuf from "protobufjs"
import { decodePPTheme, type PPTheme } from "../src/electron/data/ppTheme.ts"

type ThemeRow = {
    theme: string
    slides: number
    elements: number
    fontFamilies: string[]
    imageFills: number
}

/** Every file named "Theme" under `dir`, including themes nested inside category folders. */
export function findThemeFiles(dir: string, depth = 0): string[] {
    if (depth > 4 || !fs.existsSync(dir)) return []
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...findThemeFiles(full, depth + 1))
        else if (entry.isFile() && entry.name === "Theme") out.push(full)
    }
    return out
}

/** Theme folder name, qualified by its parent when it sits inside a category folder. */
export function themeName(dir: string, file: string, root: string): string {
    const rel = path.relative(root, path.dirname(file))
    return rel.split(path.sep).join("/") || path.basename(dir)
}

export function summarize(theme: PPTheme, name: string): ThemeRow {
    const families = new Set<string>()
    let elements = 0
    let imageFills = 0
    for (const slide of theme.slides) {
        for (const element of slide.elements) {
            elements++
            if (element.fill?.mediaPath) imageFills++
            const font = element.text?.font
            const family = font?.family || font?.name
            if (family) families.add(family)
        }
    }
    return {
        theme: name,
        slides: theme.slides.length,
        elements,
        fontFamilies: [...families].sort((a, b) => a.localeCompare(b)),
        imageFills
    }
}

async function main() {
    const args = process.argv.slice(2)
    const dir = args.find((a) => !a.startsWith("--"))
    const asJson = args.includes("--json")
    if (!dir) {
        console.error("usage: node scripts/propresenter-theme-report.ts <themes-dir> [--json]")
        process.exit(1)
    }
    if (!fs.existsSync(dir)) {
        console.error(`not found: ${dir}`)
        process.exit(1)
    }

    const root = await protobuf.load(path.join(process.cwd(), "public/proto/slide.proto"))
    const SlideType = root.lookupType("rv.data.Slide")

    const files = findThemeFiles(dir)
    const rows: ThemeRow[] = []
    const errors: { theme: string; error: string }[] = []

    for (const file of files) {
        const name = themeName(dir, file, dir)
        try {
            rows.push(summarize(decodePPTheme(fs.readFileSync(file), SlideType), name))
        } catch (e: any) {
            errors.push({ theme: name, error: e?.message || String(e) })
        }
    }

    rows.sort((a, b) => a.theme.localeCompare(b.theme))
    const totals = {
        themes: rows.length,
        slides: rows.reduce((n, r) => n + r.slides, 0),
        elements: rows.reduce((n, r) => n + r.elements, 0),
        imageFills: rows.reduce((n, r) => n + r.imageFills, 0),
        distinctFonts: [...new Set(rows.flatMap((r) => r.fontFamilies))].sort((a, b) => a.localeCompare(b)),
        errors
    }

    if (asJson) {
        console.log(JSON.stringify({ totals, themes: rows }, null, 2))
        return
    }

    const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length))
    console.log(`${pad("THEME", 34)} ${pad("SLIDES", 7)} ${pad("ELEMS", 6)} ${pad("IMG", 4)} FONTS`)
    console.log("-".repeat(100))
    for (const row of rows) {
        console.log(`${pad(row.theme, 34)} ${pad(String(row.slides), 7)} ${pad(String(row.elements), 6)} ${pad(String(row.imageFills), 4)} ${row.fontFamilies.join(", ")}`)
    }
    console.log("-".repeat(100))
    console.log(`themes ${totals.themes}  slides ${totals.slides}  elements ${totals.elements}  image fills ${totals.imageFills}`)
    console.log(`distinct font families (${totals.distinctFonts.length}): ${totals.distinctFonts.join(", ")}`)
    if (totals.errors.length) console.log(`decode errors ${totals.errors.length}: ${totals.errors.map((e) => `${e.theme} (${e.error})`).join("; ")}`)
}

// Only run when executed directly, so tests can import the helpers.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    main().catch((e) => {
        console.error("ERR", e?.message || e)
        process.exit(1)
    })
}
