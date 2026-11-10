"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Eraser, GraduationCap, Square } from "lucide-react";
import { clearChat } from "../actions/library";
import MathMarkdown from "./MathMarkdown";
import Spinner from "./Spinner";

export interface ChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "Explain the main idea like I'm 12",
  "Give me a real-world example",
  "Quiz me with 3 questions, one at a time",
  "What will most likely be on the exam?",
  "What do students usually get wrong here?",
];

export default function ChatView({ projectId, initial, subject }: { projectId: string; initial: ChatItem[]; subject: string }) {
  const [messages, setMessages] = useState<ChatItem[]>(initial);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearing, startClear] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep the newest message in view unless the student scrolled up to read.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const autosize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || streaming) return;
      setError(null);
      setInput("");
      requestAnimationFrame(autosize);
      stickToBottom.current = true;
      const userId = `local-u-${Date.now()}`;
      const botId = `local-a-${Date.now()}`;
      setMessages((m) => [...m, { id: userId, role: "user", content: question }, { id: botId, role: "assistant", content: "" }]);
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      const fail = (message: string) => {
        setMessages((m) => m.filter((x) => x.id !== userId && x.id !== botId));
        setInput(question);
        setError(message);
      };

      try {
        const res = await fetch(`/api/projects/${projectId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: question }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          return fail(data?.error ?? "The tutor couldn't answer. Please try again.");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answered = false;
        const handle = (line: string) => {
          if (!line.trim()) return;
          const event = JSON.parse(line) as { type: string; text?: string; error?: string; id?: string };
          if (event.type === "delta" && event.text) {
            answered = true;
            setMessages((m) => m.map((x) => (x.id === botId ? { ...x, content: x.content + event.text } : x)));
          } else if (event.type === "done" && event.id) {
            const savedId = event.id;
            setMessages((m) => m.map((x) => (x.id === botId ? { ...x, id: savedId } : x)));
          } else if (event.type === "error") {
            fail(event.error ?? "The tutor couldn't answer. Please try again.");
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl = buffer.indexOf("\n");
          while (nl !== -1) {
            handle(buffer.slice(0, nl));
            buffer = buffer.slice(nl + 1);
            nl = buffer.indexOf("\n");
          }
        }
        handle(buffer);
        if (!answered) setMessages((m) => m.filter((x) => !(x.id === botId && !x.content)));
      } catch (err) {
        if (controller.signal.aborted) {
          setMessages((m) =>
            m
              .map((x) => (x.id === botId && x.content ? { ...x, content: `${x.content}\n\n_(stopped)_` } : x))
              .filter((x) => !(x.id === botId && !x.content)),
          );
        } else {
          fail(err instanceof Error && err.message !== "Failed to fetch" ? "The connection dropped. Please try again." : "Couldn't reach the server.");
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        inputRef.current?.focus();
      }
    },
    [projectId, streaming],
  );

  const empty = messages.length === 0;

  return (
    <div className="card flex h-[calc(100vh-15rem)] min-h-[480px] flex-col overflow-hidden">
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-8"
        aria-live="polite"
      >
        {empty ? (
          <div className="mx-auto max-w-lg pt-6 text-center">
            <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent-soft text-accent">
              <GraduationCap className="size-5" />
            </span>
            <h2 className="mt-4 text-lg font-semibold">Ask your tutor anything</h2>
            <p className="mt-1 text-sm text-muted">It has read your material and notes for {subject}.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-faint hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="mx-auto max-w-3xl space-y-6">
            {messages.map((m, i) => (
              <li key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                {m.role === "user" ? (
                  <p className="max-w-[85%] rounded-lg bg-accent-soft px-3.5 py-2 whitespace-pre-wrap text-ink">{m.content}</p>
                ) : m.content ? (
                  <MathMarkdown className="prose max-w-none font-serif text-[16px] leading-relaxed dark:prose-invert prose-headings:font-sans prose-p:my-2 prose-strong:text-ink prose-code:rounded prose-code:bg-subtle prose-code:px-1 prose-code:before:content-none prose-code:after:content-none prose-li:my-0.5">
                    {m.content}
                  </MathMarkdown>
                ) : (
                  streaming &&
                  i === messages.length - 1 && (
                    <span className="flex items-center gap-2 text-sm text-muted">
                      <Spinner /> Thinking…
                    </span>
                  )
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="border-t border-line bg-surface px-3 py-3 sm:px-6">
        {error && (
          <p role="alert" className="mx-auto mb-2 max-w-3xl rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}
        {!empty && !streaming && (
          <div className="mx-auto mb-2 flex max-w-3xl gap-1.5 overflow-x-auto">
            {SUGGESTIONS.slice(0, 3).map((s) => (
              <button key={s} type="button" onClick={() => void send(s)} className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:text-ink">
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="mx-auto flex max-w-3xl items-end gap-2"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autosize();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder="Ask a question…  (Shift+Enter for a new line)"
            aria-label="Message"
            className="field max-h-[200px] min-h-[42px] resize-none py-2.5"
          />
          {streaming ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className="btn btn-secondary h-[42px]" aria-label="Stop">
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="btn btn-primary h-[42px]" aria-label="Send">
              <ArrowUp className="size-4" />
            </button>
          )}
          {!empty && !streaming && (
            <button
              type="button"
              disabled={clearing}
              onClick={() =>
                startClear(async () => {
                  const res = await clearChat(projectId);
                  if (res.ok) setMessages([]);
                  else setError(res.error ?? "Couldn't clear the chat.");
                })
              }
              className="icon-btn h-[42px] w-[42px]"
              title="Clear chat"
              aria-label="Clear chat"
            >
              <Eraser className="size-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
