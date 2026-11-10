/**
 * Normalises the LaTeX that local models emit so remark-math + KaTeX can
 * typeset it: converts \( \) / \[ \] delimiters to $ / $$, and undoes
 * over-escaped commands (\\frac -> \frac) inside math spans.
 */

const FENCE_SPLIT = /(```[\s\S]*?```|`[^`\n]*`)/g;

function fixMathBody(body: string): string {
  // "\\frac" inside math is almost always JSON over-escaping, not a LaTeX line break.
  return body.replace(/\\\\(?=[a-zA-Z])/g, "\\");
}

function normalizeProse(segment: string): string {
  let out = segment;

  // \[ ... \]  ->  display math on its own lines
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n$$\n${fixMathBody(body.trim())}\n$$\n`);
  // \( ... \)  ->  inline math
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${fixMathBody(body.trim())}$`);

  // $$ ... $$ and $ ... $ bodies
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_m, body: string) => `$$${fixMathBody(body)}$$`);
  out = out.replace(/(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g, (_m, body: string) => `$${fixMathBody(body)}$`);

  return out;
}

export function normalizeMath(markdown: string): string {
  if (!markdown) return "";
  return markdown
    .split(FENCE_SPLIT)
    .map((part, i) => (i % 2 === 1 ? part : normalizeProse(part)))
    .join("");
}

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π",
  rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const SYMBOLS: Record<string, string> = {
  infty: "∞", sum: "Σ", prod: "∏", int: "∫", oint: "∮", partial: "∂", nabla: "∇", cdot: "·", times: "×",
  div: "÷", pm: "±", mp: "∓", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐",
  leftrightarrow: "↔", Leftrightarrow: "⇔", implies: "⇒", iff: "⇔", leq: "≤", le: "≤", geq: "≥", ge: "≥",
  neq: "≠", ne: "≠", approx: "≈", equiv: "≡", propto: "∝", sim: "∼", in: "∈", notin: "∉", subset: "⊂",
  subseteq: "⊆", cup: "∪", cap: "∩", forall: "∀", exists: "∃", neg: "¬", land: "∧", lor: "∨", circ: "∘",
  degree: "°", hbar: "ħ", ell: "ℓ", angle: "∠", perp: "⊥", parallel: "∥", ldots: "…", cdots: "⋯",
};

const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", n: "ⁿ", i: "ⁱ",
};

/** Best-effort conversion of LaTeX to plain Unicode, for places KaTeX can't reach (mind map labels). */
export function latexToPlainText(input: string): string {
  let s = input.replace(/\$+/g, "");
  s = s.replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)");
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit|mathcal|operatorname|textbf|textit|vec|hat|bar)\s*\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\([a-zA-Z]+)/g, (m, name: string) => GREEK[name] ?? SYMBOLS[name] ?? (name.length > 1 ? "" : m));
  s = s.replace(/\^\{?([0-9+\-ni])\}?/g, (m, ch: string) => SUPERSCRIPTS[ch] ?? m);
  s = s.replace(/\\[,;:! ]/g, " ");
  s = s.replace(/\(([A-Za-z0-9α-ωΑ-Ω]+)\)\/\(([A-Za-z0-9α-ωΑ-Ω]+)\)/g, "$1/$2");
  return s;
}
