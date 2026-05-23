---
title: Interactive Study Reader Browser Extension
labels:
  - ready-for-agent
status: ready-for-agent
issue_tracker: github
github_repo: yuguerten/openread
github_publish_status: blocked-gh-cli-not-installed
created_at: 2026-05-23
---

## Problem Statement

People who read technical blogs from Hacker News often want a richer study workflow than a normal browser page provides. The current reading experience is optimized for passive scrolling through the original site, not active reading. Readers cannot reliably highlight important passages, attach notes to exact selections, review their annotations in context, or export their study notes from a clean workspace.

The desired product is not an AI summarizer and not a faster-reading tool. It is a browser extension that turns a blog post into an interactive, document-first study workspace. The workspace should feel closer to Excalidraw in interaction quality and visual simplicity, while remaining optimized for reading text.

## Solution

Build a browser extension that activates on a blog article page and opens a new extension-owned tab containing a clean reader workspace. The extension extracts the article using Mozilla Readability, renders it in a controlled document-first layout, and lets the user create text-selection anchored highlights and notes.

The v1 experience has a three-zone layout: a top toolbar, a centered readable article column, and a right annotation margin. Users select article text, then use a compact contextual popover to apply an Excalidraw-inspired highlight color or create a note. Highlights appear inline in the article. Notes with written text appear as margin cards aligned near the highlighted passage. Annotation data is private, local-first, and keyed by canonical URL.

## User Stories

1. As a Hacker News reader, I want to activate the extension on a technical blog post, so that I can move from the original site into a focused study workspace.
2. As a reader, I want the extension to open a new tab instead of replacing the current page, so that I can keep the original article available.
3. As a reader, I want the workspace to show a clean article view, so that blog-specific styling, clutter, and layout issues do not distract from reading.
4. As a reader, I want the workspace to preserve the article title, body content, links, images, and code blocks, so that the article remains useful after extraction.
5. As a reader, I want the extension to use the article canonical URL when available, so that my annotations are restored consistently.
6. As a reader, I want tracking query parameters removed from URL identity, so that the same article does not create duplicate workspaces.
7. As a reader, I want my annotations to be private by default, so that I can write freely without creating an account or sharing anything.
8. As a reader, I want annotations stored locally, so that v1 works without cloud sync or backend setup.
9. As a reader, I want to select text and see a small action popover, so that highlighting and note-taking are fast.
10. As a reader, I want to apply a highlight color directly from the selection popover, so that I can mark passages without moving to a toolbar.
11. As a reader, I want highlight colors inspired by Excalidraw, so that the product feels visually familiar and expressive.
12. As a reader, I want highlight colors to be visually meaningful but not semantically forced in v1, so that I can decide how to use them.
13. As a reader, I want to attach a note to selected text, so that my thoughts stay connected to the exact passage that caused them.
14. As a reader, I want note creation to automatically create an inline highlight, so that the note always has a visible anchor in the article.
15. As a reader, I want notes to appear in a right annotation margin, so that they are visible without covering the article text.
16. As a reader, I want plain highlights to stay inline without creating margin cards, so that the margin does not become noisy.
17. As a reader, I want margin cards to show the selected quote and my note text, so that I can understand the context of each note.
18. As a reader, I want the note editor to be an inline margin textarea, so that writing a note does not interrupt the reading flow.
19. As a reader, I want to save a note by blurring the editor or using a keyboard shortcut, so that note-taking feels lightweight.
20. As a reader, I want to cancel an empty note with Escape, so that accidental note creation is easy to undo.
21. As a reader, I want to edit an existing note, so that I can refine my thoughts while studying.
22. As a reader, I want to delete a highlight or note, so that I can clean up annotations I no longer need.
23. As a reader, I want clicking a margin note to scroll to its highlighted passage, so that I can re-enter the article context quickly.
24. As a reader, I want clicking a highlighted passage with a note to focus the matching margin card, so that I can move between text and notes.
25. As a reader, I want clicking a highlight without a note to offer adding a note, so that highlights can become richer annotations later.
26. As a reader, I want the article column to remain readable and stable, so that annotation controls do not damage the reading experience.
27. As a reader, I want notes aligned near their highlighted passages where possible, so that the margin behaves like a study canvas around the document.
28. As a reader, I want the top toolbar to expose global actions, so that selection-specific actions and workspace-wide actions are clearly separated.
29. As a reader, I want a source-page link in the toolbar, so that I can return to the original article.
30. As a reader, I want to search or use browser find within the workspace, so that I can locate article text or notes.
31. As a reader, I want filters for annotations by color or type, so that I can review subsets of my study marks.
32. As a reader, I want to export annotations as Markdown, so that my highlights and notes can move into my own note-taking system.
33. As a reader, I want exports to include the article title, canonical URL, selected quotes, colors, and note bodies, so that the exported result remains useful outside the extension.
34. As a reader, I want the extension to restore my annotations when I reopen the same article, so that my study work persists across sessions.
35. As a reader, I want annotations anchored robustly to selected text rather than fragile page DOM paths, so that extraction or rendering changes do not easily break my notes.
36. As a reader, I want the extension to fail gracefully when article extraction fails, so that I understand why a workspace cannot be created.
37. As a reader, I want unsupported content types to be excluded from v1, so that the product focuses on normal blog articles first.
38. As a developer, I want article extraction separated from rendering, so that extraction quality can improve without rewriting the reader UI.
39. As a developer, I want annotation anchoring separated from storage and UI, so that anchor restoration can be tested in isolation.
40. As a developer, I want a stable annotation schema, so that future AI, sync, and sharing features can build on the v1 data model.
41. As a developer, I want local persistence wrapped behind a small interface, so that local storage can later be replaced or augmented with cloud sync.
42. As a developer, I want export generation implemented as a pure module, so that Markdown output can be tested without browser APIs.

