// Skill Atlas builder — merges the scan payload with the authored summaries layer and
// inlines it into the template. Pure function: (payload, summaries, template) -> html.
import { sha } from './scan.mjs';

export function build(payloadIn, summaries, tpl, { generated = null, generatorHash = null } = {}) {
  // deep copy: never mutate the caller's scan result (verify() builds twice from one scan)
  const payload = JSON.parse(JSON.stringify(payloadIn));

  let missing = 0;
  for (const s of payload.skills) {
    const m = summaries[s.id];
    // no guessed category: the keyword heuristic's vocabulary is not the authored one, and a
    // wrong bucket looks authoritative. Unsummarized skills get one honest bucket.
    if (!m) { missing++; s.summarized = false; s.category = 'Not summarized yet'; continue; }
    s.summarized = true;
    s.oneLiner = m.oneLiner || '';
    s.summary = m.summary || '';
    s.useWhen = m.useWhen || '';
    s.dontUse = m.dontUse || '';
    s.keySteps = m.keySteps || [];
    s.cost = m.cost || 'free';
    if (m.category) s.category = m.category; // authored category beats the keyword heuristic
  }
  const byCat = {};
  for (const s of payload.skills) byCat[s.category] = (byCat[s.category] || 0) + 1;
  payload.counts.byCategory = Object.fromEntries(Object.entries(byCat).sort(([a], [b]) => (a < b ? -1 : 1)));
  payload.counts.unsummarized = missing;
  payload.generated = generated;                    // null unless SOURCE_DATE_EPOCH is given
  payload.summariesHash = sha(JSON.stringify(summaries)).slice(0, 16);
  payload.templateHash = sha(tpl).slice(0, 16);
  payload.generatorHash = generatorHash;

  if (!tpl.includes('/*__DATA__*/')) throw new Error('template.html lost its /*__DATA__*/ marker');

  // Skill bodies contain "<!--", "<script" and "</script>"; inside a <script> block those
  // break the data block. Escaping every "<" as \u003c is valid JSON and parser-proof.
  const safe = JSON.stringify(payload).replace(/</g, '\\u003c');
  // REPLACER FUNCTION, never a string: bodies contain `$&` / "$'" shell snippets that a
  // string replacement would treat as substitution patterns.
  const html = tpl.replace('/*__DATA__*/', () => safe);
  return { html, missing };
}
