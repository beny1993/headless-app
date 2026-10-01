/**
 * Narrows the bucket's anonymous read to `uploads/` — the product photos — so
 * that the card-to-card receipts under `receipts/` are readable only with the
 * app's key (through the authenticated receipt routes).
 *
 *   pnpm bucket-policy            # dry run: checks the bucket, prints the policy
 *   pnpm bucket-policy --apply    # sets it — LIVE, see below
 *
 * **Staging and production share this bucket: `--apply` changes production the
 * moment it succeeds.** It is Benyamin's to run, or the developer's with his
 * explicit go at that moment — never an agent's on its own. The procedure
 * (docs/DEPLOY.md §3):
 *
 *   1. The pre-check lists every object and refuses while any sits outside
 *      `uploads/` and `receipts/`: it would go dark for every shopper. A listing
 *      that is truncated with no continuation token is refused outright. Then
 *      the bucket's current policy is printed, before the proposed one.
 *   2. `PutBucketPolicy` — one statement, `s3:GetObject` for anyone on
 *      `arn:aws:s3:::<bucket>/uploads/*`, nothing else.
 *   3. `GetBucketPolicy` read back and compared: some endpoints accept a policy
 *      and silently drop a prefix.
 *   4. Then `pnpm verify-s3`, which proves both halves from outside.
 *
 * Liara documents only a whole-bucket public/private switch; a bucket policy is
 * an undocumented capability of its S3 endpoint, so step 2 may be refused
 * (`NotImplemented`/`AccessDenied`) — then the fallback is app-side encryption
 * of each receipt (design note §1e). Rollback if product photos stop loading:
 * set the bucket public again in the Liara panel. Never flip that toggle
 * otherwise: it restores whole-bucket public read, and every receipt upload is
 * then refused by the driver's probe until this is re-applied.
 *
 * Requires, in `.env`: LIARA_ENDPOINT, LIARA_BUCKET_NAME, LIARA_ACCESS_KEY,
 * LIARA_SECRET_KEY.
 */
import './load-env';
import { pathToFileURL } from 'node:url';
import {
  GetBucketPolicyCommand,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import {
  RECEIPT_KEY_PREFIX,
  UPLOAD_KEY_PREFIX,
} from '@/lib/storage/image-upload';

/** The one statement the bucket should carry. */
export const buildReadPolicy = (bucket: string): string =>
  JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/${UPLOAD_KEY_PREFIX}/*`],
      },
    ],
  });

/** Objects the rule would take dark: anything not a photo and not a receipt. */
export const findOffenders = (keys: readonly string[]): string[] =>
  keys.filter(
    (key) =>
      !key.startsWith(`${UPLOAD_KEY_PREFIX}/`) &&
      !key.startsWith(`${RECEIPT_KEY_PREFIX}/`),
  );

type Statement = {
  Effect?: unknown;
  Principal?: unknown;
  Action?: unknown;
  Resource?: unknown;
};

const asSortedList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).map(String).sort();

/** `"*"`, `{ AWS: "*" }` and `{ AWS: ["*"] }` all mean anyone. */
const principalOf = (principal: unknown): string => {
  const aws =
    typeof principal === 'object' && principal !== null
      ? (principal as { AWS?: unknown }).AWS
      : principal;
  const list = asSortedList(aws);
  return list.length === 1 && list[0] === '*' ? '*' : JSON.stringify(principal);
};

/** A policy's statements as comparable strings: meaning, not spelling. */
const normalize = (policy: string): string[] => {
  const { Statement } = JSON.parse(policy) as {
    Statement?: Statement | Statement[];
  };
  const statements =
    Statement === undefined
      ? []
      : Array.isArray(Statement)
        ? Statement
        : [Statement];
  return statements
    .map((statement) =>
      JSON.stringify([
        statement.Effect,
        principalOf(statement.Principal),
        asSortedList(statement.Action),
        asSortedList(statement.Resource),
      ]),
    )
    .sort();
};

/**
 * Whether what the endpoint stored grants exactly what was sent. Compared by
 * meaning, not by bytes: endpoints drop a Sid, wrap the principal, or turn a
 * one-item list into a string — and that is fine. A different resource, an
 * extra statement or no policy at all is not.
 */
export const samePolicy = (sent: string, readBack: string | undefined) => {
  if (!readBack) return false;
  try {
    return (
      JSON.stringify(normalize(sent)) === JSON.stringify(normalize(readBack))
    );
  } catch {
    return false;
  }
};