## Implementation Decisions

- Build a browser extension as the product shell.
- Activation starts from the current article page and opens a new extension-owned full tab for the reader workspace.
- The original page remains open and unchanged.
- Use Mozilla Readability for v1 article extraction.
- Accept "good enough" extraction for normal blog articles in v1.
- Extract at least the article title, canonical URL, readable HTML, readable plain text, links, images, and code blocks.
- Prefer canonical URL from the source page when present.
- Normalize URL identity by removing common tracking parameters.
- Store annotations locally and privately in v1.
- Key annotation sets by normalized canonical article URL.
- Use a document-first workspace with canvas affordances, rather than a freeform infinite canvas.
- Use a three-zone workspace layout: top toolbar, centered article column, right annotation margin.
- Keep the article readable as the primary surface.
- Show a contextual popover when the user selects article text.
- Selection popover supports applying a highlight color or creating a note.
- Reuse an Excalidraw-inspired color palette visually.
- Do not assign fixed semantic meanings to highlight colors in v1.
- Plain highlights are rendered inline in the article and included in filtering/export.
- Only annotations with written notes appear as margin cards.
- Notes use an inline margin card editor with a Markdown-lite textarea.
- Avoid modal note creation in v1.
- Use one annotation object per selected range.
- Prevent exact duplicate annotations for the same selected range.
- Persisted anchors should use text quote anchoring with offsets and context rather than DOM paths alone.
- Store the selected exact text, prefix context, suffix context, start offset, end offset, and block index for each anchor.
- Rendering may use transient DOM ranges during the active session, but persisted data should remain text-anchor based.
- Provide bidirectional focus between highlighted text and note margin cards.
- Provide edit and delete interactions for annotations.
- Provide annotation filtering by color/type.
- Provide Markdown export for highlights and notes.
- Fail gracefully when Readability cannot extract usable article content.

Major modules to build:

- Extension activation module: detects the current page, gathers source metadata, runs or coordinates extraction, and opens the reader tab.
- Article extraction module: wraps Mozilla Readability and returns normalized article content and metadata.
- URL identity module: derives canonical article identity and removes tracking noise.
- Reader rendering module: renders sanitized article content into the document-first workspace.
- Text selection module: converts user selections into persisted text anchors.
- Anchor restoration module: resolves saved anchors back onto the rendered article content.
- Annotation domain module: owns annotation objects, validation, duplicate handling, edit/delete behavior, and state transitions.
- Local persistence module: saves and loads annotations by article identity behind a small storage interface.
- Annotation UI module: handles selection popover, highlight rendering, note margin cards, and focus behavior.
- Export module: generates Markdown from article metadata and annotations.

Deep module opportunities:

- Article extraction should be a deep module with a simple input/output contract around raw page HTML and extracted article data.
- Text anchoring/restoration should be a deep module because it encapsulates the hardest correctness risk behind testable pure functions.
- Annotation domain state should be a deep module that can be tested without browser APIs.
- Markdown export should be a deep module because it has deterministic input/output behavior.

## Testing Decisions

- Tests should validate external behavior and stable contracts, not implementation details.
- The article extraction module should be tested with representative blog HTML fixtures, including title, canonical URL, links, images, and code blocks.
- The URL identity module should be tested with canonical URLs, fallback URLs, and tracking-parameter normalization.
- The text anchoring module should be tested with exact text, offsets, prefix/suffix context, repeated text, and shifted article content.
- The anchor restoration module should be tested against edited or re-rendered article text where offsets are slightly stale but context still matches.
- The annotation domain module should be tested for creating highlights, creating notes, preventing exact duplicates, editing notes, deleting annotations, and preserving one annotation per selected range.
- The local persistence module should be tested through its public save/load/delete behavior, using a fake storage adapter.
- The Markdown export module should be tested with highlights only, notes with quotes, multiple colors, missing optional metadata, and stable ordering.
- UI behavior should be covered with integration or end-to-end tests once a browser-extension test harness exists.
- Important UI flows to test externally: activate extension, open reader tab, select text, create highlight, create note, edit note, delete annotation, reload workspace, restore annotations, export Markdown.
- Since the current repository has no application code or existing tests, there is no direct in-repo prior art yet. New tests should establish the baseline testing style as implementation begins.

## Out of Scope

- AI integration.
- AI summaries, AI-generated notes, or AI chat over the article.
- Faster-reading or summary-first workflows.
- Social/shared annotations.
- User accounts.
- Cloud sync.
- Collaboration.
- Freehand drawing.
- Arrows/connectors between notes.
- Fully freeform infinite canvas behavior.
- Making article paragraphs draggable blocks.
- HN comments extraction.
- PDF support.
- Paywalled article handling.
- Newsletter-specific parsing.
- Browser side panel UI.
- Replacing the current tab in-place.
- Full rich-text note editor.
- Semantic labels attached to highlight colors.
- Full color picker.
- Spaced repetition.
- Cross-article knowledge graph.

## Further Notes

- The core product definition is an interactive study workspace for technical blog posts, where every v1 interaction starts from selected text.
- The product should feel visually related to Excalidraw through palette and lightweight interaction quality, while keeping reading as the main activity.
- The most important technical risk is robust annotation anchoring. Avoid depending solely on DOM paths.
- The second major risk is extraction variability across blogs. Use Readability first and defer custom extraction until real failures justify it.
- The repository currently has a GitHub remote, but the GitHub CLI is not installed in this environment. This PRD is therefore stored locally as tracker-ready markdown with the `ready-for-agent` label metadata.
