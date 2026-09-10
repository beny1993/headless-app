// The editor's field map: for each content block, its Persian heading and the
// ordered list of editable leaves — each with a label, how to render it
// (`input`, `textarea`, or `image`), and, when the leaf is a link/button LABEL,
// the fixed destination that label sits on (`target`, shown read-only under the
// field so an editable label can never disguise where it goes). This is the ONE
// place the schemas' fields are spelled out for the UI — `block-fields.test.ts`
// asserts every descriptor path is a real leaf of that key's default and every
// leaf has a descriptor, so this can never silently drift from the schema.
//
// Client-safe: only a type from the content contract, the Persian-digit
// formatter, and the code-side link TARGETS (all client-safe: `paths.ts`, the
// pure `nav-links.ts`, the type-only-import `home/content.ts`). No drizzle/pg/hono.
// Paths are dotted, with numeric segments for the tuple entries (`slots.0.name`,
// `cards.2.title`, `nav.0`), read/written by getPath/setPath.
import type { ContentKey } from '@/lib/content/site-content';
import { PATHS, shopPath } from '@/lib/constant/paths';
import { toPersianDigits } from '@/lib/format';
import {
  LIFE_MOMENT_TARGETS,
  ROUTINE_TARGETS,
} from '@/features/storefront/home/content';
import {
  FOOTER_TARGETS,
  NAV_TARGETS,
} from '@/features/storefront/layout/nav-links';

export type FieldKind = 'input' | 'textarea' | 'image';

export type FieldDescriptor = {
  /** Dotted path into the block value, e.g. `image.key`, `slots.0.quote`, `nav.0`. */
  path: string;
  label: string;
  kind: FieldKind;
  /**
   * The fixed destination this label links to, shown read-only under the field
   * («مقصد: …», LTR). Present only on labels that sit on a `<Link>`/button — nav,
   * footer links, life-moment cards, routine tabs, and every CTA. The label is
   * content; the target stays in code (`*_TARGETS` / `shopPath`), and this is how
   * the editor makes that visible so a renamed label can't misroute.
   */
  target?: string;
};

export type BlockDescriptor = { title: string; fields: FieldDescriptor[] };

const fa = toPersianDigits;

/** An image key + its alt text — the shape hero/guide/about-hero/about-story share. */
const imageFields = (prefix: string): FieldDescriptor[] => [
  { path: `${prefix}.key`, label: 'تصویر', kind: 'image' },
  { path: `${prefix}.alt`, label: 'متن جایگزین تصویر', kind: 'input' },
];

/** One «خرید بر اساس لحظه» card: title (the link label), description, photo. */
const momentCard = (i: number): FieldDescriptor[] => {
  const n = fa(i + 1);
  return [
    {
      path: `cards.${i}.title`,
      label: `عنوان کارت ${n}`,
      kind: 'input',
      target: shopPath(LIFE_MOMENT_TARGETS[i].filters),
    },
    { path: `cards.${i}.desc`, label: `توضیح کارت ${n}`, kind: 'input' },
    { path: `cards.${i}.image`, label: `عکس کارت ${n}`, kind: 'image' },
  ];
};

/** One «روتین روزانه» tab: its label (target = the category slugs) and sub-label. */
const routineTab = (i: number): FieldDescriptor[] => {
  const n = fa(i + 1);
  return [
    {
      path: `slots.${i}.label`,
      label: `عنوان تب ${n}`,
      kind: 'input',
      target: ROUTINE_TARGETS[i].categories.join(', '),
    },
    { path: `slots.${i}.sub`, label: `زیرعنوان تب ${n}`, kind: 'input' },
  ];
};

/** One family photo-wall slot (no alt — it is derived in code from name + owner). */
const familySlot = (i: number): FieldDescriptor[] => {
  const n = fa(i + 1);
  return [
    { path: `slots.${i}.image`, label: `عکس اسلات ${n}`, kind: 'image' },
    { path: `slots.${i}.name`, label: `نام اسلات ${n}`, kind: 'input' },
    { path: `slots.${i}.owner`, label: `صاحب اسلات ${n}`, kind: 'input' },
    { path: `slots.${i}.quote`, label: `نقل‌قول اسلات ${n}`, kind: 'textarea' },
  ];
};

