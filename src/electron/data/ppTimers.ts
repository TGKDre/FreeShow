// ProPresenter timers (Configuration/Timers, extension-less protobuf).
//
// Verified against Grace City's file: three timers, names in field 2, and a duration as a little endian
// double in seconds inside a one-of config message at field 10 (subfield 1 to 4 selects the kind).

import { asText, firstReference, readFields, type PPField } from "./ppWire"

export interface PPTimer {
    id: string
    name: string
    seconds: number
    countsDown: boolean
}

function payloadSeconds(chunk: Buffer): number {
    let fields: PPField[]
    try {
        fields = readFields(chunk)
    } catch {
        return 0
    }
    const duration = fields.find((a) => a.wire === 1 && typeof a.double === "number")
    if (duration?.double) return Math.round(duration.double)
    const asInt = fields.find((a) => a.wire === 0 && typeof a.value === "number" && a.value > 0)
    return asInt?.value || 0
}

export function parseTimerContainer(buf: Buffer): PPTimer[] {
    const timers: PPTimer[] = []

    for (const field of readFields(buf).filter((a) => a.field === 3 && a.wire === 2 && a.chunk)) {
        const fields = readFields(field.chunk!)
        const name = asText(fields.find((a) => a.field === 2 && a.wire === 2)?.chunk)
        if (!name) continue

        const idField = fields.find((a) => a.field === 1 && a.wire === 2 && a.chunk)
        const id = (idField && firstReference(idField.chunk!)) || name

        let seconds = 0
        for (const config of fields.filter((a) => a.field === 10 && a.wire === 2 && a.chunk)) {
            for (const part of readFields(config.chunk!)) {
                if (part.wire !== 2 || !part.chunk) continue
                const value = payloadSeconds(part.chunk)
                if (value > seconds) seconds = value
            }
        }

        // kind 3 (field 10.3) is a count up timer in the Grace City file; the rest are countdowns
        const kindField = readFields(fields.find((a) => a.field === 10 && a.chunk)?.chunk || Buffer.alloc(0)).map((a) => a.field)
        const countsDown = !kindField.includes(3)

        timers.push({ id, name, seconds, countsDown })
    }

    return timers
}
