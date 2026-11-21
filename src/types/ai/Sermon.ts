export interface SermonDevotional {
    day: number
    title: string
    scripture?: string
    body: string
}

export interface SermonQuizQuestion {
    question: string
    options?: string[]
    answer: string
}

/** One sermon, captured from the live transcript and carried into the week. */
export interface SermonNote {
    id: string
    title: string
    date: string // ISO date of the service
    startedAt: number
    endedAt?: number
    transcript: string
    summary: string
    outline: { heading: string; points: string[] }[]
    scripture: string[]
    devotionals: SermonDevotional[]
    quiz: SermonQuizQuestion[]
    tags: string[]
}

export interface SermonDraft {
    title: string
    date: string
    startedAt: number
    endedAt?: number
    transcript: string
    summary: string
    outline: { heading: string; points: string[] }[]
    scripture: string[]
}
