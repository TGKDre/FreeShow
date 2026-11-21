import { existsSync, readFileSync } from "fs"
import { describe, expect, it } from "vitest"
import { parsePropContainer } from "./ppProps"
import { parseStageContainer } from "./ppStage"
import { parseTimerContainer } from "./ppTimers"

const DIR = process.env.PP_CONFIGURATION_DIR || "/home/ubuntu/grace-city/pp-samples/Configuration"
const read = (name: string) => readFileSync(`${DIR}/${name}`)

describe.runIf(existsSync(DIR))("Grace City configuration files", () => {
    it("reads the timers with their durations", () => {
        const timers = parseTimerContainer(read("Timers"))
        expect(timers.map((a) => a.name)).toEqual(expect.arrayContaining(["Segment Countdown", "Game Timer", "PreShow Countdown"]))

        const segment = timers.find((a) => a.name === "Segment Countdown")
        const preshow = timers.find((a) => a.name === "PreShow Countdown")
        expect(segment?.seconds).toBe(1800)
        expect(preshow?.seconds).toBe(18000)
        expect(segment?.countsDown).toBe(true)
        expect(timers.every((a) => !!a.id)).toBe(true)
    })

    it("reads the stage layouts and their items", () => {
        const layouts = parseStageContainer(read("Stage"))
        expect(layouts.map((a) => a.name)).toEqual(expect.arrayContaining(["Screen Preview", "Screen Preview with timer", "Current & Next Lyrics"]))

        const withTimer = layouts.find((a) => a.name === "Screen Preview with timer")
        const timer = withTimer?.items.find((a) => a.kind === "timer")
        expect(timer?.name).toBe("Segment Countdown")
        expect(withTimer?.items.some((a) => a.kind === "screen" && a.name === "LED Screen")).toBe(true)
    })

    it("reads every prop name", () => {
        const props = parsePropContainer(read("Props"))
        expect(props.length).toBe(21)
        expect(props.map((a) => a.name)).toEqual(expect.arrayContaining(["Giving", "Announcement", "PTAM", "Giving Lowerthird"]))
        expect(props.every((a) => !!a.id)).toBe(true)
    })
})

describe("container decoders on junk input", () => {
    it("return nothing instead of throwing", () => {
        const junk = Buffer.from([0xff, 0x13, 0x00, 0x08])
        expect(parseTimerContainer(junk)).toEqual([])
        expect(parseStageContainer(junk)).toEqual([])
        expect(parsePropContainer(junk)).toEqual([])
    })
})
