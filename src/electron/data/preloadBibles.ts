import fs from "fs"
import path from "path"
import { getDataFolderPath } from "../utils/files"

/**
 * Copies the BibleShow translations that shipped with the installer into the user's Bibles folder on
 * first run, so the whole list is in the Bible tab the first time the app opens instead of waiting for
 * someone to import twenty two files by hand.
 *
 * Existing files are never overwritten: a translation the church has edited or re-imported wins over
 * the bundled copy.
 */
export function preloadBundledBibles(resourcesPath = process.resourcesPath || "") {
    const source = path.join(resourcesPath, "data", "bibles")
    if (!fs.existsSync(source)) return 0

    const target = getDataFolderPath("scriptures")
    fs.mkdirSync(target, { recursive: true })

    let copied = 0
    for (const file of fs.readdirSync(source)) {
        if (!file.toLowerCase().endsWith(".json") || file === "index.json") continue

        const destination = path.join(target, file)
        if (fs.existsSync(destination)) continue

        try {
            fs.copyFileSync(path.join(source, file), destination)
            copied++
        } catch (error) {
            console.error(`Could not preload ${file}:`, error)
        }
    }

    if (copied) console.info(`Preloaded ${copied} bundled Bibles`)
    return copied
}
