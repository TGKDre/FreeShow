import { copyFileSync, existsSync, mkdirSync, renameSync, statSync } from "fs"
import path from "path"

/**
 * ProPresenter media materialization.
 *
 * ProPresenter stores every media reference as an rv.data.URL message. Once protobufjs
 * decodes a .pro, each reference looks like one of:
 *   { absoluteString: "C:\\Users\\techg\\OneDrive\\Documents\\ProPresenter\\Media\\Assets\\x.png",
 *     platform: "PLATFORM_WIN32",
 *     local: { root: "ROOT_SHOW", path: "Media/Assets/x.png" } }
 *   { relativePath: "Media/Assets/x.png", platform: "PLATFORM_WIN32" }
 *
 * Those absolute paths are machine specific (they point into a Windows OneDrive folder).
 * This module copies every referenced file into FreeShow's own media folder and rewrites
 * the reference to the new copy, so an imported show keeps its graphics when the original
 * library moves, lives on a different machine, or is taken off OneDrive.
 *
 * Kept dependency-free (fs/path only) so it can be unit tested without Electron.
 */

export type RelocationReport = {
    relocated: Record<string, string>
    missing: string[]
    skipped: string[]
    copied: number
    bytesCopied: number
}

export const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024

const URL_PATH_KEYS = ["absoluteString", "relativePath", "local", "external"]

/** True when an object is a decoded rv.data.URL media reference. */
export function isMediaUrlRef(value: any): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const keys = Object.keys(value)
    if (!keys.some((key) => URL_PATH_KEYS.includes(key))) return false
    // applicationInfo and friends also carry `platform`; require a real path-bearing key
    return keys.includes("absoluteString") || keys.includes("relativePath") || keys.includes("local") || keys.includes("external")
}

/** Every media reference inside a decoded presentation, in traversal order. */
export function collectMediaUrlRefs(root: any): any[] {
    const refs: any[] = []
    const seen = new Set<any>()

    function walk(node: any) {
        if (!node || typeof node !== "object") return
        if (seen.has(node)) return
        seen.add(node)
        if (Array.isArray(node)) {
            node.forEach(walk)
            return
        }
        if (isMediaUrlRef(node)) refs.push(node)
        Object.keys(node).forEach((key) => walk(node[key]))
    }

    walk(root)
    return refs
}

function referencePath(ref: any): string {
    const relative = ref.relativePath || ref.local?.path || ref.external?.path || ""
    return typeof relative === "string" ? relative : ""
}

function normalizeSlashes(value: string): string {
    return value.replace(/\\/g, "/")
}

/**
 * Recover the ProPresenter library root from any reference that carries both an absolute
 * and a relative form (absoluteString - relativePath). Returns unique roots in Win/Unix form.
 */
export function deriveLibraryRoots(refs: any[]): string[] {
    const roots: string[] = []

    for (const ref of refs) {
        const absolute = typeof ref.absoluteString === "string" ? normalizeSlashes(ref.absoluteString) : ""
        const relative = normalizeSlashes(referencePath(ref)).replace(/^\/+/, "")
        if (!absolute || !relative) continue

        const lowerAbsolute = absolute.toLowerCase()
        const lowerRelative = relative.toLowerCase()
        if (!lowerAbsolute.endsWith("/" + lowerRelative) && lowerAbsolute !== lowerRelative) continue

        const root = absolute.slice(0, absolute.length - relative.length).replace(/\/+$/, "")
        if (root && !roots.includes(root)) roots.push(root)
    }

    return roots
}

/** Filesystem candidates for a reference, most direct first. */
export function candidatePaths(ref: any, presentationFilePath: string, libraryRoots: string[]): string[] {
    const candidates: string[] = []

    if (typeof ref.absoluteString === "string" && ref.absoluteString) candidates.push(ref.absoluteString)

    const relative = referencePath(ref)
    if (relative && !/^([a-zA-Z]:|\\\\|\/\/)/.test(relative)) {
        const normalized = normalizeSlashes(relative)
        libraryRoots.forEach((root) => candidates.push(path.join(root, normalized)))

        let folder = path.dirname(presentationFilePath)
        for (let depth = 0; depth < 4; depth++) {
            candidates.push(path.join(folder, normalized))
            const parent = path.dirname(folder)
            if (parent === folder) break
            folder = parent
        }
    }

    return [...new Set(candidates)]
}

// Mirror of filePathHashCode (data/thumbnails.ts), kept local so this module stays Electron free.
function pathHashCode(input: string): string {
    let hash = 0
    for (let index = 0; index < input.length; index++) {
        hash = (hash << 5) - hash + input.charCodeAt(index)
        hash |= 0
    }
    return (hash < 0 ? "i" + hash.toString().slice(1) : "a" + hash.toString()) as string
}

/** Same folder convention addToMediaFolder uses: <ParentFolderName>_<hash of parent folder>. */
export function mediaFolderId(filePath: string): string {
    const folder = path.dirname(filePath)
    return path.basename(folder) + "_" + pathHashCode(folder)
}

/** Rewrite a reference so only the new absolute location remains. */
function applyRelocatedPath(ref: any, newPath: string) {
    ref.absoluteString = newPath
    delete ref.relativePath
    delete ref.local
    delete ref.external
}

/**
 * Copy every referenced media file into mediaFolderPath and rewrite the references in place.
 * Returns a report of what moved, what was missing, and what was too large to copy.
 */
export function materializeMedia(root: any, presentationFilePath: string, mediaFolderPath: string, options?: { maxFileBytes?: number }): RelocationReport {
    const maxFileBytes = options?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
    const refs = collectMediaUrlRefs(root)
    const libraryRoots = deriveLibraryRoots(refs)
    const mediaRoot = normalizeSlashes(mediaFolderPath).replace(/\/+$/, "")

    const report: RelocationReport = { relocated: {}, missing: [], skipped: [], copied: 0, bytesCopied: 0 }

    for (const ref of refs) {
        const candidates = candidatePaths(ref, presentationFilePath, libraryRoots)
        if (!candidates.length) continue

        const source = candidates.find((candidate) => existsSync(candidate))
        if (!source) {
            const missing = candidates[0]
            if (!report.missing.includes(missing)) report.missing.push(missing)
            continue
        }

        const alreadyRelocated = report.relocated[source]
        if (alreadyRelocated) {
            applyRelocatedPath(ref, alreadyRelocated)
            continue
        }

        if (normalizeSlashes(source).startsWith(mediaRoot + "/")) {
            report.relocated[source] = source
            applyRelocatedPath(ref, source)
            continue
        }

        let size = 0
        try {
            size = statSync(source).size
        } catch (err) {
            console.error("Could not stat media file:", source, err)
        }
        if (size > maxFileBytes) {
            if (!report.skipped.includes(source)) report.skipped.push(source)
            continue
        }

        const destinationFolder = path.join(mediaFolderPath, mediaFolderId(source))
        const destination = path.join(destinationFolder, path.basename(source))
        try {
            mkdirSync(destinationFolder, { recursive: true })
            if (!existsSync(destination)) {
                // copy to a temp name first so an interrupted import never leaves a truncated file
                // sitting at the final path (a later import would then treat it as already copied)
                const partial = destination + ".partial"
                copyFileSync(source, partial)
                renameSync(partial, destination)
                report.copied++
                report.bytesCopied += size
            }
            report.relocated[source] = destination
            applyRelocatedPath(ref, destination)
        } catch (err) {
            console.error("Could not copy media file:", source, err)
            if (!report.missing.includes(source)) report.missing.push(source)
        }
    }

    return report
}
