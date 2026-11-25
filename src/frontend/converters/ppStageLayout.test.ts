import { describe, expect, it } from "vitest"
import type { PPStageLayout } from "../../electron/data/ppStage"
import { colorTriggerFields, planStageLayout } from "./ppStageLayout"

function layout(elements: PPStageLayout["elements"]): PPStageLayout {
    return { id: "1", name: "Test Layout", width: 1920, height: 1080, background: "#000000", elements }
}

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

describe("planStageLayout", () => {
    it("places every element at its own geometry, in paint order", () => {
        const plan = planStageLayout(
            layout([
                { name: "plate", box: box(0, 0, 1920, 1080), opacity: 1, rotation: 0, fill: { enabled: true, color: "#000000", alpha: 1 } },
                { name: "", box: box(0, 0, 1920, 1080), opacity: 1, rotation: 0, link: { kind: "output", screenName: "LED Screen" } }
            ])
        )

        const ids = plan.layout.itemOrder!
        expect(ids).toHaveLength(2)

        const plate = plan.layout.items[ids[0]]
        expect(plate.style).toContain("width:1920px")
        expect(plate.style).toContain("background-color:#000000")

        const output = plan.layout.items[ids[1]]
        expect(output.type).toBe("currentOutput")
    })

    it("keeps the font, colour and alignment of a stage text element", () => {
        const plan = planStageLayout(
            layout([
                {
                    name: "label",
                    box: box(103.72, 1037.41, 500, 24.42),
                    opacity: 1,
                    rotation: 0,
                    text: {
                        family: "CMG Sans",
                        size: 18,
                        bold: true,
                        italic: false,
                        uppercase: true,
                        color: "#9a9a9a",
                        align: "center",
                        verticalAlign: "middle",
                        singleLine: false,
                        scaleBehavior: 0,
                        lineHeight: 1,
                        sample: "Timer"
                    }
                }
            ])
        )

        const item = Object.values(plan.layout.items)[0]
        expect(item.style).toContain("font-family:'CMG Sans', Montserrat, sans-serif")
        expect(item.style).toContain("font-size:18px")
        expect(item.style).toContain("text-transform:uppercase")
        expect(item.style).toContain("color:#9a9a9a")
        expect(item.align).toBe("center")
        expect(item.alignX).toBe("center")
        expect(item.lines?.[0].text[0].value).toBe("Timer")
    })

    it("maps current and next slide elements to the right offsets", () => {
        const plan = planStageLayout(
            layout([
                { name: "", box: box(2, 0, 993, 1080), opacity: 1, rotation: 0, link: { kind: "slide", sourceSlide: 0 } },
                { name: "", box: box(998, 0, 922, 1080), opacity: 1, rotation: 0, link: { kind: "slide", sourceSlide: 1 } }
            ])
        )

        const items = plan.layout.itemOrder!.map((id) => plan.layout.items[id])
        expect(items[0].type).toBe("slide_text")
        expect(items[0].slideOffset).toBe(0)
        expect(items[1].slideOffset).toBe(1)
        expect(items[1].style).toContain("left:998px")
    })

    it("binds a timer by the name ProPresenter stored, and says so when it cannot", () => {
        const bound = planStageLayout(layout([{ name: "", box: box(0, 0, 1920, 100), opacity: 1, rotation: 0, link: { kind: "timer", timerName: "Segment Countdown", timerFormat: "HH:mm:ss" } }]), {
            timerIds: { "Segment Countdown": "abc123" }
        })
        const timer = Object.values(bound.layout.items)[0]
        expect(timer.type).toBe("timer")
        expect(timer.timer?.id).toBe("abc123")

        const unbound = planStageLayout(layout([{ name: "", box: box(0, 0, 1920, 100), opacity: 1, rotation: 0, link: { kind: "timer", timerName: "Missing Timer" } }]))
        expect(unbound.warnings[0]).toContain("Missing Timer")
    })

    it("reports a live video fill instead of dropping it silently", () => {
        const plan = planStageLayout(layout([{ name: "", box: box(0, 0, 1920, 1080), opacity: 1, rotation: 0, fill: { enabled: true, live: true } }]))
        expect(plan.layout.itemOrder).toHaveLength(0)
        expect(plan.warnings[0]).toContain("live video fill")
    })

    it("does not paint ProPresenter's stock blue fill as a box", () => {
        const plan = planStageLayout(
            layout([
                {
                    name: "",
                    box: box(0, 0, 1920, 1080),
                    opacity: 1,
                    rotation: 0,
                    fill: { enabled: true, color: "#1e90ff", alpha: 1 },
                    link: { kind: "slide", sourceSlide: 0 }
                }
            ])
        )
        expect(Object.values(plan.layout.items)[0].style).not.toContain("background-color")
    })

    it("carries the layout resolution and background into the stage settings", () => {
        const plan = planStageLayout(layout([]))
        expect(plan.layout.settings.resolution).toEqual({ width: 1920, height: 1080 })
        expect(plan.layout.settings.color).toBe("#000000")
    })
})

describe("colorTriggerFields", () => {
    it("maps ProPresenter's 30s amber and expiry red onto a timer warning and overflow", () => {
        const { fields, notes } = colorTriggerFields([
            { time: 30, color: "#c66b12" },
            { time: 0, color: "#9c0612" }
        ])
        expect(fields).toEqual({ warn: true, warnOffset: 30, warnColor: "#c66b12", overflow: true, overflowColor: "#9c0612" })
        expect(notes).toHaveLength(0)
    })

    it("keeps the earliest warning and says what it dropped", () => {
        const { fields, notes } = colorTriggerFields([
            { time: 60, color: "#111111" },
            { time: 30, color: "#222222" }
        ])
        expect(fields.warnOffset).toBe(60)
        expect(notes[0]).toContain("30s dropped")
    })

    it("returns nothing for an element with no triggers", () => {
        expect(colorTriggerFields([]).fields).toEqual({})
    })
})
