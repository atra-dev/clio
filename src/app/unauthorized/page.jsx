import Link from "next/link";

export const metadata = {
  title: "Unauthorized | Clio HRIS",
};

export default function UnauthorizedPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6">
      <section className="w-full rounded-2xl border border-rose-200 bg-white p-8 shadow-[0_20px_45px_-34px_rgba(15,23,42,0.6)]">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-rose-600">Access Denied</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">You do not have permission to view this page.</h1>
        <p className="mt-3 text-sm text-slate-600">
          Your account role does not include access to this feature. Contact Super Admin if this is required for your work.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-sky-600 px-4 text-sm font-medium text-white transition hover:bg-sky-700"
          >
            Go to Dashboard
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Back to Login
          </Link>
        </div>
      </section>
    </main>
  );
}
