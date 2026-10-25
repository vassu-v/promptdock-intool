// A few starter prompts so the library is not empty on first run, plus one recipe
// that shows how blocks compile into one prompt.
export const SEED_PROMPTS = [
  { title: 'Code review', tags: ['review', 'code'], pinned: true,
    body: 'Review the following {{language:TypeScript}} code for bugs, edge cases and readability. List issues by severity with a concrete fix for each.' },
  { title: 'Explain simply', tags: ['learn'],
    body: 'Explain {{topic}} to a {{audience:beginner}}. Use one analogy and one short example.' },
  { title: 'Write unit tests', tags: ['testing', 'code'],
    body: 'Write unit tests for {{target}} covering happy paths, edge cases and failure modes. Use {{framework:the existing test framework}}.' },
  { title: 'Make UI responsive', tags: ['ui', 'css'],
    body: 'Make this layout work well on phones (360px), tablets and desktop. Avoid horizontal scroll and keep tap targets at least 44px.' },
  { title: 'Commit message', tags: ['git'],
    body: 'Write a concise conventional commit message for these changes. Subject under 60 characters, then a short body explaining why.' },
  { title: 'Plan before coding', tags: ['planning'],
    body: 'Before writing any code, outline a step-by-step plan for {{task}}, list the files you will touch, and flag risks. Wait for my go-ahead.' },
  { title: 'Senior engineer', tags: ['persona', 'code'], role: 'role',
    body: 'You are a senior {{language:TypeScript}} engineer who values small, readable changes over clever ones.' },
  { title: 'Keep the scope tight', tags: ['rules', 'code'], role: 'constraints',
    body: 'Do not change public APIs or unrelated files. If something outside the request looks wrong, mention it instead of fixing it.' },
  { title: 'Answer as a diff', tags: ['output', 'code'], role: 'format',
    body: 'Reply with a unified diff only, then at most three bullet points explaining the change.' },
];

export const SEED_RECIPES = [
  { name: 'Careful review', format: 'xml', ordering: 'role', titles: ['Answer as a diff', 'Code review', 'Senior engineer', 'Keep the scope tight'] },
];

/** Adds the starter prompts and recipes to an empty store (no save; the caller saves). */
export function seedLibrary(store) {
  const byTitle = new Map(SEED_PROMPTS.map((p) => [p.title, store.create(p, { save: false }).id]));
  for (const { titles, ...r } of SEED_RECIPES) {
    store.saveRecipe({ ...r, items: titles.map((t) => ({ id: byTitle.get(t) })) }, { save: false });
  }
}
