import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { recordAuditEvent } from "@/lib/audit-log";
import { formatPersonName } from "@/lib/name-utils";
import { getLoginAccount, updateUserAccountProfile } from "@/lib/user-accounts";

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
  const targetEmail = requestedEmail || session.email;
  const account = await getLoginAccount(targetEmail);
  const firstName = String(account?.firstName || "");
  const middleName = String(account?.middleName || "");
  const lastName = String(account?.lastName || "");
  const profilePhotoDataUrl = typeof account?.profilePhotoDataUrl === "string" ? account.profilePhotoDataUrl : null;
  const profilePhotoStoragePath =
    typeof account?.profilePhotoStoragePath === "string" ? account.profilePhotoStoragePath : null;
  const phoneVerifiedAt = typeof account?.phoneVerifiedAt === "string" ? account.phoneVerifiedAt : null;
  const phoneLast4 = typeof account?.phoneLast4 === "string" ? account.phoneLast4 : null;
  const smsMfaEnabled = Boolean(account?.smsMfaEnabled);
  const role = account?.role || session.role;

  await recordAuditEvent({
    activityName: "Profile viewed",
    status: "Completed",
    module: "Authentication",
    performedBy: session.email,
    sensitivity: "Non-sensitive",
    metadata: {
      targetEmail,
      ownerView: targetEmail === session.email,
    },
    request,
  });

  return NextResponse.json({
    email: targetEmail,
    role,
    firstName,
    middleName,
    lastName,
    displayName: formatPersonName({
      firstName,
      middleName,
      lastName,
      fallbackEmail: targetEmail,
      fallbackLabel: "Clio User",
    }),
    profilePhotoDataUrl,
    profilePhotoStoragePath,
    phoneVerifiedAt,
    phoneLast4,
    smsMfaEnabled,
  });
}

export async function PUT(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["resource:own"],
    ownerIdentifier: (session) => session.email,
    ownerBypassRoles: ["SUPER_ADMIN"],
    auditModule: "Authentication",
    auditAction: "Profile update request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const body = await request.json();
    const updated = await updateUserAccountProfile({
      userId: session.email,
      firstName: body?.firstName,
      middleName: body?.middleName,
      lastName: body?.lastName,
      profilePhotoDataUrl: body?.profilePhotoDataUrl,
      profilePhotoStoragePath: body?.profilePhotoStoragePath,
      smsMfaEnabled: typeof body?.smsMfaEnabled === "boolean" ? body.smsMfaEnabled : undefined,
    });

    if (!updated) {
      return NextResponse.json({ message: "Account profile not found." }, { status: 404 });
    }

    await recordAuditEvent({
      activityName: "Profile updated",
      status: "Completed",
      module: "Authentication",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        fieldsUpdated: [
          "firstName",
          "middleName",
          "lastName",
          "profilePhotoDataUrl",
          "profilePhotoStoragePath",
          ...(typeof body?.smsMfaEnabled === "boolean" ? ["smsMfaEnabled"] : []),
        ],
      },
      request,
    });

    const firstName = String(updated.firstName || "");
    const middleName = String(updated.middleName || "");
    const lastName = String(updated.lastName || "");

    return NextResponse.json({
      ok: true,
      profile: {
        email: updated.email,
        role: updated.role,
        firstName,
        middleName,
        lastName,
        displayName: formatPersonName({
          firstName,
          middleName,
          lastName,
          fallbackEmail: updated.email,
          fallbackLabel: "Clio User",
        }),
        profilePhotoDataUrl: updated.profilePhotoDataUrl || null,
        profilePhotoStoragePath: updated.profilePhotoStoragePath || null,
        profileUpdatedAt: updated.profileUpdatedAt || null,
        phoneVerifiedAt: updated.phoneVerifiedAt || null,
        phoneLast4: updated.phoneLast4 || null,
        smsMfaEnabled: Boolean(updated.smsMfaEnabled),
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "profile_update_failed";

    await recordAuditEvent({
      activityName: "Profile update failed",
      status: "Failed",
      module: "Authentication",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        reason,
      },
      request,
    });

    const message =
      reason === "invalid_name"
        ? "Invalid name format."
        : reason === "invalid_profile_photo"
          ? "Invalid profile picture. Use PNG/JPG/WEBP under 1.5MB."
          : reason === "invalid_storage_path"
            ? "Invalid storage path for profile picture."
          : reason === "mfa_phone_not_verified"
            ? "Verify a mobile number first before enabling SMS MFA."
          : "Unable to update profile.";

    return NextResponse.json({ message }, { status: 400 });
  }
}
