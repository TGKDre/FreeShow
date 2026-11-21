// Minimal protobuf wire reader shared by the ProPresenter configuration decoders.
//
// ProPresenter writes every configuration artifact (Timers, Stage, Props, Messages, CCLI) as an
// undocumented protobuf container with the same small metadata header, so the field walker is shared and
// each decoder only knows about its own payload shape.

export interface PPField {
    field: number
    wire: number
    value?: number
    double?: number
    chunk?: Buffer
}

export function readFields(buf: Buffer): PPField[] {
    const fields: PPField[] = []
    let index = 0

    const varint = () => {
        let shift = 0
        let value = 0
        while (index < buf.length) {
            const byte = buf[index]
            index++
            value |= (byte & 0x7f) << shift
            if (!(byte & 0x80)) return value >>> 0
            shift += 7
            if (shift > 63) throw new Error("varint too long")
        }
        throw new Error("truncated varint")
    }

    while (index < buf.length) {
        const key = varint()
        const field = key >> 3
        const wire = key & 7

        if (wire === 0) {
            fields.push({ field, wire, value: varint() })
        } else if (wire === 2) {
            const length = varint()
            const chunk = buf.subarray(index, index + length)
            index += length
            fields.push({ field, wire, chunk })
        } else if (wire === 1) {
            // 64 bit, used for timer durations (field 1, wire 1, little endian double)
            fields.push({ field, wire, double: buf.readDoubleLE(index) })
            index += 8
        } else if (wire === 5) {
            index += 4
            fields.push({ field, wire })
        } else {
            break
        }
    }

    return fields
}

/** Text only when every character is printable, so binary sub-messages are not mistaken for names. */
export function asText(chunk?: Buffer): string {
    const text = chunk?.toString("utf8") ?? ""
    if (!text) return ""
    for (const char of text) {
        const code = char.charCodeAt(0)
        if (code !== 9 && code !== 10 && code !== 13 && code < 32) return ""
    }
    return text
}

export function collectStrings(buf: Buffer, depth = 0, out: string[] = []): string[] {
    if (depth > 6) return out
    let fields: PPField[]
    try {
        fields = readFields(buf)
    } catch {
        const text = asText(buf)
        if (text) out.push(text)
        return out
    }
    for (const field of fields) {
        if (field.wire !== 2 || !field.chunk) continue
        const text = asText(field.chunk)
        if (text) out.push(text)
        else if (field.chunk.length > 1) collectStrings(field.chunk, depth + 1, out)
    }
    return out
}

/** ProPresenter prefixes reference strings with control characters and a "$". */
export function normalizeReference(text: string) {
    return text.replace(/^[\u0000-\u001f\s$]+/, "").trim()
}

export function firstReference(buf: Buffer) {
    return normalizeReference(collectStrings(buf)[0] || "")
}
