"use client";

function buildQuery(params = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    const normalized = String(value).trim();
    if (!normalized) {
      return;
    }
    searchParams.set(key, normalized);
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/csv")) {
    return await response.text();
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || "Request failed.";
    throw new Error(message);
  }
  return payload;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  return await parseResponse(response);
}

async function requestCsv(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || "Export failed.");
  }
  return await response.text();
}

export const hrisApi = {
  employees: {
    async list(params = {}) {
      return await requestJson(`/api/hris/employees${buildQuery(params)}`, { method: "GET" });
    },
    async get(recordId) {
      return await requestJson(`/api/hris/employees/${encodeURIComponent(recordId)}`, { method: "GET" });
    },
    async create(payload) {
      return await requestJson("/api/hris/employees", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async update(recordId, payload) {
      return await requestJson(`/api/hris/employees/${encodeURIComponent(recordId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    async archive(recordId) {
      return await requestJson(`/api/hris/employees/${encodeURIComponent(recordId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "Archived",
        }),
      });
    },
  },

  lifecycle: {
    async list(params = {}) {
      return await requestJson(`/api/hris/lifecycle${buildQuery(params)}`, { method: "GET" });
    },
    async get(recordId) {
      return await requestJson(`/api/hris/lifecycle/${encodeURIComponent(recordId)}`, { method: "GET" });
    },
    async create(payload) {
      return await requestJson("/api/hris/lifecycle", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async update(recordId, payload) {
      return await requestJson(`/api/hris/lifecycle/${encodeURIComponent(recordId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    async offboard(recordId, payload = {}) {
      return await requestJson(`/api/hris/lifecycle/${encodeURIComponent(recordId)}/offboard`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
  },

  attendance: {
    async list(params = {}) {
      return await requestJson(`/api/hris/attendance${buildQuery(params)}`, { method: "GET" });
    },
    async create(payload) {
      return await requestJson("/api/hris/attendance", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async update(recordId, payload) {
      return await requestJson(`/api/hris/attendance/${encodeURIComponent(recordId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
  },

  leave: {
    async list(params = {}) {
      return await requestJson(`/api/hris/attendance/leave-requests${buildQuery(params)}`, { method: "GET" });
    },
    async create(payload) {
      return await requestJson("/api/hris/attendance/leave-requests", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async update(recordId, payload) {
      return await requestJson(`/api/hris/attendance/leave-requests/${encodeURIComponent(recordId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    async approve(recordId, { approved, approvalNote }) {
      return await requestJson(`/api/hris/attendance/leave-requests/${encodeURIComponent(recordId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: approved ? "Approved" : "Rejected",
          approvalNote: approvalNote || "",
        }),
      });
    },
  },

  performance: {
    async list(params = {}) {
      return await requestJson(`/api/hris/performance${buildQuery(params)}`, { method: "GET" });
    },
    async create(payload) {
      return await requestJson("/api/hris/performance", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async update(recordId, payload) {
      return await requestJson(`/api/hris/performance/${encodeURIComponent(recordId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
  },

  templates: {
    async list(params = {}) {
      return await requestJson(`/api/hris/templates${buildQuery(params)}`, { method: "GET" });
    },
    async create(payload) {
      return await requestJson("/api/hris/templates", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async update(recordId, payload) {
      return await requestJson(`/api/hris/templates/${encodeURIComponent(recordId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    async archive(recordId) {
      return await requestJson(`/api/hris/templates/${encodeURIComponent(recordId)}`, { method: "DELETE" });
    },
  },

  activityLogs: {
    async list(params = {}) {
      return await requestJson(`/api/hris/activity-logs${buildQuery(params)}`, { method: "GET" });
    },
    async exportCsv(params = {}) {
      const query = buildQuery({ ...params, export: "csv" });
      return await requestCsv(`/api/hris/activity-logs${query}`, { method: "GET" });
    },
  },

  exports: {
    async list(params = {}) {
      return await requestJson(`/api/hris/exports${buildQuery(params)}`, { method: "GET" });
    },
    async create(payload) {
      return await requestJson("/api/hris/exports", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async update(recordId, payload) {
      return await requestJson(`/api/hris/exports/${encodeURIComponent(recordId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    async approve(recordId, payload) {
      return await requestJson(`/api/hris/exports/${encodeURIComponent(recordId)}/approve`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async execute(recordId) {
      return await requestCsv(`/api/hris/exports/${encodeURIComponent(recordId)}/execute`, {
        method: "POST",
      });
    },
  },
};

