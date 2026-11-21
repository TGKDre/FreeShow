import { describe, expect, it } from "vitest"
import { buildSongLibrary, lineText, lyricLinesFromShow, slideIdForLine } from "./songLibrary"

const slide = (lines: string[][]) => ({
    items: lines.map((parts) => ({ lines: [{ align: "", text: parts.map((value) => ({ value, style: "" })) }] }))
})

const show = {
    name: "Way Maker",
    slides: {
        s1: slide([["You are here", "moving in our midst"]]),
        s2: slide([["I worship you"], ["  "], ["Way maker miracle worker"]]),
        s3: { items: [] }
    }
}

describe("lyric line text", () => {
    it("joins parts and collapses whitespace", () => {
        expect(lineText(show.slides.s1.items[0].lines[0] as any)).toBe("You are here moving in our midst")
    })

    it("returns nothing for blank or missing lines", () => {
        expect(lineText(show.slides.s2.items[1].lines[0] as any)).toBe("")
        expect(lineText(undefined as any)).toBe("")
    })
})

describe("show to lyric lines", () => {
    it("keeps slide order and drops empty lines", () => {
        expect(lyricLinesFromShow(show as any)).toEqual(["You are here moving in our midst", "I worship you", "Way maker miracle worker"])
    })

    it("handles a show without slides", () => {
        expect(lyricLinesFromShow(undefined)).toEqual([])
    })
})

describe("slide for a lyric line", () => {
    it("matches the order the lines were collected in", () => {
        expect(slideIdForLine(show as any, 0)).toBe("s1")
        expect(slideIdForLine(show as any, 1)).toBe("s2")
        expect(slideIdForLine(show as any, 2)).toBe("s2")
    })

    it("returns null past the end or for bad input", () => {
        expect(slideIdForLine(show as any, 99)).toBeNull()
        expect(slideIdForLine(show as any, -1)).toBeNull()
        expect(slideIdForLine(undefined, 0)).toBeNull()
    })
})

describe("song library", () => {
    it("skips shows without real lyrics and names the rest", () => {
        const library = buildSongLibrary({
            a: show as any,
            b: { name: "Announcements", slides: { s1: slide([["Welcome"]]) } } as any
        })
        expect(library).toHaveLength(1)
        expect(library[0]).toMatchObject({ id: "a", title: "Way Maker" })
        expect(library[0].lines).toHaveLength(3)
    })

    it("returns an empty library for empty input", () => {
        expect(buildSongLibrary({})).toEqual([])
    })
})
