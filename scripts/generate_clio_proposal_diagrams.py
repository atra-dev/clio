from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import Ellipse, FancyArrowPatch, FancyBboxPatch, Rectangle


BG = "#f3f3f3"
GRID = "#e1e1e1"
BOX_EDGE = "#3b3b3b"
TEXT = "#1f1f1f"
ACCENT_BLUE = "#3269b1"
ACCENT_GREEN = "#3f8f5a"
ACCENT_PURPLE = "#6a4fc9"


def setup_canvas(title, subtitle="", figsize=(16, 9)):
    fig, ax = plt.subplots(figsize=figsize, dpi=170)
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    # Subtle square grid similar to architecture tools.
    steps = 50
    for i in range(steps + 1):
        p = i / steps
        ax.plot([p, p], [0, 1], color=GRID, linewidth=0.35, zorder=0)
        ax.plot([0, 1], [p, p], color=GRID, linewidth=0.35, zorder=0)

    ax.text(0.02, 0.975, title, fontsize=20, weight="bold", color=TEXT, va="top", ha="left")
    if subtitle:
        ax.text(0.02, 0.945, subtitle, fontsize=10, color="#3f3f3f", va="top", ha="left")
    return fig, ax


def draw_layer(ax, x, y, w, h, title, edge):
    box = Rectangle((x, y), w, h, linewidth=1.4, edgecolor=edge, facecolor="none")
    ax.add_patch(box)
    ax.text(x + w / 2, y + h - 0.015, title, fontsize=11, color=TEXT, ha="center", va="top")


def draw_rect(ax, x, y, w, h, text, fontsize=9.5, fill="#f8f8f8", edge=BOX_EDGE):
    box = Rectangle((x, y), w, h, linewidth=1.2, edgecolor=edge, facecolor=fill)
    ax.add_patch(box)
    ax.text(x + w / 2, y + h / 2, text, fontsize=fontsize, color=TEXT, ha="center", va="center")


def draw_round(ax, x, y, w, h, text, fontsize=10, fill="#f8f8f8", edge=BOX_EDGE):
    box = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.01,rounding_size=0.02",
        linewidth=1.3,
        edgecolor=edge,
        facecolor=fill,
    )
    ax.add_patch(box)
    ax.text(x + w / 2, y + h / 2, text, fontsize=fontsize, color=TEXT, ha="center", va="center")


def draw_bullet_panel(ax, x, y, w, h, title, lines, fontsize=8):
    box = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.01,rounding_size=0.02",
        linewidth=1.2,
        edgecolor=BOX_EDGE,
        facecolor="#f9f9f9",
    )
    ax.add_patch(box)
    ax.text(x + 0.015, y + h - 0.02, title, fontsize=8.6, weight="bold", color=TEXT, ha="left", va="top")

    line_y = y + h - 0.05
    for item in lines[:4]:
        ax.text(x + 0.018, line_y, f"- {item}", fontsize=fontsize, color="#333333", ha="left", va="top")
        line_y -= 0.028


def draw_ellipse(ax, x, y, w, h, text, fontsize=10):
    shape = Ellipse((x + w / 2, y + h / 2), w, h, linewidth=1.2, edgecolor=BOX_EDGE, facecolor="#f8f8f8")
    ax.add_patch(shape)
    ax.text(x + w / 2, y + h / 2, text, fontsize=fontsize, color=TEXT, ha="center", va="center")


def draw_database(ax, x, y, w, h, title, subtitle=""):
    body_h = h - 0.05
    body = Rectangle((x, y + 0.025), w, body_h, linewidth=1.2, edgecolor=BOX_EDGE, facecolor="#f8f8f8")
    ax.add_patch(body)
    top = Ellipse((x + w / 2, y + h - 0.005), w, 0.05, linewidth=1.2, edgecolor=BOX_EDGE, facecolor="#f8f8f8")
    bottom = Ellipse((x + w / 2, y + 0.025), w, 0.05, linewidth=1.2, edgecolor=BOX_EDGE, facecolor="#f8f8f8")
    ax.add_patch(top)
    ax.add_patch(bottom)
    ax.text(x + w / 2, y + h / 2 + 0.02, title, fontsize=9.5, color=TEXT, ha="center", va="center")
    if subtitle:
        ax.text(x + w / 2, y + h / 2 - 0.02, subtitle, fontsize=8.3, color="#444444", ha="center", va="center")


