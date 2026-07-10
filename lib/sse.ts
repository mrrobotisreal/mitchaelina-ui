// Shared SSE record parsing for features that consume server-sent events via
// fetch + ReadableStream (the browser's EventSource cannot set an
// Authorization header, and the auth model never changes — so we never use
// it). Used by the chat-lab streaming send (useChatStream.ts).

/**
 * Split the accumulated stream buffer into complete SSE records (frames are
 * separated by a blank line). Returns the complete records plus the unfinished
 * remainder to carry into the next read.
 */
export function extractSSERecords(buffer: string): { records: string[]; rest: string } {
  const records: string[] = [];
  let rest = buffer;
  let sep: number;
  while ((sep = rest.indexOf('\n\n')) !== -1) {
    records.push(rest.slice(0, sep));
    rest = rest.slice(sep + 2);
  }
  return { records, rest };
}

/**
 * One SSE record's data payload: collect its `data:` lines (joined by \n),
 * ignoring `event:` fields and `:` comments/keepalives. Returns null when the
 * record carries no data (comment-only / keepalive frames).
 */
export function parseSSERecordData(record: string): string | null {
  const dataLines: string[] = [];
  for (const line of record.split('\n')) {
    if (line.startsWith(':')) continue; // comment / keepalive
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}
