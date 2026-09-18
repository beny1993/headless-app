-- Custom data migration: the 31 Iranian provinces and their placeholder shipping
-- fees, so every environment has them after a deploy. Until now they arrived only
-- through `pnpm seed-shipping`, which the production image cannot run (no tsx,
-- no devDependencies) — production was left to type 31 provinces in by hand.
--
-- Names and fees are src/db/seed/shipping-data.ts as of this migration, each name
-- in its stored form (`normalizeProvinceName`); the order is the id order, which
-- is the order the province <select> renders in (Tehran first). Pinned by
-- src/db/seed/shipping-data.test.ts.
--
-- It only ever ADDS. A province that already exists is skipped — and "exists" is
-- compared with spaces and ZWNJ (chr(8204), constructed, never typed) removed, so
-- a hand-typed «چهار محال و بختیاری» is recognised as «چهارمحال و بختیاری» rather
-- than joined by a look-alike. A skipped province keeps its name, its fee and its
-- is_active flag exactly as the admin left them: rates are inserted only for the
-- provinces this statement itself added (`added`), all in one statement.
WITH seed (ord, name, fee) AS (
  VALUES
    (1, 'تهران', 25000),
    (2, 'البرز', 30000),
    (3, 'قم', 35000),
    (4, 'قزوین', 35000),
    (5, 'مرکزی', 38000),
    (6, 'سمنان', 40000),
    (7, 'اصفهان', 42000),
    (8, 'زنجان', 42000),
    (9, 'گیلان', 45000),
    (10, 'مازندران', 45000),
    (11, 'گلستان', 48000),
    (12, 'همدان', 45000),
    (13, 'لرستان', 48000),
    (14, 'کرمانشاه', 50000),
    (15, 'کردستان', 52000),
    (16, 'آذربایجان شرقی', 52000),
    (17, 'آذربایجان غربی', 55000),
    (18, 'اردبیل', 55000),
    (19, 'ایلام', 58000),
    (20, 'خوزستان', 55000),
    (21, 'چهارمحال و بختیاری', 52000),
    (22, 'کهگیلویه و بویراحمد', 58000),
    (23, 'فارس', 55000),
    (24, 'بوشهر', 60000),
    (25, 'یزد', 48000),
    (26, 'کرمان', 58000),
    (27, 'هرمزگان', 65000),
    (28, 'خراسان رضوی', 55000),
    (29, 'خراسان شمالی', 60000),
    (30, 'خراسان جنوبی', 62000),
    (31, 'سیستان و بلوچستان', 68000)
),
added AS (
  INSERT INTO "provinces" ("name")
  SELECT seed.name
  FROM seed
  WHERE NOT EXISTS (
    SELECT 1
    FROM "provinces"
    WHERE replace(replace("provinces"."name", ' ', ''), chr(8204), '')
        = replace(replace(seed.name, ' ', ''), chr(8204), '')
  )
  ORDER BY seed.ord
  ON CONFLICT ("name") DO NOTHING
  RETURNING "id", "name"
)
INSERT INTO "shipping_rates" ("province_id", "fee")
SELECT added."id", seed.fee
FROM added
JOIN seed ON seed.name = added."name"
ORDER BY seed.ord
ON CONFLICT ("province_id") DO NOTHING;
