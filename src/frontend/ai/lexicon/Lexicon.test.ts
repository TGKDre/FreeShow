import { describe, expect, it } from "vitest"
import type { LexiconFile } from "../../../types/ai/Lexicon"
import { fold, formatEntryForSlide, loadLexicon, lookupAnywhere, normalizeStrongs, searchLexicon } from "./Lexicon"

const greek: LexiconFile = {
    language: "greek",
    attribution: "test fixture",
    entries: {
        G26: { lemma: "ἀγάπη", translit: "agápē", pron: "ag-ah'-pay", derivation: "from G25", definition: "love, i.e. affection or benevolence", kjv: "love, charity" },
        G2316: { lemma: "θεός", translit: "theós", pron: "theh'-os", derivation: "of uncertain affinity", definition: "a deity, especially the supreme Divinity", kjv: "God" },
        G3875: { lemma: "παράκλητος", translit: "paráklētos", pron: "par-ak'-lay-tos", derivation: "a derivative of G3870", definition: "an intercessor, consoler", kjv: "advocate, comforter" },
        G3056: { lemma: "λόγος", translit: "lógos", pron: "log'-os", derivation: "from G3004", definition: "something said, a topic, also reasoning", kjv: "word" }
    }
}

const hebrew: LexiconFile = {
    language: "hebrew",
    attribution: "test fixture",
    entries: {
        H7307: { lemma: "רוּח", translit: "rûwach", pron: "roo'-akh", derivation: "from H7306", definition: "wind, breath, spirit", kjv: "spirit, wind" }
    }
}

describe("strongs numbers", () => {
    it("normalises the ways an operator types them", () => {
        expect(normalizeStrongs("g3875")).toBe("G3875")
        expect(normalizeStrongs("G 3875")).toBe("G3875")
        expect(normalizeStrongs("3875", "greek")).toBe("G3875")
        expect(normalizeStrongs("H7307")).toBe("H7307")
        expect(normalizeStrongs("026")).toBeNull()
        expect(normalizeStrongs("agape")).toBeNull()
    })
})

describe("accent folding", () => {
    it("strips diacritics and apostrophes", () => {
        expect(fold("agápē")).toBe("agape")
        expect(fold("ʼĕlôhîym")).toBe("elohiym")
    })
})

describe("lexicon search", () => {
    it("finds an entry by strongs number first", () => {
        const [hit] = searchLexicon(greek, "g26")
        expect(hit.strongs).toBe("G26")
        expect(hit.translit).toBe("agápē")
    })

    it("finds by transliteration without requiring accents", () => {
        expect(searchLexicon(greek, "theos")[0].strongs).toBe("G2316")
        expect(searchLexicon(greek, "parakletos")[0].strongs).toBe("G3875")
    })

    it("finds by lemma", () => {
        expect(searchLexicon(greek, "λόγος")[0].strongs).toBe("G3056")
    })

    it("falls back to the English definition", () => {
        const hits = searchLexicon(greek, "intercessor")
        expect(hits[0].strongs).toBe("G3875")
    })

    it("returns nothing for nonsense and empty queries", () => {
        expect(searchLexicon(greek, "zzzzz")).toEqual([])
        expect(searchLexicon(greek, "")).toEqual([])
    })
})

describe("word study slide", () => {
    it("puts the original word first and the definition below", () => {
        const slide = formatEntryForSlide({ strongs: "G3875", language: "greek", ...greek.entries.G3875 })
        expect(slide.title).toBe("παράκλητος")
        expect(slide.subtitle).toContain("paráklētos")
        expect(slide.subtitle).toContain("/par-ak'-lay-tos/")
        expect(slide.subtitle).toContain("G3875")
        expect(slide.body).toContain("an intercessor, consoler")
        expect(slide.body).toContain("KJV: advocate, comforter")
    })
})

describe("loading", () => {
    const fetcher = async (url: string) => {
        if (url.includes("greek")) return greek
        return hebrew
    }

    it("caches after the first load", async () => {
        let calls = 0
        const counting = async (url: string) => {
            calls++
            return fetcher(url)
        }
        await loadLexicon("hebrew", counting)
        await loadLexicon("hebrew", counting)
        expect(calls).toBe(1)
    })

    it("searches Greek then Hebrew", async () => {
        expect((await lookupAnywhere("ruwach", fetcher))[0].strongs).toBe("H7307")
        expect((await lookupAnywhere("agape", fetcher))[0].strongs).toBe("G26")
        expect(await lookupAnywhere("zzzzz", fetcher)).toEqual([])
    })
})
