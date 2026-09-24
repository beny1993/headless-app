'use client';

import type { CSSProperties } from 'react';
import { Toaster as Sonner } from 'sonner';

/**
 * The admin panel's toast region, where request failures and partial saves are
 * reported (`toast.error` / `toast.warning` from `sonner`). Ported from the design
 * prototype's `ui/sonner.tsx` without `next-themes`: the panel is light-only.
 *
 * Sonner injects a stylesheet that sets a system `font-family` on the toaster, so
 * the inline style inherits the body's Vazirmatn back (inline beats that rule).
 * Right-to-left, and colored by kind (`richColors`) so an error reads as one.
 */
export function Toaster() {
  return (
    <Sonner
      dir="rtl"
      position="top-center"
      richColors
      style={
        {
          fontFamily: 'inherit',
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
    />
  );
}
