"use client";

/** Slash commands + personal prompt library (localStorage). */

export type SlashCommand = {
  id: string;
  name: string; // "/quiz"
  hint: string;
  template: string; // {q} replaced by the rest of the input
  icon: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "explain", name: "/explain", hint: "Explain simply with an example", icon: "◇", template: "Explain this simply, with one real-world example and a 3-line summary:\n{q}" },
  { id: "quiz", name: "/quiz", hint: "Generate a quiz with answers", icon: "✓", template: "Create a 5-question quiz (mixed MCQ + short answer) on this topic. Hide answers at the end under 'Answers'.\n{q}" },
  { id: "flashcards", name: "/flashcards", hint: "Flashcards for revision", icon: "▦", template: "Create revision flashcards on this topic. Format each as:\n**Q:** question\n**A:** answer\nCover the 10 most important concepts.\n{q}" },
  { id: "studyplan", name: "/studyplan", hint: "Day-wise study plan", icon: "☰", template: "Create a realistic day-wise study plan for this exam/syllabus with daily goals, revision slots and one practice test per week:\n{q}" },
  { id: "slides", name: "/slides", hint: "Presentation outline (exportable to PPTX)", icon: "▤", template: "Create a presentation about this. Structure it as '## Slide 1: Title' sections, each with 3-5 concise bullet points. 8 slides total.\n{q}" },
  { id: "review", name: "/review", hint: "Code review with fixes", icon: "‹›", template: "Review this code for bugs, performance and style. Show corrected code and explain each fix briefly:\n{q}" },
  { id: "summarize", name: "/summarize", hint: "TL;DR + key points", icon: "≡", template: "Summarize this into a 2-line TL;DR, 5 key points, and 2 open questions:\n{q}" },
  { id: "todo", name: "/todo", hint: "Turn this into checkable tasks", icon: "☐", template: "Break this into a concrete checklist. Use '- [ ]' for every task, ordered by priority:\n{q}" },
  { id: "research", name: "/research", hint: "Deep research with sources", icon: "◎", template: "Research this thoroughly: current state, key facts with dates, main perspectives, and what to watch next. Cite sources.\n{q}" },
];

/* ── tasks (to-dos) ── */

export type Task = { id: string; text: string; done: boolean; created: number };

const TASKS_KEY = "credon-tasks";

export function loadTasks(): Task[] {
  try {
    return JSON.parse(localStorage.getItem(TASKS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveTasks(tasks: Task[]): void {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks.slice(0, 100)));
}

export function extractChecklist(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => m[2].trim())
    .filter((text) => text.length > 2)
    .slice(0, 20);
}

export type SavedPrompt = { id: string; name: string; text: string };

const LIB_KEY = "credon-prompts";

export function loadPrompts(): SavedPrompt[] {
  try {
    return JSON.parse(localStorage.getItem(LIB_KEY) || "[]");
  } catch {
    return [];
  }
}

export function savePrompt(name: string, text: string): SavedPrompt {
  const prompts = loadPrompts();
  const entry = { id: `p-${Date.now().toString(36)}`, name: name || text.slice(0, 30), text };
  prompts.unshift(entry);
  localStorage.setItem(LIB_KEY, JSON.stringify(prompts.slice(0, 40)));
  return entry;
}

export function deletePrompt(id: string): void {
  localStorage.setItem(LIB_KEY, JSON.stringify(loadPrompts().filter((p) => p.id !== id)));
}

export function applyCommand(cmd: SlashCommand, rest: string): string {
  return cmd.template.replace("{q}", rest.trim() || "…");
}
