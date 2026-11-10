import { requireUser } from "@/lib/auth/dal";
import { listFolders } from "@/lib/data/projects";
import { countDueCards } from "@/lib/data/study";
import Sidebar from "../components/Sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [folders, dueCount] = await Promise.all([listFolders(user.id), countDueCards(user.id)]);

  return (
    <div className="lg:flex">
      <Sidebar
        user={{ name: user.name, email: user.email }}
        folders={folders.map((f) => ({ id: f.id, name: f.name, color: f.color, projectCount: f.projectCount }))}
        dueCount={dueCount}
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
