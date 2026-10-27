# Code blocks and Mermaid

Choose a language in a code block to enable syntax highlighting. Supported languages are plain text, JavaScript/TypeScript, JSX/TSX, HTML/CSS, JSON/YAML, Python, Shell, SQL, Go, Rust, Java, C/C++, Markdown and Mermaid. Common aliases such as `js`, `ts`, `py`, `bash` and `yml` are recognized. Unknown languages remain editable as plain code.

Insert **Mermaid** from the slash menu or select Mermaid in an existing code block. Code, Preview and Split modes control how source and rendered diagrams appear. Split stacks vertically on narrow screens. Editing source updates the preview after a short debounce; syntax or loading failures display an inline message and leave the source accessible through Code mode. Mermaid's built-in diagram types are supported; graphical editing and mathematical formula blocks are outside this feature.

A diagram is stored as a normal `codeBlock` with `props.language: "mermaid"`, source in `content`, and `props.displayMode` set to `code`, `preview` or `split`. A missing mode defaults to preview; newly inserted Mermaid blocks start in split mode. Mode changes use the same document command/save/sync pipeline as source edits. Read-only readers can temporarily change the visible mode without writing to the document. SVG and highlighting tokens are never persisted. Markdown export uses language-tagged fences, including `mermaid`.

Both Web and standalone editors share this implementation. Shiki core, light/dark themes and individual language registrations load through dynamic imports when needed. Language dependencies can load together. Mermaid's renderer loads only for a nonempty diagram preview, and its diagram implementations retain upstream splitting. The existing production PWA precaches JavaScript, so it may download optional chunks in the background even before their first use. No additional offline subsystem is implemented.

Themes follow each editor's Presentation. Highlight tokens provide both color sets; Mermaid configuration and rendering are serialized to prevent shared configuration from leaking between concurrently rendered editor themes. Rendering uses strict security and unique diagram IDs, discards stale asynchronous results and cleans up temporary DOM.

Verification lives in `tests/code-highlighter.test.ts`, `tests/editor-codec.test.ts`, `tests/markdown.test.ts` and `tests/e2e/code-blocks.spec.ts`. The browser tests use the production standalone bundle and verify network splitting without a service worker.
