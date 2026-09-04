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
import { getEnvVariable, isDevelopmentServer, VARS } from '@/lib/utils/env';
import { localDriver } from './local-driver';

/**
 * Everything a storage provider must do. `put` takes the server-generated key
 * (never a client filename), the bytes, and the sniffed content type (the S3
 * driver sends it; the local driver derives type from the extension instead).
 * `url` resolves a stored key to something the browser can load.
 */
export type StorageDriver = {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  url(key: string): string;
};

/** Providers with a driver behind them. Arvan/Liana's `s3` joins this list. */
export const STORAGE_PROVIDERS = ['local', 's3'] as const;

export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

const DEFAULT_PROVIDER: StorageProvider = 'local';

// Factory per provider, so a driver that reads its own env (the future S3 one:
// bucket, endpoint, keys) does so only when actually selected — the local
// default never touches S3 config, mirroring the Zarinpal seam.
const DRIVERS: Record<StorageProvider, () => StorageDriver> = {
  local: () => localDriver,
  s3: () => {
    // Present as a selectable name so the seam is complete, but inert until a
    // provider is picked — selecting it is a loud failure, never a silent
    // fall-back to local that would strand uploads on an ephemeral disk.
    throw new Error(
      `${VARS.APP_CONFIG_STORAGE_PROVIDER}="s3" has no driver yet. ` +
        'The S3-compatible (Arvan/Liara) driver is added when a provider is ' +
        'picked; use "local" until then.',
    );
  },
};

let localWarningLogged = false;

const warnIfLocal = () => {
  if (isDevelopmentServer() || localWarningLogged) return;
  localWarningLogged = true;
  console.warn(
    '[storage] APP_CONFIG_STORAGE_PROVIDER is "local": uploaded images are ' +
      'stored on the local filesystem, which does not survive a redeploy on ' +
      'ephemeral hosting. Intended for local/test deployments — set the ' +
      'S3-compatible provider before taking real uploads.',
  );
};

/**
 * The configured provider name, validated. An unrecognized value throws rather
 * than defaulting to local: naming a provider whose driver is not wired yet must
 * fail loudly, not silently store uploads somewhere they will be lost.
 */
export function getStorageProvider(): StorageProvider {
  // `||` not `??`: an empty value (the var left blank) is an unset one.
  const configured =
    getEnvVariable(
      VARS.APP_CONFIG_STORAGE_PROVIDER,
      false,
      DEFAULT_PROVIDER,
    ).trim() || DEFAULT_PROVIDER;

  // `Object.hasOwn`, not truthiness — inherited members must not resolve as
  // drivers (see the identical guard in the SMS/Zarinpal seams).
  if (!Object.hasOwn(DRIVERS, configured)) {
    throw new Error(
      `${VARS.APP_CONFIG_STORAGE_PROVIDER}="${configured}" has no driver. ` +
        `Known providers: ${STORAGE_PROVIDERS.join(', ')}.`,
    );
  }
  return configured as StorageProvider;
}

/** The configured driver. Selecting `local` outside development shouts once. */
export function getStorageDriver(): StorageDriver {
  const provider = getStorageProvider();
  if (provider === 'local') warnIfLocal();
  return DRIVERS[provider]();
}
