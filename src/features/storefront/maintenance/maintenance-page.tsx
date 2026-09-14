/** What a visitor sees while `APP_CONFIG_MAINTENANCE_MODE` closes the shop. */
export function MaintenancePage() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">به‌زودی برمی‌گردیم</h1>
      <p className="text-muted-foreground text-sm">
        در حال آماده‌سازی فروشگاه هستیم. کمی بعد دوباره سر بزنید.
      </p>
    </main>
  );
}
