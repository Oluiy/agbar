import { BACKEND_CONCEPTS } from "./concepts/index.js";

/**
 * Renders LEVELING-UP.md - deliberately separate from ARCHITECTURE.md. That file
 * explains real choices made in this exact project; this one is a fixed list of
 * reliability concepts none of which buildquick actually generated. Keeping them
 * apart means "why is my project like this" and "what does my project not have
 * yet" never get confused with each other.
 */
export function renderLevelingUpDoc(projectName: string): string {
  const intro = `# Leveling up ${projectName}\n\nNone of this is in the code you just generated - buildquick scaffolds a working API, not a payment platform's failure-handling. But every one of these shows up the moment a real API meets real traffic, real users, and real third-party outages. Worth knowing before you need them, not after an incident teaches you the hard way.\n`;

  const sections = BACKEND_CONCEPTS.map((c) => {
    const parts = [`## ${c.title}`, ``, `_${c.category}_`, ``, `**Where this bites you:** ${c.failureScenario}`, ``, `**The fix:** ${c.fix}`];
    if (c.whenToUse) parts.push(``, `**When to reach for it:** ${c.whenToUse}`);
    if (c.example) parts.push(``, "```", c.example, "```");
    if (c.practice) parts.push(``, `**Practise it:** \`${c.practice}\``);
    if (c.references?.length) {
      parts.push(``, `Read more:`, ...c.references.map((r) => `- [${r.title}](${r.url})`));
    }
    return `${parts.join("\n")}\n`;
  }).join("\n");

  return `${intro}\n${sections}`;
}
