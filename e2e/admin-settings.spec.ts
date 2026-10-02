import type { Dialog, Page } from '@playwright/test';
import { SEED_CATEGORIES, SEED_PRODUCTS } from '@/db/seed/catalog-data';
import { SEED_PROVINCES } from '@/db/seed/shipping-data';
import { FEATURED_COUNT } from '@/lib/content/site-content';
import {
  API_PATHS,
  PATHS,
  PROTECTED_PATHS,
  adminContentAreaPath,
  apiShippingRatePath,
  shopPath,
} from '@/lib/constant/paths';
import { formatToman, toAsciiDigits } from '@/lib/format';
import { PROVINCE_MESSAGES } from '@/lib/shipping/province-input';
import {
  ADMIN_STATE,
  attachReceipt,
  closeOrder,
  expect,
  openCheckout,
  passRecipientStep,
  reachPayment,
  resultOrderId,
  test,
} from './support';

test.use({ storageState: ADMIN_STATE });

// Both change settings the whole dev database shares, so each puts the old
// value back in a `finally`, even when an assertion fails.

test('a shipping rate an admin changes is what checkout charges', async ({
  page,
  shopper,
}) => {
  // The last seeded province: no other spec delivers there.
  const province = SEED_PROVINCES[SEED_PROVINCES.length - 1].name;

  await page.goto(PROTECTED_PATHS.SHIPPING);
  const fee = page.getByLabel(`هزینه ارسال ${province}`, { exact: true });
  const row = page.locator('tr', { has: fee });
  const original = await fee.inputValue();
  const changed = Number(toAsciiDigits(original)) + 1_000;

  const saveFee = async (value: string) => {
    // Save stays disabled on an unchanged value: restoring after a save that
    // never took would otherwise wait out the test and bury the real failure.
    if ((await fee.inputValue()) === value) return;
    await fee.fill(value);
    await row.locator('[data-umami-event="admin-panel-shipping-save"]').click();
    await expect(row.getByText('ذخیره شد')).toBeVisible();
  };

  await saveFee(String(changed));
  try {
    await openCheckout(shopper);
    await passRecipientStep(shopper);
    await shopper
      .locator('[data-umami-event="checkout-province-change"]')
      .selectOption({ label: province });
    await expect(shopper.getByText(formatToman(changed)).first()).toBeVisible();
  } finally {
    await saveFee(original);
  }
});

test('one fee an admin applies to every province is what checkout charges', async ({
  page,
  shopper,
}) => {
  // The last seeded province: no other spec delivers there.
  const province = SEED_PROVINCES[SEED_PROVINCES.length - 1].name;

  await page.goto(PROTECTED_PATHS.SHIPPING);
  // Every row's fee field — the labels are in the table body, so the create
  // form's and the bulk form's own fee fields are not among them.
  const fees = page.locator('tbody').getByLabel(/^هزینه ارسال /);
  const original = await fees.evaluateAll((inputs) =>
    inputs.map((input) => ({
      provinceId: Number(input.id.replace('rate-', '')),
      fee: (input as HTMLInputElement).value,
    })),
  );
  expect(original.length).toBeGreaterThanOrEqual(SEED_PROVINCES.length);
  // A fee no province has: a row showing it can only have got it from the apply.
  const applied =
    Math.max(...original.map((row) => Number(toAsciiDigits(row.fee)))) + 1_234;

  const bulkFee = page.locator(
    '[data-umami-event="admin-panel-shipping-bulk-fee"]',
  );
  const apply = page.locator(
    '[data-umami-event="admin-panel-shipping-bulk-apply"]',
  );
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT') writes.push(request.url());
  });

  // From the first click on: if the cancelled confirm ever DID send the write,
  // the fees have moved and the `finally` is what puts them back.
  try {
    // Refused at the field, before any confirm: a dot-grouped `25.000` read as
    // 25 would put 25-Toman shipping on every province.
    const confirms: string[] = [];
    const recordConfirm = (dialog: Dialog) => {
      confirms.push(dialog.message());
      void dialog.dismiss();
    };
    page.on('dialog', recordConfirm);
    await bulkFee.fill('25.000');
    await apply.click();
    await expect(page.getByText(PROVINCE_MESSAGES.fee)).toBeVisible();
    page.off('dialog', recordConfirm);
    expect(confirms).toEqual([]);
    expect(writes).toEqual([]);

    // Cancelled at the confirm: nothing is sent.
    await bulkFee.fill(String(applied));
    page.once('dialog', (dialog) => void dialog.dismiss());
    await apply.click();
    expect(writes).toEqual([]);

    let asked = '';
    page.once('dialog', (dialog) => {
      asked = dialog.message();
      void dialog.accept();
    });
    await apply.click();
    await expect(page.getByText('روی همه اعمال شد')).toBeVisible();
    expect(asked).toContain(formatToman(applied));
    expect(writes).toHaveLength(1);

    // Every row shows it — and still does from a fresh server render, so it is
    // what the database holds, not what the page painted.
    for (const fee of await fees.all()) {
      await expect(fee).toHaveValue(String(applied));
    }
    await page.reload();
    await expect(fees).toHaveCount(original.length);
    for (const fee of await fees.all()) {
      await expect(fee).toHaveValue(String(applied));
    }

    await openCheckout(shopper);
    await passRecipientStep(shopper);
    await shopper
      .locator('[data-umami-event="checkout-province-change"]')
      .selectOption({ label: province });
    await expect(shopper.getByText(formatToman(applied)).first()).toBeVisible();
  } finally {
    // Every province back to its own fee, straight through the API: the other
    // specs charge the seeded fees. All of them are attempted before any failure
    // is reported, so one refused row cannot strand the rest.
    const stranded: number[] = [];
    for (const { provinceId, fee } of original) {
      const response = await page.request.put(apiShippingRatePath(provinceId), {
        data: { fee: Number(toAsciiDigits(fee)) },
      });
      if (!response.ok()) stranded.push(provinceId);
    }
    expect(stranded).toEqual([]);
  }
});

