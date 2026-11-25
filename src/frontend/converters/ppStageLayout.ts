// Map decoded ProPresenter stage layouts to FreeShow stage items.
//
// Pure: no stores, no Svelte, so this can be unit tested against a decoded layout. The converter that
// writes into `stageShows` lives in propresenterConfiguration.ts and only calls planStageLayout().
//
// The rule the whole file follows: the file geometry IS the design. Every item is placed at the decoded
// bounds, at the decoded font size, with the decoded colour and alignment. Nothing is re-laid-out, nothing
// is auto-fitted beyond what the element's own scale behavior asked for, and no invented spacing.

import type { PPStageColorTrigger, PPStageElement, PPStageLayout } from "../../electron/data/ppStage"
import type { StageItem, StageLayout } from "../../types/Stage"

export interface StagePlanOptions {
    /** ProPresenter timer name -> FreeShow timer id, so "Segment Countdown" binds to the imported timer */
    timerIds?: { [name: string]: string }
    /** timer id used for the one video countdown element (a count down to service start) */
    serviceTimerId?: string
}

export interface StagePlan {
    layout: StageLayout
    warnings: string[]
}

/** ProPresenter's stock element fill. It is decoration, not a painted box. */
const STOCK_FILL = "#1e90ff"

function cssFontFamily(family: string) {
    const clean = (family || "").trim()
    const quoted = /\s/.test(clean) ? `'${clean}'` : clean
    // the church PC has CMG Sans; anywhere else fall back to a real installed sans, never a serif default
    return clean ? `${quoted}, Montserrat, sans-serif` : "Arial, Helvetica, sans-serif"
}

function cssColor(color: string, alpha = 1) {
    if (!color) return ""
    if (alpha >= 1) return color
    const value = color.replace("#", "")
    const [r, g, b] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16))
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function boxStyle(element: PPStageElement) {
    const { x, y, width, height } = element.box
    return `width:${width}px;height:${height}px;left:${x}px;top:${y}px;`
}

function opacityStyle(element: PPStageElement) {
    return element.opacity < 1 ? `opacity:${element.opacity};` : ""
}

function textStyle(element: PPStageElement) {
    const text = element.text
    if (!text) return ""

    let style = `font-family:${cssFontFamily(text.family)};font-size:${text.size}px;`
    if (text.bold) style += "font-weight:bold;"
    if (text.italic) style += "font-style:italic;"
    if (text.uppercase) style += "text-transform:uppercase;"
    if (text.color) style += `color:${text.color};`
    if (text.lineHeight && text.lineHeight !== 1) style += `line-height:${text.lineHeight};`
    return style
}

function plateStyle(element: PPStageElement, options: { allowStock?: boolean } = {}) {
    const fill = element.fill
    if (!fill?.enabled || !fill.color) return ""
    // stock blue is decoration on a text or linked element, but it IS the content of an empty shape element
    if (!options.allowStock && fill.color.toLowerCase() === STOCK_FILL) return ""
    const alpha = fill.alpha === undefined ? 1 : fill.alpha
    if (alpha <= 0) return ""
    return `background-color:${cssColor(fill.color, alpha)};`
}

function verticalAlign(element: PPStageElement) {
    const align = element.text?.verticalAlign
    if (align === "bottom") return "flex-end"
    if (align === "middle") return "center"
    return "flex-start"
}

function horizontalAlign(element: PPStageElement) {
    const align = element.text?.align
    return align && align !== "justify" ? align : "center"
}

function textFit(element: PPStageElement) {
    // 0 none, 1 adjust container height, 2 scale font down, 3 scale font up, 4 scale up/down
    switch (element.text?.scaleBehavior) {
        case 2:
        case 4:
            return "shrinkToFit" as const
        case 3:
            return "growToFit" as const
        default:
            return "none" as const
    }
}


/** ProPresenter stores its own trigger times in seconds remaining, and a stage timer can only carry one
 * warning threshold plus an overflow state, so the earliest warning wins and the rest are reported */
export function colorTriggerFields(triggers: PPStageColorTrigger[] = []) {
    const fields: { warn?: boolean; warnOffset?: number; warnColor?: string; overflow?: boolean; overflowColor?: string } = {}
    const notes: string[] = []

    const positive = triggers.filter((a) => a.time > 0).sort((a, b) => b.time - a.time)
    const end = triggers.find((a) => a.time <= 0)

    if (positive.length) {
        fields.warn = true
        fields.warnOffset = Math.round(positive[0].time)
        fields.warnColor = positive[0].color
        if (positive.length > 1) notes.push(`trigger at ${Math.round(positive[1].time)}s dropped, a stage timer carries one warning threshold`)
    }

    if (end?.color) {
        fields.overflow = true
        fields.overflowColor = end.color
    }

    return { fields, notes }
}

