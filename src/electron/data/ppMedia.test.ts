import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { candidatePaths, collectMediaUrlRefs, deriveLibraryRoots, materializeMedia, mediaFolderId } from "./ppMedia"

// A presentation shaped exactly like a protobufjs-decoded .pro (see references/propresenter-pro-format.md)
function urlRef(absoluteString: string, relativePath: string) {
    return { absoluteString, platform: "PLATFORM_WIN32", local: { root: "ROOT_SHOW", path: relativePath } }
}

describe("ppMedia", () => {
    let workingDir: string
    let libraryRoot: string
    let mediaFolder: string
    let presentationPath: string
    let mediaFolderCount = 0

    // every test gets an empty destination so copied counts are unambiguous
    function freshMediaFolder(): string {
        mediaFolderCount++
        const folder = path.join(workingDir, "FreeShowMedia" + mediaFolderCount)
        mkdirSync(folder, { recursive: true })
        return folder
    }

    beforeAll(() => {
        workingDir = mkdtempSync(path.join(os.tmpdir(), "ppmedia-"))
        libraryRoot = path.join(workingDir, "ProPresenter")
        mediaFolder = freshMediaFolder()
        const assets = path.join(libraryRoot, "Media", "Assets")
        mkdirSync(assets, { recursive: true })
        writeFileSync(path.join(assets, "Full Logo.png"), Buffer.alloc(1024, 7))
        writeFileSync(path.join(assets, "panel art.png"), Buffer.alloc(2048, 3))
        presentationPath = path.join(libraryRoot, "Libraries", "Songs", "We Hail.pro")
        mkdirSync(path.dirname(presentationPath), { recursive: true })
    })

    afterAll(() => {
        rmSync(workingDir, { recursive: true, force: true })
    })

    it("collects every URL reference and nothing else", () => {
        const presentation = {
            name: "We Hail",
            applicationInfo: { platform: "PLATFORM_WINDOWS", application: "APPLICATION_PROPRESENTER" },
            cues: [
                {
                    actions: [
                        {
                            slide: {
                                presentation: {
                                    baseSlide: {
                                        elements: [{ element: { fill: { media: { url: urlRef("/studio/library/Media/Assets/Full Logo.png", "Media/Assets/Full Logo.png") } } } }, { element: { text: { rtfData: "text only" } } }]
                                    }
                                }
                            }
                        }
                    ]
                }
            ]
        }

        const refs = collectMediaUrlRefs(presentation)
        expect(refs).toHaveLength(1)
        expect(refs[0].local.path).toBe("Media/Assets/Full Logo.png")
    })

    it("derives the library root from an absolute and relative pair", () => {
        const refs = [urlRef("C:\\Users\\techg\\OneDrive\\Documents\\ProPresenter\\Media\\Assets\\x.png", "Media/Assets/x.png")]
        expect(deriveLibraryRoots(refs)).toEqual(["C:/Users/techg/OneDrive/Documents/ProPresenter"])
    })

    it("resolves a relative-only reference against the derived root", () => {
        const refs = [urlRef("/studio/lib/Media/Assets/a.png", "Media/Assets/a.png")]
        const roots = deriveLibraryRoots(refs)
        const relativeOnly = { relativePath: "Media/Assets/a.png", platform: "PLATFORM_WIN32" }
        const candidates = candidatePaths(relativeOnly, "/studio/lib/Libraries/Songs/song.pro", roots)
        expect(candidates[0]).toBe("/studio/lib/Media/Assets/a.png")
        expect(candidates).toContain(path.join("/studio/lib/Libraries/Songs", "Media/Assets/a.png"))
    })

    it("copies media into the FreeShow media folder and rewrites the reference", () => {
        const absolute = path.join(libraryRoot, "Media", "Assets", "Full Logo.png")
        const ref = urlRef(absolute, "Media/Assets/Full Logo.png")
        const presentation = { cues: [{ actions: [{ slide: { elements: [{ element: { fill: { media: { url: ref } } } }] } }] }] }

        const destination = freshMediaFolder()
        const report = materializeMedia(presentation, presentationPath, destination)

        const expectedFolder = path.join(destination, mediaFolderId(absolute))
        const expected = path.join(expectedFolder, "Full Logo.png")
        expect(existsSync(expected)).toBe(true)
        expect(ref.absoluteString).toBe(expected)
        expect(ref.local).toBeUndefined()
        expect(ref.relativePath).toBeUndefined()
        expect(report.copied).toBe(1)
        expect(report.bytesCopied).toBe(1024)
        expect(report.missing).toHaveLength(0)
    })

    it("copies each distinct file once and is idempotent on re-import", () => {
        const logo = path.join(libraryRoot, "Media", "Assets", "Full Logo.png")
        const panel = path.join(libraryRoot, "Media", "Assets", "panel art.png")
        const first = urlRef(logo, "Media/Assets/Full Logo.png")
        const second = urlRef(logo, "Media/Assets/Full Logo.png")
        const third = urlRef(panel, "Media/Assets/panel art.png")
        const presentation = { cues: [{ elements: [{ url: first }, { url: second }, { url: third }] }] }

        const destination = freshMediaFolder()
        const report = materializeMedia(presentation, presentationPath, destination)
        expect(report.copied).toBe(2)
        expect(first.absoluteString).toBe(second.absoluteString)

        // second import of the same show must not re-copy
        const again = materializeMedia({ cues: [{ elements: [{ url: urlRef(logo, "Media/Assets/Full Logo.png") }, { url: urlRef(panel, "Media/Assets/panel art.png") }] }] }, presentationPath, destination)
        expect(again.copied).toBe(0)
        expect(again.relocated[logo]).toBe(first.absoluteString)
    })

    it("reports missing files instead of silently rewriting them", () => {
        const ref = urlRef(path.join(libraryRoot, "Media", "Assets", "gone.png"), "Media/Assets/gone.png")
        const report = materializeMedia({ cues: [{ elements: [{ url: ref }] }] }, presentationPath, freshMediaFolder())
        expect(report.missing).toContain(path.join(libraryRoot, "Media", "Assets", "gone.png"))
        expect(report.copied).toBe(0)
        // untouched, so the app can still try the original path on the machine that owns it
        expect(ref.absoluteString).toBe(path.join(libraryRoot, "Media", "Assets", "gone.png"))
    })

    it("skips files above the size cap without losing the reference", () => {
        const big = path.join(libraryRoot, "Media", "Assets", "big.mp4")
        writeFileSync(big, Buffer.alloc(4096, 1))
        const ref = urlRef(big, "Media/Assets/big.mp4")
        const report = materializeMedia({ cues: [{ elements: [{ url: ref }] }] }, presentationPath, freshMediaFolder(), { maxFileBytes: 1024 })
        expect(report.skipped).toEqual([big])
        expect(report.copied).toBe(0)
        expect(ref.absoluteString).toBe(big)
    })
})
