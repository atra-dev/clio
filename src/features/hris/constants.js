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
    label: "Employee (L1)",
    description: "Can access and update limited personal profile details",
  },
  {
    id: "EMPLOYEE_L2",
    label: "Employee (L2)",
    description: "Can access and update limited personal profile details",
  },
  {
    id: "EMPLOYEE_L3",
    label: "Employee (L3)",
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
    label: "Attendance Management",
    href: "/attendance",
    description: "Time logs, leave requests, approvals, and traceable updates",
  },
  {
    id: "performance",
    label: "Performance Management",
    href: "/performance",
    description: "KPI documentation, evaluations, and promotion justification",
  },
  {
    id: "documents",
    label: "Document Repository",
    href: "/documents",
    description: "Version-controlled contracts, NDAs, and HR acknowledgments",
  },
  {
    id: "activity-log",
    label: "Audit Logs",
    href: "/activity-log",
    description: "Full audit trail for employee data changes",
  },
  {
    id: "exports",
    label: "Reports & Exports",
    href: "/exports",
    description: "Control exports for sheets and reports",
  },
  {
    id: "access-management",
    label: "Access Management",
    href: "/access-management",
    description: "Role access review, least privilege checks, and privilege governance",
  },
  {
    id: "retention-archive",
    label: "Retention & Archive",
    href: "/retention-archive",
    description: "Archive controls, 5-year retention policy, and secure deletion readiness",
  },
  {
    id: "incident-management",
    label: "Incident Management",
    href: "/incident-management",
    description: "PII incident response, escalation tracking, and breach readiness",
  },
  {
    id: "requests",
    label: "Requests",
    href: "/requests",
    description: "Self-service requests with workflow tracking",
  },
  {
    id: "user-management",
    label: "User Management",
    href: "/user-management",
    description: "Invite users, assign roles, and control account status",
  },
];

export const MODULE_ACCESS = {
  SUPER_ADMIN: ["dashboard", "activity-log", "user-management"],
  GRC: [
    "dashboard",
    "employees",
    "employment-lifecycle",
    "attendance",
    "performance",
    "documents",
    "activity-log",
    "exports",
    "access-management",
    "retention-archive",
    "incident-management",
  ],
  HR: [
    "dashboard",
    "employees",
    "employment-lifecycle",
    "attendance",
    "performance",
    "documents",
    "exports",
  ],
  EA: [
    "dashboard",
    "employees",
    "employment-lifecycle",
    "attendance",
    "performance",
    "documents",
    "exports",
  ],
  EMPLOYEE_L1: ["dashboard", "employees", "attendance", "performance"],
  EMPLOYEE_L2: ["dashboard", "employees", "attendance", "performance"],
  EMPLOYEE_L3: ["dashboard", "employees", "attendance", "performance"],
};

export const LOGIN_HIGHLIGHTS = [
  "Invite-first access with required email verification",
  "Employee Records with restricted PII controls",
  "Employment Lifecycle and immediate offboarding revocation",
  "Attendance and Performance workflows with traceability",
  "Version-controlled template repository and monitored exports",
];
