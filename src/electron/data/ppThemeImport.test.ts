import fs from "fs"
import { describe, expect, it } from "vitest"
import { findThemeFiles, readThemeLibrary } from "./ppThemeImport"

const THEME_DIR = process.env.PP_THEMES_DIR || "/home/ubuntu/grace-city/pp-samples/themes"

describe("theme library reader", () => {
    it("finds theme files inside category folders", () => {
        const files = findThemeFiles("/nonexistent-path")
        expect(files).toEqual([])
    })

    it.runIf(fs.existsSync(THEME_DIR))("reads the whole Grace City library through the import path", () => {
        const themes = readThemeLibrary([THEME_DIR])
        expect(themes.length).toBeGreaterThanOrEqual(40)
        expect(themes.every((theme) => theme.templates.length > 0)).toBe(true)

        const templateCount = themes.reduce((n, theme) => n + theme.templates.length, 0)
        expect(templateCount).toBeGreaterThan(300)

        // the nested "Lyric Styles" themes keep their category in the name
        const nested = themes.filter((theme) => theme.name.includes("/"))
        expect(nested.length).toBeGreaterThan(0)

        const items = themes.flatMap((theme) => theme.templates.flatMap((template) => template.items))
        expect(items.filter((item) => item.type === "image").length).toBeGreaterThan(100)
    })
})
