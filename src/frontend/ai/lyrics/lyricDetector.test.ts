import { describe, expect, it } from "vitest"
import { findLyricMatch, scoreLine, tokenize } from "./lyricDetector"

const songs = [
    {
        id: "song-1",
        title: "Way Maker",
        lines: ["You are here moving in our midst", "I worship you I worship you", "Way maker miracle worker promise keeper"]
    },
    {
        id: "song-2",
        title: "Great Are You Lord",
        lines: ["It's your breath in our lungs", "So we pour out our praise", "Great are you lord"]
    }
]

describe("lyric tokenising", () => {
    it("drops punctuation, one letter words and filler but keeps pronouns", () => {
        expect(tokenize("Oh, You are the Way Maker!")).toEqual(["you", "are", "way", "maker"])
    })

    it("handles empty input", () => {
        expect(tokenize("")).toEqual([])
    })
})

describe("lyric line scoring", () => {
    it("scores a full match with an order bonus above plain coverage", () => {
        const tokens = tokenize("way maker miracle worker promise keeper")
        const window = new Set(tokens)
        const bigramSet = new Set(tokens.slice(0, -1).map((word, index) => `${word} ${tokens[index + 1]}`))
        const { score, matched } = scoreLine(window, bigramSet, "Way maker miracle worker promise keeper")
        expect(matched).toBe(6)
        expect(score).toBeGreaterThan(1 - 0.01)
    })

    it("returns nothing when no words overlap", () => {
        expect(scoreLine(new Set(["random"]), new Set(), "It's your breath in our lungs").matched).toBe(0)
    })
})

describe("lyric recognition", () => {
    it("matches the line being sung", () => {
        const transcript = "sing with me you are here moving in our midst tonight"
        const match = findLyricMatch(transcript, songs)
        expect(match?.songId).toBe("song-1")
        expect(match?.line).toBe("You are here moving in our midst")
        expect(match?.confidence).toBeGreaterThanOrEqual(60)
    })

    it("picks the right song when two are present in the transcript window", () => {
        const transcript = "great are you lord so we pour out our praise to you"
        const match = findLyricMatch(transcript, songs)
        expect(match?.songId).toBe("song-2")
    })

    it("ignores ordinary preaching", () => {
        const transcript = "the apostle paul writes about justification by faith in romans chapter five"
        expect(findLyricMatch(transcript, songs)).toBeNull()
    })

    it("does not fire again on the line already on screen", () => {
        const transcript = "you are here moving in our midst"
        const first = findLyricMatch(transcript, songs)
        expect(first).not.toBeNull()
        const again = findLyricMatch(transcript, songs, { excludeLine: { songId: first!.songId, lineIndex: first!.lineIndex } })
        expect(again).toBeNull()
    })

    it("needs a minimum number of matching words", () => {
        expect(findLyricMatch("way maker", songs)).toBeNull()
    })

    it("tolerates a missing word in the line", () => {
        const transcript = "you are here moving our midst right now"
        const match = findLyricMatch(transcript, songs, { minMatched: 4 })
        expect(match?.line).toBe("You are here moving in our midst")
    })

    it("handles no songs", () => {
        expect(findLyricMatch("anything at all here", [])).toBeNull()
    })
})
