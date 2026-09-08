// Generic NDJSON body reader shared by the tutor chat stream and the attempt evaluation
// stream. A single line that fails to decode must not kill the whole generator: an
// unrecognised frame is just skipped, so a server that ships a new frame type ahead of
// the client degrades gracefully instead of breaking the stream (ADR-02).
export async function* readNdjson<A>(
  response: Response,
  decode: (line: string) => A
): AsyncGenerator<A> {
  if (response.body === null) {
    throw new Error("Stream response did not include a body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const decodeLine = (line: string): A | undefined => {
    try {
      return decode(line);
    } catch (cause) {
      console.warn("ndjson: skipping line that failed to decode", line, cause);
      return undefined;
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          const decoded = decodeLine(trimmed);
          if (decoded !== undefined) {
            yield decoded;
          }
        }
      }
    }

    buffer += decoder.decode();
    const remaining = buffer.trim();
    if (remaining.length > 0) {
      const decoded = decodeLine(remaining);
      if (decoded !== undefined) {
        yield decoded;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
