import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";

export async function GET(request) {
  const requestedEmail = request.nextUrl.searchParams.get("email")?.trim().toLowerCase() || "";

  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["resource:own"],
    ownerIdentifier: (session) => requestedEmail || session.email,
    ownerBypassRoles: ["SUPER_ADMIN"],
    auditModule: "Authentication",
    auditAction: "Profile fetch request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  return NextResponse.json({
    email: requestedEmail || session.email,
    role: session.role,
  });
}