export function planStageLayout(layout: PPStageLayout, options: StagePlanOptions = {}): StagePlan {
    const warnings: string[] = []
    const items: { [key: string]: StageItem } = {}
    const order: string[] = []
    let index = 0

    const add = (item: StageItem) => {
        const id = `pp_${index++}`
        items[id] = item
        order.push(id)
    }

    for (const element of layout.elements) {
        const geometry = boxStyle(element) + opacityStyle(element)
        const link = element.link
        const label = element.name || undefined

        // ---- media fills: a media file, or a live video input ProPresenter resolves by UUID -----------
        const fill = element.fill
        if (fill?.live) {
            warnings.push(`${layout.name}: "${element.name || "element"}" is a live video fill that ProPresenter stores without a path, so it needs a device assigned in the stage editor`)
            continue
        }
        if (fill?.mediaPath) {
            add({ type: "media", src: fill.mediaPath, style: geometry, align: "" })
            continue
        }

        // ---- elements with a data link: live content ------------------------------------------------
        if (link) {
            const style = geometry + textStyle(element) + plateStyle(element)
            const base = { style, align: verticalAlign(element), alignX: horizontalAlign(element), label }

            if (link.kind === "slide") {
                add({
                    ...base,
                    type: "slide_text",
                    slideOffset: link.sourceSlide === 1 ? 1 : 0,
                    // ProPresenter does not wrap a single line element; it squeezes the box instead
                    lineCount: element.text?.singleLine ? 1 : undefined,
                    keepStyle: true,
                    textFit: textFit(element)
                } as StageItem)
                continue
            }

            if (link.kind === "timer") {
                const timerId = options.timerIds?.[link.timerName || ""] || ""
                if (!timerId) warnings.push(`${layout.name}: timer "${link.timerName || "(unnamed)"}" has no matching FreeShow timer, so the item is unbound`)
                add({
                    ...base,
                    type: "timer",
                    timer: { id: timerId, viewType: "time", padding: true, showHours: !!link.timerFormat?.includes("H") },
                    textFit: "none"
                } as StageItem)
                continue
            }

            if (link.kind === "countdown") {
                add({
                    ...base,
                    type: "timer",
                    timer: { id: options.serviceTimerId || "", viewType: "time", padding: true, showHours: true },
                    textFit: "none"
                } as StageItem)
                warnings.push(`${layout.name}: the video countdown follows the playing video in ProPresenter; it is mapped to a countdown to service start here`)
                continue
            }

            if (link.kind === "clock") {
                const seconds = !!link.timerFormat?.includes("s")
                add({
                    ...base,
                    type: "clock",
                    clock: {
                        type: "custom",
                        dateFormat: "none",
                        showTime: true,
                        seconds,
                        customFormat: link.militaryTime ? (seconds ? "HH:mm:ss" : "HH:mm") : seconds ? "h:mm:ss A" : "h:mm A"
                    },
                    textFit: "none"
                } as StageItem)
                continue
            }

            if (link.kind === "output") {
                add({ ...base, type: "currentOutput", currentOutput: { showLabel: false } } as StageItem)
                continue
            }

            if (link.kind === "notes") {
                add({ ...base, type: "slide_notes", slideOffset: link.sourceSlide === 1 ? 1 : 0 } as StageItem)
                continue
            }

            warnings.push(`${layout.name}: element "${element.name || link.field || "unknown"}" uses the ProPresenter "${link.field}" data link, which has no FreeShow stage item yet`)
            continue
        }

        // ---- no data link: labels, dividers, plates -------------------------------------------------
        const sample = element.text?.sample || ""
        if (sample) {
            add({
                type: "text",
                style: geometry + textStyle(element),
                align: verticalAlign(element),
                alignX: horizontalAlign(element),
                label,
                lines: [{ align: horizontalAlign(element), text: [{ value: sample, style: "" }] }]
            } as StageItem)
            continue
        }

        // an empty text box that still carries a fill is a plate: the white divider, the black background
        const plate = plateStyle(element, { allowStock: true })
        if (plate) {
            add({
                type: "text",
                style: geometry + plate,
                align: "flex-start",
                alignX: "center",
                label,
                lines: [{ align: "", text: [{ value: "", style: "" }] }]
            } as StageItem)
            continue
        }

        warnings.push(`${layout.name}: element "${element.name || "unknown"}" has no text, no fill and no data link, so there is nothing to draw`)
    }

    const stageLayout: StageLayout = {
        name: layout.name,
        disabled: false,
        password: "",
        settings: {
            background: true,
            color: layout.background,
            resolution: { width: layout.width, height: layout.height },
            labels: false
        },
        items,
        itemOrder: order
    }

    return { layout: stageLayout, warnings }
}
