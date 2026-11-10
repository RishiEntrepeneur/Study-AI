import { loadProject } from "@/lib/data/loaders";
import { listChat } from "@/lib/data/study";
import ChatView from "../../../../components/ChatView";

export default async function ChatPage(props: PageProps<"/projects/[projectId]/chat">) {
  const { projectId } = await props.params;
  const { user, project } = await loadProject(projectId);
  const messages = await listChat(user.id, project.id);
  return (
    <ChatView
      projectId={project.id}
      subject={project.title}
      initial={messages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
    />
  );
}