test('a headline an admin edits is what the home page shows', async ({
  page,
  shopper,
}) => {
  await page.goto(adminContentAreaPath('home'));
  const hero = page.locator('form', {
    has: page.getByRole('heading', { name: 'بخش قهرمان' }),
  });
  const headline = hero.getByLabel('سرتیتر', { exact: true });
  const original = await headline.inputValue();
  const edited = `تیتر آزمایشی ${Date.now().toString(36)}`;

  const saveHeadline = async (text: string) => {
    await headline.fill(text);
    await hero.locator('[data-umami-event="admin-panel-content-save"]').click();
    await expect(hero.getByText('ذخیره شد')).toBeVisible();
  };

  await saveHeadline(edited);
  try {
    await shopper.goto(PATHS.HOME);
    await expect(shopper.getByRole('heading', { level: 1 })).toContainText(
      edited,
    );
  } finally {
    await saveHeadline(original);
  }
});

/** The home content's «دسته‌بندی‌ها» block, in whichever tab holds it. */
const homeCategories = (tab: Page) =>
  tab.locator('form', {
    has: tab.getByRole('heading', { name: 'دسته‌بندی‌ها', exact: true }),
  });

const saveHomeCategories = async (tab: Page) => {
  await homeCategories(tab)
    .locator('[data-umami-event="admin-panel-content-save"]')
    .click();
  await expect(homeCategories(tab).getByText('ذخیره شد')).toBeVisible();
};

/** Unticks every home pick the block holds, whatever this database had. */
const untickHomeCategories = async (tab: Page) => {
  const ticked = homeCategories(tab).locator(
    '[data-umami-event="admin-panel-content-home-category-toggle"]:checked',
  );
  while ((await ticked.count()) > 0) await ticked.first().uncheck();
};

type Point = { x: number; y: number };

/** The middle of a box `boundingBox()` returned. */
const centre = (box: Point & { width: number; height: number }): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/**
 * Presses at `from`, slides onto `onto` in twelve steps and lets go, running
 * `midway` while still pressed. With `finger`, a touch through Chrome's own
 * input — Playwright's touchscreen only taps — so the browser, not the spec,
 * decides whether the slide drags the row or scrolls the page. Otherwise the
 * mouse.
 */
async function slide(
  page: Page,
  from: Point,
  onto: Point,
  finger: boolean,
  midway: () => Promise<void>,
) {
  const steps = 12;
  if (!finger) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(onto.x, onto.y, { steps });
    await midway();
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    touchPoints: Point[],
  ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  try {
    await touch('touchStart', [from]);
    for (let step = 1; step <= steps; step++) {
      await touch('touchMove', [
        {
          x: from.x + ((onto.x - from.x) * step) / steps,
          y: from.y + ((onto.y - from.y) * step) / steps,
        },
      ]);
    }
    await midway();
    await touch('touchEnd', []);
  } finally {
    await cdp.detach();
  }
}

