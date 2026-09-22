import { describe, expect, it } from 'vitest';
import {
  CATEGORY_MESSAGES,
  CATEGORY_PARENT_MESSAGES,
  categoryInputSchema,
  MAX_SORT_ORDER,
  MAX_TITLE_LENGTH,
} from './category-input';
import { MAX_SLUG_LENGTH } from './sku';

const valid = {
  title: 'غذای خشک',
  slug: 'dry-food',
  sortOrder: 1,
  parentId: null,
};

/** The message zod attached to `field`, or undefined when the field passed. */
const messageFor = (input: unknown, field: string) =>
  categoryInputSchema
    .safeParse(input)
    .error?.issues.find((issue) => issue.path[0] === field)?.message;

describe('categoryInputSchema', () => {
  it('accepts a well-formed category with a Persian title', () => {
    expect(categoryInputSchema.parse(valid)).toEqual(valid);
  });

  it('trims the title and the slug', () => {
    expect(
      categoryInputSchema.parse({
        ...valid,
        title: '  غذای خشک  ',
        slug: ' dry-food ',
      }),
    ).toEqual(valid);
  });

  it('strips server-owned fields rather than applying them', () => {
    const parsed = categoryInputSchema.parse({
      ...valid,
      id: '123e4567-e89b-12d3-a456-426614174000',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(parsed).not.toHaveProperty('id');
    expect(parsed).not.toHaveProperty('createdAt');
  });

  describe('title', () => {
    it.each(['', '   '])('rejects the blank title %j', (title) => {
      expect(messageFor({ ...valid, title }, 'title')).toBe(
        CATEGORY_MESSAGES.title,
      );
    });

    it('keeps a ZWNJ inside a Persian word', () => {
      expect(
        categoryInputSchema.parse({ ...valid, title: 'اسباب‌بازی' }).title,
      ).toBe('اسباب‌بازی');
    });

    it('accepts a title at the length cap and rejects one past it', () => {
      const at = 'غ'.repeat(MAX_TITLE_LENGTH);
      expect(
        categoryInputSchema.safeParse({ ...valid, title: at }).success,
      ).toBe(true);
      expect(messageFor({ ...valid, title: `${at}غ` }, 'title')).toBe(
        CATEGORY_MESSAGES.titleLength,
      );
    });

    // Control and bidi characters are built from code points, never typed.
    const NUL = String.fromCharCode(0);
    const ZWNJ = String.fromCharCode(0x200c);
    const RLO = String.fromCharCode(0x202e);
    const LRI = String.fromCharCode(0x2066);
    const LRM = String.fromCharCode(0x200e);
    const RLM = String.fromCharCode(0x200f);
    const ALM = String.fromCharCode(0x061c);

    it.each([
      ['a NUL byte', `غذا${NUL}`],
      ['a newline', 'غذای\nخشک'],
      ['a right-to-left override', `${RLO}غذا`],
      ['a directional isolate', `غذا${LRI}`],
      // The marks reorder the neutrals beside them exactly as the overrides do,
      // and the shared class is the only place either is listed.
      ['a left-to-right mark', `${LRM}غذا`],
      ['a right-to-left mark', `غذا${RLM}`],
      ['an Arabic letter mark', `غذا${ALM}خشک`],
    ])('rejects a title carrying %s', (_, title) => {
      expect(messageFor({ ...valid, title }, 'title')).toBe(
        CATEGORY_MESSAGES.titleChars,
      );
    });

    it('rejects a title of only invisible characters as blank', () => {
      expect(messageFor({ ...valid, title: ZWNJ.repeat(3) }, 'title')).toBe(
        CATEGORY_MESSAGES.title,
      );
    });

    it('rejects a missing title with the Persian message', () => {
      expect(messageFor({ slug: 'dry-food', sortOrder: 0 }, 'title')).toBe(
        CATEGORY_MESSAGES.title,
      );
    });
  });

  describe('slug', () => {
    it.each(['ab', 'Dry-Food', 'غذا', 'dry food', 'dry_food', ''])(
      'rejects %j',
      (slug) => {
        expect(messageFor({ ...valid, slug }, 'slug')).toBe(
          CATEGORY_MESSAGES.slug,
        );
      },
    );

    it('accepts the three-character minimum', () => {
      expect(
        categoryInputSchema.safeParse({ ...valid, slug: 'toy' }).success,
      ).toBe(true);
    });

    it('accepts a slug exactly at the catalog slug cap', () => {
      expect(
        categoryInputSchema.safeParse({
          ...valid,
          slug: 'a'.repeat(MAX_SLUG_LENGTH),
        }).success,
      ).toBe(true);
    });

    it('refuses one character past the cap, with the Persian length message', () => {
      const slug = 'a'.repeat(MAX_SLUG_LENGTH + 1);
      expect(categoryInputSchema.safeParse({ ...valid, slug }).success).toBe(
        false,
      );
      expect(messageFor({ ...valid, slug }, 'slug')).toBe(
        CATEGORY_MESSAGES.slugLength,
      );
    });
  });

  describe('sortOrder', () => {
    it.each([0, MAX_SORT_ORDER])('accepts %s', (sortOrder) => {
      expect(
        categoryInputSchema.safeParse({ ...valid, sortOrder }).success,
      ).toBe(true);
    });

    it.each([-1, 1.5, MAX_SORT_ORDER + 1, Number.NaN, undefined, '1'])(
      'rejects %s with the Persian message',
      (sortOrder) => {
        expect(messageFor({ ...valid, sortOrder }, 'sortOrder')).toBe(
          CATEGORY_MESSAGES.sortOrder,
        );
      },
    );
  });

  describe('parentId', () => {
    const PARENT = '123e4567-e89b-12d3-a456-426614174000';

    it('accepts a parent id', () => {
      expect(
        categoryInputSchema.parse({ ...valid, parentId: PARENT }).parentId,
      ).toBe(PARENT);
    });

    it('reads an omitted parent as top-level, so an older body stays valid', () => {
      const { parentId, ...withoutParent } = valid;
      void parentId;

      expect(categoryInputSchema.parse(withoutParent).parentId).toBeNull();
    });

    it.each(['', 'not-a-uuid', 12, 'dry-food'])(
      'rejects %s with the Persian message',
      (parentId) => {
        expect(messageFor({ ...valid, parentId }, 'parentId')).toBe(
          CATEGORY_MESSAGES.parent,
        );
      },
    );
  });
});

describe('CATEGORY_PARENT_MESSAGES', () => {
  it('has a Persian sentence for every refusal reason', () => {
    // The manager reuses `hasChildren` as its disabled-select hint, and the
    // routes send each of these back as `parentId: <message>`.
    expect(Object.keys(CATEGORY_PARENT_MESSAGES).sort()).toEqual([
      'hasChildren',
      'nested',
      'self',
      'unknown',
    ]);
    for (const message of Object.values(CATEGORY_PARENT_MESSAGES)) {
      expect(message).toMatch(/\p{Script=Arabic}/u);
    }
  });
});
