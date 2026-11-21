import fs from "fs"
import path from "path"
import protobuf from "protobufjs"
import { describe, expect, it } from "vitest"
import { decodePPTheme } from "./ppTheme"
import { colorToCss, elementToItem, fontToCss, normalizeFontName, resolveMediaPath, themeToTemplates } from "./ppThemeTemplate"

const THEME_DIR = process.env.PP_THEMES_DIR || "/home/ubuntu/grace-city/pp-samples/themes"

function findThemeFiles(dir: string, depth = 0): string[] {
    if (depth > 4 || !fs.existsSync(dir)) return []
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...findThemeFiles(full, depth + 1))
        else if (entry.isFile() && entry.name === "Theme") out.push(full)
    }
    return out
}

const themeName = (root: string, file: string) => path.relative(root, path.dirname(file)).split(path.sep).join("/")

describe("theme to template mapping", () => {
    it("turns a text element into a styled text item", () => {
        const item = elementToItem({ bounds: { x: 100, y: 200, width: 800, height: 300 }, text: { font: { family: "Helvetica Neue", size: 96, bold: true }, color: { red: 255, green: 0, blue: 0, alpha: 255 } } }, 0, { width: 1920, height: 1080 })
        expect(item?.type).toBe("text")
        expect(item?.style).toContain("left:100px")
        expect(item?.style).toContain("height:300px")
        // licensed family first, then the free face installed on the church PC
        expect(item?.lines?.[0].text[0].style).toContain('"Helvetica Neue"')
        expect(item?.lines?.[0].text[0].style).toContain('"Nimbus Sans"')
        expect(item?.lines?.[0].text[0].style).toContain("font-size:96px")
        expect(item?.lines?.[0].text[0].style).toContain("rgba(255,0,0,1)")
        expect(item?.lines?.[0].text[0].style).toContain("font-weight:700")
    })

    it("turns an image fill into a media item and resolves bundle paths", () => {
        const item = elementToItem({ fill: { mediaPath: "Assets/bg.jpg" } }, 1, undefined, "C:/PP/Themes/Test")
        expect(item?.type).toBe("image")
        expect(item?.src).toBe("C:/PP/Themes/Test/Assets/bg.jpg")
        expect(resolveMediaPath("D:/abs/bg.jpg", "C:/PP")).toBe("D:/abs/bg.jpg")
    })

    it("skips hidden elements and elements with nothing to draw", () => {
        expect(elementToItem({ hidden: true, text: { font: { family: "Arial" } } }, 0)).toBe(null)
        expect(elementToItem({}, 0)).toBe(null)
    })

    it("normalises alpha from both 0-1 and 0-255 inputs", () => {
        expect(colorToCss({ red: 0, green: 0, blue: 0, alpha: 128 })).toBe("rgba(0,0,0,0.5)")
        expect(colorToCss({ red: 0, green: 0, blue: 0, alpha: 0.5 })).toBe("rgba(0,0,0,0.5)")
    })

    it("resolves PostScript face names to a family plus weight", () => {
        const caps = elementToItem({ text: { font: { name: "CMGSans-BoldCAPS" } } }, 0)
        expect(caps?.lines?.[0].text[0].style).toContain('"CMG Sans"')
        expect(caps?.lines?.[0].text[0].style).toContain("font-weight:700")
        expect(caps?.lines?.[0].text[0].style).toContain("text-transform:uppercase")

        expect(normalizeFontName("ArialMT").family).toBe("Arial")
        expect(normalizeFontName("HelveticaNeue-Light")).toMatchObject({ family: "Helvetica Neue", weight: "300" })
        expect(normalizeFontName("AtkinsonHyperlegible-Bold")).toMatchObject({ family: "Atkinson Hyperlegible", weight: "700" })
    })

    it("falls back to a readable size when the theme omits one", () => {
        expect(fontToCss({ text: { font: { family: "Arial" } } })).toContain("font-size:82px")
    })
})

const files = findThemeFiles(THEME_DIR)

describe.runIf(files.length > 0)("real Grace City theme library", () => {
    const root = protobuf.loadSync(path.join(process.cwd(), "public/proto/slide.proto"))
    const SlideType = root.lookupType("rv.data.Slide")

    const built = files.map((file) => {
        const name = themeName(THEME_DIR, file)
        const theme = decodePPTheme(fs.readFileSync(file), SlideType)
        return { name, dir: path.dirname(file), theme, templates: themeToTemplates(name, theme, path.dirname(file)) }
    })

    it("covers every theme in the library", () => {
        expect(built.length).toBeGreaterThanOrEqual(40)
        expect(built.every((entry) => entry.templates.length > 0)).toBe(true)
    })

    it("keeps every slide layout that carries elements", () => {
        const slides = built.reduce((n, entry) => n + entry.theme.slides.length, 0)
        const templates = built.reduce((n, entry) => n + entry.templates.length, 0)
        // only empty slides are dropped
        expect(templates).toBeGreaterThanOrEqual(slides * 0.8)
        expect(templates).toBeLessThanOrEqual(slides)
    })

    it("carries fonts, sizes and media through to the templates", () => {
        const items = built.flatMap((entry) => entry.templates.flatMap((t) => t.items))
        const texts = items.filter((a) => a.type === "text")
        const images = items.filter((a) => a.type === "image")
        expect(texts.length).toBeGreaterThan(400)
        expect(images.length).toBeGreaterThan(100)
        expect(texts.every((a) => !!a.lines?.[0].text[0].style.includes("font-size:"))).toBe(true)
        const families = new Set(texts.map((a) => (a.lines?.[0].text[0].style.match(/font-family:([^,;]+)/) || [])[1] || ""))
        families.delete("")
        expect(families.size).toBeGreaterThan(20)
        expect(images.every((a) => !!a.src)).toBe(true)
    })
})
