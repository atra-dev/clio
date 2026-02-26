function createEmployeeDashboardContent(tierLabel) {
  return {
    title: "Employee Self-Service Dashboard",
    subtitle: `${tierLabel} workspace with least-privilege access controls.`,
    metrics: [
      { id: "my-attendance", label: "My Attendance", value: "96.4%", trend: "+1.0% this month" },
      { id: "work-hours", label: "Work Hours", value: "160h", trend: "Month-to-date" },
      { id: "kpi-progress", label: "KPI Progress", value: "87%", trend: "Q1 in progress" },
    ],
  };
}

export const DASHBOARD_METRICS = [
  { id: "active-headcount", label: "Active Headcount", value: "248", trend: "+6%" },
  { id: "on-time", label: "On-time Attendance", value: "94.7%", trend: "+1.3%" },
  { id: "pending-lifecycle", label: "Lifecycle Actions", value: "19", trend: "3 urgent" },
  { id: "template-version", label: "Template Versions", value: "42", trend: "+5 updates" },
];

export const CORE_FUNCTIONAL_FEATURES = [
  {
    id: "employee-records",
    mainTab: "Employee Records",
    summary: "Employee profile center",
    subTabs: [
      "Employee Master Data",
      "Employment Status",
      "Government IDs (Restricted PII)",
      "Contact Information",
      "Payroll Information",
      "Documents Attached to Employee",
      "Activity History (who edited)",
    ],
  },
  {
    id: "employment-lifecycle",
    mainTab: "Employment Lifecycle Management",
    summary: "Employee journey timeline from hire to exit",
    subTabs: [
      "Onboarding",
      "Role Changes / Promotions",
      "Disciplinary Records",
      "Transfers / Position Updates",
      "Offboarding",
      "Access Revocation Tracking",
    ],
  },
  {
    id: "attendance-management",
    mainTab: "Attendance Management",
    summary: "Time and leave system",
    subTabs: [
      "Time Logs",
      "Leave Requests",
      "Leave Approvals",
      "Attendance Reports",
      "Attendance Adjustments",
      "Modification Logs (audit trail)",
    ],
  },
  {
    id: "performance-management",
    mainTab: "Performance Management",
    summary: "Evaluation and appraisal system",
    subTabs: [
      "KPI Records",
      "Evaluation Forms",
      "Performance Reviews History",
      "Promotion Justification",
      "Performance Reports",
    ],
  },
  {
    id: "document-templates",
    mainTab: "Document Template Repository",
    summary: "Document management system for HR",
    subTabs: [
      "HR Templates",
      "Contracts",
      "NDAs",
      "Acknowledgment Forms",
      "Version History",
      "Upload / Manage Templates",
      "Usage Logs",
    ],
  },
];

