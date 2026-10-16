// A few starter prompts so the library is not empty on first run.
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
];
