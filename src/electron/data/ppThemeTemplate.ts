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

/** ProPresenter stores a font family and a point size; FreeShow text styles are CSS declarations. */
export function fontToCss(element: PPThemeElement): string {
    const font = element.text?.font
    const family = font?.family || font?.name || ""
    const parts: string[] = []
    if (family) parts.push(`font-family:${family}`)
    const size = font?.size && font.size > 0 ? font.size : FALLBACK_SIZE
    parts.push(`font-size:${Math.round(size)}px`)
    const color = colorToCss(element.text?.color)
    if (color) parts.push(`color:${color}`)
    if (font?.bold) parts.push("font-weight:bold")
    if (font?.italic) parts.push("font-style:italic")
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
