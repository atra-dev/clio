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
        "Proposal-aligned layered view: Security, Client, Authentication, Application, Data, Logging & Monitoring",
        figsize=(18, 10),
    )

    draw_layer(ax, 0.02, 0.82, 0.45, 0.16, "Security Layer", ACCENT_GREEN)
    draw_layer(ax, 0.55, 0.50, 0.18, 0.40, "Client Layer", ACCENT_BLUE)
    draw_layer(ax, 0.05, 0.52, 0.40, 0.24, "Authentication Layer", ACCENT_PURPLE)
    draw_layer(ax, 0.71, 0.53, 0.27, 0.34, "Application Layer", ACCENT_GREEN)
    draw_layer(ax, 0.18, 0.23, 0.22, 0.25, "Data Layer", ACCENT_BLUE)
    draw_layer(ax, 0.42, 0.06, 0.50, 0.18, "Logging & Monitoring", ACCENT_PURPLE)

    # Security controls
    draw_rect(ax, 0.05, 0.86, 0.12, 0.06, "CSRF Protection")
    draw_rect(ax, 0.19, 0.86, 0.12, 0.06, "Certificate Pinning")
    draw_rect(ax, 0.33, 0.86, 0.12, 0.06, "Security Headers")

    # Auth layer
    draw_rect(ax, 0.20, 0.66, 0.18, 0.07, "Firebase Auth")
    draw_rect(ax, 0.10, 0.58, 0.13, 0.06, "Google OAuth")
    draw_rect(ax, 0.27, 0.58, 0.13, 0.06, "Multi-Factor Auth")

    # Client layer
    draw_rect(ax, 0.58, 0.80, 0.12, 0.06, "Web Browser")
    draw_rect(ax, 0.58, 0.67, 0.12, 0.06, "Next.js Frontend")
    draw_rect(ax, 0.58, 0.54, 0.12, 0.06, "Logger Utility")

    # App layer
    draw_rect(ax, 0.77, 0.73, 0.16, 0.06, "Next.js API Routes")
    draw_rect(ax, 0.72, 0.60, 0.12, 0.06, "Application State")
    draw_rect(ax, 0.86, 0.60, 0.10, 0.06, "Error Handling")
    draw_rect(ax, 0.72, 0.52, 0.12, 0.06, "RBAC Engine")
    draw_rect(ax, 0.86, 0.52, 0.10, 0.06, "Input Validation")

    # Data layer
    draw_database(ax, 0.21, 0.34, 0.16, 0.11, "Cloud Firestore", "db: cliohris")
    draw_rect(ax, 0.22, 0.25, 0.14, 0.06, "Client-Side Cache")

    # Logging
    draw_rect(ax, 0.46, 0.12, 0.13, 0.06, "Development Logs")
    draw_rect(ax, 0.62, 0.12, 0.13, 0.06, "Production Logs")
    draw_rect(ax, 0.78, 0.12, 0.12, 0.06, "Error Tracking")
    draw_rect(ax, 0.56, 0.19, 0.24, 0.045, "Tamper-Resistant Audit Events", fontsize=8.5)

    # Arrows
    arrow(ax, (0.31, 0.86), (0.29, 0.73))
    arrow(ax, (0.39, 0.86), (0.39, 0.73))
    arrow(ax, (0.11, 0.86), (0.20, 0.70), curve=-0.1)
    arrow(ax, (0.29, 0.66), (0.16, 0.64))
    arrow(ax, (0.29, 0.66), (0.33, 0.64))
    arrow(ax, (0.38, 0.69), (0.58, 0.70))
    arrow(ax, (0.64, 0.80), (0.64, 0.73))
    arrow(ax, (0.64, 0.67), (0.64, 0.60))
    arrow(ax, (0.70, 0.70), (0.77, 0.76))
    arrow(ax, (0.85, 0.73), (0.78, 0.66))
    arrow(ax, (0.85, 0.73), (0.91, 0.66))
    arrow(ax, (0.78, 0.60), (0.29, 0.45), curve=0.06)
    arrow(ax, (0.90, 0.60), (0.83, 0.18))
    arrow(ax, (0.78, 0.52), (0.67, 0.54))
    arrow(ax, (0.84, 0.52), (0.64, 0.54), curve=0.05)
    arrow(ax, (0.29, 0.34), (0.29, 0.31))
    arrow(ax, (0.64, 0.54), (0.64, 0.22))
    arrow(ax, (0.58, 0.22), (0.52, 0.18))
    arrow(ax, (0.64, 0.22), (0.68, 0.18))
    arrow(ax, (0.70, 0.22), (0.84, 0.18))

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

    # Notes box
    draw_round(ax, 0.25, 0.16, 0.53, 0.16, " | ".join(notes), fontsize=8.3, fill="#f9f9f9")

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
    arrow(ax, (0.63, 0.49), (0.52, 0.32), curve=-0.12)

    # Audit detail bullets
    audit_y = 0.30
    for line in audit_lines[:4]:
        ax.text(0.50, audit_y, f"- {line}", fontsize=8, color="#333333", ha="left", va="center")
        audit_y -= 0.03

    fig.savefig(output_path, bbox_inches="tight")
    plt.close(fig)


