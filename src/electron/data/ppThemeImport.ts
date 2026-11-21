// Read a ProPresenter Themes library into FreeShow templates.
//
// A ProPresenter theme is a folder holding an extension-less file named "Theme" plus an Assets folder.
// The user picks that folder (or one theme file), this walks it and decodes every theme it finds.

import fs from "fs"
import path from "path"
import protobufjs from "protobufjs"
import { decodePPTheme } from "./ppTheme"
import { themeToTemplates, type PPThemeTemplate } from "./ppThemeTemplate"

export interface ImportedTheme {
    name: string
    dir: string
    templates: PPThemeTemplate[]
}

let slideType: any = null

/** slide.proto ships inside the app, next to the built electron output. */
function getSlideType() {
    if (slideType) return slideType
    const candidates = [
        path.join(process.cwd(), "public/proto/slide.proto"),
        path.join(__dirname, "../../../public/proto/slide.proto"),
        path.join(__dirname, "../../public/proto/slide.proto")
    ]
    const proto = candidates.find((candidate) => fs.existsSync(candidate))
    if (!proto) throw new Error("slide.proto was not found, so ProPresenter themes cannot be decoded")
    slideType = protobufjs.loadSync(proto).lookupType("rv.data.Slide")
    return slideType
}

/** ProPresenter theme files are literally named "Theme" and carry no extension. */
export function findThemeFiles(target: string, depth = 0): string[] {
    const out: string[] = []
    if (depth > 4) return out

    let stat: fs.Stats
    try {
        stat = fs.statSync(target)
    } catch {
        return out
    }
    if (stat.isFile()) return [target]

    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        const full = path.join(target, entry.name)
        if (entry.isDirectory()) out.push(...findThemeFiles(full, depth + 1))
        else if (entry.name === "Theme") out.push(full)
    }
    return out
}

export function readThemeLibrary(targets: string[]): ImportedTheme[] {
    const themes: ImportedTheme[] = []
    const SlideType = getSlideType()

    for (const target of targets) {
        const root = fs.existsSync(target) && fs.statSync(target).isDirectory() ? target : path.dirname(target)
        for (const file of findThemeFiles(target)) {
            const dir = path.dirname(file)
            try {
                const theme = decodePPTheme(fs.readFileSync(file), SlideType)
                // keep the category folder in the name so "Lyric Styles/White Box" stays grouped
                const name = path.relative(root, dir).split(path.sep).join("/") || path.basename(dir)
                const templates = themeToTemplates(name, theme, dir)
                if (templates.length) themes.push({ name, dir, templates })
            } catch (err: any) {
                console.error(`Theme could not be decoded (${file}):`, err?.message || err)
            }
        }
    }

    return themes
}
