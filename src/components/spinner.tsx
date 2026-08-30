import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cn('text-muted-foreground size-6 animate-spin', className)}
      aria-label="Loading"
    />
  );
}
