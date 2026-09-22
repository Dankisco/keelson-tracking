# Third-party assets

## World map geometry

`templates/partials/worldmap.html` is generated from Natural Earth 110m land
data, via the `world-atlas` TopoJSON build.

Natural Earth is released into the **public domain**. No permission or
attribution is required, though the project asks to be credited where it is
convenient to do so.

<https://www.naturalearthdata.com/about/terms-of-use/>

## Archivo (font)

`tools/Archivo.ttf` — Copyright 2020 The Archivo Project Authors.
Licensed under the **SIL Open Font License 1.1**; the full licence text is in
`tools/Archivo-OFL.txt`, which must stay alongside the font file.

The OFL permits bundling and redistribution with software. The font may not be
sold on its own, and any derivative font may not use the reserved name.

<https://github.com/Omnibus-Type/Archivo>

The website itself loads Archivo and IBM Plex Mono from Google Fonts at
runtime; the bundled copy exists only so `tools/brand_trailer.py` can render
the wordmark onto the trailer photograph.

## Photographs — LICENCE NOT ESTABLISHED

| File | Subject |
|------|---------|
| `static/img/freight-sea.webp` | container ship |
| `static/img/freight-air.webp` | cargo pallet beside a freighter |
| `static/img/freight-land.webp` | lorry at sunset (carries the Keelson logo) |
| `static/img/_freight-land-original.webp` | the same lorry photo, unbranded |

**These arrived as supplied files with no licence attached, and their rights
have not been verified.** Publishing this repository republishes them.

Before making the repository public, either:

1. confirm you hold the rights, and record the source and licence here; or
2. replace them with images you own or that carry a clear licence (Unsplash,
   Pexels and similar are straightforward); or
3. remove them from the repository and from git history, and keep the
   repository private in the meantime.

Dropping replacements at the same paths needs no code changes. See the
"Re-running the trailer branding" section of the README for the crop notes.
