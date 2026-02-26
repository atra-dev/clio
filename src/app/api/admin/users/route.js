import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { recordAuditEvent } from "@/lib/audit-log";
import { deliverInviteEmail } from "@/lib/invite-delivery";
import { inviteUserAccount, listUserAccounts, revokeInviteById } from "@/lib/user-accounts";

function extractDeliveryErrorInfo(reason) {
  const normalized = String(reason || "").trim();
  if (normalized.startsWith("email_delivery_failed:")) {
    return {
      code: "email_delivery_failed",
      providerMessage: normalized.slice("email_delivery_failed:".length).trim(),
    };
  }

  return {
    code: normalized || "email_delivery_failed",
    providerMessage: "",
  };
}

function parseBooleanEnv(name, fallbackValue = false) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase();
  if (!raw) {
    return fallbackValue;
  }
  return raw === "true" || raw === "1" || raw === "yes";
}

function isEmailDeliveryRequired() {
  const defaultRequired = process.env.NODE_ENV === "production";
  return parseBooleanEnv("CLIO_REQUIRE_EMAIL_DELIVERY", defaultRequired);
}

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    allowedRoles: ["SUPER_ADMIN", "GRC"],
    requiredPermissions: ["user_management:view"],
    auditModule: "User Management",
    auditAction: "User directory access",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const users = await listUserAccounts();

  return NextResponse.json({ users });
}

export async function POST(request) {
  const auth = await authorizeApiRequest(request, {
    allowedRoles: ["SUPER_ADMIN", "GRC"],
    requiredPermissions: ["user_management:manage"],
    auditModule: "User Management",
    auditAction: "User invitation request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const body = await request.json();
    const email = typeof body?.email === "string" ? body.email : "";
    const role = typeof body?.role === "string" ? body.role : "";
    const result = await inviteUserAccount({
      email,
      role,
      invitedBy: session.email,
    });
    const enforceDelivery = isEmailDeliveryRequired();
    let delivery = null;
    try {
      delivery = await deliverInviteEmail({
        toEmail: result.user.email,
        role: result.user.role,
        invitedBy: session.email,
        expiresAt: result.invite.expiresAt,
        inviteToken: result.invite.token,
        requestOrigin: request.nextUrl?.origin || "",
      });
    } catch (deliveryError) {
      const rawReason = deliveryError instanceof Error ? deliveryError.message : "email_delivery_failed";
      const deliveryErrorInfo = extractDeliveryErrorInfo(rawReason);
      const deliveryReason = deliveryErrorInfo.code;
      const shouldRevokeInvite = enforceDelivery;
      if (shouldRevokeInvite) {
        await revokeInviteById(result.invite.id).catch(() => null);
      }

      await recordAuditEvent({
        activityName: `Invite email delivery failed: ${result.user.email}`,
        status: "Failed",
        module: "User Management",
        performedBy: session.email,
        sensitivity: "Sensitive",
        metadata: {
          invitedEmail: result.user.email,
          inviteId: result.invite.id,
          reason: deliveryReason,
          providerMessage: deliveryErrorInfo.providerMessage || null,
          inviteAutoRevoked: shouldRevokeInvite,
          deliveryRequired: enforceDelivery,
        },
        request,
      });

      const failureMessage =
        deliveryReason === "email_provider_not_configured"
          ? "Email provider is not configured. For branded account-opening invites, set CLIO_EMAIL_PROVIDER=resend, RESEND_API_KEY, and CLIO_EMAIL_FROM."
          : deliveryReason === "firebase_api_key_not_configured"
            ? "Firebase API key is not configured. Set NEXT_PUBLIC_FIREBASE_API_KEY."
            : deliveryReason === "firebase_email_provider_not_enabled"
              ? "Firebase email-link provider is not enabled. Enable Email link (passwordless sign-in) in Firebase Authentication."
              : deliveryReason === "firebase_continue_url_invalid"
                ? "Firebase continue URL is invalid. Check NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN (or CLIO_APP_BASE_URL override) and authorize the domain in Firebase Authentication."
                : deliveryReason === "unsafe_app_base_url_for_production"
                  ? "Invite base URL is unsafe for production (localhost). Remove CLIO_APP_BASE_URL/NEXT_PUBLIC_APP_URL localhost overrides and use NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN."
                : deliveryReason === "invalid_email"
                  ? "Invalid invite email address."
          : deliveryReason === "unsupported_email_provider"
            ? "Unsupported email provider configuration."
            : deliveryReason === "email_delivery_failed" && deliveryErrorInfo.providerMessage
              ? `Email delivery failed: ${deliveryErrorInfo.providerMessage}`
              : "Unable to deliver invite email.";

      if (enforceDelivery) {
        return NextResponse.json(
          {
            message: `${failureMessage} Invitation was revoked automatically.`,
          },
          { status: 502 },
        );
      }

      delivery = {
        provider: "unavailable",
        status: "failed",
        messageId: null,
        reason: deliveryReason,
        providerMessage: deliveryErrorInfo.providerMessage || null,
      };

      await recordAuditEvent({
        activityName: `Invite delivery bypassed for test mode: ${result.user.email}`,
        status: "Completed",
        module: "User Management",
        performedBy: session.email,
        sensitivity: "Sensitive",
        metadata: {
          inviteId: result.invite.id,
          deliveryReason,
          providerMessage: deliveryErrorInfo.providerMessage || null,
          deliveryRequired: false,
        },
        request,
      });
    }

    await recordAuditEvent({
      activityName: `User invited (${result.user.role}): ${result.user.email}`,
      status: "Approved",
      module: "User Management",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        invitedEmail: result.user.email,
        invitedRole: result.user.role,
        inviteId: result.invite.id,
        invitationStatus: result.invite.status,
        deliveryProvider: delivery?.provider || "unknown",
        deliveryStatus: delivery?.status || "unknown",
      },
      request,
    });

    const invitePayload = {
      id: result.invite.id,
      email: result.invite.email,
      role: result.invite.role,
      invitedBy: result.invite.invitedBy,
      invitedAt: result.invite.invitedAt,
      expiresAt: result.invite.expiresAt,
      status: result.invite.status,
    };

    return NextResponse.json(
      {
        ok: true,
        user: result.user,
        invite: invitePayload,
        delivery,
        ...(delivery?.status === "failed"
          ? {
              warning: "Invite email delivery failed in test mode.",
            }
          : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";

    await recordAuditEvent({
      activityName: "User invitation failed",
      status: "Failed",
      module: "User Management",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        reason,
      },
      request,
    });

    const message =
      reason === "invalid_email"
        ? "Invalid email address."
        : reason === "invalid_role"
          ? "Invalid role selected."
          : reason === "email_provider_not_configured"
            ? "Email provider is not configured."
            : reason === "unsupported_email_provider"
              ? "Unsupported email provider."
          : "Unable to create invitation.";

    return NextResponse.json({ message }, { status: 400 });
  }
}
