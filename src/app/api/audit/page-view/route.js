import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { recordAuditEvent } from "@/lib/audit-log";

const PAGE_LABELS = {
  "/dashboard": "Viewed Dashboard",
  "/employees": "Viewed Employee Records",
  "/activity-log": "Viewed Activity Log",
  "/exports": "Viewed Export Control",
  "/documents": "Viewed Sheets and PDF",
  "/settings": "Viewed Settings",
};

function getPageLabel(pathname) {
  if (PAGE_LABELS[pathname]) {
    return PAGE_LABELS[pathname];
  }
  return `Viewed ${pathname || "workspace page"}`;
}

export async function POST(request) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(token);

  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const pathname = typeof body?.pathname === "string" ? body.pathname : "/dashboard";

    await recordAuditEvent({
      activityName: getPageLabel(pathname),
      status: "Completed",
      module: "Navigation",
      performedBy: session.email,
      sensitivity: "Non-sensitive",
      metadata: {
        pathname,
      },
      request,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "Unable to log page view." }, { status: 400 });
  }
}
