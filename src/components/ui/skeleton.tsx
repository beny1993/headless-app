import { cn } from '@/lib/utils';

/**
 * A placeholder block while a streamed part of the page loads, ported from
 * `design/src/app/components/ui/skeleton.tsx`. `bg-muted` rather than the
 * prototype's `bg-accent`: our accent is the brand's terracotta, which would
 * read as content, not as "loading".
 *
 * Decorative: the region it sits in carries the `aria-busy` and the label.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn('bg-muted animate-pulse rounded-md', className)}
      {...props}
    />
  );
}