export const ROLE_DASHBOARD_CONTENT = {
  SUPER_ADMIN: {
    title: "Super Admin Command Center",
    subtitle: "Unified operational and security oversight across all CLIO modules.",
    metrics: [
      { id: "active-users", label: "Active Users", value: "312", trend: "+12 this week" },
      { id: "open-incidents", label: "Open Security Incidents", value: "2", trend: "0 critical" },
      { id: "audit-events", label: "Audit Events (24h)", value: "1,482", trend: "+8%" },
      { id: "access-reviews", label: "Quarterly Reviews", value: "86%", trend: "In progress" },
    ],
    priorities: [
      "Validate role assignments for privileged accounts and temporary access grants.",
      "Review export and printing activity exceeding threshold policy.",
      "Track retention and archive jobs for resigned employee records.",
    ],
    table: {
      title: "Security Control Status",
      subtitle: "Current posture for highest-risk control groups",
      actionLabel: "Open user management",
      columns: ["Control", "Owner", "Next Review", "Status"],
      rows: [
        ["Privileged Access Review", "GRC", "Mar 01", "On Track"],
        ["PII Export Threshold Rules", "Security", "Feb 24", "In Review"],
        ["Forensic Log Integrity", "Infra", "Feb 25", "Healthy"],
        ["Retention Deletion Queue", "HR Ops", "Feb 27", "Pending"],
      ],
    },
  },
  GRC: {
    title: "GRC Dashboard",
    subtitle: "Governance oversight, audit defensibility, and policy control monitoring.",
    metrics: [
      { id: "policy-score", label: "Policy Compliance", value: "96.1%", trend: "+0.9%" },
      { id: "audit-ready", label: "Audit-Ready Controls", value: "42", trend: "+4" },
      { id: "export-alerts", label: "Export Alerts", value: "3", trend: "2 unresolved" },
      { id: "retention-checks", label: "Retention Checks", value: "11", trend: "On schedule" },
    ],
    priorities: [
      "Review tamper-resistant logs for sensitive PII access patterns.",
      "Validate quarterly access review evidence for all privileged roles.",
      "Monitor mass export events and verify documented justifications.",
    ],
    table: {
      title: "Governance Queue",
      subtitle: "High-priority compliance checkpoints",
      actionLabel: "Open activity log",
      columns: ["Checkpoint", "Owner", "Due Date", "Status"],
      rows: [
        ["Quarterly Access Review", "IAM", "Feb 26", "In Progress"],
        ["PIA Evidence Archive", "Compliance", "Feb 24", "Pending"],
        ["DLP Export Alert Triage", "GRC", "Today", "Active"],
      ],
    },
  },
  HR: {
    title: "HR Operations Dashboard",
    subtitle: "Employee operations with lifecycle, attendance, and performance control.",
    metrics: [
      { id: "active-headcount", label: "Active Headcount", value: "248", trend: "+6%" },
      { id: "onboarding", label: "Onboarding Cases", value: "7", trend: "3 in final step" },
      { id: "attendance-pending", label: "Attendance Pending", value: "14", trend: "-2" },
      { id: "review-cycle", label: "Performance Reviews", value: "61%", trend: "Cycle open" },
    ],
    priorities: [
      "Finalize onboarding tasks and role assignment approvals.",
      "Resolve pending attendance corrections before payroll lock.",
      "Document promotion justifications for review committee.",
    ],
    table: {
      title: "HR Priority Queue",
      subtitle: "Current high-impact operations",
      actionLabel: "Open lifecycle",
      columns: ["Task", "Module", "Deadline", "Status"],
      rows: [
        ["Onboarding Completion: CL-1422", "Lifecycle", "Today", "In Progress"],
        ["Attendance Correction Review", "Attendance", "Feb 22", "Pending"],
        ["Promotion Pack: A. Reyes", "Performance", "Feb 28", "Drafting"],
      ],
    },
  },
  EA: {
    title: "Executive Assistant Dashboard",
    subtitle: "Executive-authorized workforce operations and document coordination.",
    metrics: [
      { id: "exec-requests", label: "Executive Requests", value: "9", trend: "4 due today" },
      { id: "doc-prep", label: "Template Drafts", value: "12", trend: "+3" },
      { id: "attendance-followup", label: "Attendance Follow-ups", value: "6", trend: "Stable" },
      { id: "review-briefs", label: "Performance Briefs", value: "5", trend: "2 urgent" },
    ],
    priorities: [
      "Coordinate authorized updates for executive office employee actions.",
      "Prepare standardized document templates for approvals.",
      "Track and consolidate attendance and KPI briefings.",
    ],
    table: {
      title: "EA Action Board",
      subtitle: "Executive office-approved activities",
      actionLabel: "Open templates",
      columns: ["Request", "Module", "Deadline", "Status"],
      rows: [
        ["Employment Certificate Batch", "Templates", "Today", "In Progress"],
        ["Role Change Memo Pack", "Lifecycle", "Feb 23", "Pending"],
        ["KPI Summary Deck", "Performance", "Feb 24", "Drafting"],
      ],
    },
  },
  EMPLOYEE_L1: createEmployeeDashboardContent("Employee L1"),
  EMPLOYEE_L2: createEmployeeDashboardContent("Employee L2"),
  EMPLOYEE_L3: createEmployeeDashboardContent("Employee L3"),
};

export const ROLE_PRIVILEGE_MATRIX = [
  {
    role: "GRC",
    employeeRecords: "View and Edit All",
    lifecycle: "View and Edit All",
    attendance: "View and Edit All",
    performance: "View and Edit All",
    templates: "View and Edit All",
    exports: "Full Export (logged and justified)",
    audit: "Governance and full audit visibility",
  },
  {
    role: "HR",
    employeeRecords: "View and Edit All",
    lifecycle: "View and Edit All",
    attendance: "View and Edit All",
    performance: "View and Edit All",
    templates: "View and Edit All",
    exports: "Full Export (logged and justified)",
    audit: "Operational logs generated for all actions",
  },
  {
    role: "EA",
    employeeRecords: "View and Edit All (executive-authorized)",
    lifecycle: "View and Edit (authorized workflows)",
    attendance: "View and Edit (authorized workflows)",
    performance: "View and Edit (authorized workflows)",
    templates: "View and Edit",
    exports: "Full Export (logged and justified)",
    audit: "Operational logs generated for all actions",
  },
  {
    role: "EMPLOYEE (L1/L2/L3)",
    employeeRecords: "View own record + edit personal info",
    lifecycle: "No access",
    attendance: "Own attendance logs only",
    performance: "View own performance history",
    templates: "Download own documents only",
    exports: "No bulk export access",
    audit: "System-generated logging only",
  },
];

