// ProPresenter stage layouts (Configuration/Stage, extension-less protobuf).
//
// Each layout carries a name and a list of typed items. In the Grace City file the item types we can
// identify are subfield 3 (a timer reference, carrying its name) and subfield 6 (a screen reference,
// e.g. "LED Screen"). Everything else is reported as unknown rather than invented.

import { asText, firstReference, readFields } from "./ppWire"

export type PPStageItemKind = "timer" | "screen" | "unknown"

export interface PPStageItem {
    kind: PPStageItemKind
    name?: string
}

export interface PPStageLayout {
    id: string
    name: string
    items: PPStageItem[]
}

function itemKind(typeField: number): PPStageItemKind {
    if (typeField === 3) return "timer"
    if (typeField === 6) return "screen"
    return "unknown"
}

export function parseStageContainer(buf: Buffer): PPStageLayout[] {
    const layouts: PPStageLayout[] = []

    for (const field of readFields(buf).filter((a) => a.field === 2 && a.wire === 2 && a.chunk)) {
        const fields = readFields(field.chunk!)
        const name = asText(fields.find((a) => a.field === 2 && a.wire === 2)?.chunk)
        if (!name) continue

        const idField = fields.find((a) => a.field === 1 && a.wire === 2 && a.chunk)
        const id = (idField && firstReference(idField.chunk!)) || name

        const items: PPStageItem[] = []
        // the item list sits at 3.1.6, with one subfield per item type
        for (const group of fields.filter((a) => a.field === 3 && a.wire === 2 && a.chunk)) {
            const level1 = readFields(group.chunk!)
            for (const l1 of level1.filter((a) => a.field === 1 && a.wire === 2 && a.chunk)) {
                const level6 = readFields(l1.chunk!).filter((a) => a.field === 6 && a.wire === 2 && a.chunk)
                for (const list of level6) {
                    for (const entry of readFields(list.chunk!)) {
                        if (entry.wire !== 2 || !entry.chunk) continue
                        const detail = readFields(entry.chunk)
                        const label = asText(detail.find((a) => a.field === 2 && a.wire === 2)?.chunk) || undefined
                        items.push({ kind: itemKind(entry.field), name: label })
                    }
                }
            }
        }

        layouts.push({ id, name, items })
    }

    return layouts
}
