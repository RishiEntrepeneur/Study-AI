import type { StudySuiteResponse } from "../types";

/** A single portable Markdown file containing the whole study suite. */
export function suiteToMarkdown(suite: StudySuiteResponse): string {
  const { meta } = suite;
  const lines: string[] = [
    `# ${meta.title}`,
    "",
    `> ${meta.tier === "deep_dive" ? "Deep Dive" : "Standard"} tier · ${meta.wordCount.toLocaleString("en-US")} words · generated ${new Date(meta.generatedAt).toLocaleString()}`,
    "",
    "## Deep Notes",
    "",
    suite.deepNotes,
    "",
    "## Flashcards",
    "",
  ];
  suite.flashcards.forEach((card, i) => {
    lines.push(`**${i + 1}. Q:** ${card.question}`, "", `**A:** ${card.answer}`, "");
  });
  lines.push("## Quiz", "");
  suite.quiz.forEach((q, i) => {
    lines.push(`**${i + 1}. ${q.question}**`, "");
    q.options.forEach((option, j) => lines.push(`- ${"ABCD"[j]}) ${option}`));
    lines.push("", `**Answer:** ${q.correctAnswer}${q.explanation ? ` — ${q.explanation}` : ""}`, "");
  });
  lines.push("## Mind Map", "", "```mermaid", suite.mindMapCode, "```", "");
  return lines.join("\n");
}

export function downloadFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}