export const EMPLOYEE_PANEL_LINKS = [
  {
    id: "my-record",
    title: "My Profile",
    description: "View your record and update allowed personal details.",
    href: "/employees",
    label: "Self-Service",
  },
  {
    id: "my-attendance",
    title: "My Attendance",
    description: "Review your clock in and clock out logs.",
    href: "/attendance",
    label: "Time Logs",
  },
  {
    id: "my-performance",
    title: "My Performance",
    description: "Check KPI results and performance history.",
    href: "/performance",
    label: "KPI",
  },
  {
    id: "my-documents",
    title: "My Documents",
    description: "Download personal HR documents and forms.",
    href: "/documents",
    label: "Documents",
  },
  {
    id: "my-requests",
    title: "Requests",
    description: "Submit leave, attendance, and document requests.",
    href: "/requests",
    label: "Workflow",
  },
];

export const EMPLOYEE_ACCESSIBLE_MODULES = [
  "View Own Record",
  "Edit Personal Info (contact, address)",
  "Leave Requests",
  "Attendance Logs",
  "Performance History",
  "Download Own Documents",
];

export const EMPLOYEE_RESTRICTED_MODULES = [
  "Other employees",
  "Audit logs",
  "System reports",
  "Lifecycle records of others",
  "Export bulk data",
];

export const EMPLOYEE_REQUEST_ROWS = [
  {
    id: "REQ-4101",
    type: "Leave Request",
    submittedAt: "Feb 21, 2026 09:12 AM",
    targetDate: "Feb 28, 2026",
    status: "Pending",
  },
  {
    id: "REQ-4094",
    type: "Attendance Correction",
    submittedAt: "Feb 19, 2026 04:40 PM",
    targetDate: "Feb 19, 2026",
    status: "Approved",
  },
  {
    id: "REQ-4088",
    type: "Document Request",
    submittedAt: "Feb 18, 2026 10:03 AM",
    targetDate: "Feb 20, 2026",
    status: "Completed",
  },
];

export const EMPLOYEE_ROWS = [
  {
    employeeId: "CL-1001",
    name: "Samira Reyes",
    email: "samira.reyes@gmail.com",
    role: "Operations Lead",
    type: "Regular",
    status: "Active",
    employmentStatus: "Active Employee",
    contact: "+1-202-555-0131",
    govId: "TIN-***-4421",
    payrollGroup: "PG-A",
  },
  {
    employeeId: "CL-1038",
    name: "Jordan Green",
    email: "jordan.green@gmail.com",
    role: "HR Specialist",
    type: "Regular",
    status: "Active",
    employmentStatus: "Active Employee",
    contact: "+1-202-555-0170",
    govId: "SSN-***-7794",
    payrollGroup: "PG-A",
  },
  {
    employeeId: "CL-1106",
    name: "Elias Morgan",
    email: "elias.morgan@gmail.com",
    role: "Finance Analyst",
    type: "Regular",
    status: "Active",
    employmentStatus: "Active Employee",
    contact: "+1-202-555-0127",
    govId: "TIN-***-1048",
    payrollGroup: "PG-B",
  },
  {
    employeeId: "CL-1204",
    name: "Dana Cruz",
    email: "dana.cruz@gmail.com",
    role: "Executive Assistant",
    type: "Contract",
    status: "Probation",
    employmentStatus: "Active Employee",
    contact: "+1-202-555-0189",
    govId: "SSN-***-6612",
    payrollGroup: "PG-B",
  },
  {
    employeeId: "CL-1289",
    name: "Kim Andrade",
    email: "kim.andrade@gmail.com",
    role: "Account Executive",
    type: "Regular",
    status: "Active",
    employmentStatus: "Active Employee",
    contact: "+1-202-555-0112",
    govId: "TIN-***-3378",
    payrollGroup: "PG-C",
  },
];

export const SELF_SERVICE_EDITABLE_FIELDS = [
  "Mobile number",
  "Home address",
  "Emergency contact",
  "Personal email",
];

