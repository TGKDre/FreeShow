import { get } from "svelte/store"
import { loadShows } from "../../components/helpers/setShow"
import { activeProject, projects, shows, showsCache } from "../../stores"
import type { LyricSong } from "./lyricDetector"
import { buildSongLibrary, projectShowIds, setSongLibrary } from "./songLibrary"

/**
 * Index the whole service, not just the songs somebody has clicked.
 *
 * FreeShow only keeps opened shows in memory, so a detection arriving before the operator has
 * touched a song would find nothing at all. This lives apart from songLibrary because it pulls in the
 * show loader, and the pure library must stay importable without the component graph.
 */
let priming = false

export async function primeSongLibrary(): Promise<LyricSong[]> {
    const projectId = get(activeProject)
    const ids = projectShowIds(projectId ? get(projects)[projectId]?.shows : undefined)
    const missing = ids.filter((id) => !get(showsCache)[id] && get(shows)[id])

    if (missing.length && !priming) {
        priming = true
        try {
            await loadShows(missing)
        } catch (error) {
            console.warn("could not preload songs for lyric recognition:", error)
        } finally {
            priming = false
        }
    }

    const songs = buildSongLibrary(get(showsCache) as any)
    if (songs.length) setSongLibrary(songs)
    return songs
}
