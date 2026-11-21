// ProPresenter playlist (the extension-less files in Documents/ProPresenter/Playlists: "Library", "Media",
// "Audio") decoder. No published schema, so this is a direct protobuf wire reader.
//
// Verified against the real Grace City file (21 KB) and synthetic fixtures. The structure in the wild is:
//
//   root
//     field 3 (message)                  -> playlist container
//       field 12 (message)               -> the playlist list
//         field 1 (repeated message)     -> playlist
//           field 1 (message)            -> { field 1: playlist uuid }
//           field 2 (string)             -> playlist name
//           field 4 (varint)             -> optional flag
//           field 13 (repeated message)  -> item
//             field 1 (message)          -> { field 1: item/presentation uuid }
//             string fields             -> presentation name, absolute Windows path, relative path
//
// Field numbers differ between ProPresenter builds, and a second file in the same folder can nest one level
// shallower, so playlists are found by shape (a name plus repeated items) rather than by a fixed path.

export interface PPPlaylistItem {
    id: string
    name: string
    absolutePath?: string
    relativePath?: string
    header?: string
}

export interface PPPlaylist {
    id: string
    name: string
    items: PPPlaylistItem[]
}

interface Field {
    field: number
    wire: number
    value?: number
    chunk?: Buffer
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEADERS = new Set(["presen", "preson", "pres", "timer0", "preservice", "preshow", "music", "backstage"])

function readVarint(buf: Buffer, start: number) {
    let shift = 0
    let value = 0
    let index = start
    while (index < buf.length) {
        const byte = buf[index]
        index++
        value |= (byte & 0x7f) << shift
        if (!(byte & 0x80)) return { value: value >>> 0, index }
        shift += 7
        if (shift > 63) throw new Error("varint too long")
    }
    throw new Error("truncated varint")
}

function readFields(buf: Buffer): Field[] {
    const fields: Field[] = []
    let index = 0
    while (index < buf.length) {
        const key = readVarint(buf, index)
        index = key.index
        const field = key.value >> 3
        const wire = key.value & 7
        if (wire === 0) {
            const val = readVarint(buf, index)
            index = val.index
            fields.push({ field, wire, value: val.value })
        } else if (wire === 2) {
            const len = readVarint(buf, index)
            index = len.index
            fields.push({ field, wire, chunk: buf.subarray(index, index + len.value) })
            index += len.value
        } else if (wire === 5) {
            index += 4
        } else if (wire === 1) {
            index += 8
        } else {
            break
        }
    }
    return fields
}

/** Only return a chunk as text when every character is printable, so binary sub-messages are not mistaken for names. */
function asText(chunk?: Buffer) {
    const text = chunk?.toString("utf8") ?? ""
    if (!text) return ""
    for (const char of text) {
        const code = char.charCodeAt(0)
        if (code !== 9 && code !== 10 && code !== 13 && code < 32) return ""
    }
    return text
}

function collectStrings(buf: Buffer, depth = 0, out: string[] = []): string[] {
    if (depth > 6) return out
    let fields: Field[]
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

function basename(filePath: string) {
    const clean = filePath.replace(/\\/g, "/")
    const file = clean.slice(clean.lastIndexOf("/") + 1)
    return file.replace(/\.(pro|proBundle|pro4|pro6)$/i, "")
}

/** ProPresenter prefixes reference strings with control characters and a "$", so strip them before matching. */
function normalizeText(text: string) {
    return text.replace(/^[\u0000-\u001f\s$]+/, "").trim()
}

const isAbsolutePath = (text: string) => /^[A-Za-z]:[\\/]/.test(text)
const isRelativeShowPath = (text: string) => !isAbsolutePath(text) && /[\\/]/.test(text) && /\.(pro|proBundle|pro4|pro6)$/i.test(text)

function parseItem(buf: Buffer): PPPlaylistItem | null {
    const fields = readFields(buf)
    // field 1 holds the item's id/name message; uuid strings arrive with a leading control char and "$"
    const idFields = fields.filter((a) => a.field === 1 && a.wire === 2 && a.chunk)
    const idValues = idFields.flatMap((a) => collectStrings(a.chunk!)).map(normalizeText)
    const id = idValues.find((text) => UUID.test(text)) ?? ""

    // paths and names can sit in direct string fields or in a nested reference message, so read them all
    const idStrings = new Set(idValues)
    const texts = collectStrings(buf)
        .map(normalizeText)
        .filter((text) => text && !idStrings.has(text))
    const absolutePath = texts.find(isAbsolutePath) || undefined
    const relativePath = texts.find(isRelativeShowPath) || undefined

    const name =
        texts.find((text) => {
            if (UUID.test(text)) return false
            if (isAbsolutePath(text) || text.includes("/") || text.includes("\\")) return false
            if (HEADERS.has(text.toLowerCase())) return false
            if (/^\d+$/.test(text)) return false
            return true
        }) ?? ""

    if (!name && !relativePath && !absolutePath) return null
    const header = texts.find((text) => HEADERS.has(text.toLowerCase()))
    return { id, name: name || basename(relativePath || absolutePath || ""), absolutePath, relativePath, header }
}

function parsePlaylist(fields: Field[]): PPPlaylist | null {
    const name = asText(fields.find((a) => a.field === 2 && a.wire === 2)?.chunk)
    if (!name) return null

    // field 13 holds either one item or an item-list wrapper made only of repeated field 1 messages
    const itemBodies: Buffer[] = []
    for (const field of fields.filter((a) => a.field === 13 && a.wire === 2 && a.chunk)) {
        const inner = readFields(field.chunk!)
        const isItemList = inner.length > 0 && inner.every((a) => a.field === 1 && a.wire === 2 && a.chunk)
        if (isItemList) itemBodies.push(...inner.map((a) => a.chunk!))
        else itemBodies.push(field.chunk!)
    }

    const items: PPPlaylistItem[] = []
    for (const body of itemBodies) {
        const item = parseItem(body)
        if (item) items.push(item)
    }
    if (!items.length) return null

    const uuidFields = fields.filter((a) => a.field === 1 && a.wire === 2 && a.chunk)
    const id = uuidFields.flatMap((a) => collectStrings(a.chunk!)).map(normalizeText).find((text) => UUID.test(text)) ?? name
    return { id, name, items }
}

/**
 * Walk the file and return every message shaped like a playlist (a name plus a repeated item list).
 * A shape-based walk survives the nesting differences between ProPresenter builds and between the
 * Library, Media and Audio files.
 */
export function parsePlaylistContainer(buf: Buffer, depth = 0, out: PPPlaylist[] = []): PPPlaylist[] {
    if (depth > 5) return out
    let fields: Field[]
    try {
        fields = readFields(buf)
    } catch {
        return out
    }

    const playlist = parsePlaylist(fields)
    if (playlist) {
        out.push(playlist)
        return out
    }
    for (const field of fields) {
        if (field.wire !== 2 || !field.chunk || field.chunk.length < 2) continue
        // only descend into chunks that are not plain text
        if (asText(field.chunk)) continue
        parsePlaylistContainer(field.chunk, depth + 1, out)
    }
    return out
}

/** Items that name a presentation file. Headers, timers and media entries are dropped. */
export function playableItems(playlist: PPPlaylist) {
    return playlist.items.filter((item) => !!item.relativePath || !!item.absolutePath)
}
