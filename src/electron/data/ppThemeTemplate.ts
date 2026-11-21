// Map a decoded ProPresenter theme onto FreeShow templates.
//
// ProPresenter themes are not UI skins: each one holds several slide layouts (a plain lyric layout, a
// full-screen media layout, a lower third, and so on). FreeShow templates are one layout each, so a theme
// becomes one template per usable slide, named after the theme and the slide. Keeping one template per
// slide is the only way to preserve the variants a church actually switches between.
//
// Pure module: no electron, no stores, so it is unit tested against the real theme library.

import type { PPColor, PPTheme, PPThemeElement } from "./ppTheme"

export interface PPThemeTemplateItem {
    id: string
    type: "text" | "image"
    style: string
    lines?: { align: string; text: { value: string; style: string }[] }[]
    src?: string
}

export interface PPThemeTemplate {
    name: string
    color: string | null
    category: string
    slide: string
    items: PPThemeTemplateItem[]
}

const FALLBACK_SIZE = 82

function channel(value?: number) {
    const safe = typeof value === "number" && isFinite(value) ? value : 0
    return Math.max(0, Math.min(255, Math.round(safe)))
}

/** Alpha arrives as 0-255 in some builds and 0-1 in others, so both are normalised to 0-1. */
export function colorToCss(color?: PPColor | null): string {
    if (!color) return ""
    const raw = typeof color.alpha === "number" ? color.alpha : 1
    const alpha = raw > 1 ? raw / 255 : raw
    return `rgba(${channel(color.red)},${channel(color.green)},${channel(color.blue)},${Math.round(alpha * 100) / 100})`
}

/**
 * Families the Grace City themes use that are licensed and therefore not installed on the church PC, mapped
 * to the closest free face that IS installed there. Without this a missing face drops to the browser default
 * and a serif lands in the middle of a lyric slide.
 */
const FALLBACKS: Record<string, string[]> = {
    gotham: ["Montserrat"],
    "brandon grotesque": ["Montserrat"],
    "neue kabel": ["Montserrat"],
    "new kansas": ["Montserrat"],
    "ivypresto display": ["Montserrat"],
    lust: ["Montserrat"],
    "lust text": ["Montserrat"],
    "lust script": ["Montserrat"],
    botanist: ["Montserrat"],
    "century gothic": ["Montserrat"],
    "aktiv grotesk": ["Inter"],
    effra: ["Inter"],
    "acumin pro": ["Inter"],
    termina: ["Inter"],
    tenez: ["Inter"],
    obviously: ["Inter"],
    "lo res 9 plus ot": ["Inter"],
    "lores 9 plus ot": ["Inter"],
    nautica: ["Inter"],
    macula: ["Inter"],
    degular: ["Inter"],
    distancia: ["Inter"],
    helvetica: ["Nimbus Sans", "Inter"],
    "helvetica neue": ["Nimbus Sans", "Inter"],
    "neue haas grotesk": ["Nimbus Sans", "Inter"],
    "neue haas grotesk display pro": ["Nimbus Sans", "Inter"],
    "quiche flare": ["Bebas Neue"],
    quicheflare: ["Bebas Neue"],
    "dharma gothic e": ["Bebas Neue"],
    gangitem: ["Bebas Neue"],
    "hyperwave two": ["Bebas Neue"]
}

const WEIGHTS: Record<string, string> = {
    thin: "100",
    ultralight: "200",
    extralight: "200",
    light: "300",
    regular: "400",
    book: "400",
    normal: "400",
    medium: "500",
    semibold: "600",
    demibold: "600",
    extrabold: "800",
    bold: "700",
    black: "900",
    heavy: "900"
}

/** "CMGSans-BoldCAPS", "ArialMT", "HelveticaNeue-Light" -> family, weight, italic, caps. */
export function normalizeFontName(raw: string) {
    let name = (raw || "").trim().replace(/MT$/, "").replace(/PSMT$/, "")
    const caps = /CAPS$/.test(name)
    if (caps) name = name.replace(/CAPS$/, "")

    let weight = ""
    let italic = /Italic/i.test(name)
    const parts = name.split("-")
    if (parts.length > 1) {
        const suffix = parts[parts.length - 1]
        const key = suffix.replace(/Italic/gi, "").toLowerCase()
        if (WEIGHTS[key]) weight = WEIGHTS[key]
        if (/^(Regular|Bold|Light|Medium|Black|Thin|Book|Heavy|SemiBold|ExtraBold|UltraLight|ExtraLight|DemiBold|Normal)$/i.test(key)) name = parts.slice(0, -1).join("-")
    }
    // no hyphen form: "HelveticaNeue Light" style suffixes stay in the family, so only strip known tails
    name = name.replace(/^CMGSans/i, "CMG Sans")
    if (/^CMG\s*Sans\s*MonoDigits$/i.test(name)) name = "CMG Sans MonoDigits"
    return { family: name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/\s+/).filter(Boolean).join(" "), weight, italic, caps }
}

