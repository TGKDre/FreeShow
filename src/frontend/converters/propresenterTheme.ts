// Import ProPresenter themes as FreeShow templates.
//
// One theme holds several slide layouts, so it arrives here already expanded into one template per slide
// (see src/electron/data/ppThemeTemplate.ts). Templates are what a church switches between for
// different lyric looks, which makes them the honest equivalent of a ProPresenter theme.

import { uid } from "uid"
import { templates } from "../stores"
import { newToast } from "../utils/common"
import type { PPThemeTemplate } from "../../electron/data/ppThemeTemplate"

export function convertProPresenterThemes(data: { content: any; name?: string }[]) {
    const all: PPThemeTemplate[] = []

    for (const file of data || []) {
        try {
            const parsed = typeof file.content === "string" ? JSON.parse(file.content) : file.content
            if (Array.isArray(parsed?.templates)) all.push(...parsed.templates)
        } catch (err) {
            console.error("Theme JSON could not be read:", err)
        }
    }
    if (!all.length) return

    templates.update((current) => {
        for (const template of all) {
            const id = uid()
            current[id] = {
                name: template.name,
                color: template.color,
                category: template.category || "ProPresenter",
                items: template.items as any
            }
        }
        return current
    })

    newToast("main.finished")
}
