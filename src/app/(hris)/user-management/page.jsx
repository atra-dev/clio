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
          Invite users, assign GRC/HR/EA/Employee roles, and require invite email verification + SMS OTP before Google login.
        </p>
      </header>

      <UserManagementPanel />
    </div>
  );
}
