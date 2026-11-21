import { existsSync, readFileSync } from "fs"
import { describe, expect, it } from "vitest"
import { parsePlaylistContainer, playableItems } from "./ppPlaylist"

const REAL = "/home/ubuntu/grace-city/pp-samples/playlists/Library"

// --- helpers to build protobuf wire data so the parser is tested without the real file ---

function varint(value: number) {
    const bytes: number[] = []
    let rest = value
    do {
        let byte = rest & 0x7f
        rest = Math.floor(rest / 128)
        if (rest) byte |= 0x80
        bytes.push(byte)
    } while (rest)
    return Buffer.from(bytes)
}

function lenField(field: number, payload: Buffer) {
    return Buffer.concat([varint((field << 3) | 2), varint(payload.length), payload])
}

function strField(field: number, value: string) {
    return lenField(field, Buffer.from(value, "utf8"))
}

function makeItem(name: string, absolute: string, relative: string, uuid: string) {
    const inner = Buffer.concat([
        lenField(1, strField(1, uuid)),
        strField(2, name),
        strField(7, absolute),
        strField(8, relative)
    ])
    return lenField(13, inner)
}

function makePlaylist(name: string, uuid: string, items: Buffer[]) {
    const inner = Buffer.concat([strField(1, uuid), strField(2, name), ...items])
    return lenField(12, inner)
}

describe("playlist decoder", () => {
    it("reads playlist names, item names and both paths", () => {
        const container = Buffer.concat([
            makePlaylist("Sunday Service", "pl-1", [
                makeItem("Announcements", "C:\\PP\\Libraries\\Sample\\Announcements.pro", "Libraries/Sample/Announcements.pro", "it-1"),
                makeItem("Good Grace", "C:\\PP\\Libraries\\Sample\\Good Grace.pro", "Libraries/Sample/Good Grace.pro", "it-2")
            ]),
            makePlaylist("Prayer", "pl-2", [makeItem("Way Maker", "C:\\PP\\Libraries\\Sample\\Way Maker.pro", "Libraries/Sample/Way Maker.pro", "it-3")])
        ])
        const file = lenField(3, container)

        const playlists = parsePlaylistContainer(file)
        expect(playlists.map((a) => a.name)).toEqual(["Sunday Service", "Prayer"])
        expect(playlists[0].items.map((a) => a.name)).toEqual(["Announcements", "Good Grace"])
        expect(playlists[0].items[1].relativePath).toBe("Libraries/Sample/Good Grace.pro")
        expect(playlists[0].items[1].absolutePath).toContain("C:\\PP\\Libraries")
    })

    it("drops header tokens and numeric ids from item names", () => {
        const inner = Buffer.concat([lenField(1, strField(1, "abc")), strField(2, "Music"), strField(3, "26300"), strField(9, "Pres")])
        const playlist = lenField(12, Buffer.concat([strField(1, "pl"), strField(2, "Set"), lenField(13, inner)]))
        const playlists = parsePlaylistContainer(lenField(3, playlist))
        // no resolvable presentation: the item is dropped rather than imported as junk
        expect(playlists).toEqual([])
    })

    it("ignores garbage instead of throwing", () => {
        expect(parsePlaylistContainer(Buffer.from([0xff, 0x00, 0x13]))).toEqual([])
    })

    it("keeps only resolvable presentation items", () => {
        const container = makePlaylist("Set", "pl", [
            makeItem("One", "C:\\a\\One.pro", "Libraries/A/One.pro", "u1"),
            makeItem("Two", "C:\\a\\Two.pro", "Libraries/A/Two.pro", "u2")
        ])
        const playlists = parsePlaylistContainer(lenField(3, container))
        expect(playableItems(playlists[0])).toHaveLength(2)
    })
})

describe.runIf(existsSync(REAL))("real Grace City playlists file", () => {
    const playlists = parsePlaylistContainer(readFileSync(REAL))

    it("finds the playlists in the church file", () => {
        expect(playlists.length).toBeGreaterThanOrEqual(4)
        const names = playlists.map((a) => a.name)
        expect(names.some((name) => /sunday/i.test(name))).toBe(true)
        expect(names.some((name) => /prayer/i.test(name))).toBe(true)
    })

    it("resolves presentations with relative paths we can map to shows", () => {
        const items = playlists.flatMap((a) => playableItems(a))
        expect(items.length).toBeGreaterThan(20)
        const sample = items.find((a) => /announcements/i.test(a.name))
        expect(sample?.relativePath).toBe("Libraries/Sample/Announcements.pro")
        // every resolvable item should name a presentation, not a stray token
        expect(items.filter((a) => !a.name).length).toBe(0)
    })
})
