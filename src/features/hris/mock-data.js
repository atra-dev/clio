export const DASHBOARD_METRICS = [
  { id: "active-headcount", label: "Active Headcount", value: "248", trend: "+6%" },
  { id: "on-time", label: "On-time Attendance", value: "94.7%", trend: "+1.3%" },
  { id: "late-arrivals", label: "Late Arrivals", value: "13", trend: "-9%" },
  { id: "pending-requests", label: "Pending HR Requests", value: "21", trend: "+4%" },
];

export const ROLE_DASHBOARD_CONTENT = {
  GRC: {
    title: "GRC Dashboard",
    subtitle: "Compliance, governance, and risk posture across HR operations.",
    metrics: [
      { id: "risk-open", label: "Open Risk Items", value: "18", trend: "-2 this week" },
      { id: "policy-score", label: "Policy Compliance", value: "96.1%", trend: "+0.9%" },
      { id: "audit-ready", label: "Audit-ready Controls", value: "42", trend: "+4" },
      { id: "exception-cases", label: "Active Exceptions", value: "6", trend: "-1" },
    ],
    priorities: [
      "Review unresolved attendance exceptions older than 7 days.",
      "Validate monthly export access approvals.",
      "Finalize Q1 HR policy control audit checklist.",
    ],
    table: {
      title: "Compliance Activity",
      subtitle: "Recent control and governance checkpoints",
      actionLabel: "Open risk register",
      columns: ["Control", "Owner", "Due Date", "Status"],
      rows: [
        ["Attendance Audit Trail", "GRC Office", "Feb 26", "On Track"],
        ["Export Policy Verification", "Security", "Feb 24", "In Review"],
        ["Employee Data Retention", "Legal", "Mar 03", "Pending"],
        ["Access Privilege Audit", "IT", "Feb 22", "Escalated"],
      ],
    },
  },
  HR: {
    title: "HR Dashboard",
    subtitle: "Attendance, people operations, and employee lifecycle updates.",
    metrics: [
      { id: "active-headcount", label: "Active Headcount", value: "248", trend: "+6%" },
      { id: "on-time", label: "On-time Attendance", value: "94.7%", trend: "+1.3%" },
      { id: "late-arrivals", label: "Late Arrivals", value: "13", trend: "-9%" },
      { id: "pending-requests", label: "Pending HR Requests", value: "21", trend: "+4%" },
    ],
    priorities: [
      "Resolve pending leave approvals before payroll cutoff.",
      "Complete onboarding records for 3 new hires.",
      "Review attendance anomalies from Sales and Operations.",
    ],
    table: {
      title: "Attendance Snapshot",
      subtitle: "Current-day attendance status by department",
      actionLabel: "View full report",
      columns: ["Employee", "Department", "Check In", "Check Out", "Status"],
      rows: [
        ["Samira Reyes", "Operations", "08:05", "17:12", "Present"],
        ["Elias Morgan", "Finance", "08:17", "17:06", "Present"],
        ["Kim Andrade", "Sales", "08:34", "-", "Late"],
        ["Nia Patel", "Technology", "-", "-", "Leave"],
      ],
    },
  },
  EA: {
    title: "EA Dashboard",
    subtitle: "Executive support view for staffing coordination and document requests.",
    metrics: [
      { id: "exec-briefs", label: "Executive Briefs Due", value: "5", trend: "2 due today" },
      { id: "doc-requests", label: "Document Requests", value: "14", trend: "+3" },
      { id: "meeting-needs", label: "Staffing Requests", value: "9", trend: "Stable" },
      { id: "urgent-items", label: "Urgent Follow-ups", value: "4", trend: "-1" },
    ],
    priorities: [
      "Prepare employee movement summary for executive review.",
      "Coordinate urgent HR certificate requests for leadership meeting.",
      "Track approvals for cross-department staffing updates.",
    ],
    table: {
      title: "Executive Support Queue",
      subtitle: "Priority coordination and documentation tasks",
      actionLabel: "Open task board",
      columns: ["Request", "Requester", "Deadline", "Status"],
      rows: [
        ["Employment Certificate", "CEO Office", "Today 3:00 PM", "In Progress"],
        ["Headcount Movement Summary", "COO Office", "Feb 20", "Pending"],
        ["Attendance Brief", "Finance Lead", "Tomorrow", "Drafting"],
        ["Team Reassignment Memo", "HR Director", "Feb 21", "Approved"],
      ],
    },
  },
};

export const ATTENDANCE_ROWS = [
  { name: "Samira Reyes", department: "Operations", checkIn: "08:05", checkOut: "17:12", status: "Present" },
  { name: "Elias Morgan", department: "Finance", checkIn: "08:17", checkOut: "17:06", status: "Present" },
  { name: "Kim Andrade", department: "Sales", checkIn: "08:34", checkOut: "-", status: "Late" },
  { name: "Nia Patel", department: "Technology", checkIn: "-", checkOut: "-", status: "Leave" },
];

