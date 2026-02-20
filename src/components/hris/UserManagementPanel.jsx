"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";

const ROLE_OPTIONS = ["SUPER_ADMIN", "HR", "GRC", "EA"];

const initialInviteForm = {
  email: "",
  role: "HR",
};

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusBadgeClass(status) {
  if (status === "active") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (status === "disabled") {
    return "bg-rose-100 text-rose-700";
  }
  return "bg-amber-100 text-amber-700";
}

function getRowActionLabel(status) {
  if (status === "active") {
    return "Disable";
  }
  return "Open account";
}

function getNextStatus(status) {
  if (status === "active") {
    return "disabled";
  }
  return "active";
}

export default function UserManagementPanel() {
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUpdatingId, setIsUpdatingId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [invitePreview, setInvitePreview] = useState(null);
  const [inviteForm, setInviteForm] = useState(initialInviteForm);

  const loadUsers = useCallback(async () => {
    setErrorMessage("");
    try {
      const response = await fetch("/api/admin/users", { method: "GET" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Unable to load user directory.");
      }

      const payload = await response.json();
      setUsers(Array.isArray(payload.users) ? payload.users : []);
    } catch (error) {
      setErrorMessage(error.message || "Unable to load user directory.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleInviteField = (field) => (event) => {
    setInviteForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const handleInviteSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    setInvitePreview(null);

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(inviteForm),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Unable to send invitation.");
      }

      const payload = await response.json();
      setSuccessMessage(`Invitation created for ${payload.user.email}.`);
      setInvitePreview(payload.invite || null);
      setInviteForm(initialInviteForm);
      await loadUsers();
    } catch (error) {
      setErrorMessage(error.message || "Unable to send invitation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusToggle = async (user) => {
    setIsUpdatingId(user.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(`/api/admin/users/${user.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: getNextStatus(user.status),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Unable to update account status.");
      }

      const payload = await response.json();
      setUsers((current) =>
        current.map((item) => (item.id === payload.user.id ? payload.user : item)),
      );
      setSuccessMessage(`Account status updated: ${payload.user.email} is ${payload.user.status}.`);
    } catch (error) {
      setErrorMessage(error.message || "Unable to update account status.");
    } finally {
      setIsUpdatingId("");
    }
  };

  const orderedUsers = useMemo(
    () =>
      [...users].sort(
        (a, b) => new Date(b.updatedAt || b.invitedAt).getTime() - new Date(a.updatedAt || a.invitedAt).getTime(),
      ),
    [users],
  );

  return (
    <div className="space-y-4">
      <SurfaceCard
        title="Invite User"
        subtitle="No sign-up form. Accounts are created and opened through Super Admin invitations."
      >
        <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]" onSubmit={handleInviteSubmit}>
          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-slate-600">Work Email</span>
            <input
              type="email"
              required
              value={inviteForm.email}
              onChange={handleInviteField("email")}
              placeholder="employee@clio.local"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-slate-600">Role</span>
            <select
              value={inviteForm.role}
              onChange={handleInviteField("role")}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Sending..." : "Send invite"}
          </button>
        </form>

        {invitePreview ? (
          <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800">
            <p className="font-semibold">Invitation Preview (temporary while email service is not configured)</p>
            <p className="mt-1 break-all">Token: {invitePreview.invitationToken}</p>
            <p className="mt-1 break-all">Link: {invitePreview.invitationUrl}</p>
            <p className="mt-1">Expires: {formatDate(invitePreview.expiresAt)}</p>
          </div>
        ) : null}

        {errorMessage ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {errorMessage}
          </p>
        ) : null}

        {successMessage ? (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {successMessage}
          </p>
        ) : null}
      </SurfaceCard>

      <SurfaceCard title="User Directory" subtitle="Open, disable, and review account access states.">
        {isLoading ? (
          <p className="text-sm text-slate-600">Loading user accounts...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                  <th className="px-2 py-3 font-medium">Email</th>
                  <th className="px-2 py-3 font-medium">Role</th>
                  <th className="px-2 py-3 font-medium">Status</th>
                  <th className="px-2 py-3 font-medium">Invited</th>
                  <th className="px-2 py-3 font-medium">Last Login</th>
                  <th className="px-2 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {orderedUsers.map((user) => (
                  <tr key={user.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                    <td className="px-2 py-3">
                      <p className="font-medium text-slate-900">{user.email}</p>
                      <p className="text-xs text-slate-500">By: {user.invitedBy}</p>
                    </td>
                    <td className="px-2 py-3">{user.role}</td>
                    <td className="px-2 py-3">
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusBadgeClass(user.status)}`}>
                        {user.status}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-xs text-slate-600">{formatDate(user.invitedAt)}</td>
                    <td className="px-2 py-3 text-xs text-slate-600">{formatDate(user.lastLoginAt)}</td>
                    <td className="px-2 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleStatusToggle(user)}
                        disabled={isUpdatingId === user.id}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isUpdatingId === user.id ? "Updating..." : getRowActionLabel(user.status)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}
