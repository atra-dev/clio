from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch


def draw_box(ax, x, y, w, h, title, lines, face="#ffffff", edge="#b8c7db"):
    box = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.012,rounding_size=0.015",
        linewidth=1.5,
        edgecolor=edge,
        facecolor=face,
    )
    ax.add_patch(box)

    ax.text(
        x + 0.012,
        y + h - 0.03,
        title,
        fontsize=11,
        fontweight="bold",
        color="#0f2942",
        va="top",
        ha="left",
    )

    ax.text(
        x + 0.012,
        y + h - 0.06,
        "\n".join(lines),
        fontsize=9,
        color="#233647",
        va="top",
        ha="left",
        linespacing=1.25,
    )


def arrow(ax, start, end, color="#5f7ea3", curve=0.0):
    patch = FancyArrowPatch(
        start,
        end,
        arrowstyle="-|>",
        mutation_scale=13,
        linewidth=1.3,
        color=color,
        connectionstyle=f"arc3,rad={curve}",
    )
    ax.add_patch(patch)


def main():
    output_dir = Path("docs/architecture")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_png = output_dir / "clio-system-architecture.png"

    fig, ax = plt.subplots(figsize=(18, 11), dpi=180)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    fig.patch.set_facecolor("#f4f8fc")
    ax.set_facecolor("#f4f8fc")

    ax.text(
        0.03,
        0.965,
        "Project CLIO - HRIS System Architecture",
        fontsize=20,
        fontweight="bold",
        color="#10243d",
        ha="left",
        va="top",
    )
    ax.text(
        0.03,
        0.935,
        "Next.js (App Router) + Firebase Auth + Firestore (databaseId: cliohris) + RBAC + Audit Logging",
        fontsize=11,
        color="#2f4a63",
        ha="left",
        va="top",
    )

    # Row 1: Actors
    draw_box(
        ax,
        0.04,
        0.79,
        0.22,
        0.12,
        "Actors / Clients",
        [
            "Super Admin",
            "HR, GRC, EA, Employees (L1/L2/L3)",
            "Invited users via email verification link",
        ],
        face="#ffffff",
    )

    # Row 2: Frontend
    draw_box(
        ax,
        0.32,
        0.74,
        0.30,
        0.20,
        "Next.js Frontend (src/app + src/components)",
        [
            "Public pages: /login, /verify-invite, /unauthorized",
            "Protected HRIS pages: dashboard, employees, attendance,",
            "performance, documents, exports, settings, user-management",
            "Client auth: Google popup + MFA resolver (TOTP path active)",
        ],
        face="#fdfefe",
    )

    draw_box(
        ax,
        0.68,
        0.74,
        0.27,
        0.20,
        "Firebase Authentication (External Service)",
        [
            "Google provider for sign-in",
            "Invite email delivery via sendOobCode (EMAIL_SIGNIN)",
            "ID token identity lookup",
            "MFA policy configured in Firebase project",
        ],
        face="#eef6ff",
        edge="#8fb2d8",
    )

    # Row 3: Edge/Auth controls
    draw_box(
        ax,
        0.04,
        0.52,
        0.28,
        0.18,
        "Edge + Session Controls",
        [
            "middleware.ts: route guarding + strips role query param",
            "auth-session.ts: signed cookie (clio_session)",
            "server-authorization.ts + api-authorization.ts",
            "RBAC + ownership validation on API/module access",
        ],
        face="#ffffff",
    )

    draw_box(
        ax,
        0.36,
        0.50,
        0.28,
        0.22,
        "Next.js API Layer (src/app/api)",
        [
            "Auth APIs: /api/auth/login, logout, profile, role",
            "User Mgmt APIs: /api/admin/users, /status",
            "Invite Verification: /api/invite/verify",
            "Audit endpoint: /api/audit/page-view",
        ],
        face="#ffffff",
    )

    draw_box(
        ax,
        0.68,
        0.50,
        0.27,
        0.22,
        "Service / Domain Layer (src/lib)",
        [
            "user-accounts.ts: invites, account status, login account lookup",
            "invite-delivery.ts: provider abstraction (firebase/resend/console)",
            "firebase-auth-identity.ts: verify Firebase id token",
            "audit-log.ts: write/read audit events",
            "rbac.ts + hris.ts: permissions and module matrix",
        ],
        face="#fdfefe",
    )

    # Row 4: Data
    draw_box(
        ax,
        0.36,
        0.24,
        0.28,
        0.20,
        "Firestore (cliohris database)",
        [
            "Collections:",
            "- clio_users",
            "- clio_user_invites",
            "- clio_audit_logs",
            "Primary persistence for CLIO project data",
        ],
        face="#eef6ff",
        edge="#8fb2d8",
    )

    draw_box(
        ax,
        0.68,
        0.24,
        0.27,
        0.20,
        "Local Fallback Store (Dev/Failover)",
        [
            "data/user-accounts.json",
            "data/audit-log.ndjson",
            "Used when Firestore is unavailable/erroring",
        ],
        face="#ffffff",
    )

    draw_box(
        ax,
        0.04,
        0.24,
        0.28,
        0.20,
        "Security + Compliance Controls",
        [
            "RBAC enforced server-side (not UI hide only)",
            "Invite-first onboarding and verification gate",
            "Sensitive action audit events",
            "Session cookie + authorization checks per API request",
        ],
        face="#ffffff",
    )

    # Arrows
    arrow(ax, (0.26, 0.85), (0.32, 0.84))  # actors -> frontend
    arrow(ax, (0.62, 0.84), (0.68, 0.84))  # frontend -> firebase auth
    arrow(ax, (0.46, 0.74), (0.50, 0.72))  # frontend -> api
    arrow(ax, (0.20, 0.70), (0.20, 0.52))  # frontend/mw relation
    arrow(ax, (0.32, 0.60), (0.36, 0.60))  # controls -> api
    arrow(ax, (0.64, 0.61), (0.68, 0.61))  # api -> services
    arrow(ax, (0.79, 0.50), (0.79, 0.44))  # services -> firebase auth/email
    arrow(ax, (0.50, 0.50), (0.50, 0.44))  # api/services -> firestore
    arrow(ax, (0.82, 0.50), (0.82, 0.44), curve=-0.25)  # services -> local fallback
    arrow(ax, (0.46, 0.50), (0.22, 0.44), curve=0.08)  # api -> security controls
    arrow(ax, (0.79, 0.74), (0.58, 0.66), curve=0.05)  # firebase auth -> api validation path

    # Flow legend
    legend_x, legend_y, legend_w, legend_h = 0.04, 0.05, 0.91, 0.13
    draw_box(
        ax,
        legend_x,
        legend_y,
        legend_w,
        legend_h,
        "Key Runtime Flows",
        [
            "1) Super Admin invites user -> API creates invite/user record -> Firebase sends email link -> user verifies via /verify-invite.",
            "2) User signs in with Google -> API verifies Firebase ID token + RBAC/user state + invite verification -> session cookie issued.",
            "3) Protected pages call APIs -> authorization middleware + ownership checks -> Firestore writes + audit logging.",
        ],
        face="#ffffff",
    )

    fig.savefig(output_png, bbox_inches="tight")
    plt.close(fig)

    print(f"Generated: {output_png}")


if __name__ == "__main__":
    main()
