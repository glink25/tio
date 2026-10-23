# Dependency policy and tooling

Versions were checked against registry metadata and installed peer constraints on 2026-10-22. The committed lockfile is the reproducible source of truth.

- Vite 8 / Rolldown and React plugin 6 use the Oxc transform pipeline.
- Oxlint 1.89 + tsgolint 7 provide type-aware lint. Oxfmt 0.74 provides formatting, import organization and Tailwind sorting. There is no direct ESLint/Prettier project configuration or script.
- Tailwind CSS 4 integrates through its Vite plugin. Styling is utility-first rather than a monolithic component stylesheet.
- React 18.3.1 is intentionally retained for Glide 6.0.3's declared peer range. React 19 is not forced through a peer override.
- TypeScript 6.0.3 is within react-i18next's declared supported major range. A future TypeScript 7 move should wait for dependency compatibility.
- BlockNote core/react/mantine use matching 0.56.0 versions. No XL extension or remote collaboration service is enabled.
- i18next 26.5.5 / react-i18next 17.1.1 provide typed, reactive bilingual UI. Explicit pinned versions are represented in pnpm's release-age exception list; the rest of the lock resolution follows the package manager's policy.
- Lucide uses named SVG component imports; no icon font, remote CDN or CSS glyph dependency.
- Radix Dialog provides keyboard focus and modal behavior.

**BlockNote core/react/mantine are MPL-2.0**, a file-level copyleft license. The demo consumes the unmodified packages and does not copy their implementation into MIT-licensed source. Preserve their license notices and meet MPL source availability obligations when distributing their covered files. Glide, React, i18next, fflate, node-diff3, Oxc and Vite are MIT; Lucide and idb are ISC. Review the actual installed LICENSE files before redistribution; this note is not an exhaustive legal audit. Do not copy Cent source without its separate license review.

Run `corepack pnpm -r licenses list` to inspect workspace dependency licenses. Dependabot groups coupled editor/build/tooling updates. GitHub Actions are pinned to verified v7 commit IDs; Dependabot can propose updates.
