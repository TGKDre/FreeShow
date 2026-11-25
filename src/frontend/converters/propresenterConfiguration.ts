// Import the ProPresenter configuration artifacts that have no upstream importer,
// all of which Grace City actually uses on a Sunday.
//
//   Timers  -> the timers drawer (Segment Countdown 30 min, PreShow Countdown 300 min, Game Timer)
//   Stage   -> stage layouts, one FreeShow stage item per ProPresenter element, at the file's own geometry
//   Props   -> Overlays, one per prop, since FreeShow has no props container
//
// Messages and CCLI carry no importable content in the Grace City file: the messages library is empty and
// the CCLI file only holds display configuration. FreeShow already stores CCLI numbers as song metadata.

import { get } from "svelte/store"
import { uid } from "uid"
import type { PPProp } from "../../electron/data/ppProps"
import type { PPStageLayout } from "../../electron/data/ppStage"
import type { PPTimer } from "../../electron/data/ppTimers"
import type { Timer } from "../../types/Show"
import { overlays, stageShows, timers } from "../stores"
import { newToast } from "../utils/common"
import { colorTriggerFields, planStageLayout } from "./ppStageLayout"

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

/** timers are bound to stage items by name, the way ProPresenter stores the reference */
function findTimerByName(name: string) {
    return Object.values(get(timers) || {}).find((timer: Timer) => timer.name === name)
}

export function convertProPresenterStageLayouts(data: { content: any }[]) {
    const imported = read<PPStageLayout>(data, "layouts")
    if (!imported.length) return

    const warnings: string[] = []

    stageShows.update((current) => {
        // resolve (or create) the timers the layouts bind to before planning any item
        const needsTimer = (name: string) => {
            const found = findTimerByName(name)
            if (found?.id) return found.id

            // importing a stage layout on its own must still produce a working timer, so add the ones the
            // file references and let a later timers import match them by name instead of duplicating them
            const id = uid()
            const isService = /service/i.test(name)
            timers.update((all) => {
                all[id] = isService
                    ? { id, name, type: "clock", viewType: "time", time: "10:00" }
                    : { id, name, type: "counter", viewType: "time", start: 1800, end: 0 }
                return all
            })
            return id
        }

        const timerNames = new Set<string>()
        for (const layout of imported) for (const element of layout.elements) if (element.link?.timerName) timerNames.add(element.link.timerName)

        const timerIds: { [name: string]: string } = {}
        for (const name of timerNames) timerIds[name] = needsTimer(name)

        const serviceTimerId = needsTimer("Service Countdown")

        // ProPresenter keeps its 30s amber and 0s red triggers on the stage element, not on the timer
        const triggersByName: { [name: string]: { time: number; color: string }[] } = {}
        for (const layout of imported) {
            for (const element of layout.elements) {
                const link = element.link
                if (!link?.timerName || !link.colorTriggers?.length || triggersByName[link.timerName]) continue
                triggersByName[link.timerName] = link.colorTriggers
            }
        }

        timers.update((all) => {
            for (const [name, triggers] of Object.entries(triggersByName)) {
                const timer = all[timerIds[name]]
                if (!timer) continue
                const { fields, notes } = colorTriggerFields(triggers)
                Object.assign(timer, fields)
                for (const note of notes) warnings.push(`timer "${name}": ${note}`)
            }
            return all
        })

        for (const layout of imported) {
            const plan = planStageLayout(layout, { timerIds, serviceTimerId })
            warnings.push(...plan.warnings)

            const id = uid()
            current[id] = plan.layout
        }

        return current
    })

    if (warnings.length) console.info(`ProPresenter stage import: ${warnings.length} element(s) need attention\n${warnings.join("\n")}`)
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
