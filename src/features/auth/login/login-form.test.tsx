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
import { act, StrictMode } from 'react';
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

  it('keeps every digit when they arrive faster than React re-renders', async () => {
    // Found in the browser, not here: typing the six digits at speed left only
    // the first one in place. Each `onChange` read `code` from its own closure,
    // so six events batched into one render all saw the same empty string and
    // overwrote each other.
    //
    // This fires all six inside a single `act`, which is what batching does —
    // the one-`act`-per-keystroke helper above flushes React between digits and
    // cannot see the bug.
    await arrive();

    await act(async () => {
      for (const [index, digit] of [...'482913'].entries()) {
        fireEvent.change(codeBoxes()[index]!, { target: { value: digit } });
      }
    });

    expect(
      codeBoxes()
        .map((box) => box.value)
        .join(''),
    ).toBe('482913');
    expect(verify).toHaveBeenCalledWith({
      phoneNumber: '+989121234567',
      code: '482913',
    });
  });

  it('fills a box the shopper goes back to, out of order', async () => {
    await arrive();

    await act(async () => {
      fireEvent.change(codeBoxes()[3]!, { target: { value: '9' } });
    });

    expect(codeBoxes()[3]!.value).toBe('9');
    expect(codeBoxes()[0]!.value).toBe('');
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

describe('a whole code arriving in one box', () => {
  // The bug this pins: `onChange` was treated as always-one-character and kept
  // only the last digit of whatever arrived. An OTP autofill — the iOS/Android
  // "from Messages" suggestion, a password manager — delivers the whole code to
  // a single box as a change event and never fires `paste`, so six digits
  // became one, on the exact platform an SMS code is for.
  const arrive = async () => {
    renderForm();
    await requestCodeFor('09121234567');
  };

  const codeValue = () =>
    codeBoxes()
      .map((box) => box.value)
      .join('');

  it('spreads an autofilled code across the boxes', async () => {
    await arrive();

    await act(async () => {
      fireEvent.change(codeBoxes()[0]!, { target: { value: '482913' } });
    });

    expect(codeValue()).toBe('482913');
  });

  it('verifies with the whole autofilled code, not one digit of it', async () => {
    await arrive();

    await act(async () => {
      fireEvent.change(codeBoxes()[0]!, { target: { value: '482913' } });
    });

    expect(verify).toHaveBeenCalledWith({
      phoneNumber: '+989121234567',
      code: '482913',
    });
  });

  it('folds Persian digits from an autofill like any other input', async () => {
    await arrive();

    await act(async () => {
      fireEvent.change(codeBoxes()[0]!, { target: { value: '۴۸۲۹۱۳' } });
    });

    expect(codeValue()).toBe('482913');
  });

  it('never writes past the last box', async () => {
    await arrive();

    await act(async () => {
      fireEvent.change(codeBoxes()[4]!, { target: { value: '482913' } });
    });

    // Two boxes left from index four, so two digits land and no more.
    expect(codeValue()).toBe('48');
    expect(verify).not.toHaveBeenCalled();
  });

  it('still takes a single keystroke one box at a time', async () => {
    await arrive();
    await typeCode('4829');

    expect(codeValue()).toBe('4829');
  });
});

describe('when the server itself fails', () => {
  // A 5xx is not the shopper's mistake. Telling them their phone number is
  // invalid — a number this form validated before sending — sends them off to
  // retype something that was already correct.
  it('does not blame the phone number for a failed send', async () => {
    renderForm();
    sendOtp.mockResolvedValue(failure(500));

    await requestCodeFor('09121234567');

    expect(alert()?.textContent).toContain('ارتباط با سرور');
    expect(alert()?.textContent).not.toContain('معتبر نیست');
  });

  it('does not blame the code for a failed verification', async () => {
    renderForm();
    await requestCodeFor('09121234567');
    verify.mockResolvedValue(failure(503));

    await typeCode('482913');

    expect(alert()?.textContent).toContain('ارتباط با سرور');
  });

  it('still calls a genuine 400 on the phone number what it is', async () => {
    renderForm();
    sendOtp.mockResolvedValue(failure(400));

    await requestCodeFor('09121234567');

    expect(alert()?.textContent).toContain('معتبر نیست');
  });
});

describe('focus follows the step', () => {
  // Changing step swaps the whole form out. Without an explicit move, focus
  // falls to <body>: a keyboard user tabs from the top of the document to
  // reach the field that just appeared, and a screen-reader user is told
  // nothing happened at all. This is the site's only sign-in.
  it('puts the caret in the first code box once a code is sent', async () => {
    renderForm();

    await requestCodeFor('09121234567');

    expect(document.activeElement).toBe(codeBoxes()[0]);
  });

  it('returns focus to the phone field on «ویرایش شماره»', async () => {
    renderForm();
    await requestCodeFor('09121234567');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ویرایش شماره/ }));
    });

    expect(document.activeElement).toBe(phoneBox());
  });

  it('does not steal focus on first render', async () => {
    // A login page that grabs focus on load scrolls the viewport out from
    // under a shopper who is still reading.
    renderForm();

    expect(document.activeElement).toBe(document.body);
  });
});

