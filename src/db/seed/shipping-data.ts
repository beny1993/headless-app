// The 31 Iranian provinces and their placeholder per-province shipping fees,
// copied verbatim from the canonical design prototype (`design/src/app/App.tsx`,
// the PROVINCES array). The fees are placeholders that let the checkout summary
// show a real fee change (Tehran cheapest, remote provinces higher); Benyamin
// tunes the real numbers later through the admin rate-update endpoint.
//
// Deliberately free of database imports, so the checks on this data — count,
// unique names, whole non-negative Toman — run without a database. `seedShipping`
// in ./shipping.ts writes it, upserting by name so a re-run is idempotent and
// never clobbers a fee an admin has since tuned.
//
// Order is meaningful: it is the identity/id order and the order the province
// <select> renders in (Tehran first), so keep it as the prototype has it —
// Postgres Persian collation is unreliable, so the app never sorts by name.

/** Integer Toman. */
export type SeedProvince = { name: string; fee: number };

export const SEED_PROVINCES: SeedProvince[] = [
  { name: 'تهران', fee: 25_000 },
  { name: 'البرز', fee: 30_000 },
  { name: 'قم', fee: 35_000 },
  { name: 'قزوین', fee: 35_000 },
  { name: 'مرکزی', fee: 38_000 },
  { name: 'سمنان', fee: 40_000 },
  { name: 'اصفهان', fee: 42_000 },
  { name: 'زنجان', fee: 42_000 },
  { name: 'گیلان', fee: 45_000 },
  { name: 'مازندران', fee: 45_000 },
  { name: 'گلستان', fee: 48_000 },
  { name: 'همدان', fee: 45_000 },
  { name: 'لرستان', fee: 48_000 },
  { name: 'کرمانشاه', fee: 50_000 },
  { name: 'کردستان', fee: 52_000 },
  { name: 'آذربایجان شرقی', fee: 52_000 },
  { name: 'آذربایجان غربی', fee: 55_000 },
  { name: 'اردبیل', fee: 55_000 },
  { name: 'ایلام', fee: 58_000 },
  { name: 'خوزستان', fee: 55_000 },
  { name: 'چهارمحال و بختیاری', fee: 52_000 },
  { name: 'کهگیلویه و بویراحمد', fee: 58_000 },
  { name: 'فارس', fee: 55_000 },
  { name: 'بوشهر', fee: 60_000 },
  { name: 'یزد', fee: 48_000 },
  { name: 'کرمان', fee: 58_000 },
  { name: 'هرمزگان', fee: 65_000 },
  { name: 'خراسان رضوی', fee: 55_000 },
  { name: 'خراسان شمالی', fee: 60_000 },
  { name: 'خراسان جنوبی', fee: 62_000 },
  { name: 'سیستان و بلوچستان', fee: 68_000 },
];