def arrow(ax, start, end, label="", curve=0.0):
    patch = FancyArrowPatch(
        start,
        end,
        arrowstyle="-|>",
        mutation_scale=12,
        linewidth=1.2,
        color="#424242",
        connectionstyle=f"arc3,rad={curve}",
    )
    ax.add_patch(patch)
    if label:
        mx = (start[0] + end[0]) / 2
        my = (start[1] + end[1]) / 2
        ax.text(mx, my + 0.012, label, fontsize=8, color="#383838", ha="center", va="bottom")


def generate_layered_architecture(output_path):
    fig, ax = setup_canvas(
        "Project CLIO - System Architecture",
        "Current implementation view: Security, Client, Identity, API/Services, Data, Audit + Incident Response",
        figsize=(18, 10),
    )

    draw_layer(ax, 0.02, 0.80, 0.42, 0.18, "Security Layer", ACCENT_GREEN)
    draw_layer(ax, 0.46, 0.78, 0.22, 0.20, "Client Layer", ACCENT_BLUE)
    draw_layer(ax, 0.70, 0.78, 0.28, 0.20, "Identity Layer", ACCENT_PURPLE)
    draw_layer(ax, 0.03, 0.47, 0.44, 0.28, "API + Domain Layer", ACCENT_GREEN)
    draw_layer(ax, 0.49, 0.43, 0.24, 0.32, "Data Layer", ACCENT_BLUE)
    draw_layer(ax, 0.75, 0.43, 0.23, 0.32, "Audit + Incident Layer", ACCENT_PURPLE)

    # Security controls
    draw_rect(ax, 0.05, 0.89, 0.11, 0.055, "RBAC")
    draw_rect(ax, 0.18, 0.89, 0.13, 0.055, "Ownership / IDOR Check")
    draw_rect(ax, 0.33, 0.89, 0.09, 0.055, "Rate Limit")
    draw_rect(ax, 0.05, 0.82, 0.17, 0.055, "CSP + HSTS + Security Headers")
    draw_rect(ax, 0.24, 0.82, 0.18, 0.055, "Session Validation + Role Sync")

    # Client layer
    draw_rect(ax, 0.50, 0.90, 0.14, 0.055, "Web Browser")
    draw_rect(ax, 0.50, 0.83, 0.14, 0.055, "Next.js UI (App Router)")
    draw_rect(ax, 0.50, 0.76, 0.14, 0.055, "Role-Based Sidebar")

    # Identity layer
    draw_rect(ax, 0.75, 0.90, 0.19, 0.055, "Firebase Auth (Google)")
    draw_rect(ax, 0.75, 0.83, 0.19, 0.055, "Invite Verify + Session Issue")
    draw_rect(ax, 0.75, 0.76, 0.19, 0.055, "Optional MFA Policy")

    # API + domain
    draw_rect(ax, 0.06, 0.67, 0.18, 0.06, "API Routes (/api/hris/*)")
    draw_rect(ax, 0.26, 0.67, 0.18, 0.06, "Auth/Invite/User APIs")
    draw_rect(ax, 0.06, 0.59, 0.18, 0.06, "Employee/Lifecycle APIs")
    draw_rect(ax, 0.26, 0.59, 0.18, 0.06, "Attendance/Performance APIs")
    draw_rect(ax, 0.06, 0.51, 0.18, 0.06, "Exports/Retention APIs")
    draw_rect(ax, 0.26, 0.51, 0.18, 0.06, "Incident/Notification APIs")

    # Data layer
    draw_database(ax, 0.53, 0.60, 0.16, 0.11, "Firestore", "databaseId: cliohris")
    draw_rect(ax, 0.51, 0.51, 0.20, 0.06, "Collections: users, employees,")
    draw_rect(ax, 0.51, 0.445, 0.20, 0.06, "attendance, lifecycle, performance,")
    draw_rect(ax, 0.51, 0.38, 0.20, 0.06, "exports, incidents, notifications, audit")
    draw_database(ax, 0.53, 0.28, 0.16, 0.11, "Firebase Storage", "gs://atracaas-platform-clio")

    # Audit + incident
    draw_rect(ax, 0.78, 0.66, 0.17, 0.06, "Audit Log Writer")
    draw_rect(ax, 0.78, 0.58, 0.17, 0.06, "Forensic Log Views")
    draw_rect(ax, 0.78, 0.50, 0.17, 0.06, "IDS Detection Rules")
    draw_rect(ax, 0.78, 0.42, 0.17, 0.06, "Retry Queue + Dead Letter")
    draw_rect(ax, 0.78, 0.34, 0.17, 0.06, "Incident Mgmt + Alerts")

    # Arrows
    arrow(ax, (0.42, 0.92), (0.50, 0.92))
    arrow(ax, (0.64, 0.92), (0.75, 0.92))
    arrow(ax, (0.57, 0.83), (0.35, 0.70), curve=-0.05)
    arrow(ax, (0.75, 0.86), (0.44, 0.70), curve=0.05)
    arrow(ax, (0.24, 0.67), (0.53, 0.66))
    arrow(ax, (0.44, 0.59), (0.53, 0.59))
    arrow(ax, (0.44, 0.51), (0.53, 0.51))
    arrow(ax, (0.69, 0.64), (0.78, 0.69))
    arrow(ax, (0.69, 0.56), (0.78, 0.61))
    arrow(ax, (0.69, 0.48), (0.78, 0.53))
    arrow(ax, (0.86, 0.50), (0.86, 0.48))
    arrow(ax, (0.86, 0.42), (0.86, 0.40))
    arrow(ax, (0.78, 0.37), (0.69, 0.34), curve=-0.08)
    arrow(ax, (0.53, 0.33), (0.44, 0.55), curve=0.08)
    arrow(ax, (0.29, 0.89), (0.16, 0.72), curve=-0.08)

    fig.savefig(output_path, bbox_inches="tight")
    plt.close(fig)