const stepFields = (i: number): FieldDescriptor[] => {
  const n = fa(i + 1);
  return [
    { path: `steps.${i}.step`, label: `عنوان مرحله ${n}`, kind: 'input' },
    { path: `steps.${i}.desc`, label: `توضیح مرحله ${n}`, kind: 'textarea' },
  ];
};

const valueFields = (i: number): FieldDescriptor[] => {
  const n = fa(i + 1);
  return [
    { path: `items.${i}.title`, label: `عنوان ارزش ${n}`, kind: 'input' },
    { path: `items.${i}.desc`, label: `توضیح ارزش ${n}`, kind: 'textarea' },
  ];
};

/** One header nav label; its href is `NAV_TARGETS[i]`. */
const navField = (i: number): FieldDescriptor => ({
  path: `nav.${i}`,
  label: `عنوان منو ${fa(i + 1)}`,
  kind: 'input',
  target: NAV_TARGETS[i],
});

/** One footer column: its title, then each link label (href = `FOOTER_TARGETS[c][l]`). */
const footerColumn = (c: number): FieldDescriptor[] => {
  const cn = fa(c + 1);
  return [
    { path: `columns.${c}.title`, label: `عنوان ستون ${cn}`, kind: 'input' },
    ...FOOTER_TARGETS[c].map((href, l) => ({
      path: `columns.${c}.links.${l}`,
      label: `پیوند ستون ${cn} — ${fa(l + 1)}`,
      kind: 'input' as const,
      target: href,
    })),
  ];
};

