// ProPresenter stage layouts (Configuration/Stage, extension-less protobuf).
//
// The container is exactly what public/proto/stage.proto describes:
//   rv.data.Stage.Document { application_info = 1, repeated rv.data.Stage.Layout layouts = 2 }
//   rv.data.Stage.Layout   { uuid = 1, name = 2, rv.data.Slide slide = 3 }
//
// A layout IS a slide, so every element is an rv.data.Slide.Element wrapping an rv.data.Graphics.Element
// (bounds, opacity, fill, text) plus dataLinks. The data link oneof is what tells us whether the element
// shows the current slide, the next slide, a timer, a clock, a program feed, a video countdown, and so on.
//
// This module decodes the file into plain JSON (no FreeShow types) so the renderer converter can map it
// without caring about protobuf. Field numbers are never guessed here: they come from the shipped schemas.
//
// Traps worth keeping in mind when reading the output:
// - Font family and size are reliable in attributes.font (family/face/size), while the glyph colour lives
//   only in the RTF colour table (attributes.textSolidFill is an alpha stub). Both are resolved here.
// - An element "fill" on a text element is usually the ProPresenter default blue and is NOT painted; a fill
//   only becomes a background plate when the element has no glyphs of its own. The renderer converter decides.
// - Element order in the slide is back to front (the black plate that sits behind the program feed on the
//   "BLACK BG" layout comes first), unlike presentation slides where the array is front to back.

import fs from "fs"
import path from "path"
import protobufjs from "protobufjs"

export interface PPStageBox {
    x: number
    y: number
    width: number
    height: number
}

export interface PPStageFill {
    enabled: boolean
    color?: string // #rrggbb
    alpha?: number
    mediaPath?: string // absolute or reconstructed path, when the fill is a file
    live?: boolean // a live video input with no path (ProPresenter resolves it by UUID)
}

export interface PPStageText {
    family: string
    size: number // slide units, i.e. pixels on a 1920x1080 layout
    bold: boolean
    italic: boolean
    uppercase: boolean
    color: string // #rrggbb, empty when the RTF carries no colour table
    align: "left" | "center" | "right" | "justify" | ""
    verticalAlign: "top" | "middle" | "bottom"
    singleLine: boolean
    scaleBehavior: number
    lineHeight: number
    sample: string // placeholder text stored in the theme/layout (labels carry theirs)
}

export type PPStageLinkKind = "slide" | "timer" | "clock" | "output" | "countdown" | "message" | "notes" | "image" | "chord" | "other"

export interface PPStageColorTrigger {
    time: number
    color: string
}

export interface PPStageLink {
    kind: PPStageLinkKind
    /** the protobuf oneof field name, kept so an unknown kind can be reported by name */
    field?: string
    sourceSlide?: number
    timerName?: string
    timerFormat?: string
    colorTriggers?: PPStageColorTrigger[]
    clockFormat?: string
    militaryTime?: boolean
    screenName?: string
}

export interface PPStageElement {
    name: string
    link?: PPStageLink
    box: PPStageBox
    opacity: number
    rotation: number
    fill?: PPStageFill
    text?: PPStageText
}

export interface PPStageLayout {
    id: string
    name: string
    width: number
    height: number
    background: string // #rrggbb
    elements: PPStageElement[]
}

// ---------------------------------------------------------------------------------------------
// proto loading

let stageType: any = null

function protoDirCandidates() {
    return [
        path.join(process.cwd(), "public/proto"),
        path.join(__dirname, "../../../public/proto"),
        path.join(__dirname, "../../public/proto")
    ]
}

/** Load every schema once; stage.proto imports slide.proto, which imports graphicsData and basicTypes. */
function getStageType() {
    if (stageType) return stageType
    const dir = protoDirCandidates().find((candidate) => fs.existsSync(candidate))
    if (!dir) throw new Error("public/proto was not found, so ProPresenter stage layouts cannot be decoded")
    const files = fs
        .readdirSync(dir)
        .filter((file) => file.endsWith(".proto"))
        .map((file) => path.join(dir, file))
    stageType = protobufjs.loadSync(files).lookupType("rv.data.Stage.Document")
    return stageType
}

// ---------------------------------------------------------------------------------------------
// small value helpers

function num(value: any, fallback = 0) {
    const parsed = typeof value === "number" ? value : Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function hex(rgb: { red?: number; green?: number; blue?: number; alpha?: number }) {
    if (!rgb) return ""
    const channel = (value: any) => {
        const scaled = num(value) <= 1 ? num(value) * 255 : num(value)
        return Math.max(0, Math.min(255, Math.round(scaled)))
    }
    // an absent RGB triple means black, never white: {alpha: 1} is a black plate in these files
    return `#${[channel(rgb.red), channel(rgb.green), channel(rgb.blue)].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

function hasRgb(color: any) {
    return !!color && (color.red !== undefined || color.green !== undefined || color.blue !== undefined)
}

function decodeBase64(data: any) {
    if (!data) return ""
    try {
        if (typeof data === "string") return Buffer.from(data, "base64").toString("latin1")
        return Buffer.from(data).toString("latin1")
    } catch {
        return ""
    }
}

/** RTF colour table entry N (1-based) as #rrggbb. */
function rtfColorTable(rtf: string) {
    const table = rtf.match(/\\colortbl;([^}]*)}/)
    if (!table) return [] as string[]
    const entries: string[] = []
    const re = /\\red(\d+)\\green(\d+)\\blue(\d+)/g
    let match: RegExpExecArray | null
    while ((match = re.exec(table[1]))) {
        entries.push(`#${[match[1], match[2], match[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`)
    }
    return entries
}

