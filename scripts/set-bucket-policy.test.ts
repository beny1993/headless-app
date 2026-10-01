// The bucket-policy script changes who can read the LIVE bucket — staging and
// production share it — so everything it decides is pinned here against a
// mocked client: what it refuses before touching anything, that a dry run
// touches nothing, what it sends, and that a read-back which quietly lost the
// prefix is a failure. Nothing here reaches a bucket.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildReadPolicy,
  findOffenders,
  samePolicy,
  setBucketPolicy,
} from './set-bucket-policy';

const BUCKET = 'smokeypetshop';
const UPLOAD = 'uploads/123e4567-e89b-12d3-a456-426614174000.jpg';
const RECEIPT = 'receipts/123e4567-e89b-12d3-a456-426614174000.jpg';

type Sent = { name: string; input: Record<string, unknown> };

/**
 * A client whose answers are keyed by command name. `pages` is the listing,
 * one array of keys per page — `dropToken` makes it say it is truncated
 * without giving the next page's token, and `loopTokens` makes every page say
 * «more» with the next token from that list, round and round (bounded, so a
 * script that never stops paging fails here instead of hanging). `current` is
 * the bucket's policy
 * before any put (none: GetBucketPolicy fails the way S3 does);
 * `readBack` is what GetBucketPolicy returns after one. `listError` is thrown
 * by the listing, as the SDK throws an endpoint's refusal.
 */
const fakeClient = ({
  pages = [[UPLOAD]],
  dropToken = false,
  current,
  readBack,
  putError,
  listError,
  loopTokens,
}: {
  pages?: string[][];
  dropToken?: boolean;
  loopTokens?: string[];
  current?: string;
  readBack?: string;
  putError?: Error;
  listError?: Error;
}) => {
  const sent: Sent[] = [];
  let stored = current;
  let put = false;
  const send = vi.fn(
    async (command: {
      constructor: { name: string };
      input: Record<string, unknown>;
    }) => {
      const name = command.constructor.name;
      sent.push({ name, input: command.input });
      switch (name) {
        case 'ListObjectsV2Command': {
          if (listError) throw listError;
          if (loopTokens) {
            const calls = names(sent).length;
            if (calls > 50) throw new Error('runaway listing');
            return {
              Contents: [{ Key: UPLOAD }],
              IsTruncated: true,
              NextContinuationToken:
                loopTokens[(calls - 1) % loopTokens.length],
            };
          }
          const page = Number(command.input.ContinuationToken ?? 0);
          const next = page + 1;
          return {
            Contents: pages[page].map((Key) => ({ Key })),
            IsTruncated: next < pages.length,
            NextContinuationToken:
              next < pages.length && !dropToken ? String(next) : undefined,
          };
        }
        case 'PutBucketPolicyCommand':
          if (putError) throw putError;
          stored = command.input.Policy as string;
          put = true;
          return {};
        case 'GetBucketPolicyCommand': {
          const policy = put ? (readBack ?? stored) : stored;
          if (policy === undefined) {
            throw Object.assign(new Error('The bucket policy does not exist'), {
              name: 'NoSuchBucketPolicy',
            });
          }
          return { Policy: policy };
        }
        default:
          throw new Error(`unexpected command ${name}`);
      }
    },
  );
  return { client: { send }, sent };
};

const quiet = { log: vi.fn(), error: vi.fn() };
const names = (sent: Sent[]) => sent.map((s) => s.name);

beforeEach(() => {
  quiet.log.mockClear();
  quiet.error.mockClear();
});

