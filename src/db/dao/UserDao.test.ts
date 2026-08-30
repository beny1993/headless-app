import { faker } from '@faker-js/faker';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES, users } from '@/db/schema/auth';

const mocks = vi.hoisted(() => {
  const returning = vi.fn();
  const values = vi.fn((row: { email: string; role: string }) => {
    void row;
    return { returning };
  });
  const insert = vi.fn(() => ({ values }));
  return { returning, values, insert };
});

vi.mock('@/db', () => ({ db: { insert: mocks.insert } }));

const { UserDao } = await import('./UserDao');

describe('UserDao.create — role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.returning.mockResolvedValue([{ id: faker.string.uuid() }]);
  });

  const inserted = () => mocks.values.mock.calls[0][0];

  it('creates a customer, never an admin, when no role is given', async () => {
    await UserDao.create({
      email: faker.internet.email(),
      name: faker.person.fullName(),
    });

    expect(inserted().role).toBe('customer');
    expect(inserted().role).not.toBe('admin');
  });

  it('grants admin only when asked for explicitly', async () => {
    await UserDao.create({
      email: faker.internet.email(),
      name: faker.person.fullName(),
      role: ROLES.ADMIN,
    });

    expect(inserted().role).toBe('admin');
  });

  it('lowercases the email it stores', async () => {
    await UserDao.create({ email: 'Benyamin@Example.COM', name: 'Benyamin' });

    expect(inserted().email).toBe('benyamin@example.com');
  });
});

describe('user schema', () => {
  it('defaults the role column to customer', () => {
    // Guards the DB-level default too: a row inserted by anything other than
    // the DAO (Better Auth, a migration, psql) must not come out an admin.
    expect(users.role.default).toBe('customer');
    expect(users.role.default).not.toBe('admin');
  });
});
