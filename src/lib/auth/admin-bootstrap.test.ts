import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES } from '@/db/schema/auth';

const mocks = vi.hoisted(() => ({
  findByPhone: vi.fn(),
  create: vi.fn(),
  setRole: vi.fn(),
}));

vi.mock('@/db/dao/UserDao', () => ({
  UserDao: {
    findByPhone: mocks.findByPhone,
    create: mocks.create,
    setRole: mocks.setRole,
  },
}));

const { provisionAdminByPhone } = await import('./admin-bootstrap');

const CANONICAL = '+989121234567';
const adminUser = { id: 'u1', phoneNumber: CANONICAL, role: ROLES.ADMIN };
const customerUser = { id: 'u2', phoneNumber: CANONICAL, role: ROLES.CUSTOMER };

describe('provisionAdminByPhone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByPhone.mockResolvedValue(null);
    mocks.create.mockResolvedValue(adminUser);
    mocks.setRole.mockResolvedValue(adminUser);
  });

  describe('a number nobody holds yet', () => {
    it('creates the admin', async () => {
      const result = await provisionAdminByPhone(CANONICAL);

      expect(result.outcome).toBe('created');
    });

    it('grants admin explicitly, never by default', async () => {
      await provisionAdminByPhone(CANONICAL);

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: ROLES.ADMIN }),
      );
    });

    it('stores the number canonically', async () => {
      await provisionAdminByPhone(CANONICAL);

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ phoneNumber: CANONICAL }),
      );
    });

    it('marks the number verified so the admin can sign straight in', async () => {
      await provisionAdminByPhone(CANONICAL);

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ phoneNumberVerified: true }),
      );
    });

    it('uses the same temp email the OTP sign-up would derive', async () => {
      // Two derivations that drifted would let one person hold two accounts:
      // this one, and the one their first OTP login creates.
      await provisionAdminByPhone(CANONICAL);

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: '989121234567@phone.smokey.invalid',
        }),
      );
    });

    it('falls back to the readable number as a name', async () => {
      await provisionAdminByPhone(CANONICAL);

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: '09121234567' }),
      );
    });

    it('takes a display name when one is given', async () => {
      await provisionAdminByPhone(CANONICAL, 'بنیامین');

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'بنیامین' }),
      );
    });
  });

  describe('a number that already has an account', () => {
    it('promotes an existing customer', async () => {
      // The path that matters in practice: sign in normally once, then get
      // promoted — no second account, no orphaned row.
      mocks.findByPhone.mockResolvedValue(customerUser);

      const result = await provisionAdminByPhone(CANONICAL);

      expect(result.outcome).toBe('promoted');
      expect(mocks.setRole).toHaveBeenCalledWith(customerUser.id, ROLES.ADMIN);
    });

    it('never creates a second row for the same number', async () => {
      mocks.findByPhone.mockResolvedValue(customerUser);

      await provisionAdminByPhone(CANONICAL);

      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('is idempotent for someone who is already an admin', async () => {
      mocks.findByPhone.mockResolvedValue(adminUser);

      const result = await provisionAdminByPhone(CANONICAL);

      expect(result.outcome).toBe('already-admin');
      expect(mocks.setRole).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    });
  });

  describe('normalizes what a human types', () => {
    it.each([
      ['the local form', '09121234567'],
      ['spaces', '0912 123 4567'],
      ['Persian digits', '۰۹۱۲۱۲۳۴۵۶۷'],
      ['the access prefix', '00989121234567'],
    ])('accepts %s and looks the number up canonically', async (_l, input) => {
      // Unlike the API, this boundary is a person at a shell. Normalizing here
      // is what stops `pnpm create-admin 0912…` from creating a *second*
      // account beside the one that phone already signs in with.
      await provisionAdminByPhone(input);

      expect(mocks.findByPhone).toHaveBeenCalledWith(CANONICAL);
    });
  });

  describe('refuses input it cannot make sense of', () => {
    it.each([
      ['a landline', '02112345678'],
      ['a foreign number', '+14155552671'],
      ['an email address', 'benyamin@example.com'],
      ['nothing at all', ''],
      ['a truncated number', '0912123'],
    ])('rejects %s', async (_label, input) => {
      await expect(provisionAdminByPhone(input)).rejects.toThrow();
    });

    it('writes nothing when it rejects', async () => {
      await expect(provisionAdminByPhone('02112345678')).rejects.toThrow();

      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.setRole).not.toHaveBeenCalled();
      expect(mocks.findByPhone).not.toHaveBeenCalled();
    });
  });
});
