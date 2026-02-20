export const ROLES = [
  {
    id: "SUPER_ADMIN",
    label: "Super Admin",
    description: "Full system access and administrative control",
  },
  {
    id: "GRC",
    label: "GRC",
    description: "Governance, Risk, and Compliance oversight",
  },
  {
    id: "HR",
    label: "HR",
    description: "Human Resources operations and employee lifecycle",
  },
  {
    id: "EA",
    label: "EA",
    description: "Executive assistance and department coordination",
  },
];

export const MODULES = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    description: "Company-wide attendance and HR KPIs",
  },
  {
    id: "employees",
    label: "Employee Records",
    href: "/employees",
    description: "Centralized employee profiles and status",
  },
  {
    id: "activity-log",
    label: "Activity Log",
    href: "/activity-log",
    description: "Full audit trail for employee data changes",
  },
  {
    id: "exports",
    label: "Export Control",
    href: "/exports",
    description: "Control exports for sheets and reports",
  },
  {
    id: "documents",
    label: "Sheets and PDF",
    href: "/documents",
    description: "Generate sheets and PDF files with branding",
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    description: "Manage account security and access preferences",
  },
  {
    id: "user-management",
    label: "User Management",
    href: "/user-management",
    description: "Invite users, assign roles, and control account status",
  },
];

export const MODULE_ACCESS = {
  SUPER_ADMIN: MODULES.map((module) => module.id),
  HR: ["dashboard", "employees", "documents"],
  GRC: ["dashboard", "activity-log", "exports"],
  EA: ["dashboard", "documents"],
};

export const LOGIN_HIGHLIGHTS = [
  "Attendance visibility in one dashboard",
  "Fast access to employee records and history",
  "Export control for operational reports",
  "Sheets and PDF outputs with North Star branding",
];
