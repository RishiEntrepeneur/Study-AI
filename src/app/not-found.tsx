import Link from "next/link";
import { LogoMark } from "./components/Logo";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <LogoMark className="size-12" />
      <h1 className="mt-6 text-2xl font-semibold">That page isn&apos;t here</h1>
      <p className="mt-2 max-w-sm text-muted">It may have been deleted, or the link is wrong.</p>
      <Link href="/dashboard" className="btn btn-primary mt-6">
        Go to home
      </Link>
    </div>
  );
}
