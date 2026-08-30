import type { Metadata } from 'next';
import { UsersCard } from '@/features/backoffice/dashboard/users-card';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default function BackofficePage() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
          <CardDescription>
            This is the authenticated back office. Build admin pages here — each
            page goes through the session gate in the (protected) layout, reads
            data through DAOs, and mutates through server actions or the Hono
            API.
          </CardDescription>
        </CardHeader>
      </Card>
      <UsersCard />
    </div>
  );
}
