export enum VARS {
  APP_CONFIG_DATABASE_URL = 'APP_CONFIG_DATABASE_URL',

  APP_CONFIG_AUTH_SECRET = 'APP_CONFIG_AUTH_SECRET',

  // Which SMS driver `src/lib/sms` dispatches through. `console` (the default)
  // writes codes to the server log instead of sending them — the mock the
  // project ships with until Kavenegar or SMS.ir is picked.
  APP_CONFIG_SMS_PROVIDER = 'APP_CONFIG_SMS_PROVIDER',

  APP_CONFIG_EMAIL_ENABLED = 'APP_CONFIG_EMAIL_ENABLED',
  APP_CONFIG_SMTP_SERVER = 'APP_CONFIG_SMTP_SERVER',
  APP_CONFIG_SMTP_PORT = 'APP_CONFIG_SMTP_PORT',
  APP_CONFIG_SMTP_USER = 'APP_CONFIG_SMTP_USER',
  APP_CONFIG_SMTP_PASSWORD = 'APP_CONFIG_SMTP_PASSWORD',
  APP_CONFIG_SMTP_SENDER_EMAIL = 'APP_CONFIG_SMTP_SENDER_EMAIL',

  NODE_ENV = 'NODE_ENV',
  NEXT_PUBLIC_APP_URL = 'NEXT_PUBLIC_APP_URL',
}

type Func = {
  (key: VARS, required: true): string;
  (key: VARS, required: false, defaultValue: string): string;
};

// NODE_ENV and NEXT_PUBLIC_* vars must use static dot-access so the bundler
// can inline them in the browser bundle at build time. Dynamic process.env[key]
// is not statically replaced and would be undefined on the client.
// Add any new NEXT_PUBLIC_* VARS entries here.
const STATIC_INLINED_VARS: Partial<Record<VARS, string | undefined>> = {
  [VARS.NODE_ENV]: process.env.NODE_ENV,
  [VARS.NEXT_PUBLIC_APP_URL]: process.env.NEXT_PUBLIC_APP_URL,
};

export const getEnvVariable: Func = (
  key: VARS,
  required: boolean,
  defaultValue?: string,
) => {
  const result =
    key in STATIC_INLINED_VARS ? STATIC_INLINED_VARS[key] : process.env[key];

  if (required && !result) {
    throw Error(`Environment variable ${key} is required and not set`);
  }

  return result ?? defaultValue!;
};

export const isDevelopmentServer = () => {
  return getEnvVariable(VARS.NODE_ENV, false, '') === 'development';
};

export const getAppBaseUrl = () => {
  const url = getEnvVariable(VARS.NEXT_PUBLIC_APP_URL, false, '');
  if (url) return url;

  // No silent localhost fallback in production. Better Auth derives both its
  // trusted origins (its CSRF check) and the `Secure` flag on the session
  // cookie from this URL — an unset value there would ship admin sessions on a
  // non-secure cookie and reject the real origin. NEXT_PUBLIC_* is inlined at
  // build time, so this has to be set as a build arg, not at container start.
  if (getEnvVariable(VARS.NODE_ENV, false, '') === 'production') {
    throw Error(
      `Environment variable ${VARS.NEXT_PUBLIC_APP_URL} is required in production`,
    );
  }

  return 'http://localhost:3000';
};
