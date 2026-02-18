import HrisShell from "@/components/hris/HrisShell";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-session";

export default async function WorkspaceLayout({ children }) {
  const session = await getServerSession();

  if (!session) {
    redirect("/login");
  }

  return <HrisShell session={session}>{children}</HrisShell>;
}
