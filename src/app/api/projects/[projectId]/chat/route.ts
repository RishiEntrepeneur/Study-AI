/**
 * POST /api/projects/[projectId]/chat — ask the tutor. Body: { message: string }
 * Streams NDJSON events: {"type":"delta","text"} … then {"type":"done"} or {"type":"error","error"}.
 */
import { eq } from "drizzle-orm";
import { requireApiUser } from "@/lib/auth/dal";
import { getAIConfig } from "@/lib/ai/config";
import { describeAIError } from "@/lib/ai/errors";
import { contextFor } from "@/lib/ai/generate";
import { handleInputError, handleRouteError, jsonError, NO_STORE, readJson } from "@/lib/ai/http";
import { chat } from "@/lib/ai/ollama";
import { buildTutorMessages } from "@/lib/ai/tutor";
import { schema, write } from "@/lib/db";
import { getProjectBundle, parseContent } from "@/lib/data/projects";
import { addChatMessage, listChat } from "@/lib/data/study";
import { checkRateLimit } from "@/lib/rateLimit";

const MAX_MESSAGE_CHARS = 4_000;
const REPLY_TOKENS = 1_536;

export async function POST(request: Request, ctx: RouteContext<"/api/projects/[projectId]/chat">): Promise<Response> {
  let user;
  let projectId: string;
  let message: string;
  let bundle;
  try {
    user = await requireApiUser();
    projectId = (await ctx.params).projectId;
    const body = (await readJson(request, 32 * 1024)) as { message?: unknown };
    message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) return jsonError(400, { error: "Type a question first.", code: "BAD_REQUEST" });
    if (message.length > MAX_MESSAGE_CHARS) {
      return jsonError(400, { error: `Keep questions under ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters.`, code: "BAD_REQUEST" });
    }
    const limit = checkRateLimit(`chat:${user.id}`, 240, 60 * 60 * 1000);
    if (!limit.allowed) return jsonError(429, { error: "You're sending messages very quickly. Please wait a moment.", code: "RATE_LIMITED" });
    bundle = await getProjectBundle(user.id, projectId);
    if (!bundle) return jsonError(404, { error: "That project could not be found.", code: "NOT_FOUND" });
  } catch (err) {
    return handleInputError(err) ?? handleRouteError(err);
  }

  const cfg = getAIConfig();
  const history = (await listChat(user.id, projectId)).map((m) => ({ role: m.role, content: m.content }));
  const notes = parseContent(bundle.generations.find((g) => g.type === "notes"), "notes")?.markdown;
  const messages = buildTutorMessages({
    title: bundle.project.title,
    topic: bundle.project.topic,
    materials: bundle.materials.map((m) => ({ name: m.name, content: m.content })),
    notes,
    history,
    question: message,
  });
  const userMessage = await addChatMessage(projectId, "user", message);

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  const promptChars = messages.reduce((s, m) => s + m.content.length, 0);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: object) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      const heartbeat = setInterval(() => open && controller.enqueue(encoder.encode("\n")), 15_000);
      let answer = "";
      try {
        await chat({
          cfg,
          messages,
          numCtx: contextFor("", "x".repeat(promptChars), REPLY_TOKENS, cfg.maxContext),
          numPredict: REPLY_TOKENS,
          temperature: 0.5,
          signal: abort.signal,
          onText: (text) => {
            answer += text;
            send({ type: "delta", text });
          },
        });
        answer = answer.trim();
        if (!answer) throw new Error("The tutor returned an empty answer.");
        const saved = await addChatMessage(projectId, "assistant", answer);
        send({ type: "done", id: saved.id, userMessageId: userMessage.id });
      } catch (err) {
        if (abort.signal.aborted) {
          // Keep what the student already saw.
          if (answer.trim()) await addChatMessage(projectId, "assistant", `${answer.trim()}\n\n_(stopped)_`);
          else await write((db) => db.delete(schema.chatMessages).where(eq(schema.chatMessages.id, userMessage.id)).run());
        } else {
          // Roll back the question so a retry doesn't duplicate it.
          await write((db) => db.delete(schema.chatMessages).where(eq(schema.chatMessages.id, userMessage.id)).run());
          send({ type: "error", error: describeAIError(err, cfg.model).message });
        }
      } finally {
        clearInterval(heartbeat);
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no", ...NO_STORE, "Cache-Control": "no-store, no-transform" },
  });
}
