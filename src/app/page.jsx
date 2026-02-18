import LoginCard from "@/components/auth/LoginCard";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-session";

export default async function Home() {
  const session = await getServerSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
      <LoginCard />
    </main>
  );
}