describe('the code boxes name the error that invalidated them', () => {
  it('points every box at the alert instead of just saying "invalid"', async () => {
    renderForm();
    await requestCodeFor('09121234567');
    verify.mockResolvedValue(failure(400));

    await typeCode('482913');

    const described = codeBoxes()[0]!.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described!)?.textContent).toContain(
      'صحیح نیست',
    );
    for (const box of codeBoxes()) {
      expect(box.getAttribute('aria-invalid')).toBe('true');
      expect(box.getAttribute('aria-describedby')).toBe(described);
    }
  });

  it('drops the association once there is no error to point at', async () => {
    renderForm();
    await requestCodeFor('09121234567');

    expect(codeBoxes()[0]!.getAttribute('aria-describedby')).toBeNull();
  });
});

describe('focus, under StrictMode', () => {
  // `next dev` runs the App Router in StrictMode, which double-invokes mount
  // effects. A `useRef(false)` "have I run before" flag survives between the
  // two passes, so the second pass sees the flag the first one set and treats
  // the mount as a step change — focusing the phone field on page load, in the
  // one environment where it would be noticed. Comparing the previous step
  // instead is idempotent. The plain-render test above cannot see this.
  it('still does not steal focus on load when effects run twice', () => {
    render(
      <StrictMode>
        <LoginForm next="/" />
      </StrictMode>,
    );

    expect(document.activeElement).toBe(document.body);
  });

  it('still moves to the code boxes on a real step change', async () => {
    render(
      <StrictMode>
        <LoginForm next="/" />
      </StrictMode>,
    );

    await requestCodeFor('09121234567');

    expect(document.activeElement).toBe(codeBoxes()[0]);
  });
});

describe('resending a code', () => {
  // The countdown chains a fresh timeout per render, so it has to be advanced
  // a second at a time — one big jump fires only the first link.
  const tick = async (seconds: number) => {
    for (let second = 0; second < seconds; second++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
  };

  it('puts focus back on the boxes the shopper now has to fill', async () => {
    // The pressed button is replaced by the countdown, so without this focus
    // drops to <body> — the same failure the step effect exists to prevent.
    renderForm();
    await requestCodeFor('09121234567');
    await tick(RESEND_SECONDS);

    const button = screen.getByRole('button', { name: /ارسال دوباره/ });
    // A real click focuses what it presses; `fireEvent` does not, and without
    // this the caret is still sitting in box one from the step change and the
    // assertion below passes no matter what the component does.
    button.focus();
    expect(document.activeElement).toBe(button);

    await act(async () => {
      fireEvent.click(button);
    });

    expect(document.activeElement).toBe(codeBoxes()[0]);
  });

  it('starts a countdown from the wait the server reports on a 429', async () => {
    // Otherwise, once the hourly cap is what refused, the countdown has long
    // expired and the button sits enabled — every click repeats the same
    // error with no hint that the wait is now minutes, not seconds. The
    // server computes the exact figure; ignoring it is what leaves a shopper
    // hammering a control that cannot succeed.
    renderForm();
    await requestCodeFor('09121234567');
    await tick(RESEND_SECONDS);
    sendOtp.mockResolvedValue({
      data: null,
      error: { status: 429, retryAfterSeconds: 300 },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ارسال دوباره/ }));
    });

    expect(screen.queryByRole('button', { name: /ارسال دوباره/ })).toBeNull();
    // Five minutes, in the countdown's own format — minutes are not padded.
    expect(screen.getByText('۵:۰۰')).toBeDefined();
  });
});

describe('the staging code echo', () => {
  // On a deployed staging build the code is written to the server log and
  // nowhere else, so the response carries it and the page prints it. In
  // production the field is absent — nothing to render, no branch to disable.
  const echo = (devCode: string) => ({
    data: { message: 'code sent', devCode },
    error: null,
  });

  it('shows the code the server echoed back', async () => {
    sendOtp.mockResolvedValue(echo('482913'));
    renderForm();

    await requestCodeFor('09121234567');

    expect(screen.getByText('482913')).toBeDefined();
  });

  it('shows nothing when the response carries no code — production', async () => {
    renderForm();

    await requestCodeFor('09121234567');

    expect(screen.queryByText(/حالت آزمایشی/)).toBeNull();
  });

  it('replaces the code shown when a resend brings a new one', async () => {
    sendOtp.mockResolvedValue(echo('482913'));
    renderForm();
    await requestCodeFor('09121234567');
    for (let second = 0; second < RESEND_SECONDS; second++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    sendOtp.mockResolvedValue(echo('111111'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ارسال دوباره/ }));
    });

    expect(screen.queryByText('482913')).toBeNull();
    expect(screen.getByText('111111')).toBeDefined();
  });

  it('drops the code when the shopper goes back to edit the number', async () => {
    sendOtp.mockResolvedValue(echo('482913'));
    renderForm();
    await requestCodeFor('09121234567');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ویرایش شماره' }));
    });

    expect(screen.queryByText('482913')).toBeNull();
  });
});
