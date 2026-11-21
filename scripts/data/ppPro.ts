/**
 * RTF helpers for ProPresenter 7 song files (.pro).
 *
 * Every slide's text lives in an RTF blob. Font table, colour table and paragraph styles are noise;
 * what matters is the words and where the line breaks fall, because that is the grouping Grace City
 * already made by hand in ProPresenter.
 */

export function readFields(buf) {
    const out = []
    let i = 0
    const varint = () => {
        let shift = 0
        let value = 0
        while (i < buf.length) {
            const byte = buf[i++]
            value |= (byte & 0x7f) << shift
            if (!(byte & 0x80)) return value >>> 0
            shift += 7
            if (shift > 63) throw new Error("varint too long")
        }
        throw new Error("truncated varint")
    }

    while (i < buf.length) {
        let key
        try {
            key = varint()
        } catch {
            break
        }
        const field = key >> 3
        const wire = key & 7

        if (wire === 0) out.push({ field, wire, value: varint() })
        else if (wire === 2) {
            const length = varint()
            if (i + length > buf.length) break
            out.push({ field, wire, chunk: buf.subarray(i, i + length) })
            i += length
        } else if (wire === 1) {
            out.push({ field, wire, double: buf.readDoubleLE(i) })
            i += 8
        } else if (wire === 5) {
            out.push({ field, wire })
            i += 4
        } else break
    }

    return out
}

const SKIP_GROUPS = ["fonttbl", "colortbl", "stylesheet", "info", "pict", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "themedata", "colorschememapping", "latentstyles"]

/** RTF to plain text: keeps the words and the line breaks, drops every control word. */
export function rtfToText(rtf) {
    let out = ""
    let i = 0
    let depth = 0
    let skipDepth = -1

    while (i < rtf.length) {
        const char = rtf[i]

        if (char === "{") {
            depth++
            // a destination group (\fonttbl, \colortbl ...) contributes nothing readable
            const ahead = rtf.slice(i + 1, i + 40)
            if (skipDepth < 0 && SKIP_GROUPS.some((group) => ahead.startsWith("\\" + group))) skipDepth = depth
            i++
            continue
        }

        if (char === "}") {
            if (skipDepth === depth) skipDepth = -1
            depth--
            i++
            continue
        }

        if (skipDepth >= 0) {
            i++
            continue
        }

        if (char === "\\") {
            const next = rtf[i + 1]

            if (next === "'") {
                const hex = rtf.slice(i + 2, i + 4)
                out += String.fromCharCode(parseInt(hex, 16) || 0)
                i += 4
                continue
            }

            if (next === "u") {
                const match = rtf.slice(i).match(/^\\u(-?\d+)\s?\??/)
                if (match) {
                    const code = Number(match[1])
                    out += String.fromCharCode(code < 0 ? code + 65536 : code)
                    i += match[0].length
                    continue
                }
            }

            if (next === "\\" || next === "{" || next === "}") {
                out += next
                i += 2
                continue
            }

            const word = rtf.slice(i).match(/^\\([a-zA-Z]+)(-?\d+)? ?/)
            if (word) {
                const name = word[1]
                if (name === "par" || name === "line" || name === "row") out += "\n"
                else if (name === "tab") out += " "
                i += word[0].length
                continue
            }

            // control symbol such as \* or \~
            i += 2
            continue
        }

        out += char
        i++
    }

    return out
}

/** Title from the top level field 3, which is the presentation name ProPresenter shows in the library. */
export function proTitle(buf) {
    for (const field of readFields(buf)) {
        if (field.field === 3 && field.chunk) {
            const text = field.chunk.toString("utf8")
            if (/^[\p{L}\p{N}\p{P}\p{Zs}]+$/u.test(text) && text.length < 120) return text.trim()
        }
    }
    return ""
}

/** Slide texts in document order: each RTF blob is one slide, which is one screen in the room. */
export function proSlides(buf) {
    const slides = []

    const walk = (buffer, depth) => {
        if (depth > 6) return
        let fields
        try {
            fields = readFields(buffer)
        } catch {
            return
        }

        for (const field of fields) {
            if (!field.chunk) continue
            const head = field.chunk.subarray(0, 6).toString("latin1")
            if (head.startsWith("{\\rtf")) {
                const text = rtfToText(field.chunk.toString("utf8"))
                    .split(/\r?\n/)
                    .map((line) => line.replace(/\u0000/g, "").trim())
                    .filter((line) => line.length)
                if (text.length) slides.push(text)
                continue
            }
            walk(field.chunk, depth + 1)
        }
    }

    walk(buf, 0)
    return slides
}
