// Compile a stack of prompt blocks into one prompt.
//
// - Blocks are ordered by role (role → context → task → constraints → format → examples),
//   or kept in stack order. Disabled blocks are skipped.
// - Slots are merged across blocks: {{language}} in three blocks is one blank.
// - Sentences repeated in a later block are dropped (and reported).
// - Simple contradictions ("be concise" vs "be detailed") are reported, not changed.
// - Output: plain text, Markdown sections or XML-style tags.
import { parseSlots, fillSlots } from './slots.js';
import { ROLES } from './store.js';

export { ROLES };
export const FORMATS = ['plain', 'markdown', 'xml'];

const HEADINGS = { role: 'Role', context: 'Context', task: 'Task', constraints: 'Constraints', format: 'Output format', examples: 'Examples' };

// Each group lists phrases that pull in opposite directions.
const CONFLICTS = [
  [['concise', 'brief', 'short', 'terse', 'succinct'], ['detailed', 'thorough', 'in depth', 'in-depth', 'comprehensive', 'verbose', 'exhaustive']],
  [['formal'], ['casual', 'informal', 'friendly tone']],
  [['bullet points', 'bulleted', 'a list'], ['prose', 'paragraphs', 'no lists', 'no bullet']],
  [['json'], ['markdown', 'plain text']],
  [['no code', 'without code'], ['write code', 'code example', 'implement']],
];

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}{}]+/gu, ' ').trim();
const sentences = (line) => line.split(/(?<=[.!?])\s+(?=\S)/u);
const roleOf = (p) => (ROLES.includes(p?.role) ? p.role : 'task');

/** Remove sentences already said by an earlier block. Returns [body, dropped sentences]. */
function dedupe(body, seen) {
  const dropped = [];
  const lines = String(body).split('\n').map((line) => {
    if (!line.trim()) return line;
    const kept = sentences(line).filter((s) => {
      const k = norm(s);
      if (k.length < 8) return true; // too short to call a duplicate ("Thanks.")
      if (seen.has(k)) { dropped.push(s.trim()); return false; }
      seen.add(k);
      return true;
    });
    return kept.join(' ');
  });
  return [lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), dropped];
}

function findConflicts(blocks) {
  const hit = (text, words) => words.find((w) => new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, 'iu').test(text));
  const out = [];
  for (const [a, b] of CONFLICTS) {
    let ia = null, ib = null;
    for (const bl of blocks) {
      const wa = hit(bl.body, a), wb = hit(bl.body, b);
      if (wa && !ia) ia = { word: wa, title: bl.title };
      if (wb && !ib) ib = { word: wb, title: bl.title };
    }
    if (ia && ib) out.push(`"${ia.word}" (${ia.title}) vs "${ib.word}" (${ib.title})`);
  }
  return out;
}

/**
 * @param stack    [{ prompt, on }] in stack order (on defaults to true)
 * @param options  { format, ordering: 'role'|'stack', values, separator, dedupe }
 * @returns { text, slots, blocks, dropped, conflicts, chars, tokens }
 */
export function compile(stack, { format = 'plain', ordering = 'role', values = {}, separator = '\n\n', dedupe: doDedupe = true } = {}) {
  const active = stack.filter((it) => it?.prompt && it.on !== false && String(it.prompt.body ?? '').trim());
  const ordered = ordering === 'stack' ? active
    : active.map((it, i) => ({ it, i })).sort((x, y) => ROLES.indexOf(roleOf(x.it.prompt)) - ROLES.indexOf(roleOf(y.it.prompt)) || x.i - y.i).map((x) => x.it);

  const seen = new Set();
  const dropped = [];
  const blocks = [];
  for (const { prompt } of ordered) {
    const [body, gone] = doDedupe ? dedupe(prompt.body, seen) : [String(prompt.body).trim(), []];
    dropped.push(...gone.map((s) => ({ sentence: s, from: prompt.title })));
    if (body) blocks.push({ id: prompt.id, title: prompt.title, role: roleOf(prompt), body });
  }

  const slots = parseSlots(blocks.map((b) => b.body).join('\n'));
  const fill = (s) => fillSlots(s, values);

  let text;
  if (format === 'plain') {
    text = blocks.map((b) => fill(b.body)).join(separator);
  } else {
    // One section per role, blocks of the same role joined inside it (in output order).
    const groups = [];
    for (const b of blocks) {
      const last = groups[groups.length - 1];
      if (last && last.role === b.role) last.bodies.push(b.body); else groups.push({ role: b.role, bodies: [b.body] });
    }
    text = groups.map((g) => {
      const body = fill(g.bodies.join('\n\n'));
      return format === 'xml' ? `<${g.role}>\n${body}\n</${g.role}>` : `## ${HEADINGS[g.role]}\n\n${body}`;
    }).join('\n\n');
  }

  return { text, slots, blocks, dropped, conflicts: findConflicts(blocks), chars: text.length, tokens: Math.ceil(text.length / 4) };
}
