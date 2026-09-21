// The two label/value rows the admin order page draws. They look alike and are
// deliberately NOT one component: the totals row always sets `nums`, the
// payment row sets it only for the LTR gateway keys, and the payment row is
// vertically centred with a gap the totals block does not have. Collapsing them
// would change what renders.

/** A totals line: «جمع اقلام», the shipping fee, the discount. Always numeric. */
export function TotalsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * A payment-detail line. `ltr` is for the opaque gateway keys an admin copies
 * verbatim into Zarinpal's panel — they read left to right and stay Latin.
 */
export function PaymentRow({
  label,
  value,
  ltr,
}: {
  label: string;
  value: string;
  ltr?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={ltr ? 'nums' : ''} dir={ltr ? 'ltr' : undefined}>
        {value}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
