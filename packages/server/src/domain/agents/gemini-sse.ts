export interface ParseSseChunkResult {
  readonly events: readonly string[];
  readonly rest: string;
}

/** Accumulates buffer + chunk and returns complete `data:` payloads plus the incomplete tail. */
export const parseSseChunk = (buffer: string, chunk: string): ParseSseChunkResult => {
  const combined = buffer + chunk;
  // Split on blank lines (both \n\n and \r\n\r\n)
  const rawBlocks = combined.split(/\r?\n\r?\n/);
  // The last element is either empty (complete) or an incomplete block still waiting
  const rest = rawBlocks.pop() ?? "";

  const events: string[] = [];
  for (const block of rawBlocks) {
    let dataLine: string | undefined;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(":")) continue; // comment / keep-alive
      if (line.startsWith("data:")) {
        dataLine = line.slice(5).trimStart();
      }
    }
    if (dataLine !== undefined) {
      events.push(dataLine);
    }
  }

  return { events, rest };
};
