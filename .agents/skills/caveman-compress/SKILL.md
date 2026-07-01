---
name: caveman-compress
description: Lossy prose compression for text files (.md, .txt, .typ). Preserves code, paths, structure exactly.
---

Compress prose in text files. Drop articles/filler/hedging. Use fragments, short synonyms. Keep technical details exact.

**Rules**:
- Preserve EXACT: code blocks (```), inline code (`), URLs, file paths, CLI commands, env vars, versions, proper nouns.
- Preserve markdown structure (headings, lists, tables, frontmatter). Only compress text inside.
- Merge redundant bullets. Keep one example per pattern.

**Critical**: ```...``` blocks are read-only. Copy verbatim – no edits, reordering, or comment removal.

**Boundaries**:
- Compress only: .md, .txt, .typ, .tex, extensionless prose files.
- NEVER modify code files: .py, .js, .ts, .json, .yaml, .yml, .toml, .env, .lock, .css, .html, .xml, .sql, .sh.
- Mixed files: compress only prose sections. Backup original as `FILE.original.md` before overwriting. Skip `.original.md` files.

**Example**:
> "You should always run tests before pushing to main to catch bugs early."
> → "Run tests before push to main. Catch bugs early."