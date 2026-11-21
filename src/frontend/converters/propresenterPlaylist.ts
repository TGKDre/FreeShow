// Turn a decoded ProPresenter playlist into a FreeShow project (the service order).
//
// The playlist arrives from the main process as JSON (see the propresenter_playlist special import in
// src/electron/data/import.ts, which runs ppPlaylist.parsePlaylistContainer). Each item names a
// presentation and its .pro path; shows already imported keep the presentation name, so items are matched
// by name first and by the file's base name second.

import { get } from "svelte/store"
import { uid } from "uid"
import { projects, shows } from "../stores"
import { newToast } from "../utils/common"
import type { PPPlaylist } from "../../electron/data/ppPlaylist"

interface ImportedPlaylistFile {
    content: any
    name?: string
    extension?: string
}

export function convertProPresenterPlaylists(data: ImportedPlaylistFile[]) {
    const playlists: PPPlaylist[] = []
    for (const file of data || []) {
        try {
            const parsed = typeof file.content === "string" ? JSON.parse(file.content) : file.content
            if (Array.isArray(parsed?.playlists)) playlists.push(...parsed.playlists)
        } catch (err) {
            console.error("Playlist JSON could not be read:", err)
        }
    }
    if (!playlists.length) return

    const showList = Object.entries(get(shows) || {}).map(([id, show]: any) => ({ id, name: (show?.name || "").toLowerCase() }))
    const byName = new Map<string, string>()
    for (const show of showList) if (show.name && !byName.has(show.name)) byName.set(show.name, show.id)

    const missing: string[] = []
    let created = 0

    projects.update((current) => {
        for (const playlist of playlists) {
            const refs: { id: string }[] = []
            for (const item of playlist.items || []) {
                const key = (item.name || "").toLowerCase()
                const id = byName.get(key)
                if (!id) {
                    if (item.name) missing.push(item.name)
                    continue
                }
                // the same presentation can legitimately appear twice in a service
                refs.push({ id })
            }
            if (!refs.length) continue

            const projectId = uid()
            current[projectId] = {
                id: projectId,
                name: playlist.name,
                created: Date.now(),
                parent: "",
                shows: refs,
                origin: "propresenter"
            }
            created++
        }
        return current
    })

    if (created) newToast("main.finished")
    if (missing.length) {
        const unique = Array.from(new Set(missing))
        console.warn(`Playlist items with no matching show (${unique.length}):`, unique)
    }
}
