// Route paths — never hardcode route strings in components or handlers;
// import from here so renames stay one-line changes.

export const PATHS = {
  HOME: '/',
  SHOP: '/shop',
  ABOUT: '/about',
  ACCOUNT: '/account',
} as const;

export const AUTH_PATHS = {
  SIGNIN: '/auth/signin',
  MAGIC: '/auth/magic',
} as const;

export const PROTECTED_PATHS = {
  INDEX: '/backoffice',
} as const;

export const API_PATHS = {
  DOC: '/api/doc',
  REFERENCE: '/api/reference',
  HEALTH: '/api/health',
} as const;
