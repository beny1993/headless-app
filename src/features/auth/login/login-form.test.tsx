// The login flow's correctness lives in wiring, not in a function: which step
// is on screen, what the six boxes do to one string of state, when the resend
// button comes back, and what a failed request leaves behind. None of that is
// reachable from a unit test — the AGENTS.md rule for when a client component
// must get one of these.
//
// Mocked at the module edge only: `authClient` is the network, `useRouter` is
// the navigation. `normalizeIranPhone` and the countdown run for real, because
// they are the two things most worth pinning — a request carrying `0912…`
// instead of `+98912…` would silently open a second account for one person.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from './login-form';

const { sendOtp, verify, push, refresh } = vi.hoisted(() => ({
  sendOtp: vi.fn(),
  verify: vi.fn(),
  push: vi.fn<(href: string) => void>(),
  refresh: vi.fn(),
}));

vi.mock('@/lib/auth/client', () => ({
  authClient: { phoneNumber: { sendOtp, verify } },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

/** The component's own countdown. A change to it is a change in behaviour. */
const RESEND_SECONDS = 120;

const ok = { data: {}, error: null };
const failure = (status: number) => ({ data: null, error: { status } });

const phoneBox = () =>
  screen.getByLabelText('شماره موبایل') as HTMLInputElement;
const codeBoxes = () =>
  screen.getAllByLabelText(/رقم .* از کد تایید/) as HTMLInputElement[];
const requestButton = () => screen.getByRole('button', { name: /دریافت کد/ });
const alert = () => screen.queryByRole('alert');

/** Type a number and ask for a code, awaiting the request the click starts. */
const requestCodeFor = async (typed: string) => {
  fireEvent.change(phoneBox(), { target: { value: typed } });
  await act(async () => {
    fireEvent.click(requestButton());
  });
};

/** Fill the boxes one keystroke at a time, as a shopper does. */
const typeCode = async (digits: string) => {
  for (const [index, digit] of [...digits].entries()) {
    await act(async () => {
      fireEvent.change(codeBoxes()[index]!, { target: { value: digit } });
    });
  }
};

beforeEach(() => {
  // Only the countdown's own timer. Faking React 19's scheduling as well is
  // where this suite would start flaking (AGENTS.md).
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.clearAllMocks();
  sendOtp.mockResolvedValue(ok);
  verify.mockResolvedValue(ok);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderForm = (next = '/') => render(<LoginForm next={next} />);

describe('step one: the phone number', () => {
  it('starts on the phone step', () => {
    renderForm();

    expect(phoneBox()).toBeDefined();
    expect(screen.queryAllByLabelText(/رقم .* از کد تایید/)).toHaveLength(0);
  });

  it('moves to the code step once a code is sent', () => {
    renderForm();

    return requestCodeFor('09121234567').then(() => {
      expect(codeBoxes()).toHaveLength(6);
    });
  });

  it('sends the canonical form, not what was typed', async () => {
    // The API accepts `+989xxxxxxxxx` and nothing else. If this ever sent the
    // raw string, a shopper typing the local form would be told their own
    // number is invalid.
    renderForm();

    await requestCodeFor('09121234567');

    expect(sendOtp).toHaveBeenCalledWith({ phoneNumber: '+989121234567' });
  });

  it('normalizes Persian digits before sending', async () => {
    renderForm();

    await requestCodeFor('۰۹۱۲۱۲۳۴۵۶۷');

    expect(sendOtp).toHaveBeenCalledWith({ phoneNumber: '+989121234567' });
  });

  it('normalizes a number written with spaces', async () => {
    renderForm();

    await requestCodeFor('0912 123 4567');

    expect(sendOtp).toHaveBeenCalledWith({ phoneNumber: '+989121234567' });
  });

  it('refuses a landline without spending a request', async () => {
    renderForm();

    await requestCodeFor('02112345678');

    expect(sendOtp).not.toHaveBeenCalled();
    expect(alert()?.textContent).toContain('موبایل');
  });

  it('stays on the phone step when the number is rejected', async () => {
    renderForm();

    await requestCodeFor('0912');

    expect(phoneBox()).toBeDefined();
  });

  it('marks the field invalid for a screen reader', async () => {
    renderForm();

    await requestCodeFor('02112345678');

    expect(phoneBox().getAttribute('aria-invalid')).toBe('true');
  });

  it('clears the error as soon as the shopper edits the number', async () => {
    renderForm();
    await requestCodeFor('02112345678');

    fireEvent.change(phoneBox(), { target: { value: '0912' } });

    expect(alert()).toBeNull();
  });

  it('stays put and explains when the server throttles the send', async () => {
    sendOtp.mockResolvedValue(failure(429));
    renderForm();

    await requestCodeFor('09121234567');

    expect(screen.queryAllByLabelText(/رقم .* از کد تایید/)).toHaveLength(0);
    expect(alert()?.textContent).toContain('صبر');
  });

  it('explains a dropped connection rather than looking stuck', async () => {
    sendOtp.mockRejectedValue(new Error('offline'));
    renderForm();

    await requestCodeFor('09121234567');

    expect(alert()?.textContent).toContain('ارتباط');
  });
});

describe('step two: the code', () => {
  const arrive = async () => {
    renderForm();
    await requestCodeFor('09121234567');
  };

  it('shows the number the code went to, in the readable local form', async () => {
    await arrive();

    // `+989121234567` is what the server stores; `۰۹۱۲۱۲۳۴۵۶۷` is what the
    // shopper recognizes as their own number.
    expect(document.body.textContent).toContain('۰۹۱۲۱۲۳۴۵۶۷');
  });

  it('fills one box per digit typed', async () => {
    await arrive();

    await typeCode('482');

    expect(codeBoxes().map((box) => box.value)).toEqual([
      '4',
      '8',
      '2',
      '',
      '',
      '',
    ]);
  });

  it('folds Persian digits typed into the boxes', async () => {
    // A Persian keyboard is the default on an Iranian phone; the verify
    // endpoint compares against ASCII.
    await arrive();

    await typeCode('۴۸۲۹۱۳');

    expect(verify).toHaveBeenCalledWith({
      phoneNumber: '+989121234567',
      code: '482913',
    });
  });

  it('ignores a letter rather than putting it in a box', async () => {
    await arrive();

    await typeCode('4');
    await act(async () => {
      fireEvent.change(codeBoxes()[1]!, { target: { value: 'x' } });
    });

    expect(codeBoxes()[1]!.value).toBe('');
  });

  it('verifies on its own once the sixth digit lands', async () => {
    await arrive();

    await typeCode('482913');

    expect(verify).toHaveBeenCalledWith({
      phoneNumber: '+989121234567',
      code: '482913',
    });
  });

  it('accepts a pasted code', async () => {
    await arrive();

    await act(async () => {
      fireEvent.paste(codeBoxes()[0]!, {
        clipboardData: { getData: () => '482913' },
      });
    });

    expect(
      codeBoxes()
        .map((box) => box.value)
        .join(''),
    ).toBe('482913');
    expect(verify).toHaveBeenCalled();
  });

  it('takes only the digits out of a pasted SMS', async () => {
    await arrive();

    await act(async () => {
      fireEvent.paste(codeBoxes()[0]!, {
        clipboardData: { getData: () => 'کد ورود شما به اسموکی: 482913' },
      });
    });

    expect(
      codeBoxes()
        .map((box) => box.value)
        .join(''),
    ).toBe('482913');
  });

  it('sends the shopper on to where they were going', async () => {
    renderForm('/admin-panel');
    await requestCodeFor('09121234567');

    await typeCode('482913');

    expect(push).toHaveBeenCalledWith('/admin-panel');
  });

  it('re-fetches the tree so the navbar notices the session', async () => {
    await arrive();

    await typeCode('482913');

    expect(refresh).toHaveBeenCalled();
  });

  it('goes back to the phone step, cleared, on «ویرایش شماره»', async () => {
    await arrive();
    await typeCode('4829');

    fireEvent.click(screen.getByRole('button', { name: 'ویرایش شماره' }));

    expect(phoneBox()).toBeDefined();
  });
});

describe('a code that does not work', () => {
  const arriveAndFail = async (status: number) => {
    renderForm();
    await requestCodeFor('09121234567');
    verify.mockResolvedValue(failure(status));
    await typeCode('482913');
  };

  it('says the code is wrong', async () => {
    await arriveAndFail(400);

    expect(alert()?.textContent).toContain('صحیح نیست');
  });

  it('empties the boxes so the next attempt starts clean', async () => {
    // Leaving the wrong digits in place means the shopper has to clear six
    // boxes by hand before they can retry.
    await arriveAndFail(400);

    expect(
      codeBoxes()
        .map((box) => box.value)
        .join(''),
    ).toBe('');
  });

  it('navigates nowhere', async () => {
    await arriveAndFail(400);

    expect(push).not.toHaveBeenCalled();
  });

  it('marks the boxes invalid for a screen reader', async () => {
    await arriveAndFail(400);

    expect(codeBoxes()[0]!.getAttribute('aria-invalid')).toBe('true');
  });

  it('says the attempts ran out when the code has been killed', async () => {
    // A 403 is the plugin's attempt budget: the code is gone, and telling the
    // shopper to "check the code" would send them back to a dead one.
    await arriveAndFail(403);

    expect(alert()?.textContent).toContain('تلاش');
  });

  it('says to wait when the verify endpoint is rate limited', async () => {
    await arriveAndFail(429);

    expect(alert()?.textContent).toContain('صبر');
  });
});

describe('the resend countdown', () => {
  const arrive = async () => {
    renderForm();
    await requestCodeFor('09121234567');
  };

  /**
   * One second at a time, awaiting React between each.
   *
   * The countdown chains a fresh `setTimeout` from an effect after every tick,
   * so a single jump of N seconds fires the one timer that is currently
   * pending and no more — the next is not scheduled until React has
   * re-rendered.
   */
  const tick = async (seconds: number) => {
    for (let second = 0; second < seconds; second++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
  };

  it('starts counting instead of offering a resend', async () => {
    await arrive();

    expect(screen.queryByRole('button', { name: /ارسال دوباره/ })).toBeNull();
    expect(document.body.textContent).toContain('۲:۰۰');
  });

  it('counts down in Persian digits', async () => {
    await arrive();

    await tick(30);

    expect(document.body.textContent).toContain('۱:۳۰');
  });

  it('pads the seconds so it never reads ۱:۵', async () => {
    await arrive();

    await tick(115);

    expect(document.body.textContent).toContain('۰:۰۵');
  });

  it('offers the resend once the countdown reaches zero', async () => {
    await arrive();

    await tick(RESEND_SECONDS);

    expect(screen.getByRole('button', { name: /ارسال دوباره/ })).toBeDefined();
  });

  it('waits longer than the server does before offering it', async () => {
    // The server's cooldown is 90s. A button that appears at, say, 60s is a
    // button that reliably answers 429.
    await arrive();

    await tick(90);

    expect(screen.queryByRole('button', { name: /ارسال دوباره/ })).toBeNull();
  });

  it('sends to the same number, and restarts the clock', async () => {
    await arrive();
    await tick(RESEND_SECONDS);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ارسال دوباره/ }));
    });

    expect(sendOtp).toHaveBeenLastCalledWith({ phoneNumber: '+989121234567' });
    expect(screen.queryByRole('button', { name: /ارسال دوباره/ })).toBeNull();
  });

  it('clears the old code when a new one is sent', async () => {
    await arrive();
    await typeCode('4829');
    await tick(RESEND_SECONDS);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ارسال دوباره/ }));
    });

    expect(
      codeBoxes()
        .map((box) => box.value)
        .join(''),
    ).toBe('');
  });

  it('keeps the shopper on the code step when a resend is throttled', async () => {
    await arrive();
    await tick(RESEND_SECONDS);
    sendOtp.mockResolvedValue(failure(429));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ارسال دوباره/ }));
    });

    expect(codeBoxes()).toHaveLength(6);
    expect(alert()?.textContent).toContain('صبر');
  });
});
