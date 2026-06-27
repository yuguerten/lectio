# Lectio Interface System

## Direction

Lectio should feel like a serious technical reading workspace: quiet, textual, and precise, with just enough warmth to support long study sessions. The human is reading a dense article, selecting passages, leaving margin notes, asking for help on selected text, filtering annotations, and exporting useful Markdown without losing their place.

## Domain

- Reader focus
- Article extraction
- Technical prose
- Selection anchors
- Highlights
- Margin notes
- Annotation filters
- Reading position
- Source URL identity
- Markdown export
- Assist actions

## Color World

- Paper white: extracted article canvas and long-form reading background
- Ink graphite: primary text, tool labels, and note content
- Margin gray: secondary metadata, separators, disabled controls
- Highlighter ochre: selected passages and active highlight affordances
- Anchor blue: links, selected text assist, current reader location
- Review green: saved notes, successful export, persisted state
- Correction red: destructive remove actions and failed persistence/export states

## Signature

Lectio’s signature is the margin anchor rail: a restrained rail beside the article that ties highlighted passages, note markers, filter state, and reading position back to the text. It should appear in the reader, annotation lists, filtered states, export preview, and assist results so the product feels built around anchored study rather than generic document viewing.

## Rejecting Defaults

- Generic SaaS sidebar with app-wide navigation -> reader-first chrome with compact article tools, annotation filters, export, and assist actions kept close to the text.
- Card grid of metrics -> text-first article layout with margin-linked notes, selection state, and annotation density shown as reading structure.
- Purple/blue gradient productivity palette -> paper, graphite, ochre, anchor blue, review green, and correction red mapped to real reading actions.

## Intent Checkpoint

Intent: A focused reader studying technical articles must preserve context, annotate precisely, and export usable notes; the interface should feel calm, exact, and text-led.

Palette: Paper white and ink graphite come from the reading surface; margin gray belongs to article chrome; highlighter ochre, anchor blue, review green, and correction red map to annotation, links/assist, success, and removal.

Depth: Borders-only with subtle surface color shifts. Long reading sessions need quiet structure, not floating decorative cards.

Surfaces: Warm paper canvas, slightly lifted tool panels, one-level-higher popovers, and darker inset controls for search, filters, and note fields.

Typography: Readable article type for prose; compact sans for controls; tabular numerals for counts, positions, and export stats.

Spacing: 4px base unit.

## Surface Scale

- Canvas: paper white reader background
- Surface 1: slightly lifted paper for toolbars, side panels, and annotation rows
- Surface 2: quiet raised paper for popovers, dropdowns, menus, and assist panels
- Inset: slightly darker paper for search, filters, textareas, and editable note fields

Sidebars or tool rails should share the canvas temperature and separate with low-opacity borders. Popovers sit one level above their trigger. Inputs are inset, not raised.

## Token Architecture

Use product-specific token names where practical:

- `--paper`
- `--paper-raised`
- `--paper-popover`
- `--paper-inset`
- `--ink`
- `--ink-secondary`
- `--ink-tertiary`
- `--ink-muted`
- `--margin-line`
- `--margin-line-soft`
- `--anchor-blue`
- `--highlight-ochre`
- `--review-green`
- `--correction-red`

Every color should map back to foreground, background, border, brand/action, or semantic meaning. Avoid random decorative accent colors.

## Text Hierarchy

- Primary: article text, note content, active tool labels
- Secondary: source metadata, annotation summaries, button text
- Tertiary: timestamps, URL details, counts, export metadata
- Muted: placeholders, disabled actions, inactive filter hints

Article reading text should have more generous line height than controls. Control labels should stay compact and medium weight.

## Spacing

Base unit: 4px.

- 4px: icon and inline metadata gaps
- 8px: compact control gaps
- 12px: annotation row internals
- 16px: panel padding and toolbar group spacing
- 24px: section separation
- 32px: major reader/workspace separation

Keep fixed-format controls stable with explicit dimensions so hover, loading, and filtered states do not shift the reader.

## Depth And Borders

Use borders-only with quiet surface shifts.

- Standard border: article panels, toolbars, annotation rows
- Soft border: section dividers and rail ticks
- Emphasis border: active filter, selected annotation, focused note field
- Focus border: keyboard focus and assist trigger state

Borders should be low-opacity and never be the first thing visible in the reader.

## Component Patterns

- Reader chrome: compact top or side tools, same visual temperature as the page, with current source and export/assist actions visible without crowding the article.
- Margin anchor rail: thin position rail with highlight ticks, note markers, and active selection/annotation states.
- Annotation row: passage excerpt first, note/filter metadata second, actions last. Keep destructive actions visually quiet until hover/focus.
- Note editor: inset field, stable height, clear save/error state, and visible link back to the anchored passage.
- Filters: segmented or toggle controls for all/highlights/notes, using ochre and anchor blue only when state is meaningful.
- Assist result: one surface level above the selected passage or notes panel; preserve the source excerpt so explanation/translation stays grounded.
- Markdown export: preview should read like an output document, not a modal full of settings; export status uses review green or correction red.

## Interaction States

Every control needs default, hover, active, focus, disabled, loading, empty, and error states where applicable.

Selection and annotation states should be visually distinct:

- Text selected but not saved: anchor blue
- Highlight saved: highlighter ochre
- Note attached: graphite marker with paper surface
- Filter match: emphasized rail marker and row border
- Export success: review green
- Remove/failure: correction red

## Validation Checks

- Swap test: replacing the margin anchor rail with a generic progress bar should noticeably weaken the interface.
- Squint test: article text, active selection, and current annotation/filter state should remain clear without harsh borders.
- Signature test: the margin anchor rail should appear in at least five reusable contexts: reader, annotation list, filtered state, export preview, assist result, or source overview.
- Token test: token names should sound like reading, margins, ink, anchors, highlights, and notes rather than generic SaaS surfaces.
