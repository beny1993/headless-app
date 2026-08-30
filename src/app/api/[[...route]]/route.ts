import { app } from '@/lib/hono';

// Bridge the Hono app into the App Router. Deliberately not `handle` from
// `hono/vercel`: that adapter is this same one-liner, and nothing here targets
// a serverless/Vercel runtime.
const handler = (request: Request) => app.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