def generate_role_dfd(output_path, role_title, actor_lines, process_label, action_lines, db_label, audit_lines, notes):
    fig, ax = setup_canvas(f"{role_title} Data Flow Diagram", "Project CLIO Role-Centric Operational Flow", figsize=(16, 8))

    # External actors
    y = 0.72
    for line in actor_lines:
        draw_rect(ax, 0.04, y, 0.14, 0.08, line, fontsize=8.6)
        y -= 0.11

    # Role gateway and core process
    draw_rect(ax, 0.23, 0.56, 0.14, 0.08, role_title)
    draw_ellipse(ax, 0.45, 0.49, 0.18, 0.16, process_label, fontsize=9.6)
    draw_rect(ax, 0.41, 0.70, 0.22, 0.06, "RBAC + Ownership Validation", fontsize=8.7)

    # Action stack
    action_y = 0.73
    for item in action_lines:
        draw_rect(ax, 0.68, action_y, 0.16, 0.065, item, fontsize=8.3)
        action_y -= 0.09

    # Data stores
    draw_database(ax, 0.88, 0.48, 0.09, 0.22, "CLIO DB", db_label)
    draw_database(ax, 0.88, 0.18, 0.09, 0.20, "Audit Logs", "Tamper-resistant")

    # Notes and audit panels (split to avoid text overlap)
    draw_bullet_panel(ax, 0.25, 0.16, 0.29, 0.16, "Audit Focus", audit_lines, fontsize=8)
    draw_bullet_panel(ax, 0.56, 0.16, 0.22, 0.16, "Security Notes", notes, fontsize=8)

    # Arrows
    first_actor_center = (0.18, 0.76)
    arrow(ax, first_actor_center, (0.23, 0.60), "Access")
    if len(actor_lines) > 1:
        arrow(ax, (0.18, 0.65), (0.23, 0.60), curve=0.05)
    if len(actor_lines) > 2:
        arrow(ax, (0.18, 0.54), (0.23, 0.60), curve=0.09)

    arrow(ax, (0.37, 0.60), (0.45, 0.57), "Authorized request")
    arrow(ax, (0.52, 0.70), (0.52, 0.65), "Policy checks")

    action_centers = [0.762, 0.672, 0.582, 0.492, 0.402]
    for cy in action_centers[: len(action_lines)]:
        arrow(ax, (0.63, 0.57), (0.68, cy), curve=0.02)

    arrow(ax, (0.84, 0.63), (0.88, 0.60), "Read/Write")
    arrow(ax, (0.84, 0.36), (0.88, 0.28), "Audit event")
    arrow(ax, (0.88, 0.56), (0.63, 0.53), "Data response", curve=-0.1)
    arrow(ax, (0.93, 0.48), (0.93, 0.38))
    arrow(ax, (0.63, 0.49), (0.46, 0.32), curve=-0.12)

    fig.savefig(output_path, bbox_inches="tight")
    plt.close(fig)


