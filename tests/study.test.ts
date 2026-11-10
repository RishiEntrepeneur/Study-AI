import { describe, expect, it } from "vitest";
import { cardStage, formatInterval, schedule } from "@/lib/srs";
import { rankPassages, splitPassages } from "@/lib/ai/retrieval";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { parseNewProject } from "@/lib/validation";
import { buildSystemPrompt, buildUserPrompt, ACADEMIC_CORE_PROMPT } from "@/lib/ai/prompts";

const fresh = { intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 };
const DAY = 86_400_000;

describe("spaced repetition", () => {
  it("schedules new cards and grows intervals on success", () => {
    const now = 1_000_000;
    const first = schedule(fresh, "good", now);
    expect(first.intervalDays).toBe(1);
    const second = schedule(first, "good", now);
    expect(second.intervalDays).toBe(3);
    const third = schedule(second, "good", now);
    expect(third.intervalDays).toBeGreaterThan(6);
    expect(schedule(fresh, "easy", now).intervalDays).toBe(4);
  });

  it("brings a forgotten card back in minutes and lowers ease", () => {
    const now = 0;
    const again = schedule({ intervalDays: 10, ease: 2.5, reps: 4, lapses: 0 }, "again", now);
    expect(again.dueAt).toBe(10 * 60_000);
    expect(again.reps).toBe(0);
    expect(again.lapses).toBe(1);
    expect(again.ease).toBeCloseTo(2.3);
  });

  it("formats intervals and stages for humans", () => {
    expect(formatInterval(10 * 60_000)).toBe("10 min");
    expect(formatInterval(3 * DAY)).toBe("3 days");
    expect(cardStage({ reps: 0, intervalDays: 0, lastReviewedAt: null })).toBe("new");
    expect(cardStage({ reps: 5, intervalDays: 30, lastReviewedAt: 1 })).toBe("mastered");
  });
});

describe("tutor retrieval", () => {
  it("finds the passage that answers the question", () => {
    const text = [
      "Photosynthesis converts light energy into chemical energy in chloroplasts.",
      "The Krebs cycle oxidises acetyl-CoA in the mitochondrial matrix producing NADH.",
      "Glycolysis splits glucose into two pyruvate molecules in the cytoplasm.",
    ].join("\n\n");
    const passages = splitPassages("notes", text, 12);
    expect(passages).toHaveLength(3);
    const best = rankPassages(passages, "Where does the Krebs cycle happen?", 15);
    expect(best[0].text).toContain("Krebs");
  });
});

describe("passwords", () => {
  it("hashes with a salt and verifies", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("new project validation", () => {
  it("accepts a topic with no material", () => {
    const p = parseNewProject({ topic: "Fourier transforms", outputs: ["notes", "quiz"] }, 1000);
    expect(p.title).toBe("Fourier transforms");
    expect(p.materials).toEqual([]);
    expect(p.tier).toBe("standard");
  });

  it("requires a topic or enough material, and at least one output", () => {
    expect(() => parseNewProject({ outputs: ["notes"] }, 1000)).toThrow(/topic/);
    expect(() => parseNewProject({ topic: "x", outputs: [] }, 1000)).toThrow(/at least one/);
    expect(() => parseNewProject({ topic: "x", outputs: ["podcast"] }, 1000)).toThrow(/recognised/);
    expect(() => parseNewProject({ topic: "x", outputs: ["notes"], materials: [{ content: "word ".repeat(2000) }] }, 1000)).toThrow(/limit/);
  });
});

describe("prompts", () => {
  it("keeps the Academic Core verbatim and switches modes", () => {
    const topic = buildSystemPrompt({ type: "flashcards", tier: "deep_dive", mode: "topic", multiPart: false });
    expect(topic.startsWith(ACADEMIC_CORE_PROMPT)).toBe(true);
    expect(topic).toContain("DEEP DIVE");
    expect(topic).toContain("there is no lecture material");
    expect(topic).toContain("18 to 25");
    expect(buildUserPrompt({ topic: "Entropy", title: "Entropy", text: null })).toContain("TOPIC: Entropy");
    expect(buildUserPrompt({ topic: "", title: "T", text: "material" })).toContain("<<<LECTURE_MATERIAL_START>>>");
  });
});
