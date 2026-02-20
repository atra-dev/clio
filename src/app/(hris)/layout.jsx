import HrisShell from "@/components/hris/HrisShell";
import { requireAuthenticatedSession } from "@/lib/server-authorization";

export default async function WorkspaceLayout({ children }) {
  const session = await requireAuthenticatedSession();

  return <HrisShell session={session}>{children}</HrisShell>;
}