/** ProPresenter stores a font family and a point size; FreeShow text styles are CSS declarations. */
export function fontToCss(element: PPThemeElement): string {
    const font = element.text?.font
    const raw = font?.family || font?.name || ""
    const { family, weight, italic, caps } = normalizeFontName(raw)

    const parts: string[] = []
    if (family) {
        const chain = [family, ...(FALLBACKS[family.toLowerCase()] || []), "Arial"]
        const unique = chain.filter((name, index) => chain.indexOf(name) === index)
        parts.push(`font-family:${unique.map((name) => (name.includes(" ") ? `"${name}"` : name)).join(", ")}`)
    }

    const size = font?.size && font.size > 0 ? font.size : FALLBACK_SIZE
    parts.push(`font-size:${Math.round(size)}px`)
    const color = colorToCss(element.text?.color)
    if (color) parts.push(`color:${color}`)

    const cssWeight = font?.bold ? "700" : weight
    if (cssWeight) parts.push(`font-weight:${cssWeight}`)
    if (font?.italic || italic) parts.push("font-style:italic")
    if (caps) parts.push("text-transform:uppercase")

    return `${parts.join(";")};`
}

export function positionCss(element: PPThemeElement, slide?: { width: number; height: number }): string {
    const width = slide?.width || 1920
    const height = slide?.height || 1080
    const x = element.bounds?.x ?? 0
    const y = element.bounds?.y ?? 0
    const boxWidth = element.bounds?.width || width
    const boxHeight = element.bounds?.height || height
    return `top:${Math.round(y)}px;left:${Math.round(x)}px;height:${Math.round(boxHeight)}px;width:${Math.round(boxWidth)}px;`
}

/** Absolute paths are kept; bundle-relative ones are resolved against the theme folder. */
export function resolveMediaPath(mediaPath: string, themeDir?: string): string {
    if (!mediaPath) return ""
    if (/^[A-Za-z]:[\\/]/.test(mediaPath) || mediaPath.startsWith("/")) return mediaPath
    if (!themeDir) return mediaPath
    const base = themeDir.replace(/[\\/]+$/, "")
    return `${base}/${mediaPath.replace(/^[.\\/]+/, "")}`
}

export function elementToItem(element: PPThemeElement, index: number, slideSize?: { width: number; height: number }, themeDir?: string): PPThemeTemplateItem | null {
    if (!element || element.hidden) return null
    const style = positionCss(element, slideSize)

    const media = element.fill?.mediaPath
    if (media) return { id: `pp-${index}`, type: "image", style, src: resolveMediaPath(media, themeDir) }

    if (element.text) {
        return {
            id: `pp-${index}`,
            type: "text",
            style,
            lines: [{ align: "center", text: [{ value: "", style: fontToCss(element) }] }]
        }
    }
    return null
}

/** One template per slide that yields at least one item. */
export function themeToTemplates(name: string, theme: PPTheme, themeDir?: string): PPThemeTemplate[] {
    const templates: PPThemeTemplate[] = []
    const slides = theme?.slides || []
    const category = name.includes("/") ? name.split("/").slice(0, -1).join("/") : ""

    slides.forEach((slide, slideIndex) => {
        const items: PPThemeTemplateItem[] = []
        slide.elements.forEach((element, elementIndex) => {
            const item = elementToItem(element, elementIndex, slide.size, themeDir)
            if (item) items.push(item)
        })
        if (!items.length) return

        const slideName = slide.name || `Slide ${slideIndex + 1}`
        templates.push({
            name: slides.length > 1 ? `${name} - ${slideName}` : name,
            color: slide.backgroundColor ? colorToCss(slide.backgroundColor) : null,
            category: category || "ProPresenter",
            slide: slideName,
            items
        })
    })

    return templates
}

export function themeToTemplate(name: string, theme: PPTheme, themeDir?: string): PPThemeTemplate | null {
    return themeToTemplates(name, theme, themeDir)[0] || null
}
