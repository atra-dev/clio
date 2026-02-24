import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { getEmployeeRecordBackend } from "@/lib/hris-backend";
import {
  canActorAccessOwner,
  logApiAudit,
  mapBackendError,
  parseJsonBody,
} from "@/lib/hris-api";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDocumentSummary(record, payload) {
  const requestedId = normalizeText(payload?.documentId);
  const requestedName = normalizeText(payload?.documentName);
  const requestedType = normalizeText(payload?.documentType);
  const requestedRef = normalizeText(payload?.documentRef);
  const documents = Array.isArray(record?.documents) ? record.documents : [];
  const matched = documents.find((document, index) => {
    const item = document && typeof document === "object" ? document : {};
    const id = normalizeText(item.id || item.recordId || `${index}`);
    const name = normalizeText(item.name);
    const ref = normalizeText(item.ref || item.storagePath);
    return (
      (requestedId && requestedId === id) ||
      (requestedRef && requestedRef === ref) ||
      (requestedName && requestedName === name)
    );
  });

  return {
    id: normalizeText(matched?.id || matched?.recordId || requestedId),
    name: normalizeText(matched?.name || requestedName || "Employee Document"),
    type: normalizeText(matched?.type || requestedType || "General"),
    ref: normalizeText(matched?.ref || matched?.storagePath || requestedRef),
  };
}

async function getRecordId(paramsPromise) {
  const params = await paramsPromise;
  return typeof params?.recordId === "string" ? params.recordId : "";
}

export async function POST(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["employees:view"],
    auditModule: "Employee Records",
    auditAction: "Employee document access request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  try {
    const record = await getEmployeeRecordBackend(recordId, { includeDocuments: true });
    if (!record) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    const canAccess = canActorAccessOwner({
      session,
      ownerEmail: record.email,
    });
    if (!canAccess) {
      await logApiAudit({
        request,
        module: "Employee Records",
        activityName: "Employee document access blocked by ownership policy",
        status: "Rejected",
        sensitivity: "Sensitive",
        performedBy: session.email,
        metadata: {
          recordId,
          ownerEmail: record.email,
          role: session.role,
        },
      });
      return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    }

    const body = await parseJsonBody(request);
    const document = normalizeDocumentSummary(record, body);

    await logApiAudit({
      request,
      module: "Employee Records",
      activityName: "Employee document viewed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        recordRef: record.employeeId || recordId,
        employeeEmail: record.email,
        resourceType: "Employee Document",
        resourceLabel: document.name,
        viewedFields: ["documents"],
        accessedDocuments: [
          {
            id: document.id,
            name: document.name,
            type: document.type,
          },
        ],
        accessedDocumentCount: 1,
        documentRef: document.ref || null,
        auditNote: `Opened employee document "${document.name}".`,
        nextAction: "No further action required.",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to log employee document access.");
    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}
