import { describe, expect, it } from "vitest";
import { countNodes, emitMindmap, mergeMindmaps, mindmapTreeFromMarkdown, parseMindmap, sanitizeMindmap } from "@/lib/mindmap";
import { normalizeMath } from "@/lib/math";

describe("mindmap sanitizer", () => {
  it("rebuilds messy model output into canonical syntax", () => {
    const messy = [
      "mindmap",
      "root((Calculus))",
      "    Derivatives ::icon(fa fa-book)",
      "        - Chain rule: $f(g(x))' = f'(g(x)) g'(x)$",
      "\t\tPower rule",
      "    Integrals",
      "Another root",
    ].join("\n");
    const out = sanitizeMindmap(messy, "Fallback")!;
    const lines = out.split("\n");
    expect(lines[0]).toBe("mindmap");
    expect(lines[1]).toBe("  root((Calculus))");
    expect(out).not.toMatch(/::icon|\$|\\/);
    // the stray second root becomes a branch instead of breaking Mermaid
    expect(parseMindmap(out)!.children.map((c) => c.label)).toEqual(["Derivatives", "Integrals", "Another root"]);
  });

  it("falls back to the notes structure when the map is unusable", () => {
    const notes = "# Concept Architecture\n## Kinematics\n- **Velocity**: rate\n- **Acceleration**: rate of rate\n## Dynamics\n- **Force**: push";
    const out = sanitizeMindmap("graph TD; A-->B", "Mechanics", notes)!;
    const tree = parseMindmap(out)!;
    expect(tree.label).toBe("Mechanics");
    expect(tree.children.map((c) => c.label)).toEqual(["Kinematics", "Dynamics"]);
  });

  it("merges segment maps under one root", () => {
    const merged = mergeMindmaps("Physics", [
      { code: "mindmap\n  root((Waves))\n    Frequency", fallbackLabel: "S1" },
      { code: "", fallbackLabel: "Optics" },
    ]);
    const tree = parseMindmap(merged)!;
    expect(tree.label).toBe("Physics");
    expect(tree.children.map((c) => c.label)).toEqual(["Part 1 · Waves", "Part 2 · Optics"]);
  });

  it("caps huge maps breadth-first", () => {
    const root = { label: "R", children: Array.from({ length: 10 }, (_, i) => ({
      label: `B${i}`, children: Array.from({ length: 40 }, (_, j) => ({ label: `L${i}-${j}`, children: [] })),
    })) };
    const tree = parseMindmap(emitMindmap(root, 50))!;
    expect(tree.children).toHaveLength(10); // every branch survives
    expect(countNodes(tree)).toBe(51);
  });

  it("derives nothing from empty notes", () => {
    expect(mindmapTreeFromMarkdown("", "x")).toBeNull();
  });
});

describe("normalizeMath", () => {
  it("converts \\( \\) and \\[ \\] delimiters and fixes over-escaping", () => {
    expect(normalizeMath(String.raw`Energy \(E = mc^2\) and \[F = ma\]`)).toBe("Energy $E = mc^2$ and \n$$\nF = ma\n$$\n");
    expect(normalizeMath(String.raw`$\\frac{1}{2}$`)).toBe(String.raw`$\frac{1}{2}$`);
    expect(normalizeMath("```\n\\(code\\)\n```")).toBe("```\n\\(code\\)\n```");
  });
});