def main():
    out = Path("docs/architecture")
    out.mkdir(parents=True, exist_ok=True)

    generate_layered_architecture(out / "clio-system-architecture-proposal.png")

    generate_role_dfd(
        out / "clio-dfd-super-admin.png",
        role_title="Super Admin",
        actor_lines=["Super Admin", "Security Lead"],
        process_label="Account Governance Console",
        action_lines=[
            "Create Invite / Account",
            "Assign Account Role",
            "Disable / Enable Account",
            "Revoke Sessions",
            "Audit Admin Actions",
        ],
        db_label="users + invites",
        audit_lines=[
            "Actor identity",
            "Before/after role state",
            "Invite + status transition",
            "Source IP and device",
        ],
        notes=[
            "No shared accounts",
            "Least privilege enforcement",
            "Session version invalidation",
            "Admin actions fully auditable",
        ],
    )

    generate_role_dfd(
        out / "clio-dfd-grc.png",
        role_title="GRC",
        actor_lines=["GRC Officer", "Compliance Auditor", "Executive Committee"],
        process_label="Governance, Risk, Compliance Ops",
        action_lines=[
            "Full Records Oversight",
            "Audit + Forensic Review",
            "Access Management Review",
            "Retention & Archive Control",
            "Incident Response Handling",
        ],
        db_label="all HRIS modules",
        audit_lines=[
            "PII access event",
            "Export volume and format",
            "Incident timeline",
            "Reviewer identity",
        ],
        notes=[
            "Full read/edit authority per matrix",
            "Audit visibility across modules",
            "Breach escalation ownership",
            "Retention + deletion oversight",
        ],
    )

    generate_role_dfd(
        out / "clio-dfd-hr.png",
        role_title="HR",
        actor_lines=["HR Manager", "HR Officer"],
        process_label="HR Operations Workflow",
        action_lines=[
            "Maintain Employee Records",
            "Run Lifecycle Workflows",
            "Manage Attendance Records",
            "Update Performance Data",
            "Manage HR Documents",
        ],
        db_label="employee modules",
        audit_lines=[
            "Create/update traceability",
            "Attendance modifications",
            "Document version history",
            "Performed by + timestamp",
        ],
        notes=[
            "Restricted PII handling controls",
            "Operational HR authority",
            "Immediate offboarding revocation",
            "Changes logged for audit defense",
        ],
    )

    generate_role_dfd(
        out / "clio-dfd-ea.png",
        role_title="Executive Assistant",
        actor_lines=["Executive Office", "EA Operator"],
        process_label="Executive Support Workflow",
        action_lines=[
            "View Employee Records",
            "Authorized Record Updates",
            "Employment Lifecycle Support",
            "Reports & Export Requests",
            "Document Coordination",
        ],
        db_label="records + docs",
        audit_lines=[
            "Authorization context",
            "Export justification",
            "Document access logs",
            "Action initiator",
        ],
        notes=[
            "Edit rights only as authorized",
            "Full logging on exports/prints",
            "Document controls and versioning",
            "RBAC checks on every API request",
        ],
    )

    generate_role_dfd(
        out / "clio-dfd-employee.png",
        role_title="Employee (L1/L2/L3)",
        actor_lines=["Employee User", "HR/GRC Reviewer"],
        process_label="Self-Service Employee Workspace",
        action_lines=[
            "View Own Profile Record",
            "Edit Personal Contact Info",
            "Clock In / Clock Out",
            "View Own Attendance + Performance",
            "Access Own Attached Documents",
        ],
        db_label="own-scope data",
        audit_lines=[
            "Ownership validation result",
            "Requested data scope",
            "Personal data change log",
            "Attendance action details",
        ],
        notes=[
            "IDOR prevention via ownership check",
            "No access to other employees",
            "Least privilege by role level",
            "All actions logged with source metadata",
        ],
    )

    print("Generated proposal-aligned diagrams:")
    for path in sorted(out.glob("clio-*.png")):
        print(f"- {path}")


if __name__ == "__main__":
    main()
