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
  {
    id: "EMPLOYEE_L1",
    label: "Employee L1",
    description: "Can access and update limited personal profile details",
  },
  {
    id: "EMPLOYEE_L2",
    label: "Employee L2",
    description: "Can access and update limited personal profile details",
  },
  {
    id: "EMPLOYEE_L3",
    label: "Employee L3",
    description: "Can access and update limited personal profile details",
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
    id: "employment-lifecycle",
    label: "Employment Lifecycle",
    href: "/employment-lifecycle",
    description: "Onboarding, role changes, disciplinary records, and offboarding",
  },
  {
    id: "attendance",
    label: "Attendance",
    href: "/attendance",
    description: "Time logs, leave requests, approvals, and traceable updates",
  },
  {
    id: "performance",
    label: "Performance",
    href: "/performance",
    description: "KPI documentation, evaluations, and promotion justification",
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
    label: "Template Repository",
    href: "/documents",
    description: "Version-controlled contracts, NDAs, and HR acknowledgments",
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
  GRC: [
    "dashboard",
    "employees",
    "employment-lifecycle",
    "attendance",
    "performance",
    "documents",
    "exports",
    "activity-log",
    "settings",
  ],
  HR: [
    "dashboard",
    "employees",
    "employment-lifecycle",
    "attendance",
    "performance",
    "documents",
    "exports",
    "settings",
  ],
  EA: [
    "dashboard",
    "employees",
    "employment-lifecycle",
    "attendance",
    "performance",
    "documents",
    "exports",
    "settings",
  ],
  EMPLOYEE_L1: ["dashboard", "employees", "attendance", "performance", "documents", "exports"],
  EMPLOYEE_L2: ["dashboard", "employees", "attendance", "performance", "documents", "exports"],
  EMPLOYEE_L3: ["dashboard", "employees", "attendance", "performance", "documents", "exports"],
};

export const LOGIN_HIGHLIGHTS = [
  "Invite-first access with required email verification",
  "Employee Records with restricted PII controls",
  "Employment Lifecycle and immediate offboarding revocation",
  "Attendance and Performance workflows with traceability",
  "Version-controlled template repository and monitored exports",
];
