# Lectio Interface System

## Direction

Lectio is a calm editorial reading tool for people studying long technical articles. The article is the product; navigation and annotation controls exist to preserve reading context, then recede. It should feel like a well-set research edition rather than a dashboard, production sheet, or browser full of utilities.

The marketing site may use a stronger industrial-print voice. The in-extension reader must use this quieter system.

## Domain

- Long-form technical reading
- Article structure and current section
- Marginalia and anchored notes
- Source provenance
- Listening and reading pace
- Local bookmarks
- Citation and export

## Color World

- Clean warm paper: `#FBFAF7`
- Warm alternate paper: `#F4F1EA`
- Charcoal reading ink: `#24211D`
- Muted graphite: `#6C665E`
- Faint pencil: `#948D84`
- Editorial link blue: `#245F8F`
- Quiet error terracotta: `#A65343`
- Pale annotation yellow: `rgba(232, 207, 128, 0.48)`

Blue communicates navigation, links, focus, and selected tools. Terracotta is reserved for errors. Color is never decorative and never fills large structural regions.

## Signature

Lectio’s signature is the quiet article margin: a narrow, numbered contents rail that tracks the active section beside a carefully typeset reading column. The signature appears in active-section navigation, anchored notes, reading progress, and the compact selection toolbar.

## Rejecting Defaults

- Dashboard chrome -> one 64px utility bar
- Cover-like dossier panel -> contents-only article margin
- Metadata wall -> source title in the app bar; details remain available through the source
- Duplicate calls to action -> one control per action
- Floating color dashboard -> compact Highlight / Translate / Explain / Note row
- Sans-serif document treatment -> editorial serif article body
- Loud black/red state changes -> pale blue state washes and charcoal text

## Intent Checkpoint

Intent: A person concentrating on a long article must read, navigate, annotate, listen, and export without the interface competing for attention.

Palette: Warm paper reduces glare, charcoal softens contrast, and restrained editorial blue communicates action without visual alarm.

Depth: Borders-only. Low-opacity separators establish the app bar, margin, and popovers. No decorative shadow system.

Surfaces: The sidebar and article share one paper canvas. Alternate paper is limited to inputs, inline code, and the optional warm-paper mode.

Typography: Georgia/system serif for article prose and headings; Inter/system sans for navigation and controls; system mono only for compact numeric data.

Spacing: 4px base unit.

## Layout

- App bar: fixed 64px; brand, truncated source title, then icon utilities
- Article margin: fixed 256px desktop rail containing only contents and collapsed archive
- Reading field: centered 760px maximum article column
- Compact breakpoint: rail disappears below 920px
- Mobile breakpoint: 56px app bar and 18px article gutters
- Source register, dossier numeral, duplicate audio card, production strip, and colophon remain hidden in the reader

## Component Patterns

- App utility: 44–48px icon control with tooltip and subtle blue hover wash
- Contents row: two-digit section number, title, 2px blue active rule, no inverted field
- Selection toolbar: one horizontal row with Highlight, Translate, Explain, and primary Note
- Highlight: quiet pale-yellow wash; browser selection uses translucent editorial blue
- Article heading: serif, sentence case, no automatic numbering or uppercase conversion
- Article link: editorial blue with a thin underline
- Blockquote: graphite text with a restrained 3px blue rule
- Popover: paper surface, low-opacity border, 7px radius

## Interaction States

- Hover: pale blue wash with blue foreground
- Active/current: pale blue wash plus a small blue rule where orientation matters
- Focus: translucent 2px blue outline
- Bookmarked: blue icon with a 2px blue bottom rule
- Error: terracotta text or wash, never a large filled error control
- Motion: 120ms ease for state changes; no bounce or page-level animation

## Non-Negotiables

- The article remains the strongest element after the squint test
- No viewport-scale numerals or decorative production metadata in the reader
- No saturated red or pure-black structural fields
- No duplicate action entry points in the reading plane
- No multicolor swatch row in the selection toolbar
- Sidebar and content use the same canvas color
- Article prose remains hard-left, serif, and comfortably spaced
- Controls retain labels through accessible names and tooltips when visually icon-only
