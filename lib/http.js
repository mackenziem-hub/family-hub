// Family Hub - request helpers.
// Vercel's Node runtime usually parses JSON into req.body, but it can be
// inconsistent for PATCH/PUT/DELETE. readJson() handles all cases:
// already-parsed object, raw string, or unread stream.
export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.length) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  // Fall back to reading the raw stream.
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}
