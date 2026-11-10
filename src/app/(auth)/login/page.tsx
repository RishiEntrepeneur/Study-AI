import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/dal";
import AuthForm from "../../components/AuthForm";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage(props: PageProps<"/login">) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await props.searchParams;
  return <AuthForm mode="login" next={typeof next === "string" ? next : undefined} />;
}