type Sender = { send: (command: never) => Promise<unknown> };

/** Every key in the bucket, all pages. */
const listKeys = async (client: Sender, bucket: string) => {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = (await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: token,
      }) as never,
    )) as {
      Contents?: { Key?: string }[];
      IsTruncated?: boolean;
      NextContinuationToken?: string;
    };
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    if (page.IsTruncated && !page.NextContinuationToken) {
      // An endpoint that says «more» without saying where: an object on the
      // unread pages would go dark unseen, so the bucket is not judged at all.
      throw new Error(
        `the listing of ${bucket} is truncated but gives no continuation token; ` +
          'refusing to judge the bucket on part of it',
      );
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
};

/** The bucket's policy as it stands, for the operator to see before any change. */
const currentPolicy = async (client: Sender, bucket: string) => {
  try {
    const { Policy } = (await client.send(
      new GetBucketPolicyCommand({ Bucket: bucket }) as never,
    )) as { Policy?: string };
    return Policy ? JSON.stringify(JSON.parse(Policy), null, 2) : '(none)';
  } catch (cause) {
    return (cause as Error).name === 'NoSuchBucketPolicy'
      ? '(none)'
      : `(could not be read: ${(cause as Error).name})`;
  }
};

type Options = {
  client: Sender;
  bucket: string;
  apply: boolean;
  log: (line: string) => void;
  error: (line: string) => void;
};

/**
 * The procedure above, against any client. Resolves `true` when the bucket is
 * (or, on a dry run, may be) given the policy; `false` when it must not be, the
 * endpoint would not keep it, or anything on the way failed. A failure is
 * reported by its name and message alone: the AWS SDK copies every field of
 * the endpoint's error answer onto the error it throws
 * (`decorateServiceException`), and for a refused key or signature that answer
 * can carry the key's id and the string that was signed.
 */
export const setBucketPolicy = (options: Options): Promise<boolean> =>
  procedure(options).catch((cause: unknown) => {
    options.error(
      `✗ failed: ${(cause as Error).name}: ${(cause as Error).message}`,
    );
    return false;
  });

async function procedure({
  client,
  bucket,
  apply,
  log,
  error,
}: Options): Promise<boolean> {
  const keys = await listKeys(client, bucket);
  const offenders = findOffenders(keys);
  log(`→ ${keys.length} objects in ${bucket}`);
  if (offenders.length > 0) {
    error(
      `✗ ${offenders.length} objects sit outside ${UPLOAD_KEY_PREFIX}/ and ` +
        `${RECEIPT_KEY_PREFIX}/ and would go dark for everyone:\n` +
        offenders.map((key) => `  ${key}`).join('\n'),
    );
    return false;
  }

  // What is being replaced, then what replaces it — in both modes, so the
  // operator can keep a copy of what the change replaces.
  log(`→ current policy\n${await currentPolicy(client, bucket)}`);
  const policy = buildReadPolicy(bucket);
  log(`→ proposed policy\n${JSON.stringify(JSON.parse(policy), null, 2)}`);
  if (!apply) {
    log('\n(dry run) nothing was changed. Re-run with --apply to set it.');
    return true;
  }

  try {
    await client.send(
      new PutBucketPolicyCommand({ Bucket: bucket, Policy: policy }) as never,
    );
  } catch (cause) {
    error(
      `✗ the endpoint refused the policy (${(cause as Error).name}: ` +
        `${(cause as Error).message}). Bucket policies are not available ` +
        'here — use the encryption fallback (design note §1e).',
    );
    return false;
  }

  const stored = (
    (await client.send(
      new GetBucketPolicyCommand({ Bucket: bucket }) as never,
    )) as { Policy?: string }
  ).Policy;
  if (!samePolicy(policy, stored)) {
    error(
      `✗ the endpoint stored something else:\n${stored ?? '(no policy)'}\n` +
        'Roll back (bucket public in the Liara panel) and use the encryption ' +
        'fallback (design note §1e).',
    );
    return false;
  }

  log('✓ policy set and read back. Now run `pnpm verify-s3`.');
  return true;
}

// Run only as a script (`pnpm bucket-policy`), never on import by its test.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { getS3Client } = await import('@/lib/storage/s3-driver');
  const { client, bucket } = getS3Client();
  const ok = await setBucketPolicy({
    client,
    bucket,
    apply: process.argv.includes('--apply'),
    log: console.log,
    error: console.error,
  });
  process.exitCode = ok ? 0 : 1;
}
