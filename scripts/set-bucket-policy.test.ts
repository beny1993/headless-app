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
 * one array of keys per page; `readBack` is what GetBucketPolicy returns.
 */
const fakeClient = ({
  pages = [[UPLOAD]],
  readBack,
  putError,
}: {
  pages?: string[][];
  readBack?: string;
  putError?: Error;
}) => {
  const sent: Sent[] = [];
  let stored: string | undefined;
  const send = vi.fn(
    async (command: {
      constructor: { name: string };
      input: Record<string, unknown>;
    }) => {
      const name = command.constructor.name;
      sent.push({ name, input: command.input });
      switch (name) {
        case 'ListObjectsV2Command': {
          const page = Number(command.input.ContinuationToken ?? 0);
          const next = page + 1;
          return {
            Contents: pages[page].map((Key) => ({ Key })),
            IsTruncated: next < pages.length,
            NextContinuationToken:
              next < pages.length ? String(next) : undefined,
          };
        }
        case 'PutBucketPolicyCommand':
          if (putError) throw putError;
          stored = command.input.Policy as string;
          return {};
        case 'GetBucketPolicyCommand':
          return { Policy: readBack ?? stored };
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

  it('only checks and prints on a dry run — the policy is never sent', async () => {
    const { client, sent } = fakeClient({});

    const ok = await setBucketPolicy({
      client,
      bucket: BUCKET,
      apply: false,
      ...quiet,
    });

    expect(ok).toBe(true);
    expect(names(sent)).toEqual(['ListObjectsV2Command']);
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
      'PutBucketPolicyCommand',
      'GetBucketPolicyCommand',
    ]);
    expect(sent[1].input).toEqual({
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
