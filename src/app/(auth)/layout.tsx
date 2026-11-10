import Logo from "../components/Logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center px-4 py-5 sm:px-6">
        <Logo />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[6vh] pb-16 sm:px-6">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
