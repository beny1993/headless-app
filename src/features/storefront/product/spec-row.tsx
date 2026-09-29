/**
 * One row of the product's specification table.
 *
 * `value` is a node, not a string, for the one row that renders links — برند،
 * کد کالا and مناسب برای still pass plain strings. The `<dd>` wraps rather than
 * squeezing the `<dt>`: with six categories that is two or three lines in a
 * spec table, which is what a spec table is for. `justify-end` is logical, so
 * it stays correct in the RTL shell.
 */
export function Spec({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="border-border flex items-center justify-between gap-4 border-b py-3">
      <dt className="text-muted-foreground font-medium">{label}</dt>
      <dd className="flex flex-wrap justify-end gap-x-1 font-semibold">
        {value}
      </dd>
    </div>
  );
}
