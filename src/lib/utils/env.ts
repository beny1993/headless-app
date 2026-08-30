export enum VARS {
  APP_CONFIG_DATABASE_URL = 'APP_CONFIG_DATABASE_URL',

  APP_CONFIG_AUTH_SECRET = 'APP_CONFIG_AUTH_SECRET',

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

export const getAppBaseUrl = () =>
  getEnvVariable(VARS.NEXT_PUBLIC_APP_URL, false, 'http://localhost:3000');