def main():
    out = Path("docs/architecture")
    out.mkdir(parents=True, exist_ok=True)

    generate_layered_architecture(out / "clio-system-architecture-proposal.png")

    generate_role_dfd(
        out / "clio-dfd-super-admin.png",
        role_title="Super Admin",
        actor_lines=["CISO / CIO", "Security Specialist", "SOC Analyst"],
        process_label="User Management Governance",
        action_lines=[
            "Send Invite",
            "Approve / Reject Access",
            "Change User Role",
            "Disable / Enable User",
            "Remove User Account",
        ],
        db_label="users + invites",
        audit_lines=[
            "Actor identity",
            "Before/after role state",
            "Approval decision trail",
            "Source IP and device",
        ],
        notes=[
            "No shared accounts",
            "Least privilege enforcement",
            "Quarterly access review",
            "Admin actions are fully auditable",
        ],
    )

    generate_role_dfd(
        out / "clio-dfd-grc.png",
        role_title="GRC",
        actor_lines=["GRC Officer", "Compliance Auditor"],
        process_label="Governance & Risk Control",
        action_lines=[
            "View All Employee Records",
            "Review Export Activity",
            "Run Access Reviews",
            "Investigate Incidents",
            "Validate Policy Compliance",
        ],
        db_label="records + audits",
        audit_lines=[
            "PII access event",
            "Export volume and format",
            "Incident timeline",
            "Reviewer identity",
        ],
        notes=[
            "Full read/edit authority per matrix",
            "Audit visibility across modules",
            "Breach escalation support",
            "Retention and deletion oversight",
        ],
    )

    generate_role_dfd(
        out / "clio-dfd-hr.png",
        role_title="HR",
        actor_lines=["HR Manager", "HR Officer"],
        process_label="HR Operations Workflow",
        action_lines=[
            "Maintain Employee Master Data",
            "Process Lifecycle Events",
            "Manage Attendance & Leave",
            "Record Performance Reviews",
            "Generate HR Documents",
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
        process_label="Executive Office Authorized Actions",
        action_lines=[
            "View All Employee Records",
            "Authorized Record Updates",
            "Prepare Executive Reports",
            "Controlled Data Exports",
            "Template/Document Processing",
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
            "Watermark-ready document controls",
            "RBAC checks on every API request",
        ],
    )

    generate_role_dfd(
        out / "clio-dfd-employee.png",
        role_title="Employee (L1/L2/L3)",
        actor_lines=["Employee User", "Line Manager (approval)"],
        process_label="Self-Service Employee Portal",
        action_lines=[
            "View Own Record Only",
            "Update Limited Personal Fields",
            "Submit Leave / Attendance Requests",
            "View Own Performance History",
            "Export Own Record Only",
        ],
        db_label="own-scope data",
        audit_lines=[
            "Ownership validation result",
            "Requested data scope",
            "Personal data change log",
            "Export event details",
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
