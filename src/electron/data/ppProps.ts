// ProPresenter props (Configuration/Props, extension-less protobuf).
//
// A prop is a reusable slide element the operator drags in: name plates, giving and announcement lower
// thirds, editable title templates. FreeShow has no props container, so each prop maps to an Overlay with
// a text item. Grace City's file holds 21 props, name in field 2.

import { asText, firstReference, readFields } from "./ppWire"

export interface PPProp {
    id: string
    name: string
}

export function parsePropContainer(buf: Buffer): PPProp[] {
    const props: PPProp[] = []

    for (const field of readFields(buf).filter((a) => a.field === 2 && a.wire === 2 && a.chunk)) {
        const fields = readFields(field.chunk!)
        const name = asText(fields.find((a) => a.field === 2 && a.wire === 2)?.chunk)
        if (!name) continue

        const idField = fields.find((a) => a.field === 1 && a.wire === 2 && a.chunk)
        const id = (idField && firstReference(idField.chunk!)) || name
        props.push({ id, name })
    }

    return props
}
