import { UserDao } from '@/db/dao/UserDao';
import { toLocalIranPhone } from '@/lib/auth/phone';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// Server component demonstrating the page → DAO → DB read chain.
export async function UsersCard() {
  const users = await UserDao.list();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>
          Everyone with an account — customers sign themselves up by phone OTP.
          Grant admin with <code>pnpm create-admin &lt;phone&gt;</code>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <p className="text-muted-foreground text-sm">No users yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Phone</th>
                <th className="py-2 font-medium">Role</th>
                <th className="py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b last:border-0">
                  <td className="py-2">{user.name}</td>
                  {/* The phone, not the derived `…@phone.smokey.invalid`
                      address, which identifies nobody. */}
                  <td className="py-2" dir="ltr">
                    {toLocalIranPhone(user.phoneNumber ?? '')}
                  </td>
                  <td className="py-2">{user.role}</td>
                  <td className="py-2">
                    {user.createdAt.toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
