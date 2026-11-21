# Data packs

Two sets of data ship inside the installer so the app has everything it needs before it touches the
network: the LoveWorld Singers catalogue and the BibleShow translations.

Neither is committed. `assets/data/` is ignored on purpose, because the lyrics belong to LoveWorld
Music Ministry and most of the translations are licensed by their publishers. The public CI release
therefore ships without them. The church build is made on a machine where the packs are present.

## Refresh the lyrics

```bash
npm run data:lyrics
```

Reads the A to Z index at loveworldlyrics.com, then every song page, and writes
`assets/data/loveworld-songs.json`. It takes about five minutes for 1,500 songs.

What it produces, per song:

- `sections`, one per stanza, with `label` where the page provides one (Verse 1, Chorus, Bridge).
- Pages with no labels are bunched from the paragraph markup, which is the stanza boundary the site
  already uses. A stanza that appears more than once is labelled Chorus.
- Pages that still say "Lyrics being written out" keep their entry with no sections, so search finds
  the song and the lyrics are fetched live once the site publishes them.

The app reads this file first and only calls the network when a song is missing from it.

## Rebuild the Bibles

```bash
npm run data:bibles
```

Reads the Access databases copied from the church PC (`C:\BibleShow5\Bibles\*.bib`) in `bibles-raw/`
and writes one FreeShow bible per translation to `assets/data/bibles/`. Each keeps its copyright line,
which the Bible drawer displays.

`bibles-raw/` is ignored too. To add a translation, drop its `.bib` file in and run the command again.

## What reaches the app

`electron-builder` copies `assets/data/` into `resources/data/` (`extraResources` in
`config/building/electron-builder.yaml`).

- Lyrics: read from `resources/data/loveworld-songs.json` at first use.
- Bibles: copied into the user's Bibles folder on first launch, never overwriting a file already
  there, so an edited translation stays edited.

## Licensing, plainly

Public domain translations can be redistributed: KJV, YLT, WNT, DRC and the BSB. The rest, including
Amp, AmpC, NIV, ESV, NKJV, NLT, NRSV, TPT, Message, CJB and the Bible Society editions, cannot be
shipped in a public release. Keep them for the church build.
