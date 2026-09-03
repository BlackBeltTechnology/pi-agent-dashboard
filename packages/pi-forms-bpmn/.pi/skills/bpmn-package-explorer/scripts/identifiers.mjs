// Deterministic identifier derivation and naming/uniqueness rules (§4).
//
// GOVERNS AUTHORING ONLY. Once a .bpmn exists its identifiers are opaque and are
// never re-derived (see isOpaqueExistingFile / preserveIdentifiers). A named
// element's id is `<Prefix>_<slug(deburr(name))>`, a pure function of type+name
// with no positional state; an unnamed element gets an ordinal discriminator and
// is not bindable.

import { PREFIX, BINDABLE } from './envelope.mjs';

/** Strip diacritics to ASCII. Hungarian ő/ű decompose to o/u under NFKD. */
export function deburr(str) {
  return (str || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks
    .replace(/[^\x00-\x7f]/g, '');   // any remaining non-ASCII
}

/** name → slug: lowercase, deburr, non-alphanumeric runs → single underscore. */
export function slug(name) {
  return deburr(String(name).toLowerCase())
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function prefixFor(type) {
  const p = PREFIX[type];
  if (!p) throw new Error(`no identifier prefix for element type '${type}'`);
  return p;
}

/** Derive the id of a single NAMED element. Pure function of type + name. */
export function deriveNamedId(type, name) {
  return `${prefixFor(type)}_${slug(name)}`;
}

/**
 * Derive identifiers for a whole authored process and enforce the naming and
 * uniqueness rules. Input: elements = [{ key, type, name }] (key is any stable
 * caller handle). Returns { ids: Map(key->id), diagnostics: [{code,message}] }.
 * Any diagnostic is a hard error.
 *
 * Rules:
 *   4.8  two elements sharing a prefix may not share a name
 *   4.9  two elements may not produce the same id after deburring (xsd:ID)
 *   4.10 a bindable element (userTask/businessRuleTask/callActivity) must be named
 *   4.4  an unnamed non-bindable element gets an ordinal discriminator
 */
export function deriveIdentifiers(elements) {
  const diagnostics = [];
  const add = (code, message) => diagnostics.push({ code, message });
  const ids = new Map();

  // 4.10 — bindable elements must be named.
  for (const el of elements) {
    if (BINDABLE.has(el.type) && !(el.name && String(el.name).trim())) {
      add('UNNAMED-BINDABLE', `${el.type} '${el.key}' has no name; a bindable element requires a name to derive a stable identifier`);
    }
  }

  // 4.8 — duplicate name within a shared prefix.
  const byPrefixName = new Map(); // `${prefix}\u0000${name}` -> [keys]
  for (const el of elements) {
    if (!(el.name && String(el.name).trim())) continue;
    const k = `${prefixFor(el.type)}\u0000${el.name}`;
    if (!byPrefixName.has(k)) byPrefixName.set(k, []);
    byPrefixName.get(k).push(el.key);
  }
  for (const [k, keys] of byPrefixName) {
    if (keys.length > 1) {
      const name = k.split('\u0000')[1];
      add('DUP-NAME', `elements ${keys.join(', ')} share the prefix and the name '${name}'; disambiguate the names (e.g. '${name} (manager)' and '${name} (finance)')`);
    }
  }

  // Derive ids: named → slug; unnamed → ordinal per prefix.
  const ordinalCounter = new Map();
  for (const el of elements) {
    if (el.name && String(el.name).trim()) {
      ids.set(el.key, deriveNamedId(el.type, el.name));
    } else {
      const pfx = prefixFor(el.type);
      const n = (ordinalCounter.get(pfx) || 0) + 1;
      ordinalCounter.set(pfx, n);
      ids.set(el.key, `${pfx}_${n}`);
    }
  }

  // 4.9 — post-deburr duplicate identifier (would be an invalid duplicate xsd:ID).
  const byId = new Map();
  for (const [key, id] of ids) {
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(key);
  }
  for (const [id, keys] of byId) {
    if (keys.length > 1) {
      add('DUP-ID', `elements ${keys.join(', ')} produce the same identifier '${id}' after deburring; a duplicate xsd:ID is invalid XML — rename to differ after diacritic removal`);
    }
  }

  return { ids, diagnostics, ok: diagnostics.length === 0 };
}

/** Which element ids are ordinal (unnamed) and therefore NOT bindable (4.5). */
export function unnamedOrdinalIds(elements) {
  const set = new Set();
  const ordinalCounter = new Map();
  for (const el of elements) {
    if (!(el.name && String(el.name).trim())) {
      const pfx = prefixFor(el.type);
      const n = (ordinalCounter.get(pfx) || 0) + 1;
      ordinalCounter.set(pfx, n);
      set.add(`${pfx}_${n}`);
    }
  }
  return set;
}
