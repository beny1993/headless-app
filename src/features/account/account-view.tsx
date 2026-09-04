'use client';

// The account page shell: a sidebar of tabs (orders · pets · addresses · profile)
// over one signed-in customer's data. The server page (../../app/(app)/account)
// loads every tab's data owner-scoped and hands it in as props; this component
// only chooses which tab is on screen.
//
// Tabs are local state, not URL-synced — a refresh returns to the default tab,
// which is fine for a personal dashboard and keeps the component clear of the
// URL-resync class the project's component-test rule flags. The order DETAIL is a
// real route (`/account/orders/[orderId]`, server-rendered and owner-scoped), so
// the security-carrying read is never client state. The wishlist tab from the
// prototype is omitted (backlog, per the design review's "Omitted in v1").
import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, MapPin, Package, User } from 'lucide-react';
import {
  AddressesTab,
  type ProvinceOption,
} from '@/features/account/addresses-tab';
import { PetsTab } from '@/features/account/pets-tab';
import { SignOutButton } from '@/features/auth/sign-out-button';
import { accountOrderPath } from '@/lib/constant/paths';
import { formatJalali, formatToman, toPersianDigits } from '@/lib/format';
import type { AddressResponse } from '@/lib/hono/routes/me-addresses';
import type { OrderSummaryResponse } from '@/lib/hono/routes/me-orders';
import type { PetResponse } from '@/lib/hono/routes/me-pets';
import { orderStatusBadge } from '@/lib/orders/order-status-display';
import { cn } from '@/lib/utils';

type Tab = 'orders' | 'pets' | 'addresses' | 'profile';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'orders', label: 'سفارش‌ها', icon: <Package size={16} /> },
  {
    id: 'pets',
    label: 'حیوانات من',
    icon: <span className="text-base">🐾</span>,
  },
  { id: 'addresses', label: 'آدرس‌ها', icon: <MapPin size={16} /> },
  { id: 'profile', label: 'پروفایل', icon: <User size={16} /> },
];

export function AccountView({
  name,
  phone,
  orders,
  pets,
  addresses,
  provinces,
}: {
  name: string;
  phone: string;
  orders: OrderSummaryResponse[];
  pets: PetResponse[];
  addresses: AddressResponse[];
  provinces: ProvinceOption[];
}) {
  const [tab, setTab] = useState<Tab>('orders');

  return (
    <main className="min-h-screen pt-4">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
        <div className="mb-8 flex items-center gap-4">
          <div className="bg-secondary flex size-14 items-center justify-center rounded-full text-2xl">
            <span aria-hidden="true">👤</span>
          </div>
          <div>
            <p className="text-xl font-bold">{name || 'حساب کاربری'}</p>
            <p className="text-muted-foreground text-sm" dir="ltr">
              {toPersianDigits(phone)}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-8 lg:flex-row">
          <aside className="shrink-0 lg:w-52">
            <nav className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-x-visible lg:pb-0">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={tab === t.id ? 'page' : undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors',
                    tab === t.id
                      ? 'bg-accent-strong text-white'
                      : 'hover:bg-secondary',
                  )}
                  data-umami-event={`account-tab-${t.id}`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </nav>
          </aside>

          <div className="flex-1">
            {tab === 'orders' && <OrdersTab orders={orders} />}
            {tab === 'pets' && <PetsTab initialPets={pets} />}
            {tab === 'addresses' && (
              <AddressesTab
                initialAddresses={addresses}
                provinces={provinces}
              />
            )}
            {tab === 'profile' && <ProfileTab name={name} phone={phone} />}
          </div>
        </div>
      </div>
    </main>
  );
}

function OrdersTab({ orders }: { orders: OrderSummaryResponse[] }) {
  return (
    <div>
      <h2 className="mb-5 text-xl font-bold">سفارش‌های من</h2>
      {orders.length === 0 ? (
        <div className="bg-secondary/40 rounded-2xl py-16 text-center">
          <Package
            size={40}
            className="text-muted-foreground mx-auto mb-3"
            aria-hidden="true"
          />
          <p className="mb-1 font-semibold">هنوز سفارشی ثبت نکرده‌ای</p>
          <p className="text-muted-foreground text-sm">
            اولین سفارشت اینجا نمایش داده می‌شود.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const status = orderStatusBadge(order.status);
            return (
              <Link
                key={order.orderId}
                href={accountOrderPath(order.orderId)}
                className="bg-card border-border hover:border-accent-strong flex flex-wrap items-center justify-between gap-3 rounded-xl border p-5 transition-[border-color,box-shadow] hover:shadow-sm"
                data-umami-event="account-order-open"
              >
                <span className="text-accent-strong flex items-center gap-2 text-sm font-medium">
                  <ChevronLeft size={14} aria-hidden="true" /> جزئیات سفارش
                </span>
                <span className="flex flex-wrap items-center gap-5">
                  <span className="text-end">
                    <span
                      className={cn(
                        'inline-block rounded-full px-3 py-1 text-xs font-medium',
                        status.badge,
                      )}
                    >
                      {status.label}
                    </span>
                    <span className="mt-1 block text-sm font-bold">
                      {formatToman(order.total)}
                    </span>
                  </span>
                  <span className="text-end">
                    <span className="block font-semibold">
                      سفارش #{toPersianDigits(order.orderNo)}
                    </span>
                    <span className="text-muted-foreground block text-sm">
                      {formatJalali(new Date(order.createdAt))} ·{' '}
                      {toPersianDigits(order.itemCount)} قلم
                    </span>
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProfileTab({ name, phone }: { name: string; phone: string }) {
  return (
    <div>
      <h2 className="mb-5 text-xl font-bold">پروفایل</h2>
      <div className="bg-card border-border space-y-4 rounded-2xl border p-6">
        <div>
          <p className="text-muted-foreground mb-1.5 text-sm font-medium">
            نام و نام خانوادگی
          </p>
          <p className="font-medium">{name || '—'}</p>
        </div>
        <div>
          <p className="text-muted-foreground mb-1.5 text-sm font-medium">
            شماره موبایل
          </p>
          <p className="font-medium" dir="ltr">
            {toPersianDigits(phone)}
          </p>
          <p className="text-muted-foreground mt-1.5 text-xs">
            شماره ورود توست و از این صفحه تغییر نمی‌کند.
          </p>
        </div>
        <div className="pt-2">
          <SignOutButton page="account" />
        </div>
      </div>
    </div>
  );
}