export const EMPLOYMENT_LIFECYCLE_ROWS = [
  {
    caseId: "LC-2201",
    employee: "Samira Reyes",
    category: "Onboarding",
    owner: "HR Operations",
    updatedAt: "Feb 20, 2026 09:15 AM",
    status: "In Progress",
  },
  {
    caseId: "LC-2197",
    employee: "Kim Andrade",
    category: "Role Change",
    owner: "Executive Office",
    updatedAt: "Feb 19, 2026 03:40 PM",
    status: "Pending Approval",
  },
  {
    caseId: "LC-2188",
    employee: "Elias Morgan",
    category: "Disciplinary Record",
    owner: "HR Compliance",
    updatedAt: "Feb 18, 2026 11:00 AM",
    status: "Documented",
  },
  {
    caseId: "LC-2176",
    employee: "Dana Cruz",
    category: "Offboarding",
    owner: "HR Operations",
    updatedAt: "Feb 17, 2026 04:18 PM",
    status: "Access Revoked",
  },
];

export const ATTENDANCE_ROWS = [
  {
    employee: "Samira Reyes",
    date: "Feb 20, 2026",
    checkIn: "08:04",
    checkOut: "17:16",
    status: "Present",
    modifiedBy: "hr.manager@gmail.com",
  },
  {
    employee: "Elias Morgan",
    date: "Feb 20, 2026",
    checkIn: "08:19",
    checkOut: "17:09",
    status: "Present",
    modifiedBy: "hr.manager@gmail.com",
  },
  {
    employee: "Kim Andrade",
    date: "Feb 20, 2026",
    checkIn: "08:37",
    checkOut: "-",
    status: "Late",
    modifiedBy: "ea.office@gmail.com",
  },
  {
    employee: "Dana Cruz",
    date: "Feb 20, 2026",
    checkIn: "-",
    checkOut: "-",
    status: "Absent",
    modifiedBy: "hr.assistant@gmail.com",
  },
];

export const PERFORMANCE_ROWS = [
  {
    employee: "Samira Reyes",
    period: "Q1 2026",
    kpiScore: "91",
    rating: "Exceeds",
    promotionCase: "Submitted",
    reviewer: "HR Director",
    status: "Under Review",
  },
  {
    employee: "Elias Morgan",
    period: "Q1 2026",
    kpiScore: "84",
    rating: "Meets",
    promotionCase: "N/A",
    reviewer: "Finance Lead",
    status: "Completed",
  },
  {
    employee: "Kim Andrade",
    period: "Q1 2026",
    kpiScore: "78",
    rating: "Developing",
    promotionCase: "N/A",
    reviewer: "Sales Head",
    status: "Action Plan",
  },
];

export const TEMPLATE_REPOSITORY_ROWS = [
  {
    template: "Employment Contract",
    category: "Contract",
    version: "v4.3",
    classification: "Restricted PII",
    updatedAt: "Feb 18, 2026",
    modifiedBy: "hr.admin@gmail.com",
  },
  {
    template: "NDA Agreement",
    category: "NDA",
    version: "v2.7",
    classification: "Restricted PII",
    updatedAt: "Feb 16, 2026",
    modifiedBy: "grc.analyst@gmail.com",
  },
  {
    template: "Policy Acknowledgment",
    category: "Acknowledgment",
    version: "v3.1",
    classification: "Restricted PII",
    updatedAt: "Feb 14, 2026",
    modifiedBy: "ea.office@gmail.com",
  },
];

