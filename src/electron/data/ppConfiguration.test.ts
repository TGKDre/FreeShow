import { existsSync, readFileSync } from "fs"
import { describe, expect, it } from "vitest"
import { parsePropContainer } from "./ppProps"
import { parseStageContainer } from "./ppStage"
import { parseTimerContainer } from "./ppTimers"
import { colorTriggerFields, planStageLayout } from "../../frontend/converters/ppStageLayout"

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

    it("reads the stage layouts, their geometry and their data links", () => {
        const layouts = parseStageContainer(read("Stage"))
        expect(layouts).toHaveLength(21)
        expect(layouts.map((a) => a.name)).toEqual(expect.arrayContaining(["Screen Preview", "Screen Preview with timer", "Current & Next Lyrics"]))

        const withTimer = layouts.find((a) => a.name === "Screen Preview with timer")!
        expect(withTimer.width).toBe(1920)
        expect(withTimer.height).toBe(1080)
        expect(withTimer.background).toBe("#000000")

        const timer = withTimer.elements.find((a) => a.link?.kind === "timer")
        expect(timer?.link?.timerName).toBe("Segment Countdown")
        expect(timer?.box.height).toBeCloseTo(106.75, 1)

        const screen = withTimer.elements.find((a) => a.link?.kind === "output")
        expect(screen?.link?.screenName).toBe("LED Screen")
        expect(screen?.box.width).toBe(1920)
    })

    it("resolves stage text typography from the attributes and the RTF", () => {
        const layouts = parseStageContainer(read("Stage"))
        const lyrics = layouts.find((a) => a.name === "Current & Next Lyrics")!

        const current = lyrics.elements.find((a) => a.link?.kind === "slide" && a.link.sourceSlide === 0)!
        const next = lyrics.elements.find((a) => a.link?.kind === "slide" && a.link.sourceSlide === 1)!
        expect(current.text?.family).toBe("CMG Sans")
        expect(current.text?.bold).toBe(true)
        expect(current.text?.uppercase).toBe(true)
        expect(current.text?.color).toBe("#ffffff")
        expect(current.box.x).toBeCloseTo(2.25, 1)
        expect(next.box.x).toBeCloseTo(997.66, 1)

        // the 4.5px yellow divider between the two lyric columns is a plate, not a text element
        const divider = lyrics.elements.find((a) => !a.link && a.fill?.color === "#ffff00")!
        expect(divider.box.width).toBeCloseTo(4.5, 1)
        expect(divider.box.height).toBe(1080)
        expect(divider.text?.sample).toBe("")
    })

    it("keeps the per element sizes and colours of the mixed text layout", () => {
        const layouts = parseStageContainer(read("Stage"))
        const mixed = layouts.find((a) => a.name === "Current + Next Text")!
        expect(mixed.elements).toHaveLength(7)

        // the file marks the gold 150px box as the next slide and the white 42px box as the current one
        const current = mixed.elements.find((a) => a.link?.kind === "slide" && a.link.sourceSlide === 0)!
        const next = mixed.elements.find((a) => a.link?.kind === "slide" && a.link.sourceSlide === 1)!
        expect(next.text?.size).toBe(150)
        expect(next.text?.color).toBe("#b88206")
        expect(current.text?.size).toBe(42)

        const timer = mixed.elements.find((a) => a.link?.kind === "timer")!
        expect(timer.link?.timerFormat).toBe("m:ss")
        expect(timer.link?.colorTriggers?.map((a) => a.color)).toEqual(["#c66b12", "#9c0612"])
        expect(timer.link?.colorTriggers?.map((a) => a.time)).toEqual([30, 0])

        // and those triggers become a timer warning at 30 seconds plus a red overflow
        expect(colorTriggerFields(timer.link?.colorTriggers)).toEqual({
            fields: { warn: true, warnOffset: 30, warnColor: "#c66b12", overflow: true, overflowColor: "#9c0612" },
            notes: []
        })

        const countdown = mixed.elements.find((a) => a.link?.kind === "countdown")
        expect(countdown?.link?.timerFormat).toBe("mm:ss")

        const labels = mixed.elements.filter((a) => !a.link && a.text?.sample)
        expect(labels.map((a) => a.text?.sample)).toEqual(expect.arrayContaining(["Timer", "Video Countdown"]))
    })

    it("maps every stage layout onto FreeShow stage items at the file geometry", () => {
        const layouts = parseStageContainer(read("Stage"))
        const plans = layouts.map((a) => planStageLayout(a, { timerIds: { "Segment Countdown": "timer1" }, serviceTimerId: "service" }))
        // 39 positioned elements: three are live video fills with no path, and one is an unassigned screen
        // element with no data link and no enabled fill, so 35 of them become items. Five warnings follow:
        // those four, plus the video countdown being mapped to a countdown to service start
        expect(plans.reduce((n, p) => n + Object.keys(p.layout.items).length, 0)).toBe(35)
        expect(plans.reduce((n, p) => n + p.warnings.length, 0)).toBe(5)
        expect(plans.flatMap((p) => p.warnings).filter((w) => w.includes("live video fill"))).toHaveLength(3)

        const lyrics = plans.find((a) => a.layout.name === "Current & Next Lyrics")!
        expect(Object.keys(lyrics.layout.items)).toHaveLength(3)
        const lyricItems = lyrics.layout.itemOrder!.map((id) => lyrics.layout.items[id])
        expect(lyricItems[0].style).toContain("background-color:#ffff00")
        expect(lyricItems[1].slideOffset).toBe(1)
        expect(lyricItems[2].slideOffset).toBe(0)
        expect(lyricItems[2].style).toContain("left:2.25px")
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