export const BLOCK_FIELDS: Record<ContentKey, BlockDescriptor> = {
  'home.hero': {
    title: 'بخش قهرمان',
    fields: [
      { path: 'eyebrow', label: 'عنوان کوچک', kind: 'input' },
      { path: 'headline', label: 'سرتیتر', kind: 'textarea' },
      { path: 'accent', label: 'خط تأکید', kind: 'input' },
      { path: 'body', label: 'متن', kind: 'textarea' },
      ...imageFields('image'),
      {
        path: 'shopCta',
        label: 'دکمه فروشگاه',
        kind: 'input',
        target: shopPath(),
      },
      {
        path: 'aboutCta',
        label: 'دکمه درباره ما',
        kind: 'input',
        target: PATHS.ABOUT,
      },
    ],
  },
  'home.moments': {
    title: 'خرید بر اساس لحظه',
    fields: [
      { path: 'eyebrow', label: 'عنوان کوچک', kind: 'input' },
      { path: 'headline', label: 'سرتیتر', kind: 'input' },
      {
        path: 'cta',
        label: 'پیوند «مشاهده همه»',
        kind: 'input',
        target: shopPath(),
      },
      ...[0, 1, 2, 3, 4].flatMap(momentCard),
    ],
  },
  'home.recommends': {
    title: 'انتخاب‌های اسموکی',
    fields: [
      { path: 'eyebrow', label: 'عنوان کوچک', kind: 'input' },
      { path: 'headline', label: 'سرتیتر', kind: 'input' },
      { path: 'body', label: 'متن', kind: 'textarea' },
    ],
  },
  'home.journey': {
    title: 'خرید شخصی‌سازی شده',
    fields: [
      { path: 'eyebrow', label: 'عنوان کوچک', kind: 'input' },
      { path: 'headline', label: 'سرتیتر', kind: 'input' },
      { path: 'body', label: 'متن', kind: 'textarea' },
    ],
  },
  'home.guide': {
    title: 'راهنمای اسموکی',
    fields: [
      { path: 'eyebrow', label: 'عنوان کوچک', kind: 'input' },
      { path: 'headline', label: 'سرتیتر', kind: 'textarea' },
      { path: 'body', label: 'متن', kind: 'textarea' },
      ...imageFields('image'),
      {
        path: 'cta',
        label: 'دکمه فراخوان',
        kind: 'input',
        target: shopPath({ category: 'wet-food' }),
      },
    ],
  },
  'home.routine': {
    title: 'روتین روزانه',
    fields: [
      { path: 'eyebrow', label: 'عنوان کوچک', kind: 'input' },
      { path: 'headline', label: 'سرتیتر', kind: 'input' },
      { path: 'body', label: 'متن', kind: 'input' },
      ...[0, 1, 2, 3].flatMap(routineTab),
    ],
  },
  'home.family': {
    title: 'خانواده اسموکی',
    fields: [
      { path: 'eyebrow', label: 'عنوان کوچک', kind: 'input' },
      { path: 'headline', label: 'سرتیتر', kind: 'input' },
      ...[0, 1, 2, 3, 4, 5].flatMap(familySlot),
    ],
  },
  'home.categories': {
    title: 'دسته‌بندی‌ها',
    fields: [
      { path: 'headline', label: 'سرتیتر', kind: 'input' },
      {
        path: 'cta',
        label: 'پیوند «همه دسته‌بندی‌ها»',
        kind: 'input',
        target: shopPath(),
      },
    ],
  },
  'home.philosophy': {
    title: 'فلسفه اسموکی',
    fields: [
      { path: 'eyebrow', label: 'عنوان کوچک', kind: 'input' },
      { path: 'headline', label: 'سرتیتر', kind: 'textarea' },
      { path: 'accent', label: 'خط تأکید', kind: 'input' },
      { path: 'body', label: 'متن', kind: 'textarea' },
      {
        path: 'cta',
        label: 'پیوند فراخوان',
        kind: 'input',
        target: PATHS.ABOUT,
      },
    ],
  },
  'about.hero': {
    title: 'بخش قهرمان',
    fields: [
      { path: 'eyebrow', label: 'عنوان کوچک', kind: 'input' },
      { path: 'headline', label: 'سرتیتر', kind: 'textarea' },
      { path: 'accent', label: 'خط تأکید', kind: 'input' },
      ...imageFields('image'),
    ],
  },
  'about.story': {
    title: 'داستان',
    fields: [
      { path: 'title', label: 'عنوان', kind: 'input' },
      { path: 'paragraphs.0', label: `پاراگراف ${fa(1)}`, kind: 'textarea' },
      { path: 'paragraphs.1', label: `پاراگراف ${fa(2)}`, kind: 'textarea' },
      { path: 'paragraphs.2', label: `پاراگراف ${fa(3)}`, kind: 'textarea' },
      ...imageFields('image'),
    ],
  },
  'about.process': {
    title: 'فرآیند انتخاب',
    fields: [
      { path: 'title', label: 'عنوان', kind: 'input' },
      ...[0, 1, 2, 3].flatMap(stepFields),
    ],
  },
  'about.values': {
    title: 'ارزش‌ها',
    fields: [
      { path: 'title', label: 'عنوان', kind: 'input' },
      ...[0, 1, 2, 3].flatMap(valueFields),
    ],
  },
  'about.cta': {
    title: 'فراخوان پایانی',
    // textarea like every other headline: the rendered <h2> carries
    // whitespace-pre-line, so an admin newline becomes a line break.
    fields: [
      { path: 'headline', label: 'سرتیتر', kind: 'textarea' },
      { path: 'cta', label: 'دکمه فراخوان', kind: 'input', target: shopPath() },
    ],
  },
  header: {
    title: 'هدر و ناوبری',
    fields: [
      { path: 'brand', label: 'نام‌واژه (لوگو متنی)', kind: 'input' },
      { path: 'tagline', label: 'زیرعنوان', kind: 'input' },
      ...[0, 1, 2].map(navField),
    ],
  },
  footer: {
    title: 'فوتر',
    fields: [
      { path: 'brand', label: 'نام‌واژه', kind: 'input' },
      { path: 'tagline', label: 'توضیح کوتاه', kind: 'textarea' },
      ...[0, 1].flatMap(footerColumn),
      {
        path: 'copyright',
        label: 'متن کپی‌رایت (بعد از © و سال)',
        kind: 'input',
      },
      { path: 'credit', label: 'خط اعتبار', kind: 'input' },
    ],
  },
};

/** Read a dotted path (numeric segments index arrays) out of a block value. */
export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[segment];
  }, obj);
}

/**
 * Return a copy of `obj` with the leaf at `path` set to `value`, cloning only the
 * objects/arrays along the path (so React state updates stay immutable). Arrays
 * are cloned as arrays, preserving the tuple shape the schema expects.
 */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const clone: Record<string, unknown> = Array.isArray(obj)
    ? ([...obj] as unknown as Record<string, unknown>)
    : { ...(obj as Record<string, unknown>) };

  clone[head] =
    rest.length === 0
      ? value
      : setPath((obj as Record<string, unknown>)[head], rest.join('.'), value);

  return clone as T;
}
