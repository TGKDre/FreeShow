import protobuf from "protobufjs"
import { existsSync, readFileSync, readdirSync } from "fs"
import path from "path"
import { beforeAll, describe, expect, it } from "vitest"
import { decodePPTheme, parseThemeContainer } from "./ppTheme"

let Slide: any

// Encode a protobuf length-delimited field (field number + length + payload).
function lenDelim(field: number, payload: Uint8Array): Buffer {
    const tag = Buffer.from([(field << 3) | 2])
    const lenBytes: number[] = []
    let len = payload.length
    do {
        let b = len & 0x7f
        len >>>= 7
        if (len) b |= 0x80
        lenBytes.push(b)
    } while (len)
    return Buffer.concat([tag, Buffer.from(lenBytes), Buffer.from(payload)])
}

// Wrap one encoded rv.data.Slide into a Theme container: field1 identifier, field3 entry.
function buildTheme(name: string, slideBytes: Uint8Array): Uint8Array {
    const entry = Buffer.concat([lenDelim(1, slideBytes), lenDelim(2, Buffer.from(name, "utf8"))])
    return Buffer.concat([lenDelim(1, Buffer.from("dummy-identifier", "utf8")), lenDelim(3, entry)])
}

beforeAll(async () => {
    const protoPath = path.join(process.cwd(), "public", "proto", "slide.proto")
    const root = await protobuf.load(protoPath)
    Slide = root.lookupType("rv.data.Slide")
})

describe("parseThemeContainer", () => {
    it("frames named theme slides out of the container", () => {
        const slideBytes = Slide.encode(
            Slide.fromObject({
                elements: [{ element: { bounds: { origin: { x: 10, y: 20 }, size: { width: 100, height: 40 } } } }]
            })
        ).finish()
        const buf = buildTheme("Lyrics", slideBytes)
        const entries = parseThemeContainer(buf)
        expect(entries.length).toBe(1)
        expect(entries[0].name).toBe("Lyrics")
        expect(entries[0].slideBytes.length).toBeGreaterThan(0)
    })
})

describe("decodePPTheme", () => {
    it("decodes geometry and typography from a synthetic themed slide", () => {
        const slideBytes = Slide.encode(
            Slide.fromObject({
                elements: [
                    {
                        element: {
                            bounds: { origin: { x: 120, y: 300 }, size: { width: 1200, height: 240 } },
                            opacity: 0.9,
                            text: {
                                attributes: {
                                    font: { family: "CMG Sans", size: 64, bold: true },
                                    textSolidFill: { red: 1, green: 1, blue: 1, alpha: 1 }
                                },
                                verticalAlignment: 2,
                                scaleBehavior: 2
                            }
                        }
                    }
                ]
            })
        ).finish()

        const theme = decodePPTheme(buildTheme("Title & Subtitle", slideBytes), Slide)
        expect(theme.slides.length).toBe(1)
        const slide = theme.slides[0]
        expect(slide.name).toBe("Title & Subtitle")
        expect(slide.elements.length).toBe(1)
        const el = slide.elements[0]
        expect(el.bounds).toEqual({ x: 120, y: 300, width: 1200, height: 240 })
        expect(el.opacity).toBeCloseTo(0.9, 3)
        expect(el.text?.font?.family).toBe("CMG Sans")
        expect(el.text?.font?.size).toBe(64)
        expect(el.text?.font?.bold).toBe(true)
        expect(el.text?.verticalAlignment).toBe(2)
        expect(el.text?.color).toEqual({ red: 1, green: 1, blue: 1, alpha: 1 })
    })

    it("decodes the real Grace City theme library when present", () => {
        const dir = process.env.GC_THEME_SAMPLES || "/home/ubuntu/grace-city/theme-samples/themes"
        if (!existsSync(dir)) {
            // Library lives on the church PC; skip cleanly elsewhere.
            expect(true).toBe(true)
            return
        }
        const folders = readdirSync(dir).filter((d) => existsSync(path.join(dir, d, "Theme")))
        expect(folders.length).toBeGreaterThan(30)
        let slides = 0
        let elements = 0
        for (const folder of folders) {
            const buf = readFileSync(path.join(dir, folder, "Theme"))
            const theme = decodePPTheme(buf, Slide)
            slides += theme.slides.length
            elements += theme.slides.reduce((sum, s) => sum + s.elements.length, 0)
        }
        expect(slides).toBeGreaterThan(300)
        expect(elements).toBeGreaterThan(900)
    })
})