test('the home categories an admin picks lead the strip, in the order picked', async ({
  page,
  shopper,
}) => {
  // Two seeded main categories, picked last one first: the strip must follow
  // the picking order, not the display order.
  const [first, second] = [...SEED_CATEGORIES].reverse();

  // This tab holds the saved value untouched. Saving it again at the end puts
  // back exactly what was there, picks and their order included — the API has
  // no read to take a copy from.
  await page.goto(adminContentAreaPath('home'));
  await expect(homeCategories(page)).toBeVisible();

  const editor = await page.context().newPage();
  try {
    await editor.goto(adminContentAreaPath('home'));
    await untickHomeCategories(editor);
    await homeCategories(editor)
      .getByLabel(first.title, { exact: true })
      .check();
    await homeCategories(editor)
      .getByLabel(second.title, { exact: true })
      .check();
    await saveHomeCategories(editor);

    await shopper.goto(PATHS.HOME);
    const tiles = shopper.locator('[data-umami-event="home-category-click"]');
    await expect(tiles.nth(0)).toHaveAttribute(
      'href',
      shopPath({ category: first.slug }),
    );
    await expect(tiles.nth(1)).toHaveAttribute(
      'href',
      shopPath({ category: second.slug }),
    );
  } finally {
    await editor.close();
    await saveHomeCategories(page);
  }
});

