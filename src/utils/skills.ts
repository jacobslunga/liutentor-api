import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Skills är slash-kommandon studenten väljer i chattens inmatningsfält. Varje
 * skill bor som en egen fil i `src/skills/` med frontmatter och en brödtext som
 * beskriver hur svaret ska byggas. Brödtexten läggs till systemprompten för den
 * aktuella förfrågan, på samma sätt som WEB_SEARCH_PROMPT.
 *
 * Filerna läses en gång vid uppstart. Dockerfilen kopierar in hela src/ och kör
 * `bun run src/app.ts` utan bundling, så de finns på plats även i drift.
 *
 * OBS i utveckling: `bun --hot` bevakar bara importerade moduler, inte .md. En
 * ändrad skill-fil syns först efter omstart av servern.
 */
export const SKILL_IDS = [
  "explain",
  "theory",
  "solution",
  "hint",
  "summary",
] as const;

export type SkillId = (typeof SKILL_IDS)[number];

/** Filnamnen är ASCII; id:t är det som går över nätet. */
const SKILL_FILES: Record<SkillId, string> = {
  explain: "forklara.md",
  theory: "teori.md",
  solution: "losning.md",
  hint: "ledtrad.md",
  summary: "sammanfatta.md",
};

export interface Skill {
  id: SkillId;
  command: string;
  label: string;
  description: string;
  /** Brödtexten, redan formaterad som en systemprompt-sektion. */
  prompt: string;
}

/**
 * Minimal frontmatter-läsare. Skill-filerna är våra egna och har enkla
 * `nyckel: värde`-rader, så en YAML-parser vore mer maskineri än det bär.
 */
function parseFrontmatter(raw: string, file: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw.trim());
  if (!match) throw new Error(`Skill ${file} saknar frontmatter`);

  const [, header, body] = match;
  const meta: Record<string, string> = {};
  for (const line of header!.split(/\r?\n/)) {
    const field = /^(\w+):\s*(.*)$/.exec(line);
    if (!field) continue;
    meta[field[1]!] = field[2]!.trim().replace(/^"(.*)"$/, "$1");
  }
  return { meta, body: body!.trim() };
}

function loadSkill(id: SkillId): Skill {
  const file = SKILL_FILES[id];
  const path = fileURLToPath(new URL(`../skills/${file}`, import.meta.url));
  const raw = readFileSync(path, "utf8");
  const { meta, body } = parseFrontmatter(raw, file);

  for (const key of ["command", "label", "description"]) {
    if (!meta[key]) throw new Error(`Skill ${file} saknar "${key}"`);
  }

  return {
    id,
    command: meta.command!,
    label: meta.label!,
    description: meta.description!,
    // Rubriknivån matchar WEB_SEARCH_PROMPT, som också kommer in som en
    // toppnivåsektion i systemprompten.
    prompt: `\n\n# Skill: ${meta.label}\n\n${body}\n`,
  };
}

export const SKILLS: Record<SkillId, Skill> = Object.fromEntries(
  SKILL_IDS.map((id) => [id, loadSkill(id)]),
) as Record<SkillId, Skill>;

export const SKILL_PROMPTS: Record<SkillId, string> = Object.fromEntries(
  SKILL_IDS.map((id) => [id, SKILLS[id].prompt]),
) as Record<SkillId, string>;
