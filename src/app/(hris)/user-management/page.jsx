import UserManagementPanel from "@/components/hris/UserManagementPanel";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "User Management | Clio HRIS",
};

export default async function UserManagementPage() {
  await requireModuleAccess("user-management");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">User Management</h1>
        <p className="mt-1 text-sm text-slate-600">
          Create accounts by invitation, assign roles, and open or disable user access.
        </p>
      </header>

      <UserManagementPanel />
    </div>
  );
}
