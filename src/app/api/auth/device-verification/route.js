import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { recordAuditEvent } from "@/lib/audit-log";
import { createIncidentRecordBackend } from "@/lib/hris-backend";
import {
  createInAppNotificationsBulk,
  getInAppNotificationForRecipient,
  resolveDeviceVerificationNotification,
  resolveGrcRecipients,
} from "@/lib/security-notifications";
import { buildIncidentCreatedNotification } from "@/lib/incident-notification-text";
import { revokeUserSessions, updateLoginDeviceTrust } from "@/lib/user-accounts";

function normalizeDecision(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "confirm" || normalized === "yes") return "confirm";
  if (normalized === "deny" || normalized === "no") return "deny";
  return "";
}

function asString(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export async function POST(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["resource:own"],
    ownerIdentifier: (session) => session.email,
    ownerBypassRoles: ["SUPER_ADMIN", "GRC", "HR", "EA", "EMPLOYEE_L1", "EMPLOYEE_L2", "EMPLOYEE_L3"],
    auditModule: "Authentication",
    auditAction: "Device verification response",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const body = await request.json().catch(() => ({}));
    const recordId = asString(body?.notificationId);
    const decision = normalizeDecision(body?.decision);

    if (!recordId || !decision) {
      return NextResponse.json({ message: "Invalid device verification request." }, { status: 400 });
    }

    const notification = await getInAppNotificationForRecipient(recordId, session.email);
    if (!notification) {
      return NextResponse.json({ message: "Notification not found." }, { status: 404 });
    }

    const metadata = notification?.metadata && typeof notification.metadata === "object" ? notification.metadata : {};
    const existingDecisionRaw = asString(metadata?.deviceVerificationDecision).toLowerCase();
    const existingDecision =
      existingDecisionRaw === "confirmed"
        ? "confirm"
        : existingDecisionRaw === "denied"
          ? "deny"
          : existingDecisionRaw;
    if (existingDecision) {
      if (existingDecision === decision) {
        return NextResponse.json({ ok: true, decision: existingDecision, alreadyResolved: true });
      }
      return NextResponse.json(
        { message: `Device verification already submitted as ${existingDecision}.` },
        { status: 409 },
      );
    }

    const deviceId = asString(metadata?.deviceId);
    const deviceLabel = asString(metadata?.deviceLabel, "Unknown device");
    const sourceIp = asString(metadata?.sourceIp, "unknown");
    const userAgent = asString(metadata?.userAgent, "unknown");

    if (!deviceId) {
      return NextResponse.json({ message: "Device reference is missing." }, { status: 400 });
    }

    if (decision === "confirm") {
      await updateLoginDeviceTrust({
        email: session.email,
        deviceId,
        trusted: true,
      });
      await resolveDeviceVerificationNotification(recordId, session.email, "confirm");

      await recordAuditEvent({
        activityName: "Device verification confirmed",
        status: "Completed",
        module: "Authentication",
        performedBy: session.email,
        sensitivity: "Sensitive",
        metadata: {
          deviceId,
          deviceLabel,
          sourceIp,
        },
        request,
      });

      return NextResponse.json({ ok: true, decision: "confirm" });
    }

    await updateLoginDeviceTrust({
      email: session.email,
      deviceId,
      trusted: false,
      deniedReason: "user_reported",
    });
    await revokeUserSessions({ userId: session.email }).catch(() => null);
    await resolveDeviceVerificationNotification(recordId, session.email, "deny");

    const incident = await createIncidentRecordBackend(
      {
        title: "Unrecognized device login reported",
        summary: `User ${session.email} reported an unrecognized device login from ${deviceLabel}. Source IP: ${sourceIp}.`,
        incidentType: "Unauthorized Access",
        severity: "High",
        status: "Open",
        restrictedPiiInvolved: false,
        affectedEmployeeEmail: session.email,
        ownerEmail: session.email,
      },
      session.email,
    );

    const recipients = await resolveGrcRecipients();
    if (recipients.length > 0 && incident) {
      const incidentActionUrl = `/incident-management?incident=${encodeURIComponent(incident.id)}`;
      const notificationCopy = buildIncidentCreatedNotification(incident, incident.id);
      const payloads = recipients.map((recipientEmail) => ({
        title: notificationCopy.title,
        message: `User reported unrecognized login. ${notificationCopy.message}`,
        severity: incident.severity || "High",
        type: "incident-created",
        module: "Incident Management",
        actionUrl: incidentActionUrl,
        recipientEmail,
        metadata: {
          incidentId: incident.id,
          incidentCode: incident.incidentCode || "",
          reportedBy: session.email,
          deviceLabel,
          sourceIp,
          userAgent,
        },
        createdBy: session.email,
      }));
      await createInAppNotificationsBulk(payloads);
    }

    await recordAuditEvent({
      activityName: "Device verification denied (incident created)",
      status: "Completed",
      module: "Authentication",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        deviceId,
        deviceLabel,
        sourceIp,
        incidentId: incident?.id || null,
        incidentCode: incident?.incidentCode || null,
      },
      request,
    });

    return NextResponse.json({ ok: true, decision: "deny", incidentId: incident?.id || null });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "device_verification_failed";
    const status = reason === "device_verification_already_resolved" ? 409 : 400;
    return NextResponse.json({ message: "Unable to process device verification.", reason }, { status });
  }
}
