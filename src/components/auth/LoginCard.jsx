"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BrandMark from "@/components/ui/BrandMark";
import { LOGIN_HIGHLIGHTS, ROLES } from "@/features/hris/constants";
import { normalizeRole } from "@/lib/hris";

const initialForm = {
  email: "",
  password: "",
  role: "HR",
};

export default function LoginCard() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleField = (field) => (event) => {
    setForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          role: normalizeRole(form.role),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Unable to log in.");
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setErrorMessage(error.message || "Unable to log in.");
      setIsSubmitting(false);
    }
  };

  return (
    <section className="grid w-full gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="relative overflow-hidden rounded-3xl border border-[#d7e5f5] bg-white p-8 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.55)] sm:p-10">
        <div className="pointer-events-none absolute -top-12 -right-12 h-48 w-48 rounded-full bg-[#dbeafe]" />
        <div className="pointer-events-none absolute -bottom-14 -left-14 h-44 w-44 rounded-full bg-[#ecfeff]" />
        <div className="relative space-y-8">
          <BrandMark compact />
          <div className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-[0.15em] text-[#0f6bcf]">
              Clio Human Resource Information System
            </p>
            <h1 className="max-w-xl text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              Attendance and employee data, secured and easy to access.
            </h1>
            <p className="max-w-lg text-base text-slate-600">
              Built for GRC, HR, and EA teams with centralized records, activity logs, export control,
              and document workflows.
            </p>
          </div>

          <ul className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
            {LOGIN_HIGHLIGHTS.map((item) => (
              <li key={item} className="rounded-xl border border-[#d7e5f5] bg-[#f8fbff] px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-3xl border border-[#d7e5f5] bg-white p-8 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.55)] sm:p-10">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Log in to Clio</h2>
        <p className="mt-2 text-sm text-slate-600">
          Sign in to continue to the HRIS dashboard.
        </p>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-slate-700">
              Work Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={handleField("email")}
              placeholder="name@clio.local"
              className="h-11 w-full rounded-xl border border-[#c9d8ea] bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0f6bcf] focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              minLength={8}
              required
              value={form.password}
              onChange={handleField("password")}
              placeholder="At least 8 characters"
              className="h-11 w-full rounded-xl border border-[#c9d8ea] bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0f6bcf] focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="role" className="text-sm font-medium text-slate-700">
              Role
            </label>
            <select
              id="role"
              value={form.role}
              onChange={handleField("role")}
              className="h-11 w-full rounded-xl border border-[#c9d8ea] bg-white px-3 text-sm text-slate-900 focus:border-[#0f6bcf] focus:outline-none"
            >
              {ROLES.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0f6bcf] px-4 text-sm font-semibold text-white transition hover:bg-[#0c57aa] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Signing in..." : "Log in to workspace"}
          </button>

          {errorMessage ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {errorMessage}
            </p>
          ) : null}
        </form>

        <p className="mt-4 text-xs text-slate-500">
          Demo mode enabled: use any valid email and password to explore the front-end.
        </p>
      </div>
    </section>
  );
}
