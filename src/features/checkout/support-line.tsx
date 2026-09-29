import { SUPPORT_PHONE } from '@/lib/constant/support';
import { formatNumber, toPersianDigits } from '@/lib/format';
import { cn } from '@/lib/utils';

/** «شماره پشتیبانی» and its hours, under a failed or unsettled payment. */
export function SupportLine({ className }: { className?: string }) {
  return (
    <p className={cn('text-muted-foreground mt-6 text-xs', className)}>
      شماره پشتیبانی:{' '}
      <span dir="ltr" className="nums">
        {toPersianDigits(SUPPORT_PHONE)}
      </span>{' '}
      — هر روز {formatNumber(9)} تا {formatNumber(18)}
    </p>
  );
}
