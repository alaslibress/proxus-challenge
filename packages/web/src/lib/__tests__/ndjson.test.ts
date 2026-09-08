import { describe, it, expect, vi, afterEach } from "vitest";
import { readNdjson } from "../ndjson.ts";

const encoder = new TextEncoder();

/** Response de mentira sobre un ReadableStream: environment es "node", no hace falta red. */
const responseFrom = (chunks: readonly string[]): Response => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });

  return new Response(stream);
};

const decodeJson = (line: string): { readonly type: string } =>
  JSON.parse(line) as { readonly type: string };

// readNdjson cancela el reader en su finally: salir del for-await con un break temprano
// cierra el stream a media lectura y el test mediría otra cosa. Se consume siempre entero.
const collect = async <A>(source: AsyncGenerator<A>): Promise<A[]> => {
  const out: A[] = [];
  for await (const item of source) {
    out.push(item);
  }
  return out;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readNdjson", () => {
  it("emits every complete line of a single chunk, in order", async () => {
    const response = responseFrom([
      '{"type":"status","value":"a"}\n{"type":"status","value":"b"}\n{"type":"done"}\n'
    ]);

    const frames = await collect(readNdjson(response, decodeJson));

    expect(frames).toEqual([
      { type: "status", value: "a" },
      { type: "status", value: "b" },
      { type: "done" }
    ]);
  });

  it("reassembles a JSON object split across two chunks and emits it once", async () => {
    const response = responseFrom(['{"type":"sta', 'tus","value":"a"}\n{"type":"done"}\n']);

    const frames = await collect(readNdjson(response, decodeJson));

    expect(frames).toEqual([{ type: "status", value: "a" }, { type: "done" }]);
  });

  it("reassembles an object split across many chunks, one character at a time", async () => {
    const payload = '{"type":"done","payload":{"id":"attempt-1"}}\n';
    const response = responseFrom(payload.split(""));

    const frames = await collect(readNdjson(response, decodeJson));

    expect(frames).toEqual([{ type: "done", payload: { id: "attempt-1" } }]);
  });

  it("emits the last line even when it has no trailing newline", async () => {
    const response = responseFrom(['{"type":"status"}\n{"type":"done"}']);

    const frames = await collect(readNdjson(response, decodeJson));

    expect(frames).toEqual([{ type: "status" }, { type: "done" }]);
  });

  it("ignores blank and whitespace-only lines", async () => {
    const response = responseFrom(['\n   \n{"type":"done"}\n\n  \n']);

    const frames = await collect(readNdjson(response, decodeJson));

    expect(frames).toEqual([{ type: "done" }]);
  });

  it("skips a line that fails to decode, warns, and keeps going", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = responseFrom([
      '{"type":"status"}\nesto no es json\n{"type":"done"}\n'
    ]);

    const frames = await collect(readNdjson(response, decodeJson));

    expect(frames).toEqual([{ type: "status" }, { type: "done" }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("ndjson: skipping line that failed to decode");
  });

  it("skips an undecodable final line without a trailing newline", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = responseFrom(['{"type":"status"}\n{"type":']);

    const frames = await collect(readNdjson(response, decodeJson));

    expect(frames).toEqual([{ type: "status" }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("skips a frame the decoder rejects (unknown frame type) and keeps the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const strictDecode = (line: string): { readonly type: string } => {
      const parsed = JSON.parse(line) as { readonly type: string };
      if (parsed.type !== "status" && parsed.type !== "done") {
        throw new Error(`unknown frame type: ${parsed.type}`);
      }
      return parsed;
    };
    const response = responseFrom([
      '{"type":"status"}\n{"type":"frame-del-futuro"}\n{"type":"done"}\n'
    ]);

    const frames = await collect(readNdjson(response, strictDecode));

    expect(frames).toEqual([{ type: "status" }, { type: "done" }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("throws when the response has no body", async () => {
    const response = new Response(null);

    await expect(collect(readNdjson(response, decodeJson))).rejects.toThrow(
      "Stream response did not include a body"
    );
  });

  it("yields nothing for an empty stream", async () => {
    const frames = await collect(readNdjson(responseFrom([]), decodeJson));

    expect(frames).toEqual([]);
  });
});
