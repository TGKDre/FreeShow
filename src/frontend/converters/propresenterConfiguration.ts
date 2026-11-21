// Import the ProPresenter configuration artifacts that have no upstream importer,
// all of which Grace City actually uses on a Sunday.
//
//   Timers  -> the timers drawer (Segment Countdown 30 min, PreShow Countdown 300 min, Game Timer)
//   Stage   -> stage layouts, rebuilt from FreeShow's own stage items (current and next slide, plus the
//              timer the ProPresenter layout referenced)
//   Props   -> Overlays, one per prop, since FreeShow has no props container
//
// Messages and CCLI carry no importable content in the Grace City file: the messages library is empty and
// the CCLI file only holds display configuration. FreeShow already stores CCLI numbers as song metadata.

import { uid } from "uid"
import type { PPProp } from "../../electron/data/ppProps"
import type { PPStageLayout } from "../../electron/data/ppStage"
import type { PPTimer } from "../../electron/data/ppTimers"
import { overlays, stageShows, timers } from "../stores"
import { newToast } from "../utils/common"

function read<T>(data: { content: any }[], key: string): T[] {
    const out: T[] = []
    for (const file of data || []) {
        try {
            const parsed = typeof file.content === "string" ? JSON.parse(file.content) : file.content
            if (Array.isArray(parsed?.[key])) out.push(...parsed[key])
        } catch (err) {
            console.error(`ProPresenter ${key} could not be read:`, err)
        }
    }
    return out
}

export function convertProPresenterTimers(data: { content: any }[]) {
    const imported = read<PPTimer>(data, "timers")
    if (!imported.length) return

    timers.update((current) => {
        for (const timer of imported) {
            const id = uid()
            current[id] = {
                id,
                name: timer.name,
                type: "counter",
                viewType: "time",
                // FreeShow counts from start to end; a ProPresenter countdown runs duration -> 0
                start: timer.countsDown ? timer.seconds : 0,
                end: timer.countsDown ? 0 : timer.seconds
            }
        }
        return current
    })

    newToast("main.finished")
}

const STAGE_TEXT_STYLE = "width:1870px;height:680px;left:25px;top:25px;font-family:Arial;font-weight:bold;"
const STAGE_NEXT_STYLE = "width:1870px;height:330px;left:25px;top:725px;font-family:Arial;font-weight:bold;color:#aaaaaa;"

export function convertProPresenterStageLayouts(data: { content: any }[]) {
    const imported = read<PPStageLayout>(data, "layouts")
    if (!imported.length) return

    stageShows.update((current) => {
        for (const layout of imported) {
            const items: any = {
                current: { type: "slide_text", style: STAGE_TEXT_STYLE, align: "" },
                next: { type: "slide_text", slideOffset: 1, lineCount: 2, style: STAGE_NEXT_STYLE, align: "" }
            }

            for (const item of layout.items || []) {
                if (item.kind === "timer") {
                    items.timer = {
                        type: "timer",
                        label: item.name || "",
                        style: "width:520px;height:180px;left:1380px;top:40px;font-family:Arial;font-weight:bold;",
                        align: ""
                    }
                }
                if (item.kind === "screen") {
                    items.output = { type: "currentOutput", label: item.name || "", style: "width:420px;height:236px;left:1460px;top:800px;border:2px solid #707070;", align: "" }
                }
            }

            const id = uid()
            current[id] = { name: layout.name, disabled: false, password: "", settings: {}, items }
        }
        return current
    })

    newToast("main.finished")
}

export function convertProPresenterProps(data: { content: any }[]) {
    const imported = read<PPProp>(data, "props")
    if (!imported.length) return

    overlays.update((current) => {
        for (const prop of imported) {
            const id = uid()
            current[id] = {
                name: prop.name,
                color: null,
                category: "ProPresenter Props",
                items: [
                    {
                        id: uid(),
                        style: "top:800px;left:60px;height:160px;width:1100px;",
                        lines: [{ align: "left", text: [{ value: prop.name, style: "font-size:64px;color:#ffffff;font-family:Arial;font-weight:bold;" }] }]
                    }
                ]
            }
        }
        return current
    })

    newToast("main.finished")
}