export const EMPLOYEE_ROWS = [
  { employeeId: "CL-1001", name: "Samira Reyes", role: "Operations Lead", type: "Regular", status: "Active" },
  { employeeId: "CL-1038", name: "Jordan Green", role: "HR Specialist", type: "Regular", status: "Active" },
  { employeeId: "CL-1106", name: "Elias Morgan", role: "Finance Analyst", type: "Regular", status: "Active" },
  { employeeId: "CL-1204", name: "Dana Cruz", role: "Executive Assistant", type: "Contract", status: "Probation" },
  { employeeId: "CL-1289", name: "Kim Andrade", role: "Account Executive", type: "Regular", status: "Active" },
];

export const ACTIVITY_LOG_ROWS = [
  {
    id: "ACT-6124",
    activityName: "Updated Employee Profile (CL-1038)",
    status: "Completed",
    relativeTime: "2 min ago",
    loggedAt: "Feb 18, 2026 08:41 AM",
    module: "Employee Records",
    performedBy: "hr.manager@clio.local",
  },
  {
    id: "ACT-6123",
    activityName: "Approved Leave Request (CL-1289)",
    status: "Approved",
    relativeTime: "4 min ago",
    loggedAt: "Feb 18, 2026 08:39 AM",
    module: "Attendance",
    performedBy: "hr.manager@clio.local",
  },
  {
    id: "ACT-6121",
    activityName: "Generated Employment Certificate PDF",
    status: "Completed",
    relativeTime: "6 min ago",
    loggedAt: "Feb 18, 2026 08:37 AM",
    module: "Sheets and PDF",
    performedBy: "ea.office@clio.local",
  },
  {
    id: "ACT-6118",
    activityName: "Exported Employee Master List",
    status: "Completed",
    relativeTime: "8 min ago",
    loggedAt: "Feb 18, 2026 08:35 AM",
    module: "Export Control",
    performedBy: "grc.analyst@clio.local",
  },
  {
    id: "ACT-6117",
    activityName: "Corrected Attendance Log (Samira Reyes)",
    status: "Completed",
    relativeTime: "12 min ago",
    loggedAt: "Feb 18, 2026 08:31 AM",
    module: "Attendance",
    performedBy: "hr.assistant@clio.local",
  },
  {
    id: "ACT-6116",
    activityName: "Created New Employee Record (CL-1312)",
    status: "Completed",
    relativeTime: "15 min ago",
    loggedAt: "Feb 18, 2026 08:28 AM",
    module: "Employee Records",
    performedBy: "hr.recruit@clio.local",
  },
  {
    id: "ACT-6115",
    activityName: "Requested Shift Change Approval (CL-1204)",
    status: "Pending",
    relativeTime: "17 min ago",
    loggedAt: "Feb 18, 2026 08:26 AM",
    module: "Attendance",
    performedBy: "ea.office@clio.local",
  },
  {
    id: "ACT-6114",
    activityName: "Failed Payroll Attendance Export",
    status: "Failed",
    relativeTime: "21 min ago",
    loggedAt: "Feb 18, 2026 08:22 AM",
    module: "Export Control",
    performedBy: "hr.manager@clio.local",
  },
  {
    id: "ACT-6113",
    activityName: "Rejected Backdated Attendance Request",
    status: "Rejected",
    relativeTime: "26 min ago",
    loggedAt: "Feb 18, 2026 08:17 AM",
    module: "Attendance",
    performedBy: "grc.analyst@clio.local",
  },
  {
    id: "ACT-6112",
    activityName: "Updated Emergency Contact (CL-1001)",
    status: "Completed",
    relativeTime: "31 min ago",
    loggedAt: "Feb 18, 2026 08:12 AM",
    module: "Employee Records",
    performedBy: "hr.admin@clio.local",
  },
  {
    id: "ACT-6111",
    activityName: "Uploaded Signed NDA Document",
    status: "Completed",
    relativeTime: "36 min ago",
    loggedAt: "Feb 18, 2026 08:07 AM",
    module: "Sheets and PDF",
    performedBy: "ea.office@clio.local",
  },
  {
    id: "ACT-6110",
    activityName: "Locked Export Template: Attendance Weekly",
    status: "Failed",
    relativeTime: "40 min ago",
    loggedAt: "Feb 18, 2026 08:03 AM",
    module: "Export Control",
    performedBy: "grc.analyst@clio.local",
  },
];

export const EXPORT_CONTROL_ROWS = [
  {
    name: "Attendance - Weekly Summary",
    format: "Sheets",
    owner: "HR Team",
    lastExport: "Feb 17, 2026 18:00",
    status: "Enabled",
  },
  {
    name: "Employee Master List",
    format: "CSV",
    owner: "GRC Team",
    lastExport: "Feb 16, 2026 10:22",
    status: "Enabled",
  },
  {
    name: "Probation Monitoring",
    format: "PDF",
    owner: "EA Office",
    lastExport: "Feb 15, 2026 16:44",
    status: "Review",
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
