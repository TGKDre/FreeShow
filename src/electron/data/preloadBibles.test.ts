import fs from "fs"
import os from "os"
import path from "path"
import { describe, expect, it, vi } from "vitest"

const scriptures = fs.mkdtempSync(path.join(os.tmpdir(), "bibles-"))
vi.mock("../utils/files", () => ({
    getDataFolderPath: () => scriptures
}))

const { preloadBundledBibles } = await import("./preloadBibles")

describe("preloading bundled Bibles", () => {
    const makeResources = (bibles: { [name: string]: string }) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "resources-"))
        const folder = path.join(root, "data", "bibles")
        fs.mkdirSync(folder, { recursive: true })
        for (const [name, content] of Object.entries(bibles)) fs.writeFileSync(path.join(folder, name), content)
        return root
    }

    it("copies each bible into the user's folder", () => {
        const resources = makeResources({ "KJV1769.json": '{"name":"King James"}', "YLT1898.json": '{"name":"Young"}' })
        const copied = preloadBundledBibles(resources)

        expect(copied).toBe(2)
        expect(fs.existsSync(path.join(scriptures, "KJV1769.json"))).toBe(true)
        expect(fs.readFileSync(path.join(scriptures, "YLT1898.json"), "utf8")).toBe('{"name":"Young"}')
    })

    it("never overwrites a translation that is already there", () => {
        const resources = makeResources({ "KJV1769.json": '{"name":"new copy"}' })
        fs.writeFileSync(path.join(scriptures, "KJV1769.json"), '{"name":"edited by the church"}')

        expect(preloadBundledBibles(resources)).toBe(0)
        expect(fs.readFileSync(path.join(scriptures, "KJV1769.json"), "utf8")).toBe('{"name":"edited by the church"}')
    })

    it("skips the index and leaves nothing behind without a pack", () => {
        expect(preloadBundledBibles(path.join(os.tmpdir(), "no-such-folder"))).toBe(0)

        const resources = makeResources({ "index.json": "[]", "BSB2023.json": '{"name":"Berean"}' })
        expect(preloadBundledBibles(resources)).toBe(1)
        expect(fs.existsSync(path.join(scriptures, "index.json"))).toBe(false)
    })
})
