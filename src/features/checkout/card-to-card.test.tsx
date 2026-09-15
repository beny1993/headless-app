// The card panel's two rules that no schema test can reach: the raw ASCII
// number never renders as text (the result page asserts `main` has no ASCII
// digit) yet is what the copy button puts on the clipboard, and a link is built
// from a bare handle. Empty slots and empty handles render nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import {
  CardToCardPanel,
  type CardToCardContent,
  formatCardNumber,
} from './card-to-card';

const base = DEFAULT_CONTENT['checkout.payment'];
const empty: CardToCardContent = {
  ...base,
  bankCards: [
    { bank: '', number: '', holder: '' },
    { bank: '', number: '', holder: '' },
    { bank: '', number: '', holder: '' },
  ],
};
const filled: CardToCardContent = {
  ...base,
  bankCards: [
    { bank: 'ملت', number: '6037997512345678', holder: 'سارا محمدی' },
    { bank: '', number: '', holder: '' },
    { bank: '', number: '', holder: '' },
  ],
  instagram: 'smokey.shop',
  telegram: 'smokey_shop',
};

afterEach(cleanup);

describe('formatCardNumber', () => {
  it('groups by four in Persian digits', () => {
    expect(formatCardNumber('6037997512345678')).toBe('۶۰۳۷ ۹۹۷۵ ۱۲۳۴ ۵۶۷۸');
  });
});

describe('CardToCardPanel', () => {
  it('shows only the filled slot, in Persian digits, and copies the ASCII number', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    try {
      const { container } = render(<CardToCardPanel payment={filled} />);

      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(screen.getByText('۶۰۳۷ ۹۹۷۵ ۱۲۳۴ ۵۶۷۸')).toBeTruthy();
      expect(screen.getByText('ملت · سارا محمدی')).toBeTruthy();
      expect(container.textContent).not.toMatch(/\d/);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'کپی شماره کارت' }));
      });
      expect(writeText).toHaveBeenCalledWith('6037997512345678');
      expect(screen.getByText('کپی شد')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('links Instagram and Telegram from bare handles, in a new tab', () => {
    render(<CardToCardPanel payment={filled} />);
    const instagram = screen.getByRole('link', { name: 'اینستاگرام' });
    const telegram = screen.getByRole('link', { name: 'تلگرام' });
    expect(instagram.getAttribute('href')).toBe(
      'https://instagram.com/smokey.shop',
    );
    expect(telegram.getAttribute('href')).toBe('https://t.me/smokey_shop');
    for (const link of [instagram, telegram]) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('renders the note and the contact sentence, but no card and no link, when nothing is set', () => {
    render(<CardToCardPanel payment={empty} />);
    expect(screen.getByText(base.note)).toBeTruthy();
    expect(screen.getByText(/اینستاگرام یا تلگرام/)).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
