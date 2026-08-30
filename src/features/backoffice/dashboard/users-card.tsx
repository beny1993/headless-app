import { UserDao } from '@/db/dao/UserDao';
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
        <CardTitle>Back-office users</CardTitle>
        <CardDescription>
          Provision users with <code>pnpm create-admin &lt;email&gt;</code> —
          sign-in is invite-only.
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
                <th className="py-2 font-medium">Email</th>
                <th className="py-2 font-medium">Role</th>
                <th className="py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b last:border-0">
                  <td className="py-2">{user.name}</td>
                  <td className="py-2">{user.email}</td>
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
