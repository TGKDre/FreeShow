/**
 * ProPresenter theme decoding.
 *
 * A ProPresenter theme file (".proTheme", stored on disk as a file literally named "Theme"
 * inside a per-theme folder) is a small protobuf container, distinct from a Presentation:
 *
 *   field 1  : rv.data.ApplicationInfo / identifier (ignored here)
 *   field 3* : one entry per theme slide, each entry being:
 *                field 1 : rv.data.Slide   (the theme's design: bounds, text, fills, media)
 *                field 2 : string          (the slide name, e.g. "Title & Subtitle", "Lyrics")
 *
 * The container framing is parsed by hand (no protobufjs dependency) so this module stays
 * unit-testable in plain node. The caller supplies a protobufjs type for rv.data.Slide
 * (from public/proto/slide.proto) to turn the raw slide bytes into a structured model.
 *
 * The model carries geometry, typography, colours and media references only. Sample text is
 * not extracted (theme text is placeholder RTF); the point is the design a theme imposes.
 */

export type PPColor = { red: number; green: number; blue: number; alpha: number }

export type PPThemeElement = {
    bounds?: { x: number; y: number; width: number; height: number }
    rotation?: number
    opacity?: number
    hidden?: boolean
    fill?: { enable?: boolean; color?: PPColor; mediaPath?: string }
    text?: {
        font?: { name?: string; family?: string; face?: string; size?: number; bold?: boolean; italic?: boolean }
        capitalization?: number
        color?: PPColor
        verticalAlignment?: number
        scaleBehavior?: number
        transform?: number
        hasRtf?: boolean
    }
}

export type PPThemeSlide = {
    name: string
    backgroundColor?: PPColor
    drawsBackgroundColor?: boolean
    size?: { width: number; height: number }
    elements: PPThemeElement[]
}

export type PPTheme = { slides: PPThemeSlide[] }

type ScannedField = { field: number; val?: Uint8Array }

function readVarint(buf: Uint8Array, start: number): [number, number] {
    let shift = 0
    let result = 0
    let i = start
    while (i < buf.length) {
        const byte = buf[i++]
        result += (byte & 0x7f) * Math.pow(2, shift)
        if (!(byte & 0x80)) break
        shift += 7
    }
    return [result, i]
}

function scanFields(buf: Uint8Array): ScannedField[] {
    const out: ScannedField[] = []
    let i = 0
    while (i < buf.length) {
        const [tag, afterTag] = readVarint(buf, i)
        i = afterTag
        const field = Math.floor(tag / 8)
        const wire = tag & 7
        if (wire === 2) {
            const [len, afterLen] = readVarint(buf, i)
            i = afterLen
            out.push({ field, val: buf.subarray(i, i + len) })
            i += len
        } else if (wire === 0) {
            const [, afterVarint] = readVarint(buf, i)
            i = afterVarint
            out.push({ field }) // varint values are not needed for theme framing
        } else if (wire === 5) {
            i += 4
        } else if (wire === 1) {
            i += 8
        } else {
            break
        }
    }
    return out
}

/**
 * Parse the theme container into its raw theme slides. No protobufjs needed.
 * Returns each slide's name and its encoded rv.data.Slide bytes.
 */
export function parseThemeContainer(buf: Uint8Array): { name: string; slideBytes: Uint8Array }[] {
    const out: { name: string; slideBytes: Uint8Array }[] = []
    for (const entry of scanFields(buf)) {
        if (entry.field !== 3 || !entry.val) continue
        let slideBytes: Uint8Array | undefined
        let name = ""
        for (const inner of scanFields(entry.val)) {
            if (inner.field === 1 && inner.val) slideBytes = inner.val
            else if (inner.field === 2 && inner.val) name = Buffer.from(inner.val).toString("utf8")
        }
        if (slideBytes) out.push({ name, slideBytes })
    }
    return out
}

function toColor(color: any): PPColor | undefined {
    if (!color) return undefined
    return { red: color.red ?? 0, green: color.green ?? 0, blue: color.blue ?? 0, alpha: color.alpha ?? 0 }
}

function mapElement(raw: any): PPThemeElement {
    const el = raw || {}
    const out: PPThemeElement = {}

    const bounds = el.bounds
    if (bounds) {
        out.bounds = {
            x: bounds.origin?.x ?? 0,
            y: bounds.origin?.y ?? 0,
            width: bounds.size?.width ?? 0,
            height: bounds.size?.height ?? 0
        }
    }
    if (typeof el.rotation === "number") out.rotation = el.rotation
    if (typeof el.opacity === "number") out.opacity = el.opacity
    if (el.hidden) out.hidden = true

    if (el.fill) {
        const fill: NonNullable<PPThemeElement["fill"]> = {}
        if (el.fill.enable !== undefined) fill.enable = el.fill.enable
        if (el.fill.color) fill.color = toColor(el.fill.color)
        const mediaPath = el.fill.media?.url?.absoluteString || el.fill.media?.url?.local?.path
        if (mediaPath) fill.mediaPath = mediaPath
        if (Object.keys(fill).length) out.fill = fill
    }

    if (el.text) {
        const attributes = el.text.attributes || {}
        const text: NonNullable<PPThemeElement["text"]> = {}
        const font = attributes.font
        if (font) text.font = { name: font.name, family: font.family, face: font.face, size: font.size, bold: font.bold, italic: font.italic }
        if (attributes.capitalization !== undefined) text.capitalization = attributes.capitalization
        const glyphColor = toColor(attributes.textSolidFill)
        if (glyphColor) text.color = glyphColor
        if (el.text.verticalAlignment !== undefined) text.verticalAlignment = el.text.verticalAlignment
        if (el.text.scaleBehavior !== undefined) text.scaleBehavior = el.text.scaleBehavior
        if (el.text.transform !== undefined) text.transform = el.text.transform
        if (el.text.rtfData) text.hasRtf = true
        out.text = text
    }

    return out
}

/**
 * Decode a ProPresenter theme into a structured model.
 * @param buf     raw theme file bytes
 * @param SlideType  protobufjs type for rv.data.Slide (public/proto/slide.proto)
 */
export function decodePPTheme(buf: Uint8Array, SlideType: any): PPTheme {
    const slides: PPThemeSlide[] = []
    for (const entry of parseThemeContainer(buf)) {
        const slide: any = SlideType.toObject(SlideType.decode(entry.slideBytes), { defaults: false, arrays: true, objects: true, longs: String })
        const elements: PPThemeElement[] = (slide.elements || []).map((e: any) => mapElement(e.element))
        slides.push({
            name: entry.name,
            backgroundColor: toColor(slide.backgroundColor),
            drawsBackgroundColor: slide.drawsBackgroundColor,
            size: slide.size ? { width: slide.size.width, height: slide.size.height } : undefined,
            elements
        })
    }
    return { slides }
}
