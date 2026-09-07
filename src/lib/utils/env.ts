export enum VARS {
  APP_CONFIG_DATABASE_URL = 'APP_CONFIG_DATABASE_URL',

  APP_CONFIG_AUTH_SECRET = 'APP_CONFIG_AUTH_SECRET',

  // Which SMS driver `src/lib/sms` dispatches through. `console` (the default)
  // writes codes to the server log instead of sending them — the mock the
  // project ships with until Kavenegar or SMS.ir is picked.
  APP_CONFIG_SMS_PROVIDER = 'APP_CONFIG_SMS_PROVIDER',

  // Which Zarinpal driver `src/lib/zarinpal` dispatches through. `mock` (the
  // default) simulates the whole request/redirect/callback/verify flow locally
  // with no gateway account — the shipped default. The real `zarinpal` v4 HTTP
  // driver is present but inert until this names it AND the merchant id is set.
  APP_CONFIG_ZARINPAL_PROVIDER = 'APP_CONFIG_ZARINPAL_PROVIDER',
  // Zarinpal merchant id — required only when the provider is `zarinpal`.
  APP_CONFIG_ZARINPAL_MERCHANT_ID = 'APP_CONFIG_ZARINPAL_MERCHANT_ID',
  // `true` routes the real driver at Zarinpal's sandbox host instead of live.
  APP_CONFIG_ZARINPAL_SANDBOX = 'APP_CONFIG_ZARINPAL_SANDBOX',

  // Which storage driver `src/lib/storage` dispatches through for product image
  // uploads. `local` (the default) writes files under APP_CONFIG_STORAGE_LOCAL_ROOT
  // and serves them from `/uploads/*` — the shipped default so uploads work on
  // local and test deployments with no object-storage account. The S3-compatible
  // (Arvan/Liara) driver is added when a provider is picked; until then selecting
  // it throws, like the real Zarinpal driver.
  APP_CONFIG_STORAGE_PROVIDER = 'APP_CONFIG_STORAGE_PROVIDER',
  // Filesystem root the `local` driver writes uploads into (and the serving route
  // reads them back from). Relative paths resolve from the process working
  // directory. Defaults to `uploads` at the repo root; keep it out of `public/`
  // and out of git.
  APP_CONFIG_STORAGE_LOCAL_ROOT = 'APP_CONFIG_STORAGE_LOCAL_ROOT',
  // Liara (S3-compatible) object storage — read only when the `s3` driver is
  // selected, and only server-side (`src/lib/storage/s3-driver.ts`). Names follow
  // Liara's platform convention rather than the `APP_CONFIG_` prefix (Benyamin,
  // 2026-09-07). ENDPOINT is the host with no bucket; the public *read* base
  // (bucket appended) is NEXT_PUBLIC_STORAGE_BASE_URL below.
  LIARA_ENDPOINT = 'LIARA_ENDPOINT',
  LIARA_BUCKET_NAME = 'LIARA_BUCKET_NAME',
  LIARA_ACCESS_KEY = 'LIARA_ACCESS_KEY',
  LIARA_SECRET_KEY = 'LIARA_SECRET_KEY',
  // Public read base for uploaded objects, e.g.
  // `https://storage.c2.liara.site/<bucket>`. NEXT_PUBLIC_* is inlined into the
  // client bundle at build time — the browser (the localStorage cart, etc.)
  // resolves image URLs from this, so it must be set at *build* and must equal
  // `${LIARA_ENDPOINT}/${LIARA_BUCKET_NAME}`. Empty ⇒ local-relative `/uploads`.
  NEXT_PUBLIC_STORAGE_BASE_URL = 'NEXT_PUBLIC_STORAGE_BASE_URL',

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
  [VARS.NEXT_PUBLIC_STORAGE_BASE_URL]: process.env.NEXT_PUBLIC_STORAGE_BASE_URL,
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
