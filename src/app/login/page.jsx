import LoginCard from "@/components/auth/LoginCard";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-session";

export const metadata = {
  title: "Log In | Clio HRIS",
};

export default async function LoginPage() {
  const session = await getServerSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#f7f3ea]">
      <div className="pointer-events-none absolute -top-24 -left-24 h-80 w-80 rounded-full bg-[#e6efe7] opacity-70" />
      <div className="pointer-events-none absolute -bottom-28 right-[-8rem] h-96 w-96 rounded-full bg-[#f2e7d3] opacity-80" />
      <div className="pointer-events-none absolute right-[-10rem] top-[-6rem] h-72 w-72 rounded-full bg-[#e8eef7] opacity-70" />
      <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-center px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
        <LoginCard />
      </div>
    </main>
  );
}
