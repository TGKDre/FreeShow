import { describe, expect, it } from "vitest"
import { decodeEntities, isSectionLabel, matchSongs, normalizeLabel, parseIndex, parseSections, parseSong, songToShowText } from "./loveWorldLyrics"

const indexHtml = `
<ul><li><a class="x" href="/song/a-king-is-born"><span class="block"><span class="inline-block">A King Is Born</span></span><span class="block"><span class="inline-block">Christmas Carol Service Songs</span></span></a></li>
<li><a class="x" href="/song/a-moment-of-grace"><span class="block"><span class="inline-block">A Moment of Grace</span></span><span class="block"><span class="inline-block">Led by Shaunte &middot; Loveworld Songs 2026 Renditions</span></span></a></li>
<li><a class="x" href="/song/a-new-race"><span class="block"><span class="inline-block">A New Race</span></span><span class="block"><span class="inline-block">Led by Sylvia Rich &middot; Praise Night 24 with Pastor Chris</span></span></a></li>
<li><a class="x" href="/song/a-new-race-2"><span class="block"><span class="inline-block">A New Race</span></span><span class="block"><span class="inline-block">Led by Sylvia Rich &middot; Praise Night 26 with Pastor Chris</span></span></a></li></ul>`

const songHtml = `<html><body><h1 class="title">A King Is Born</h1>
<div><p>Verse 1</p><p>No more weeping<br/>No more crying<br/>Christ is born<br/>It&#x27;s a brand new day</p>
<p>Chorus</p><p>Oh, oh, oh, oh<br/>Christ is born<br/>Oh, oh, oh, oh<br/>The King is born</p>
<p>Bridge</p><p>Hallelujah Christ is born</p>
<p>Report an issue</p><p>More from Loveworld Singers</p></div></body></html>`

describe("index", () => {
    it("reads slugs, titles and the album line", () => {
        const songs = parseIndex(indexHtml)
        expect(songs).toHaveLength(4)
        expect(songs[0]).toEqual({ slug: "a-king-is-born", title: "A King Is Born", meta: "Christmas Carol Service Songs" })
        expect(songs[1].meta).toContain("Led by Shaunte")
    })

    it("keeps duplicate titles as separate renditions", () => {
        const songs = parseIndex(indexHtml).filter((song) => song.title === "A New Race")
        expect(songs.map((song) => song.slug)).toEqual(["a-new-race", "a-new-race-2"])
    })

    it("copes with junk", () => {
        expect(parseIndex("")).toEqual([])
        expect(parseIndex("<p>no songs here</p>")).toEqual([])
    })
})

describe("song page", () => {
    it("splits into labelled sections and stops at the page footer", () => {
        const sections = parseSections(songHtml)
        expect(sections.map((section) => section.label)).toEqual(["Verse 1", "Chorus", "Bridge"])
        expect(sections[0].lines).toEqual(["No more weeping", "No more crying", "Christ is born", "It's a brand new day"])
        expect(sections[2].lines).toEqual(["Hallelujah Christ is born"])
    })

    it("recognises the labels a LoveWorld song actually uses", () => {
        for (const label of ["Verse 1", "CHORUS", "Pre-Chorus", "Bridge:", "Vamp", "Hook 2", "Instrumental"]) {
            expect(isSectionLabel(label)).toBe(true)
        }
        for (const line of ["No more weeping", "Oh, oh, oh, oh", ""]) {
            expect(isSectionLabel(line)).toBe(false)
        }
    })

    it("does not treat a lyric line as a label", () => {
        const sections = parseSections("<p>Chorus</p><p>You are the chorus of my song</p>")
        expect(sections).toHaveLength(1)
        expect(sections[0].lines).toEqual(["You are the chorus of my song"])
    })

    it("takes the title from the page and keeps the metadata", () => {
        const song = parseSong(songHtml, { slug: "a-king-is-born", title: "ignored", meta: "Christmas Carol Service Songs" })
        expect(song.title).toBe("A King Is Born")
        expect(song.meta).toBe("Christmas Carol Service Songs")
        expect(song.sections).toHaveLength(3)
    })

    it("builds slide text with one block per section", () => {
        const text = songToShowText(parseSong(songHtml, { slug: "a-king-is-born", title: "A King Is Born" }))
        expect(text.split("\n\n")).toHaveLength(3)
        expect(text.startsWith("Verse 1\nNo more weeping")).toBe(true)
    })
})

describe("matching", () => {
    const index = [
        { slug: "holy", title: "Holy", meta: "" },
        { slug: "holy-are-you-lord", title: "Holy Are You Lord", meta: "" },
        { slug: "king-of-glory", title: "King Of Glory", meta: "" },
        { slug: "a-king-is-born", title: "A King Is Born", meta: "" }
    ]

    it("ranks an exact title first", () => {
        expect(matchSongs(index, "holy")[0].slug).toBe("holy")
    })

    it("finds by partial words", () => {
        const results = matchSongs(index, "king glory")
        expect(results[0].slug).toBe("king-of-glory")
    })

    it("is insular about punctuation and case", () => {
        expect(matchSongs(index, "KING OF GLORY!")[0].slug).toBe("king-of-glory")
    })

    it("returns nothing for an empty query or no match", () => {
        expect(matchSongs(index, "   ")).toEqual([])
        expect(matchSongs(index, "zzzz")).toEqual([])
    })
})

describe("entity and label cleanup", () => {
    it("decodes the entities the site emits", () => {
        expect(decodeEntities("It&#x27;s &amp; more")).toBe("It's & more")
    })

    it("tidies labels", () => {
        expect(normalizeLabel("chorus:")).toBe("Chorus")
        expect(normalizeLabel("verse 2")).toBe("Verse 2")
    })
})
