import Link from "next/link";

export const metadata = {
  title: "Invitation | Clio HRIS",
};

export default async function InvitePage({ params }) {
  const { token } = await params;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_20px_45px_-34px_rgba(15,23,42,0.6)]">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-700">Invitation Received</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Your account invite is recorded.</h1>
        <p className="mt-3 text-sm text-slate-600">
          Invitation token: <span className="font-mono text-slate-700">{token}</span>
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Once Super Admin opens your account, you can sign in from the login page.
        </p>

        <div className="mt-6">
          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-sky-600 px-4 text-sm font-medium text-white transition hover:bg-sky-700"
          >
            Go to Login
          </Link>
        </div>
      </section>
    </main>
  );
}
