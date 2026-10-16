// Slot syntax: {{name}} or {{name:default value}}.
// Pure functions, shared by the desktop app and a future web build.

const SLOT_RE = /\{\{\s*([A-Za-z0-9_\- ]+?)\s*(?::([^}]*))?\}\}/g;

/** Unique slots in order of first appearance: [{ name, default }]. */
export function parseSlots(text) {
  const seen = new Map();
  for (const m of String(text ?? '').matchAll(SLOT_RE)) {
    const name = m[1].trim();
    if (!seen.has(name)) seen.set(name, { name, default: m[2]?.trim() ?? '' });
    else if (!seen.get(name).default && m[2]) seen.get(name).default = m[2].trim();
  }
  return [...seen.values()];
}

/** Replace slots with values; missing values fall back to the inline default, else stay as-is. */
export function fillSlots(text, values = {}) {
  return String(text ?? '').replace(SLOT_RE, (whole, rawName, def) => {
    const name = rawName.trim();
    const v = values[name];
    if (v !== undefined && v !== '') return v;
    if (def !== undefined && def.trim() !== '') return def.trim();
    return whole;
  });
}