/** The glyph colour is the first \cf in the document body, not \strokec / \highlight. */
function rtfBodyColor(rtf: string) {
    const table = rtfColorTable(rtf)
    if (!table.length) return ""
    const body = rtf.replace(/\\colortbl;[^}]*}/, "")
    const cf = body.match(/\\cf(\d+)/)
    const index = cf ? Number(cf[1]) : 1
    return table[Math.max(1, index) - 1] || table[0] || ""
}

function rtfFontTable(rtf: string) {
    const table = rtf.match(/\\fonttbl([^}]*)}/)
    if (!table) return ""
    const entry = table[1].match(/\\f\d+[^;]*?([^\\;]+);/)
    return entry ? entry[1].trim() : ""
}

function rtfSize(rtf: string) {
    const match = rtf.match(/\\fs(\d+)/)
    // \fs is half-points and one point is one slide unit here, so fs100 -> 50
    return match ? Number(match[1]) / 2 : 0
}

function rtfBold(rtf: string) {
    const body = rtf.replace(/\\fonttbl[^}]*}/, "").replace(/\\colortbl;[^}]*}/, "")
    // \b0 clears bold; a bare \b sets it
    return /\\b(?!0\b)/.test(body)
}

function rtfSampleText(rtf: string) {
    const body = rtf.replace(/\\fonttbl[^}]*}/, "").replace(/\\colortbl;[^}]*}/, "").replace(/\{\\\*[^}]*}/g, "")
    const text = body
        .replace(/\\u-?\d+\??/g, "")
        .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
        .replace(/[{}]/g, "")
        .trim()
    return text
}

/** PostScript face names are not CSS families. Attributes usually carry the family already; this is the fallback. */
export function normalizeFontFamily(raw: string) {
    let family = (raw || "").trim()
    if (!family) return ""
    family = family.replace(/^([A-Za-z ]+?)-(Bold|Light|Regular|Italic|Medium|Black|SemiBold|Book|Thin|ExtraBold|ExtraLight|Heavy|Oblique).*$/i, "$1")
    family = family.replace(/(MT|PSMT|PS)$/i, "")
    family = family.replace(/\s+/g, " ").trim()
    // the church's brand face is stored as "CMG Sans " with a trailing space and as CMSans-BoldCAPS
    if (/^CMG\s*Sans/i.test(family.replace(/\s/g, "")) || /^CMGSans/i.test(raw)) return "CMG Sans"
    return family
}

// ---------------------------------------------------------------------------------------------
// element decoding

function decodeText(element: any): PPStageText | undefined {
    const text = element?.text
    if (!text) return undefined

    const attributes = text.attributes || {}
    const font = attributes.font || {}
    const rtf = decodeBase64(text.rtfData)
    const paragraph = attributes.paragraphStyle || {}
    const alignments = ["left", "right", "center", "justify", "left"]

    const family = normalizeFontFamily(font.family || font.name || rtfFontTable(rtf))
    const size = num(font.size) || rtfSize(rtf) || 50
    const face = String(font.face || "")

    return {
        family,
        size,
        bold: !!font.bold || /bold/i.test(face) || rtfBold(rtf),
        italic: !!font.italic,
        uppercase: /caps/i.test(face) || attributes.capitalization === 1,
        color: rtfBodyColor(rtf),
        align: (alignments[num(paragraph.alignment)] as PPStageText["align"]) || "",
        verticalAlign: num(text.verticalAlignment) === 2 ? "bottom" : num(text.verticalAlignment) === 1 ? "middle" : "top",
        singleLine: num(text.transform) === 1,
        scaleBehavior: num(text.scaleBehavior),
        lineHeight: num(paragraph.lineHeightMultiple) || 1,
        sample: rtfSampleText(rtf)
    }
}

function decodeFill(element: any): PPStageFill | undefined {
    const fill = element?.fill
    if (!fill) return undefined

    if (fill.media) {
        const url = fill.media.url || {}
        const mediaPath = url.absoluteString || url.relativePath || url.local?.path || ""
        return { enabled: true, mediaPath: mediaPath || undefined, live: !mediaPath }
    }

    if (fill.color) {
        return {
            enabled: !!fill.enable,
            color: hasRgb(fill.color) ? hex(fill.color) : "#000000",
            alpha: fill.color.alpha === undefined ? 1 : num(fill.color.alpha)
        }
    }

    if (fill.gradient) return { enabled: !!fill.enable, color: hex(fill.gradient.stops?.[0]?.color) || "#000000" }

    return undefined
}

