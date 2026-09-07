// SiteContentDao against a real Postgres — upsert idempotency, updated_at
// advancing, read-side resolution of a missing / invalid / hand-inserted row,
// and the write-side parse gate. These need a live database (see
// src/db/test-db.ts); the DB-less run collects and skips cleanly.
//
// Every row is a real content key, so the suite cleans up the keys it touches in
// afterEach — the storefront and the admin page read the same table off the same
// dev database, so a leaked row would change what another test (or a manual
// visit) sees.
import { inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteContent } from '@/db/schema/site-content';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';

const { SiteContentDao } = await importWithDb(
  () => import('@/db/dao/SiteContentDao'),
);

describe.skipIf(!databaseReachable)('SiteContentDao', () => {
  // The keys any test in this file may write; cleaned after each.
  const touched = ['about.cta', 'about.story', 'home.family'] as const;

  // A valid `about.cta` value with a chosen headline — spreads the default so the
  // whole (v2-extended) shape is present and a later required field never breaks
  // these round-trips.
  const cta = (headline: string) => ({
    ...DEFAULT_CONTENT['about.cta'],
    headline,
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testDb
      .delete(siteContent)
      .where(inArray(siteContent.key, [...touched]));
  });

  describe('set + getMany round-trip', () => {
    it('stores a value and reads it back', async () => {
      await SiteContentDao.set('about.cta', cta('سلام دنیا'));

      const { 'about.cta': value } = await SiteContentDao.getMany([
        'about.cta',
      ]);
      expect(value).toEqual(cta('سلام دنیا'));
    });

    it('is an upsert — a second set replaces, never duplicates', async () => {
      await SiteContentDao.set('about.cta', cta('اول'));
      await SiteContentDao.set('about.cta', cta('دوم'));

      const rows = await testDb
        .select()
        .from(siteContent)
        .where(inArray(siteContent.key, ['about.cta']));
      expect(rows).toHaveLength(1);
      expect((rows[0].value as { headline: string }).headline).toBe('دوم');
    });

    it('strips fields the schema does not declare before storing', async () => {
      await SiteContentDao.set('about.cta', {
        ...cta('x'),
        // An injected extra field — must never reach the row.
        role: 'admin',
      } as ReturnType<typeof cta>);

      const rows = await testDb
        .select()
        .from(siteContent)
        .where(inArray(siteContent.key, ['about.cta']));
      expect(rows[0].value).toEqual(cta('x'));
    });
  });

  describe('set advances updated_at', () => {
    it('bumps updated_at on the conflicting update', async () => {
      // Insert a deliberately-stale row directly, then let `set` update it, so
      // the comparison is against a known-older timestamp rather than two
      // same-millisecond writes.
      const stale = new Date(Date.now() - 60_000);
      await testDb.insert(siteContent).values({
        key: 'about.cta',
        value: { headline: 'قدیمی' },
        updatedAt: stale,
      });

      await SiteContentDao.set('about.cta', cta('تازه'));

      const [row] = await testDb
        .select()
        .from(siteContent)
        .where(inArray(siteContent.key, ['about.cta']));
      expect(row.updatedAt.getTime()).toBeGreaterThan(stale.getTime());
    });
  });

  describe('set refuses an invalid value', () => {
    it('throws and writes nothing for a value failing the schema', async () => {
      await expect(
        // Empty headline fails boundedText's min(1).
        SiteContentDao.set('about.cta', cta('')),
      ).rejects.toThrow();

      const rows = await testDb
        .select()
        .from(siteContent)
        .where(inArray(siteContent.key, ['about.cta']));
      expect(rows).toHaveLength(0);
    });

    it('throws for an out-of-shape image key (last write boundary)', async () => {
      await expect(
        SiteContentDao.set('about.story', {
          ...DEFAULT_CONTENT['about.story'],
          image: { key: 'http://evil/x.jpg', alt: 'x' },
        }),
      ).rejects.toThrow();
    });
  });

  describe('getMany read-side resolution', () => {
    it('returns the default for a key with no row, silently', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { 'about.cta': value } = await SiteContentDao.getMany([
        'about.cta',
      ]);
      expect(value).toEqual(DEFAULT_CONTENT['about.cta']);
      expect(warn).not.toHaveBeenCalled();
    });

    it('falls back to the default and warns for a hand-inserted invalid row', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // A row planted by something other than the DAO — `{}` is not a valid
      // about.cta value.
      await testDb.insert(siteContent).values({ key: 'about.cta', value: {} });

      const { 'about.cta': value } = await SiteContentDao.getMany([
        'about.cta',
      ]);
      expect(value).toEqual(DEFAULT_CONTENT['about.cta']);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('falls back for a row whose image key was tampered with outside the app', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await testDb.insert(siteContent).values({
        key: 'about.story',
        value: {
          ...DEFAULT_CONTENT['about.story'],
          image: { key: '/site/../etc/passwd', alt: 'x' },
        },
      });

      const { 'about.story': value } = await SiteContentDao.getMany([
        'about.story',
      ]);
      expect(value).toEqual(DEFAULT_CONTENT['about.story']);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('returns only the keys asked for, not other rows in the table', async () => {
      await SiteContentDao.set('about.cta', cta('x'));
      await SiteContentDao.set('home.family', DEFAULT_CONTENT['home.family']);

      const result = await SiteContentDao.getMany(['about.cta']);
      expect(Object.keys(result)).toEqual(['about.cta']);
    });

    it('reads several keys in one call, each resolved independently', async () => {
      await SiteContentDao.set('about.cta', cta('ذخیره‌شده'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await SiteContentDao.getMany(['about.cta', 'about.story']);
      // Saved key comes back stored; the un-saved key comes back as its default.
      expect(result['about.cta']).toEqual(cta('ذخیره‌شده'));
      expect(result['about.story']).toEqual(DEFAULT_CONTENT['about.story']);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
