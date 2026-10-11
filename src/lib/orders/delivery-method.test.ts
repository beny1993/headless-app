import { describe, expect, it } from 'vitest';
import {
  DELIVERY_METHODS,
  DELIVERY_METHOD_LABELS,
  DELIVERY_METHOD_VALUES,
  deliveryMethodSchema,
  effectiveDeliveryMethod,
  isCourierProvince,
} from './delivery-method';

const ZWNJ = String.fromCharCode(0x200c);

describe('the delivery-method domain', () => {
  it('is post and courier, post first (the pgEnum is built in this order)', () => {
    expect(DELIVERY_METHOD_VALUES).toEqual(['post', 'courier']);
  });

  it('labels every method in Persian', () => {
    expect(DELIVERY_METHOD_LABELS[DELIVERY_METHODS.POST]).toBe('پست');
    expect(DELIVERY_METHOD_LABELS[DELIVERY_METHODS.COURIER]).toBe(
      'ارسال با پیک',
    );
  });

  it('accepts only the two methods', () => {
    expect(deliveryMethodSchema.safeParse('courier').success).toBe(true);
    expect(deliveryMethodSchema.safeParse('post').success).toBe(true);
    expect(deliveryMethodSchema.safeParse('express').success).toBe(false);
    expect(deliveryMethodSchema.safeParse('').success).toBe(false);
    expect(deliveryMethodSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('isCourierProvince', () => {
  it('is true for Tehran', () => {
    expect(isCourierProvince('تهران')).toBe(true);
  });

  it('reads a hand-typed Tehran as Tehran: spaces, edge ZWNJ, an invisible mark', () => {
    expect(isCourierProvince('  تهران ')).toBe(true);
    expect(isCourierProvince(`${ZWNJ}تهران${ZWNJ}`)).toBe(true);
    expect(isCourierProvince(`ته${String.fromCharCode(0x200b)}ران`)).toBe(true);
  });

  it('is false for every other province, and for near misses', () => {
    expect(isCourierProvince('اصفهان')).toBe(false);
    expect(isCourierProvince('البرز')).toBe(false);
    expect(isCourierProvince('تهرانپارس')).toBe(false);
    expect(isCourierProvince('ته ران')).toBe(false);
    expect(isCourierProvince('')).toBe(false);
  });
});

describe('effectiveDeliveryMethod', () => {
  it('keeps courier in Tehran', () => {
    expect(effectiveDeliveryMethod('courier', 'تهران')).toBe('courier');
  });

  it('falls back to post outside Tehran or before a province is picked', () => {
    expect(effectiveDeliveryMethod('courier', 'اصفهان')).toBe('post');
    expect(effectiveDeliveryMethod('courier', null)).toBe('post');
  });

  it('never turns post into courier', () => {
    expect(effectiveDeliveryMethod('post', 'تهران')).toBe('post');
    expect(effectiveDeliveryMethod('post', null)).toBe('post');
  });
});
