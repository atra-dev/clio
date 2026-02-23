import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { logApiAudit } from "@/lib/hris-api";

async function getRecordId(paramsPromise) {
  const params = await paramsPromise;
  return typeof params?.recordId === "string" ? params.recordId : "";
}

export async function POST(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["lifecycle:view"],
    auditModule: "Employment Lifecycle",
    auditAction: "Lifecycle approval request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  await logApiAudit({
    request,
    module: "Employment Lifecycle",
    activityName: "Lifecycle approval endpoint blocked",
    status: "Rejected",
    sensitivity: "Sensitive",
    performedBy: session.email,
    metadata: {
      recordId,
      recordRef: recordId,
      resourceType: "Lifecycle Workflow",
      reason: "approval_chain_disabled",
      auditNote: "Lifecycle approval endpoint invoked while approval chain is disabled by policy.",
      nextAction: "Use direct lifecycle status update actions from Lifecycle Records.",
    },
  });

  return NextResponse.json(
    {
      message: "Lifecycle approval chain is disabled. Update workflow status directly from Lifecycle Records.",
    },
    { status: 410 },
  );
}
