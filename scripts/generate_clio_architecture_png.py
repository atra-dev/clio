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
    fig.patch.set_facecolor("#f3f7fc")
    ax.set_facecolor("#f3f7fc")

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
        "Next.js + Firebase Auth + Firestore (databaseId: cliohris) + Firebase Storage + RBAC + IDS + Incident Response",
        fontsize=11,
        color="#2f4a63",
        ha="left",
        va="top",
    )

    # Row 1: Actors + Client + Identity
    draw_box(
        ax,
        0.03,
        0.76,
        0.24,
        0.16,
        "Actors / Access Roles",
        [
            "Super Admin",
            "GRC, HR, EA, Employee",
            "Invite-first onboarding + verified user activation",
            "Role-specific dashboard and module access",
        ],
        face="#ffffff",
    )

    draw_box(
        ax,
        0.31,
        0.72,
        0.30,
        0.22,
        "Client Layer - Next.js Frontend",
        [
            "Public: login, invite verify, unauthorized",
            "Workspace: dashboard + role-based module navigation",
            "Core modules: employee records, lifecycle, attendance,",
            "performance, document repo, audit logs, reports/exports,",
            "access management, retention/archive, incident management",
        ],
        face="#fdfefe",
    )

    draw_box(
        ax,
        0.66,
        0.72,
        0.31,
        0.22,
        "Identity Layer - Firebase Authentication",
        [
            "Google provider for sign-in",
            "Invite verification gate before account usage",
            "ID token verification + session creation path",
            "Optional MFA policy at Firebase project level",
        ],
        face="#eef6ff",
        edge="#8fb2d8",
    )

    # Row 2: Security + API + Domain Services
    draw_box(
        ax,
        0.03,
        0.52,
        0.24,
        0.20,
        "Security Gateway",
        [
            "Middleware route guarding + role route isolation",
            "Signed session cookie + stale session checks",
            "API authorization: RBAC + ownership validation",
            "Rate limiting on sensitive incident endpoints",
        ],
        face="#ffffff",
    )

    draw_box(
        ax,
        0.31,
        0.50,
        0.30,
        0.22,
        "Application API Layer (src/app/api)",
        [
            "Auth APIs, invite/verify, user/account management",
            "Module APIs: employees, lifecycle, attendance,",
            "performance, templates, exports, retention, incidents",
            "Notification APIs and role-protected data endpoints",
        ],
        face="#ffffff",
    )

    draw_box(
        ax,
        0.66,
        0.50,
        0.31,
        0.22,
        "Service / Domain Layer (src/lib + src/services)",
        [
            "RBAC matrix + permission middleware helpers",
            "HRIS backend services for module workflows",
            "Audit log writer + field-level trace metadata",
            "Incident detection (IDS), queue retry, dead-letter",
            "Security notification and alert dispatch services",
        ],
        face="#fdfefe",
    )

    # Row 3: Data + Security Ops
    draw_box(
        ax,
        0.31,
        0.23,
        0.30,
        0.21,
        "Data Layer - Firestore + Storage",
        [
            "Firestore (databaseId: cliohris):",
            "clio_users, employees, attendance, performance,",
            "employment_lifecycle, clio_audit_logs, incidents,",
            "notifications, retention/archive collections",
            "Storage bucket: gs://atracaas-platform-clio",
        ],
        face="#eef6ff",
        edge="#8fb2d8",
    )

    draw_box(
        ax,
        0.66,
        0.23,
        0.31,
        0.21,
        "Security Operations Layer",
        [
            "Tamper-evident audit trails across CRUD/view/export",
            "Incident management: escalation, 72-hour response,",
            "forensic logging (access, export, admin, delete)",
            "IDS anomaly detection -> auto incident + alerts",
            "Retry queue and dead-letter for failed detections",
        ],
        face="#f8fcff",
        edge="#8fb2d8",
    )

    draw_box(
        ax,
        0.03,
        0.24,
        0.24,
        0.21,
        "Compliance + Protection Controls",
        [
            "Least privilege and segregation of duties",
            "Restricted PII masking + controlled access",
            "Retention/archive policy + delayed purge workflow",
            "Security headers, CSP, HSTS (prod), provider fail-fast",
        ],
        face="#ffffff",
    )

    # Arrows
    arrow(ax, (0.27, 0.84), (0.31, 0.83))  # actors -> frontend
    arrow(ax, (0.61, 0.83), (0.66, 0.83))  # frontend -> identity
    arrow(ax, (0.46, 0.72), (0.46, 0.64))  # frontend -> api
    arrow(ax, (0.20, 0.76), (0.16, 0.62))  # actors -> gateway
    arrow(ax, (0.27, 0.62), (0.31, 0.62))  # gateway -> api
    arrow(ax, (0.61, 0.62), (0.66, 0.62))  # api -> services
    arrow(ax, (0.46, 0.50), (0.46, 0.44))  # api -> data
    arrow(ax, (0.82, 0.50), (0.82, 0.44))  # services -> security ops
    arrow(ax, (0.66, 0.82), (0.55, 0.64), curve=0.05)  # identity -> api
    arrow(ax, (0.82, 0.72), (0.82, 0.64), curve=0.0)  # identity -> services
    arrow(ax, (0.61, 0.33), (0.66, 0.33))  # data -> sec ops
    arrow(ax, (0.31, 0.33), (0.27, 0.33))  # data -> compliance
    arrow(ax, (0.82, 0.23), (0.55, 0.18), curve=-0.05)  # sec ops -> flows

    # Flow legend
    legend_x, legend_y, legend_w, legend_h = 0.03, 0.04, 0.94, 0.14
    draw_box(
        ax,
        legend_x,
        legend_y,
        legend_w,
        legend_h,
        "Key Runtime Flows",
        [
            "1) Onboarding/invite flow: authorized role creates user/account context -> invite verification -> Google sign-in enabled.",
            "2) Secure request flow: frontend -> API authz (session, RBAC, ownership, rate-limit) -> domain service -> Firestore/Storage.",
            "3) Security flow: audit event stream -> IDS anomaly detection -> auto incident + in-app alerts + forensic traceability.",
            "4) Data governance flow: offboarding/retention rules move records to archive and enforce controlled post-retention deletion.",
        ],
        face="#ffffff",
    )

    fig.savefig(output_png, bbox_inches="tight")
    plt.close(fig)

    print(f"Generated: {output_png}")


if __name__ == "__main__":
    main()