test('the home categories an admin drags into order lead the strip in that order', async ({
  page,
  shopper,
  isMobile,
}) => {
  // Ticked in display order, then the second dragged above the first. Tick
  // order and display order both lead with `first`, so only the drag — saved —
  // puts `second` in front.
  const [first, second] = SEED_CATEGORIES;
  const gripOf = (category: { title: string }) => `جابه‌جایی ${category.title}`;

  // The saved value, untouched, to save again at the end — the API has no
  // read. A tab of its own, so the drag runs in `page`, which the fixture
  // watches for console errors and failed requests.
  const snapshot = await page.context().newPage();
  await snapshot.goto(adminContentAreaPath('home'));
  await expect(homeCategories(snapshot)).toBeVisible();

  try {
    await page.goto(adminContentAreaPath('home'));
    const block = homeCategories(page);
    await untickHomeCategories(page);
    await block.getByLabel(first.title, { exact: true }).check();
    await block.getByLabel(second.title, { exact: true }).check();
    const grips = block.locator(
      '[data-umami-event="admin-panel-content-home-category-reorder"]',
    );
    await expect(grips).toHaveCount(2);
    await expect(grips.nth(0)).toHaveAccessibleName(gripOf(first));

    // A real pointer: the second grip dragged onto the first row — a finger at
    // phone width, where only the grip's `touch-none` stops the slide becoming
    // a scroll that cancels the drag, and a mouse on the desktop.
    // `scrollIntoViewIfNeeded` because `boundingBox()` does not scroll.
    await grips.nth(1).scrollIntoViewIfNeeded();
    const from = await grips.nth(1).boundingBox();
    const onto = await grips.nth(0).boundingBox();
    if (!from || !onto) throw new Error('a category grip has no box to drag');
    await slide(page, centre(from), centre(onto), isMobile, async () => {
      // Marked mid-drag, so the count of zero after the release means something.
      await expect(block.locator('[data-category-dragging]')).toHaveCount(1);
    });
    await expect(block.locator('[data-category-dragging]')).toHaveCount(0);
    await expect(grips.nth(0)).toHaveAccessibleName(gripOf(second));

    // The arrow keys, in Chrome. ArrowDown moves the focused grip's own row,
    // the move that drops focus in a browser; the grip that moved has to hold
    // it afterwards. ArrowUp then restores the dragged order.
    await grips.nth(0).focus();
    await page.keyboard.press('ArrowDown');
    await expect(grips.nth(1)).toHaveAccessibleName(gripOf(second));
    await expect(grips.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(grips.nth(0)).toHaveAccessibleName(gripOf(second));
    await expect(grips.nth(0)).toBeFocused();

    await saveHomeCategories(page);
    // Reopened, the editor lists the saved order.
    await page.reload();
    await expect(grips.nth(0)).toHaveAccessibleName(gripOf(second));
    await expect(grips.nth(1)).toHaveAccessibleName(gripOf(first));

    await shopper.goto(PATHS.HOME);
    const tiles = shopper.locator('[data-umami-event="home-category-click"]');
    await expect(tiles.nth(0)).toHaveAttribute(
      'href',
      shopPath({ category: second.slug }),
    );
    await expect(tiles.nth(1)).toHaveAttribute(
      'href',
      shopPath({ category: first.slug }),
    );
  } finally {
    await saveHomeCategories(snapshot);
    await snapshot.close();
  }
});

test('a product an admin picks for the first «انتخاب‌های اسموکی» box is what the home page shows there, and only there', async ({
  page,
  shopper,
}) => {
  await page.goto(adminContentAreaPath('home'));
  const block = page.locator('form', {
    has: page.getByRole('heading', { name: 'انتخاب‌های اسموکی', exact: true }),
  });
  const headline = await block
    .getByLabel('سرتیتر', { exact: true })
    .inputValue();
  const first = block
    .locator('[data-umami-event="admin-panel-content-featured-product-change"]')
    .first();
  const original = await first.inputValue();

  // The seeded family is offered once, by its head's own row — never a
  // member's, whose pick the storefront would silently drop. Matched by id,
  // not by title: the members share the head's title.
  const member = SEED_PRODUCTS.find((product) => product.variantOfSku)!;
  const head = SEED_PRODUCTS.find(
    (product) => product.sku === member.variantOfSku,
  )!;
  const family = (
    (await (
      await page.request.get(`${API_PATHS.PRODUCTS}/${head.slug}`)
    ).json()) as { data: { id: string; variants: { id: string }[] } }
  ).data;
  const offered = await first
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  expect(offered).toContain(family.id);
  for (const variant of family.variants) {
    if (variant.id !== family.id) expect(offered).not.toContain(variant.id);
  }

  // The grid as it stands. The pick is its SECOND card — a product the
  // automatic rule already shows — so a rule that offered a pick again would
  // show it twice.
  await shopper.goto(PATHS.HOME);
  const grid = shopper.locator('section', {
    has: shopper.getByRole('heading', { name: headline, exact: true }),
  });
  const cards = grid.locator('[data-umami-event="product-card-open"]');
  await expect(cards).toHaveCount(FEATURED_COUNT);
  const pick = (await cards.allTextContents())[1];

  const save = async (option: string | { label: string }) => {
    await first.selectOption(option);
    await block
      .locator('[data-umami-event="admin-panel-content-save"]')
      .click();
    await expect(block.getByText('ذخیره شد')).toBeVisible();
  };

  // From the first write on: if the save lands but its confirmation does not,
  // the `finally` still puts box one back.
  try {
    await save({ label: pick });
    await shopper.reload();
    await expect(cards.first()).toHaveText(pick);
    // Only box one changed hands: every other box is still filled, and the
    // pick is not offered a second time by the automatic rule.
    await expect(cards).toHaveCount(FEATURED_COUNT);
    expect(
      (await cards.allTextContents()).filter((title) => title === pick),
    ).toHaveLength(1);
  } finally {
    await save(original);
  }
});

test('the social handles an admin edits are what the footer links to', async ({
  page,
  shopper,
}) => {
  await page.goto(adminContentAreaPath('footer'));
  const block = page.locator('form', {
    has: page.getByRole('heading', { name: 'فوتر' }),
  });
  const dailies = block.getByLabel(/اینستاگرام آموزش و سرگرمی/);
  const telegram = block.getByLabel(/نام کاربری تلگرام/);
  const original = {
    dailies: await dailies.inputValue(),
    telegram: await telegram.inputValue(),
  };
  const save = async (values: typeof original) => {
    await dailies.fill(values.dailies);
    await telegram.fill(values.telegram);
    await block
      .locator('[data-umami-event="admin-panel-content-save"]')
      .click();
    await expect(block.getByText('ذخیره شد')).toBeVisible();
  };

  // Another network's URL is refused on its own field, before anything is sent.
  await dailies.fill('https://t.me/smokeypetshop');
  await block.locator('[data-umami-event="admin-panel-content-save"]').click();
  await expect(block.getByText(/لینک باید آدرس پروفایل/)).toBeVisible();

  // One handle pasted as the profile URL (share token and all), one cleared:
  // the pill links the clean profile, the other pill is gone.
  const handle = `e2e.${Date.now().toString(36)}`;
  const edited = {
    dailies: `https://www.instagram.com/${handle}?stkn=NWkxMDlrYWtqY2Jn`,
    telegram: '',
  };
  await save(edited);
  try {
    // The editor shows what was stored: the bare handle.
    await expect(dailies).toHaveValue(handle);
    await shopper.goto(PATHS.HOME);
    const pill = shopper.locator(
      '[data-umami-event="footer-social-instagram-dailies"]',
    );
    await expect(pill).toHaveAttribute(
      'href',
      `https://instagram.com/${handle}`,
    );
    await expect(pill).toHaveAttribute('target', '_blank');
    await expect(pill).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(
      shopper.locator('[data-umami-event="footer-social-telegram"]'),
    ).toHaveCount(0);
    await expect(
      shopper.locator('[data-umami-event="footer-social-instagram-shop"]'),
    ).toHaveAttribute('href', /^https:\/\/instagram\.com\/./);
  } finally {
    await save(original);
  }
});

test('a card an admin saves is what card-to-card checkout shows', async ({
  page,
  shopper,
}) => {
  await page.goto(adminContentAreaPath('checkout'));
  const block = page.locator('form', {
    has: page.getByRole('heading', { name: 'پرداخت کارت به کارت' }),
  });
  const number = block.getByLabel('شماره کارت ۱', { exact: true });
  const holder = block.getByLabel('نام صاحب کارت ۱', { exact: true });
  const instagram = block.getByLabel(/نام کاربری اینستاگرام/);
  const original = {
    number: await number.inputValue(),
    holder: await holder.inputValue(),
    instagram: await instagram.inputValue(),
  };
  // A letters-only tag: the result page must show no ASCII digit at all.
  const tag = Date.now()
    .toString(36)
    .replace(/\d/g, (d) => 'ghijklmnop'[Number(d)]);
  const edited = {
    number: '6037-9975-1234-5678',
    holder: `آزمایشی ${tag}`,
    instagram: 'smokey.e2e',
  };

  const save = async (values: typeof original) => {
    await number.fill(values.number);
    await holder.fill(values.holder);
    await instagram.fill(values.instagram);
    await block
      .locator('[data-umami-event="admin-panel-content-save"]')
      .click();
    await expect(block.getByText('ذخیره شد')).toBeVisible();
  };

  await save(edited);
  try {
    // The number is stored bare and shown grouped, in Persian digits.
    await expect(number).toHaveValue('6037997512345678');
    const shown = '۶۰۳۷ ۹۹۷۵ ۱۲۳۴ ۵۶۷۸';

    await openCheckout(shopper);
    await reachPayment(shopper);
    await shopper.locator('[data-umami-event="checkout-payment-cod"]').check();
    await expect(shopper.getByText(shown)).toBeVisible();
    await expect(shopper.getByText(edited.holder)).toBeVisible();
    await expect(
      shopper.locator('[data-umami-event="checkout-card-instagram"]'),
    ).toHaveAttribute('href', 'https://instagram.com/smokey.e2e');

    await attachReceipt(shopper);
    await shopper.locator('[data-umami-event="checkout-submit-order"]').click();
    const orderId = await resultOrderId(shopper);
    try {
      // The result page repeats it, for a second transfer.
      await expect(shopper.getByText(shown)).toBeVisible();
      await expect(shopper.getByRole('main')).not.toContainText(/\d/);
    } finally {
      await closeOrder(page, orderId);
    }
  } finally {
    await save(original);
  }
});

test('a destination an admin picks is where the about page button goes', async ({
  page,
  shopper,
}) => {
  const category = SEED_CATEGORIES[0];
  const external = 'https://example.com/e2e-about';

  await page.goto(adminContentAreaPath('about'));
  const block = page.locator('form', {
    has: page.getByRole('heading', { name: 'فراخوان پایانی' }),
  });
  const type = block.locator(
    '[data-umami-event="admin-panel-content-link-type-change"]',
  );
  // Only a button still on its default destination can be put back exactly.
  test.skip(
    (await type.inputValue()) !== '',
    'the about button already has a saved destination',
  );
  const label = await block
    .getByLabel('دکمه فراخوان', { exact: true })
    .inputValue();
  const button = shopper.getByRole('main').getByRole('link', { name: label });

  const save = async () => {
    await block
      .locator('[data-umami-event="admin-panel-content-save"]')
      .click();
    await expect(block.getByText('ذخیره شد')).toBeVisible();
  };

  try {
    // Stored by id, shown as the category's current slug.
    await type.selectOption('shop');
    await block
      .locator('[data-umami-event="admin-panel-content-link-category-change"]')
      .selectOption({ label: category.title });
    await save();
    await shopper.goto(PATHS.ABOUT);
    await expect(button).toHaveAttribute(
      'href',
      shopPath({ category: category.slug }),
    );

    // An external destination opens in a new tab and leaks no opener.
    await type.selectOption('external');
    await block
      .locator('[data-umami-event="admin-panel-content-link-url-input"]')
      .fill(external);
    await save();
    await shopper.reload();
    await expect(button).toHaveAttribute('href', external);
    await expect(button).toHaveAttribute('target', '_blank');
    await expect(button).toHaveAttribute('rel', 'noopener noreferrer');
  } finally {
    await type.selectOption('');
    await save();
  }
});
