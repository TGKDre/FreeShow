import type { SermonNote } from "./Sermon"

/**
 * Turns a sermon note into something a person can actually be given.
 *
 * Two shapes, because the church hands notes out two ways: a page that opens on a phone and prints
 * cleanly, and plain text that survives a WhatsApp message without markup turning into noise.
 */

export function escapeHtml(value: string): string {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
}

const CHURCH = "LoveWorld Grace City"

export function noteToText(note: SermonNote): string {
    const lines: string[] = []

    lines.push(note.title || "Sermon note")
    if (note.date) lines.push(note.date)
    lines.push("")

    if (note.summary) lines.push(note.summary, "")

    if (note.scripture?.length) {
        lines.push("Scripture")
        for (const reference of note.scripture) lines.push(`- ${reference}`)
        lines.push("")
    }

    for (const section of note.outline || []) {
        lines.push(section.heading)
        for (const point of section.points || []) lines.push(`- ${point}`)
        lines.push("")
    }

    lines.push(`${CHURCH}`)
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

/** A self-contained page: no fonts to fetch, no scripts, so it opens on any phone and prints. */
export function noteToHtml(note: SermonNote): string {
    const outline = (note.outline || [])
        .map(
            (section) => `<section>
            <h2>${escapeHtml(section.heading)}</h2>
            ${(section.points || []).map((point) => `<p>${escapeHtml(point)}</p>`).join("\n            ")}
        </section>`
        )
        .join("\n        ")

    const scripture = (note.scripture || []).length
        ? `<ul class="refs">${note.scripture.map((reference) => `<li>${escapeHtml(reference)}</li>`).join("")}</ul>`
        : ""

    const tags = (note.tags || []).length ? `<p class="tags">${note.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join(" ")}</p>` : ""

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(note.title || "Sermon note")}</title>
<style>
    :root { color-scheme: light }
    body { margin: 0; background: #f6f1e4; color: #17181a; font: 16px/1.6 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif }
    main { max-width: 42rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem }
    header { border-bottom: 3px solid #d6ae31; padding-bottom: 1rem; margin-bottom: 1.75rem }
    .church { margin: 0 0 0.35rem; font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; color: #6b6250 }
    h1 { margin: 0; font-size: 1.9rem; line-height: 1.2 }
    .date { margin: 0.4rem 0 0; color: #6b6250 }
    .summary { font-size: 1.06rem; margin: 0 0 1.75rem }
    h2 { font-size: 1.05rem; margin: 1.6rem 0 0.4rem; color: #17181a }
    section p { margin: 0.35rem 0 0.35rem 0.9rem }
    .refs { margin: 0 0 1.5rem; padding-left: 1.1rem; color: #4a4438 }
    .tags span { display: inline-block; margin: 0 0.3rem 0.3rem 0; padding: 0.1rem 0.5rem; border: 1px solid #cdc3ad; border-radius: 999px; font-size: 0.78rem; color: #6b6250 }
    footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid #ddd4c0; font-size: 0.8rem; color: #6b6250 }
    @media print { body { background: #fff } main { padding: 0 } footer { page-break-inside: avoid } }
</style>
</head>
<body>
<main>
    <header>
        <p class="church">${CHURCH}</p>
        <h1>${escapeHtml(note.title || "Sermon note")}</h1>
        ${note.date ? `<p class="date">${escapeHtml(note.date)}</p>` : ""}
    </header>
    ${note.summary ? `<p class="summary">${escapeHtml(note.summary)}</p>` : ""}
    ${scripture}
    ${outline}
    ${tags}
    <footer>${CHURCH} · shared ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</footer>
</main>
</body>
</html>`
}
