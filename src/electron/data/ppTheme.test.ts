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

// Encode a protobuf varint field (wire type 0), e.g. an enum or a version number.
function varintField(field: number, value: number): Buffer {
    const bytes: number[] = [(field << 3) | 0]
    let v = value
    do {
        let b = v & 0x7f
        v >>>= 7
        if (v) b |= 0x80
        bytes.push(b)
    } while (v)
    return Buffer.from(bytes)
}

function themeEntry(name: string, slideBytes: Uint8Array): Buffer {
    return lenDelim(3, Buffer.concat([lenDelim(1, slideBytes), lenDelim(2, Buffer.from(name, "utf8"))]))
}

// Wrap one encoded rv.data.Slide into a Theme container: field1 identifier, field3 entry.
function buildTheme(name: string, slideBytes: Uint8Array): Uint8Array {
    return Buffer.concat([lenDelim(1, Buffer.from("dummy-identifier", "utf8")), themeEntry(name, slideBytes)])
}

function encodeSlide(obj: any): Uint8Array {
    return Slide.encode(Slide.fromObject(obj)).finish()
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

    it("returns an empty list for an empty buffer", () => {
        expect(parseThemeContainer(Buffer.alloc(0))).toEqual([])
    })

    it("frames correctly when the container starts with a varint field", () => {
        const slideBytes = encodeSlide({
            elements: [{ element: { bounds: { origin: { x: 0, y: 0 }, size: { width: 10, height: 10 } } } }]
        })
        // A real container can lead with wire-type-0 fields (identifier / version) before field 3.
        const buf = Buffer.concat([varintField(1, 12345), varintField(2, 7), themeEntry("Verse", slideBytes)])
        const entries = parseThemeContainer(buf)
        expect(entries.length).toBe(1)
        expect(entries[0].name).toBe("Verse")
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

    it("returns slides: [] for an empty buffer", () => {
        expect(decodePPTheme(Buffer.alloc(0), Slide)).toEqual({ slides: [] })
    })

    it("maps an absolute-path media fill to fill.mediaPath", () => {
        const abs = "C:\\\\Users\\\\techg\\\\OneDrive\\\\Documents\\\\ProPresenter\\\\Media\\\\Assets\\\\bg.png"
        const slideBytes = encodeSlide({
            elements: [{ element: { bounds: { origin: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }, fill: { media: { url: { absoluteString: abs } } } } }]
        })
        const theme = decodePPTheme(buildTheme("Background", slideBytes), Slide)
        expect(theme.slides[0].elements[0].fill?.mediaPath).toBe(abs)
    })

    it("maps a local-only media fill to fill.mediaPath", () => {
        const slideBytes = encodeSlide({
            elements: [
                {
                    element: {
                        bounds: { origin: { x: 40, y: 40 }, size: { width: 300, height: 120 } },
                        fill: { media: { url: { local: { root: "ROOT_SHOW", path: "Media/Assets/logo-white.png" } } } }
                    }
                }
            ]
        })
        const theme = decodePPTheme(buildTheme("Logo", slideBytes), Slide)
        const el = theme.slides[0].elements[0]
        expect(el.fill?.mediaPath).toBe("Media/Assets/logo-white.png")
    })

    it("decodes the real Grace City theme library when present", () => {
        const dir = process.env.GC_THEME_SAMPLES || "/home/ubuntu/grace-city/theme-samples/themes"
        if (!existsSync(dir)) {
            // Library lives on the church PC; skip cleanly elsewhere.
            expect(true).toBe(true)
            return
        }
        // Themes nest: most are <theme>/Theme, but a category like "Lyric Styles" holds
        // sub-themes (<category>/<sub>/Theme). Walk recursively so all are counted.
        const themeFiles: string[] = []
        const walk = (d: string) => {
            for (const entry of readdirSync(d, { withFileTypes: true })) {
                const full = path.join(d, entry.name)
                if (entry.isDirectory()) walk(full)
                else if (entry.isFile() && entry.name === "Theme") themeFiles.push(full)
            }
        }
        walk(dir)
        expect(themeFiles.length).toBeGreaterThanOrEqual(44)
        let slides = 0
        let elements = 0
        for (const file of themeFiles) {
            const theme = decodePPTheme(readFileSync(file), Slide)
            slides += theme.slides.length
            elements += theme.slides.reduce((sum, s) => sum + s.elements.length, 0)
        }
        expect(slides).toBeGreaterThan(340)
        expect(elements).toBeGreaterThan(1000)
    })
})
