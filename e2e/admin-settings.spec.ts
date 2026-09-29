import type { Dialog } from '@playwright/test';
import { SEED_CATEGORIES } from '@/db/seed/catalog-data';
import { SEED_PROVINCES } from '@/db/seed/shipping-data';
import {
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

    // The result page repeats it: that is where the shopper pays from.
    await shopper.locator('[data-umami-event="checkout-submit-order"]').click();
    await resultOrderId(shopper);
    await expect(shopper.getByText(shown)).toBeVisible();
    await expect(shopper.getByRole('main')).not.toContainText(/\d/);
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
