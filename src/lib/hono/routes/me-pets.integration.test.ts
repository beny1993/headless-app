// Request-level tests for the owner-scoped pet CRUD, driven through the Hono app.
// Only the session lookup is mocked; auth (401 on every verb) and owner-scoping
// (an attacker gets 404, never another user's pet, and never touches their row)
// are the point. Needs a live database — see src/db/test-db.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PET_GENDERS } from '@/lib/account/pet';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { databaseReachable, importWithDb } from '@/db/test-db';
import { AccountFixtures } from '@/db/account-test-fixtures';
import { API_PATHS, apiMePetPath } from '@/lib/constant/paths';
import type { ApiResponse } from '@/lib/hono/envelope';
import type { PetResponse } from '@/lib/hono/routes/me-pets';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { PetDao } = await importWithDb(() => import('@/db/dao/PetDao'));

const petBody = (over: Record<string, unknown> = {}) => ({
  name: 'لونا',
  type: PET_TYPES.CAT,
  gender: PET_GENDERS.FEMALE,
  neutered: true,
  breed: 'ایرانی',
  ...over,
});

describe.skipIf(!databaseReachable)('/api/me/pets', () => {
  const fx = new AccountFixtures();
  afterEach(() => {
    mocks.getSession.mockReset();
    return fx.cleanup();
  });

  const asUser = (id: string) =>
    mocks.getSession.mockResolvedValue({
      user: { id, email: 'c@example.com', role: 'customer' },
      session: { id: 's1' },
    });
  const anon = () => mocks.getSession.mockResolvedValue(null);

  const post = (body: unknown) =>
    app.request(API_PATHS.ME_PETS, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  const patch = (id: string, body: unknown) =>
    app.request(apiMePetPath(id), {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  const del = (id: string) =>
    app.request(apiMePetPath(id), { method: 'DELETE' });

  const created = async (userId: string, over?: Record<string, unknown>) =>
    PetDao.create(userId, {
      name: 'لونا',
      type: PET_TYPES.CAT,
      gender: PET_GENDERS.FEMALE,
      neutered: true,
      breed: 'ایرانی',
      age: undefined,
      weight: undefined,
      photoUrl: undefined,
      ...over,
    });

  describe('auth', () => {
    it('401s every verb without a session', async () => {
      anon();
      expect((await app.request(API_PATHS.ME_PETS)).status).toBe(401);
      expect((await post(petBody())).status).toBe(401);
      expect((await patch(crypto.randomUUID(), petBody())).status).toBe(401);
      expect((await del(crypto.randomUUID())).status).toBe(401);
    });
  });

  describe('create + list', () => {
    it('creates a pet owned by the session user and lists it back', async () => {
      const user = await fx.user();
      asUser(user.id);

      const res = await post(petBody({ name: 'رکس', type: PET_TYPES.DOG }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as ApiResponse<PetResponse>;
      if (body.status !== 'success') throw new Error(body.message);
      expect(body.data.name).toBe('رکس');
      expect(body.data).not.toHaveProperty('userId');

      const list = (await (
        await app.request(API_PATHS.ME_PETS)
      ).json()) as ApiResponse<PetResponse[]>;
      if (list.status !== 'success') throw new Error(list.message);
      expect(list.data).toHaveLength(1);
    });

    it('400s a malformed body', async () => {
      const user = await fx.user();
      asUser(user.id);
      expect((await post(petBody({ name: '' }))).status).toBe(400);
      expect((await post(petBody({ type: 'parrot' }))).status).toBe(400);
    });

    it('rejects a non-https photo url (400) — attacker-controllable, later rendered', async () => {
      const user = await fx.user();
      asUser(user.id);
      expect(
        (await post(petBody({ photoUrl: 'javascript:alert(1)' }))).status,
      ).toBe(400);
    });
  });

  describe('cross-user isolation (IDOR)', () => {
    it('does not list another user’s pets', async () => {
      const owner = await fx.user();
      await created(owner.id);
      const attacker = await fx.user();
      asUser(attacker.id);

      const list = (await (
        await app.request(API_PATHS.ME_PETS)
      ).json()) as ApiResponse<PetResponse[]>;
      if (list.status !== 'success') throw new Error(list.message);
      expect(list.data).toEqual([]);
    });

    it('404s an update to another user’s pet and leaves it untouched', async () => {
      const owner = await fx.user();
      const pet = await created(owner.id, { name: 'اصلی' });
      const attacker = await fx.user();
      asUser(attacker.id);

      expect((await patch(pet.id, petBody({ name: 'هک‌شده' }))).status).toBe(
        404,
      );
      const reread = await PetDao.getOwned(pet.id, owner.id);
      expect(reread?.name).toBe('اصلی');
    });

    it('404s a delete of another user’s pet and leaves it in place', async () => {
      const owner = await fx.user();
      const pet = await created(owner.id);
      const attacker = await fx.user();
      asUser(attacker.id);

      expect((await del(pet.id)).status).toBe(404);
      expect(await PetDao.getOwned(pet.id, owner.id)).not.toBeNull();
    });
  });

  describe('update + delete (owner)', () => {
    it('updates the owner’s pet', async () => {
      const user = await fx.user();
      const pet = await created(user.id);
      asUser(user.id);

      const res = await patch(pet.id, petBody({ name: 'لونای جدید' }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as ApiResponse<PetResponse>;
      if (body.status !== 'success') throw new Error(body.message);
      expect(body.data.name).toBe('لونای جدید');
    });

    it('400s a non-uuid id but 404s an unknown uuid', async () => {
      const user = await fx.user();
      asUser(user.id);
      expect((await del('not-a-uuid')).status).toBe(400);
      expect((await del(crypto.randomUUID())).status).toBe(404);
    });

    it('deletes the owner’s pet and echoes its id', async () => {
      const user = await fx.user();
      const pet = await created(user.id);
      asUser(user.id);

      const res = await del(pet.id);
      expect(res.status).toBe(200);
      const body = (await res.json()) as ApiResponse<{ id: string }>;
      if (body.status !== 'success') throw new Error(body.message);
      expect(body.data.id).toBe(pet.id);
      expect(await PetDao.getOwned(pet.id, user.id)).toBeNull();
    });
  });

  describe('per-user cap', () => {
    it('422s the pet past the cap', async () => {
      const { MAX_PETS_PER_USER } = await import('@/lib/hono/routes/me-pets');
      const user = await fx.user();
      asUser(user.id);
      await Promise.all(
        Array.from({ length: MAX_PETS_PER_USER }, () => created(user.id)),
      );
      expect((await post(petBody())).status).toBe(422);
    });
  });
});
