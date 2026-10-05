// The storage seam — one typed interface, drivers chosen by env, exactly like
// the SMS (`src/lib/sms`) and Zarinpal (`src/lib/zarinpal/client.ts`) seams.
// The `local` driver is the shipped default so product-image upload works with
// no object-storage account; the S3-compatible (Arvan/Liara) driver slots in
// behind this same interface when a provider is picked — a provider-env change
// and nothing else, no caller above the seam sees the difference.
//
// **Nothing above this seam knows where an image physically lives.** Callers
// store the opaque object key `put` was given and render it through `url(key)`;
// the driver owns the URL↔location mapping.
import {
  getEnvProvider,
  getEnvVariable,
  isDevelopmentServer,
  VARS,
} from '@/lib/utils/env';
import { warnOnce } from '@/lib/warn-once';
import { localDriver } from './local-driver';
import { s3Driver } from './s3-driver';

/**
 * Everything a storage provider must do. `put` takes the server-generated key
 * (never a client filename), the bytes, and the sniffed content type (the S3
 * driver sends it; the local driver derives type from the extension instead).
 * `get` reads an object back with the app's own access — `null` when it is
 * gone. `url` resolves a stored key to something the browser can load, and
 * THROWS on a receipt key: a receipt has no public URL, only the authenticated
 * receipt routes, which read it through `get`.
 */
export type StorageDriver = {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  url(key: string): string;
};

export { ReceiptExposedError } from './s3-driver';

/** Providers with a driver behind them. Arvan/Liana's `s3` joins this list. */
export const STORAGE_PROVIDERS = ['local', 's3'] as const;

export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

const DEFAULT_PROVIDER: StorageProvider = 'local';

// Factory per provider, so a driver that reads its own env (the future S3 one:
// bucket, endpoint, keys) does so only when actually selected — the local
// default never touches S3 config, mirroring the Zarinpal seam.
const DRIVERS: Record<StorageProvider, () => StorageDriver> = {
  local: () => localDriver,
  // The S3-compatible (Liara/Arvan) driver. It reads its own env lazily on first
  // use, so returning it here touches no S3 config — `next build` and the `local`
  // default never construct a client.
  s3: () => {
    warnIfMissingPublicBase();
    return s3Driver;
  },
};

// `s3` writes to the bucket at runtime, but the browser resolves read URLs from
// the build-time NEXT_PUBLIC_STORAGE_BASE_URL. If that is unset while `s3` is the
// provider, uploads succeed but render as broken `/uploads/*` local paths — warn
// loudly once rather than fail silently.
const warnIfMissingPublicBase = () => {
  if (getEnvVariable(VARS.NEXT_PUBLIC_STORAGE_BASE_URL, false, '').trim())
    return;
  warnOnce(
    'storage-public-base',
    `[storage] APP_CONFIG_STORAGE_PROVIDER is "s3" but ` +
      `${VARS.NEXT_PUBLIC_STORAGE_BASE_URL} is unset: uploads will be stored in ` +
      'the bucket but rendered as broken local URLs. Set it (at build time) to ' +
      "the bucket's public base, e.g. https://<endpoint>/<bucket>.",
  );
};

const warnIfLocal = () => {
  if (isDevelopmentServer()) return;
  warnOnce(
    'storage-local',
    '[storage] APP_CONFIG_STORAGE_PROVIDER is "local": uploaded images are ' +
      'stored on the local filesystem, which does not survive a redeploy on ' +
      'ephemeral hosting. Intended for local/test deployments — set the ' +
      'S3-compatible provider before taking real uploads.',
  );
};

/**
 * The configured provider, validated: an unknown name throws rather than
 * defaulting to local, which would store uploads somewhere they will be lost.
 */
export const getStorageProvider = (): StorageProvider =>
  getEnvProvider(
    VARS.APP_CONFIG_STORAGE_PROVIDER,
    STORAGE_PROVIDERS,
    DEFAULT_PROVIDER,
  );

/** The configured driver. Selecting `local` outside development shouts once. */
export function getStorageDriver(): StorageDriver {
  const provider = getStorageProvider();
  if (provider === 'local') warnIfLocal();
  return DRIVERS[provider]();
}
