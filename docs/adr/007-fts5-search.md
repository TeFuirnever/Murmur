# ADR 007: FTS5 full-text search with trigram tokenizer

**Status**: Accepted
**Date**: 2026-05-23

## Context

`searchTranscriptions` used `LIKE '%query%'` across 3 text columns, causing full-table scans. For users with many transcriptions, search becomes slow. CJK text (Chinese) requires substring matching that default FTS5 tokenizers don't support.

## Decision

Use SQLite FTS5 with the `trigram` tokenizer:

- Creates `transcriptions_fts` virtual table mirroring text columns
- Triggers keep FTS index in sync with INSERT/UPDATE/DELETE
- `rebuild` on startup ensures existing data is indexed
- Queries < 3 characters use LIKE (trigram requires 3+ chars)
- Queries >= 3 characters use FTS5 MATCH with relevance ranking (`ORDER BY rank`)

## Consequences

- Search performance scales with index size instead of table size
- Chinese substring matching works correctly via trigram overlap
- Short queries (1-2 chars) use LIKE fallback — acceptable for rare short searches
- ~100 bytes overhead per row for the FTS index