export const ACTIVITY_LOG_ROWS = [
  {
    id: "ACT-6124",
    activityName: "Updated Employee Profile (CL-1038)",
    status: "Completed",
    relativeTime: "2 min ago",
    loggedAt: "Feb 18, 2026 08:41 AM",
    module: "Employee Records",
    performedBy: "hr.manager@gmail.com",
  },
  {
    id: "ACT-6123",
    activityName: "Approved Attendance Correction (CL-1289)",
    status: "Approved",
    relativeTime: "4 min ago",
    loggedAt: "Feb 18, 2026 08:39 AM",
    module: "Attendance",
    performedBy: "hr.manager@gmail.com",
  },
  {
    id: "ACT-6121",
    activityName: "Uploaded NDA Template Revision",
    status: "Completed",
    relativeTime: "6 min ago",
    loggedAt: "Feb 18, 2026 08:37 AM",
    module: "Template Repository",
    performedBy: "ea.office@gmail.com",
  },
  {
    id: "ACT-6118",
    activityName: "Exported Employee Master List",
    status: "Completed",
    relativeTime: "8 min ago",
    loggedAt: "Feb 18, 2026 08:35 AM",
    module: "Export Control",
    performedBy: "grc.analyst@gmail.com",
  },
  {
    id: "ACT-6117",
    activityName: "Corrected Attendance Log (Samira Reyes)",
    status: "Completed",
    relativeTime: "12 min ago",
    loggedAt: "Feb 18, 2026 08:31 AM",
    module: "Attendance",
    performedBy: "hr.assistant@gmail.com",
  },
  {
    id: "ACT-6116",
    activityName: "Created New Employee Record (CL-1312)",
    status: "Completed",
    relativeTime: "15 min ago",
    loggedAt: "Feb 18, 2026 08:28 AM",
    module: "Employee Records",
    performedBy: "hr.recruit@gmail.com",
  },
  {
    id: "ACT-6115",
    activityName: "Requested Shift Change Approval (CL-1204)",
    status: "Pending",
    relativeTime: "17 min ago",
    loggedAt: "Feb 18, 2026 08:26 AM",
    module: "Attendance",
    performedBy: "ea.office@gmail.com",
  },
  {
    id: "ACT-6114",
    activityName: "Failed Payroll Attendance Export",
    status: "Failed",
    relativeTime: "21 min ago",
    loggedAt: "Feb 18, 2026 08:22 AM",
    module: "Export Control",
    performedBy: "hr.manager@gmail.com",
  },
  {
    id: "ACT-6113",
    activityName: "Rejected Backdated Attendance Request",
    status: "Rejected",
    relativeTime: "26 min ago",
    loggedAt: "Feb 18, 2026 08:17 AM",
    module: "Attendance",
    performedBy: "grc.analyst@gmail.com",
  },
  {
    id: "ACT-6112",
    activityName: "Updated Emergency Contact (CL-1001)",
    status: "Completed",
    relativeTime: "31 min ago",
    loggedAt: "Feb 18, 2026 08:12 AM",
    module: "Employee Records",
    performedBy: "hr.admin@gmail.com",
  },
  {
    id: "ACT-6111",
    activityName: "Uploaded Signed NDA Document",
    status: "Completed",
    relativeTime: "36 min ago",
    loggedAt: "Feb 18, 2026 08:07 AM",
    module: "Template Repository",
    performedBy: "ea.office@gmail.com",
  },
  {
    id: "ACT-6110",
    activityName: "Locked Export Template: Attendance Weekly",
    status: "Failed",
    relativeTime: "40 min ago",
    loggedAt: "Feb 18, 2026 08:03 AM",
    module: "Export Control",
    performedBy: "grc.analyst@gmail.com",
  },
];

export const EXPORT_CONTROL_ROWS = [
  {
    name: "Employee Master Dataset",
    format: "CSV",
    owner: "HR Team",
    lastExport: "Feb 19, 2026 18:00",
    status: "Approved",
    volume: "248 rows",
    justification: "Monthly HR operations report",
  },
  {
    name: "Attendance Compliance Pack",
    format: "PDF",
    owner: "GRC Team",
    lastExport: "Feb 18, 2026 10:22",
    status: "Approved",
    volume: "31 pages",
    justification: "Quarterly governance review",
  },
  {
    name: "Executive Workforce Brief",
    format: "Sheets",
    owner: "EA Office",
    lastExport: "Feb 17, 2026 16:44",
    status: "Review",
    volume: "62 rows",
    justification: "Executive office staffing brief",
  },
];

export const SHEET_LIBRARY = [
  {
    name: "Daily Attendance Sheet",
    purpose: "Track in/out logs for all departments",
    owner: "HR Operations",
    updated: "Feb 18, 2026",
  },
  {
    name: "Employee Record Intake",
    purpose: "Collect new hire and profile updates",
    owner: "HR Admin",
    updated: "Feb 17, 2026",
  },
  {
    name: "Compliance Review Tracker",
    purpose: "Track corrective actions and policy checks",
    owner: "GRC Office",
    updated: "Feb 15, 2026",
  },
];

export const PDF_OUTPUTS = [
  {
    name: "Employment Certificate",
    audience: "Employees",
    stamp: "North Star logo on header",
  },
  {
    name: "Attendance Compliance Report",
    audience: "Leadership",
    stamp: "North Star logo on footer",
  },
];

