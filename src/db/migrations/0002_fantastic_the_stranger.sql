-- Persian product search: the trigram extension, the normalized column, its
-- index, and a backfill for the rows that existed before it.
--
-- `pg_trgm` first — `gin_trgm_ops` below does not exist until the extension
-- does. It is a trusted extension, so the database owner can create it without
-- superuser rights, and `IF NOT EXISTS` keeps `pnpm migration:reset-dev` and a
-- fresh production database on the same path.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Backfill. This mirrors `normalizeSearchText` in
-- `src/lib/catalog/search-text.ts`, which is the source of truth and the only
-- thing that writes this column from here on: silent marks stripped, Arabic
-- yeh/kaf folded to their Persian letters, Arabic-Indic and Persian digits
-- folded to ASCII, zero-width characters turned into spaces, whitespace
-- collapsed and trimmed. It is a one-shot statement, not a rule the database
-- keeps — a later change to the TypeScript normalizer ships as its own
-- migration rather than by editing this one.
--
-- `concat_ws` skips a NULL brand or benefit but keeps an empty one, which is
-- why the whitespace collapse has to run after it and not before.
UPDATE "products" SET "search_text" = btrim(
  regexp_replace(
    translate(
      regexp_replace(
        concat_ws(' ', "title", "brand", "benefit"),
        -- harakat, superscript alef, tatweel
        '[ً-ْٰـ]', '', 'g'
      ),
      -- ARABIC YEH (U+064A), ALEF MAKSURA (U+0649), ARABIC KAF (U+0643),
      -- Arabic-Indic digits (U+0660-0669), Persian digits (U+06F0-06F9), then
      -- four characters nobody can see in a diff: ZWSP (U+200B), ZWNJ
      -- (U+200C), ZWJ (U+200D), BOM (U+FEFF). 27 code points.
      E'يىك٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹​‌‍﻿',
      -- PERSIAN YEH, PERSIAN YEH, PERSIAN KEHEH, 0-9, 0-9, then one space per
      -- zero-width character. `repeat` rather than four typed spaces, which no
      -- reviewer can count at the end of a string literal. 27 against 27, which
      -- is what `translate` requires to map rather than delete.
      'ییک01234567890123456789' || repeat(' ', 4)
    ),
    '\s+', ' ', 'g'
  )
);--> statement-breakpoint
CREATE INDEX "products_search_text_trgm_idx" ON "products" USING gin ("search_text" gin_trgm_ops);
