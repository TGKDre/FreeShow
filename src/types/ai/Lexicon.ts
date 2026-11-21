export type LexiconLanguage = "greek" | "hebrew"

/** Raw record as stored in public/lexicon/<language>.json. */
export interface LexiconRawEntry {
    lemma: string
    translit: string
    pron: string
    derivation: string
    definition: string
    kjv: string
}

export interface LexiconFile {
    language: LexiconLanguage
    attribution: string
    entries: { [strongs: string]: LexiconRawEntry }
}

export interface LexiconEntry extends LexiconRawEntry {
    strongs: string
    language: LexiconLanguage
}