describe('buildReadPolicy', () => {
  it('lets anyone GET an object under uploads/ and nothing else', () => {
    expect(JSON.parse(buildReadPolicy(BUCKET))).toEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${BUCKET}/uploads/*`],
        },
      ],
    });
  });
});

describe('findOffenders', () => {
  it('names every object the rule would take dark — anything outside uploads/ and receipts/', () => {
    expect(
      findOffenders([
        UPLOAD,
        RECEIPT,
        'products/cat.jpg',
        'site/hero.jpg',
        'uploadsx/a.jpg',
        'loose.png',
      ]),
    ).toEqual([
      'products/cat.jpg',
      'site/hero.jpg',
      'uploadsx/a.jpg',
      'loose.png',
    ]);
  });
});

describe('samePolicy', () => {
  const sent = buildReadPolicy(BUCKET);

  it('accepts the read-back when the endpoint only reshaped it', () => {
    // S3 endpoints normalize: a principal object, a bare string action, a Sid.
    const reshaped = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'x',
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${BUCKET}/uploads/*`,
        },
      ],
    });
    expect(samePolicy(sent, reshaped)).toBe(true);
  });

  it.each([
    ['the prefix dropped', `arn:aws:s3:::${BUCKET}/*`],
    ['another prefix', `arn:aws:s3:::${BUCKET}/receipts/*`],
  ])('refuses a read-back with %s', (_, resource) => {
    const changed = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: [resource],
        },
      ],
    });
    expect(samePolicy(sent, changed)).toBe(false);
  });

  it('refuses a read-back with a statement added', () => {
    const parsed = JSON.parse(sent);
    parsed.Statement.push({
      Effect: 'Allow',
      Principal: '*',
      Action: ['s3:ListBucket'],
      Resource: [`arn:aws:s3:::${BUCKET}`],
    });
    expect(samePolicy(sent, JSON.stringify(parsed))).toBe(false);
  });

  it('refuses no policy at all', () => {
    expect(samePolicy(sent, undefined)).toBe(false);
  });
});

describe('setBucketPolicy', () => {
  it('refuses, touching nothing, while any object would go dark — found on any page', async () => {
    const { client, sent } = fakeClient({
      pages: [[UPLOAD], ['products/cat.jpg']],
    });

    const ok = await setBucketPolicy({
      client,
      bucket: BUCKET,
      apply: true,
      ...quiet,
    });

    expect(ok).toBe(false);
    expect(names(sent)).toEqual([
      'ListObjectsV2Command',
      'ListObjectsV2Command',
    ]);
    expect(quiet.error.mock.calls.flat().join('\n')).toContain(
      'products/cat.jpg',
    );
  });

  it('refuses to judge the bucket on part of a listing — truncated, with no token for the rest', async () => {
    // An endpoint that says «more» without saying where: the offender on the
    // unread page would go dark.
    const { client, sent } = fakeClient({
      pages: [[UPLOAD], ['site/logo.png']],
      dropToken: true,
    });

    const ok = await setBucketPolicy({
      client,
      bucket: BUCKET,
      apply: true,
      ...quiet,
    });

    expect(ok).toBe(false);
    expect(names(sent)).toEqual(['ListObjectsV2Command']);
    expect(quiet.error.mock.calls.flat().join('\n')).toMatch(
      /continuation token/,
    );
  });

  it('refuses a listing that hands back a token it gave before — it would page forever', async () => {
    // A → B → A: not the same token twice in a row, so only remembering every
    // token seen catches it.
    const { client, sent } = fakeClient({ loopTokens: ['A', 'B'] });

    const ok = await setBucketPolicy({
      client,
      bucket: BUCKET,
      apply: true,
      ...quiet,
    });

    expect(ok).toBe(false);
    expect(names(sent)).toEqual([
      'ListObjectsV2Command',
      'ListObjectsV2Command',
      'ListObjectsV2Command',
    ]);
    expect(quiet.error.mock.calls.flat().join('\n')).toMatch(
      /repeats a continuation token/,
    );
  });

  it('reports a failure by its name and message alone — never the rest of what the endpoint answered', async () => {
    // An SDK error carries every field of the endpoint's error answer; for a
    // refused signature, S3's names the key's id and what was signed.
    const refused = Object.assign(
      new Error(
        'The request signature we calculated does not match the signature you provided.',
      ),
      {
        name: 'SignatureDoesNotMatch',
        $fault: 'client',
        $metadata: { httpStatusCode: 403, requestId: 'REQUEST-ID-1' },
        AWSAccessKeyId: 'AKIDEXAMPLEKEYID',
        StringToSign: 'AWS4-HMAC-SHA256 20261001T000000Z scope hash',
        SignatureProvided: 'SIGNATURE-PROVIDED-1',
      },
    );
    const { client, sent } = fakeClient({ listError: refused });

    const ok = await setBucketPolicy({
      client,
      bucket: BUCKET,
      apply: true,
      ...quiet,
    });

    expect(ok).toBe(false);
    expect(names(sent)).toEqual(['ListObjectsV2Command']);
    const printed = [...quiet.log.mock.calls, ...quiet.error.mock.calls]
      .flat()
      .map(String)
      .join('\n');
    expect(printed).toContain(
      'SignatureDoesNotMatch: The request signature we calculated does not match',
    );
    for (const leak of [
      'AKIDEXAMPLEKEYID',
      'AWS4-HMAC-SHA256',
      'SIGNATURE-PROVIDED-1',
      'REQUEST-ID-1',
    ]) {
      expect(printed).not.toContain(leak);
    }
  });

  it('only checks and prints on a dry run — the policy is never sent', async () => {
    const { client, sent } = fakeClient({});

    const ok = await setBucketPolicy({
      client,
      bucket: BUCKET,
      apply: false,
      ...quiet,
    });

    expect(ok).toBe(true);
    expect(names(sent)).toEqual([
      'ListObjectsV2Command',
      'GetBucketPolicyCommand',
    ]);
  });

  it('shows the policy it would replace before the one it proposes', async () => {
    const current = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${BUCKET}/*`,
        },
      ],
    });
    const { client } = fakeClient({ current });

    await setBucketPolicy({ client, bucket: BUCKET, apply: false, ...quiet });

    const printed = quiet.log.mock.calls.flat().join('\n');
    const currentAt = printed.indexOf(`arn:aws:s3:::${BUCKET}/*`);
    const proposedAt = printed.indexOf(`arn:aws:s3:::${BUCKET}/uploads/*`);
    expect(currentAt).toBeGreaterThan(-1);
    expect(proposedAt).toBeGreaterThan(currentAt);
  });

  it('says so when the bucket has no policy yet', async () => {
    const { client } = fakeClient({});

    await setBucketPolicy({ client, bucket: BUCKET, apply: false, ...quiet });

    expect(quiet.log.mock.calls.flat().join('\n')).toMatch(
      /current policy[\s\S]*\(none\)/,
    );
  });

  it('sends the policy and reads it back when applied', async () => {
    const { client, sent } = fakeClient({ pages: [[UPLOAD, RECEIPT]] });

    const ok = await setBucketPolicy({
      client,
      bucket: BUCKET,
      apply: true,
      ...quiet,
    });

    expect(ok).toBe(true);
    expect(names(sent)).toEqual([
      'ListObjectsV2Command',
      'GetBucketPolicyCommand',
      'PutBucketPolicyCommand',
      'GetBucketPolicyCommand',
    ]);
    expect(sent[2].input).toEqual({
      Bucket: BUCKET,
      Policy: buildReadPolicy(BUCKET),
    });
  });

  it('fails when the endpoint stored something other than what was sent', async () => {
    const { client } = fakeClient({
      readBack: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${BUCKET}/*`],
          },
        ],
      }),
    });

    const ok = await setBucketPolicy({
      client,
      bucket: BUCKET,
      apply: true,
      ...quiet,
    });

    expect(ok).toBe(false);
  });

  it('fails, pointing at the fallback, when the endpoint refuses bucket policies', async () => {
    const { client } = fakeClient({
      putError: Object.assign(new Error('not implemented'), {
        name: 'NotImplemented',
      }),
    });

    const ok = await setBucketPolicy({
      client,
      bucket: BUCKET,
      apply: true,
      ...quiet,
    });

    expect(ok).toBe(false);
    expect(quiet.error.mock.calls.flat().join('\n')).toMatch(/NotImplemented/);
  });
});
