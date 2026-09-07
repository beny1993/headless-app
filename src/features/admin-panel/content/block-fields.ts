// The editor's field map: for each content block, its Persian heading and the
// ordered list of editable leaves, each with a label and how to render it
// (`input`, `textarea`, or `image`). This is the ONE place the nine schemas'
// fields are spelled out for the UI — `block-fields.test.ts` asserts every
// descriptor path is a real leaf of that key's default and every leaf has a
// descriptor, so this can never silently drift from the schema.
//
// Client-safe: only a type from the content contract and the Persian-digit
// formatter, no drizzle/pg/hono. Paths are dotted, with numeric segments for the
// tuple entries (`slots.0.name`, `steps.2.desc`), read/written by getPath/setPath.
import type { ContentKey } from '@/lib/content/site-content';
import { toPersianDigits } from '@/lib/format';

export type FieldKind = 'input' | 'textarea' | 'image';

export type FieldDescriptor = {
  /** Dotted path into the block value, e.g. `image.key`, `slots.0.quote`. */
  path: string;
  label: string;
  kind: FieldKind;
};

export type BlockDescriptor = { title: string; fields: FieldDescriptor[] };

const fa = toPersianDigits;

/** An image key + its alt text — the shape hero/guide/about-hero/about-story share. */
const imageFields = (prefix: string): FieldDescriptor[] => [
  { path: `${prefix}.key`, label: 'تصویر', kind: 'image' },
  { path: `${prefix}.alt`, label: 'متن جایگزین تصویر', kind: 'input' },
];

/** One family photo-wall slot (no alt — it is derived in code from name + owner). */
const slotFields = (i: number): FieldDescriptor[] => {
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

export const BLOCK_FIELDS: Record<ContentKey, BlockDescriptor> = {
  'home.hero': {
    title: 'بخش قهرمان (صفحه اصلی)',
    fields: [
      { path: 'eyebrow', label: 'عنوان کوچک', kind: 'input' },
      { path: 'headline', label: 'سرتیتر', kind: 'textarea' },
      { path: 'accent', label: 'خط تأکید', kind: 'input' },
      { path: 'body', label: 'متن', kind: 'textarea' },
      ...imageFields('image'),
    ],
  },
  'home.guide': {
    title: 'راهنمای اسموکی (صفحه اصلی)',
    fields: [
      { path: 'eyebrow', label: 'عنوان کوچک', kind: 'input' },
      { path: 'headline', label: 'سرتیتر', kind: 'textarea' },
      { path: 'body', label: 'متن', kind: 'textarea' },
      ...imageFields('image'),
    ],
  },
  'home.philosophy': {
    title: 'فلسفه اسموکی (صفحه اصلی)',
    fields: [
      { path: 'eyebrow', label: 'عنوان کوچک', kind: 'input' },
      { path: 'headline', label: 'سرتیتر', kind: 'textarea' },
      { path: 'accent', label: 'خط تأکید', kind: 'input' },
      { path: 'body', label: 'متن', kind: 'textarea' },
    ],
  },
  'home.family': {
    title: 'خانواده اسموکی (صفحه اصلی)',
    fields: [0, 1, 2, 3, 4].flatMap(slotFields),
  },
  'about.hero': {
    title: 'بخش قهرمان (درباره ما)',
    fields: [
      { path: 'eyebrow', label: 'عنوان کوچک', kind: 'input' },
      { path: 'headline', label: 'سرتیتر', kind: 'textarea' },
      { path: 'accent', label: 'خط تأکید', kind: 'input' },
      ...imageFields('image'),
    ],
  },
  'about.story': {
    title: 'داستان (درباره ما)',
    fields: [
      { path: 'title', label: 'عنوان', kind: 'input' },
      { path: 'paragraphs.0', label: `پاراگراف ${fa(1)}`, kind: 'textarea' },
      { path: 'paragraphs.1', label: `پاراگراف ${fa(2)}`, kind: 'textarea' },
      { path: 'paragraphs.2', label: `پاراگراف ${fa(3)}`, kind: 'textarea' },
      ...imageFields('image'),
    ],
  },
  'about.process': {
    title: 'فرآیند انتخاب (درباره ما)',
    fields: [
      { path: 'title', label: 'عنوان', kind: 'input' },
      ...[0, 1, 2, 3].flatMap(stepFields),
    ],
  },
  'about.values': {
    title: 'ارزش‌ها (درباره ما)',
    fields: [
      { path: 'title', label: 'عنوان', kind: 'input' },
      ...[0, 1, 2, 3].flatMap(valueFields),
    ],
  },
  'about.cta': {
    title: 'فراخوان پایانی (درباره ما)',
    fields: [{ path: 'headline', label: 'سرتیتر', kind: 'input' }],
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