// protobufjs camelCases the oneof field names (timerText, slideText), so normalise before matching
const LINK_FIELDS: { [key: string]: PPStageLinkKind } = {
    slidetext: "slide",
    slidellabeltext: "slide",
    timertext: "timer",
    clocktext: "clock",
    outputscreen: "output",
    videocountdown: "countdown",
    audiocountdown: "countdown",
    stagemessage: "message",
    presentationnotes: "notes",
    slideimage: "image",
    chordchart: "chord",
    chordprochart: "chord"
}

/** "\${timer}" plus the digit styles is how ProPresenter stores a timer's format. */
function formatFromTimerFormat(format: any) {
    if (!format) return ""
    const part = (style: any, pad: string) => {
        const value = num(style)
        if (!value) return ""
        // STYLE_SHORT pads to one digit, STYLE_LONG to two. REMOVE_* hides the unit.
        return value >= 3 ? "" : value === 2 ? `${pad}${pad}` : pad
    }
    const hour = part(format.hour, "H")
    const minute = part(format.minute, "m")
    const second = part(format.second, "s")
    return [hour, minute, second].filter(Boolean).join(":")
}

function decodeLink(dataLinks: any[]): PPStageLink | undefined {
    for (const link of dataLinks || []) {
        const field = Object.keys(link).find((key) => key !== "$type" && link[key] !== undefined)
        if (!field) continue
        const value = link[field] || {}
        const kind = LINK_FIELDS[String(field).replace(/_/g, "").toLowerCase()] || "other"
        const out: PPStageLink = { kind, field }

        if (kind === "slide") out.sourceSlide = num(value.sourceSlide) === 1 ? 1 : 0
        if (kind === "timer") {
            out.timerName = value.timerName || ""
            out.timerFormat = formatFromTimerFormat(value.timerFormat)
            out.colorTriggers = (value.colorTriggers || [])
                .filter((trigger: any) => !!trigger?.color)
                .map((trigger: any) => ({ time: num(trigger.time), color: hex(trigger.color) }))
                .sort((a: PPStageColorTrigger, b: PPStageColorTrigger) => b.time - a.time)
        }
        if (kind === "clock") {
            out.clockFormat = value.clockFormatString || ""
            out.militaryTime = !!value.format?.militaryTimeEnabled
            // timeFormat: 0 none, 1 short, 2 medium, 3 long, 4 full
            out.timerFormat = num(value.format?.timeFormat) >= 2 ? "H:mm:ss" : "H:mm"
        }
        if (kind === "output") out.screenName = value.screenName || ""
        if (kind === "countdown") {
            out.timerFormat = formatFromTimerFormat(value.timerFormat)
            out.colorTriggers = (value.colorTriggers || [])
                .filter((trigger: any) => !!trigger?.color)
                .map((trigger: any) => ({ time: num(trigger.time), color: hex(trigger.color) }))
        }

        return out
    }
    return undefined
}

function decodeElement(slideElement: any): PPStageElement {
    const element = slideElement.element || {}
    const bounds = element.bounds || {}
    const origin = bounds.origin || {}
    const size = bounds.size || {}

    // empty bounds mean "start at 0,0" rather than an invalid negative box
    const round = (value: number) => Math.round(value * 100) / 100
    const text = decodeText(element)

    return {
        name: element.name || "",
        link: decodeLink(slideElement.dataLinks || []),
        box: {
            x: round(num(origin.x)),
            y: round(num(origin.y)),
            width: round(num(size.width)),
            height: round(num(size.height))
        },
        opacity: element.opacity === undefined ? 1 : num(element.opacity, 1),
        rotation: num(element.rotation),
        fill: decodeFill(element),
        // A text element with no RTF at all is a shape (plate, divider, art), so only keep typography when
        // the file actually stored some.
        text: element.text?.rtfData ? text : undefined
    }
}

// ---------------------------------------------------------------------------------------------

/**
 * Decode Configuration/Stage into one entry per layout.
 * Returns an empty array for junk input so a bad file cannot break the import.
 */
export function parseStageContainer(buf: Buffer): PPStageLayout[] {
    const document = getStageType()
    let decoded: any

    try {
        decoded = document.toObject(document.decode(buf), { defaults: false, arrays: true, objects: true, longs: String })
    } catch (err) {
        console.error("Stage file could not be decoded:", err)
        return []
    }

    const layouts: PPStageLayout[] = []
    for (const layout of decoded.layouts || []) {
        const name = layout.name || ""
        if (!name) continue

        let slide: any = {}
        try {
            slide = layout.slide || {}
        } catch {
            slide = {}
        }

        const id = layout.uuid?.string || name
        const width = num(slide.size?.width) || 1920
        const height = num(slide.size?.height) || 1080
        const background = hex(slide.backgroundColor) || "#000000"

        layouts.push({
            id,
            name,
            width,
            height,
            background,
            elements: (slide.elements || []).map(decodeElement)
        })
    }

    return layouts
}
