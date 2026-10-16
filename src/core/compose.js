import { parseSlots, fillSlots } from './slots.js';

/** Join prompt bodies in the given order. */
export function composeBodies(prompts, separator = '\n\n') {
  return prompts.map((p) => String(p.body ?? '').trim()).filter(Boolean).join(separator);
}

/** All slots across several prompts, merged by name (first default wins). */
export function slotsFor(prompts, separator) {
  return parseSlots(composeBodies(prompts, separator));
}

/** Final text ready for the clipboard. */
export function render(prompts, values = {}, separator = '\n\n') {
  return fillSlots(composeBodies(prompts, separator), values);
}
