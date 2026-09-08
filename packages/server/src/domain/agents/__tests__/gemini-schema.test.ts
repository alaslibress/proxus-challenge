import { describe, it, expect } from "vitest";
import { JsonSchema, Schema } from "effect";
import { FinalFeedbackSchema } from "@proxus/shared";
import { resolveAllRefs, toGeminiResponseSchema } from "../gemini-schema.ts";

// Ningún schema del repo emite hoy $ref (toJsonSchemaDocument sobre FinalFeedbackSchema
// devuelve definitions: {}), así que los documentos con $ref se fabrican a mano.
const document = (
  schema: JsonSchema.JsonSchema,
  definitions: JsonSchema.Definitions
): JsonSchema.Document<"draft-2020-12"> => ({
  dialect: "draft-2020-12",
  schema,
  definitions
});

const collectKeys = (node: unknown, acc: string[] = []): string[] => {
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, acc);
    return acc;
  }
  if (typeof node !== "object" || node === null) {
    return acc;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    acc.push(key);
    collectKeys(value, acc);
  }
  return acc;
};

describe("resolveAllRefs", () => {
  it("inlines a top-level $ref pointing at definitions", () => {
    const doc = document({ $ref: "#/definitions/User" } as JsonSchema.JsonSchema, {
      User: { type: "object", properties: { name: { type: "string" } } }
    });

    const resolved = resolveAllRefs(doc);

    expect(resolved).toEqual({ type: "object", properties: { name: { type: "string" } } });
    expect(collectKeys(resolved)).not.toContain("$ref");
  });

  it("inlines a $ref nested inside properties", () => {
    const doc = document(
      {
        type: "object",
        properties: {
          author: { $ref: "#/definitions/User" },
          tags: { type: "array", items: { $ref: "#/definitions/Tag" } }
        }
      } as JsonSchema.JsonSchema,
      {
        User: { type: "object", properties: { name: { type: "string" } } },
        Tag: { type: "string" }
      }
    );

    const resolved = resolveAllRefs(doc);

    expect(resolved).toEqual({
      type: "object",
      properties: {
        author: { type: "object", properties: { name: { type: "string" } } },
        tags: { type: "array", items: { type: "string" } }
      }
    });
    expect(collectKeys(resolved)).not.toContain("$ref");
  });

  it("throws when a nested $ref cannot be resolved", () => {
    const doc = document(
      {
        type: "object",
        properties: { author: { $ref: "#/definitions/Missing" } }
      } as JsonSchema.JsonSchema,
      { User: { type: "string" } }
    );

    expect(() => resolveAllRefs(doc)).toThrow(/Unable to resolve \$ref: #\/definitions\/Missing/);
  });

  it("throws on a cyclic $ref instead of looping forever", () => {
    // El ciclo va ANIDADO dentro de properties a propósito: resolveAllRefs llama primero a
    // JsonSchema.resolveTopLevel$ref, así que un ciclo en el nivel superior no llegaría
    // nunca a la guardia de substituteRefs y el test estaría probando otra cosa.
    const doc = document(
      {
        type: "object",
        properties: { hijo: { $ref: "#/definitions/A" } }
      } as JsonSchema.JsonSchema,
      {
        A: { type: "object", properties: { hijo: { $ref: "#/definitions/A" } } }
      }
    );

    expect(() => resolveAllRefs(doc)).toThrow(
      /Cyclic \$ref detected while resolving schema: #\/definitions\/A/
    );
  });
});

describe("toGeminiResponseSchema", () => {
  it("strips every disallowed key at any depth, arrays included", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Root",
      type: "object",
      additionalProperties: false,
      definitions: { A: { type: "string" } },
      $defs: { B: { type: "string" } },
      properties: {
        nested: {
          type: "object",
          title: "Nested",
          additionalProperties: false,
          examples: ["x"],
          properties: { name: { type: "string" } }
        },
        list: {
          type: "array",
          items: { type: "object", title: "Item", additionalProperties: false, properties: {} }
        },
        anyOfField: {
          anyOf: [
            { type: "string", title: "A" },
            { type: "number", examples: [1] }
          ]
        }
      }
    };

    const purged = toGeminiResponseSchema(schema);
    const keys = collectKeys(purged);

    for (const disallowed of [
      "$schema",
      "$defs",
      "$ref",
      "additionalProperties",
      "definitions",
      "title",
      "examples"
    ]) {
      expect(keys).not.toContain(disallowed);
    }

    expect(purged).toEqual({
      type: "object",
      properties: {
        nested: { type: "object", properties: { name: { type: "string" } } },
        list: { type: "array", items: { type: "object", properties: {} } },
        anyOfField: { anyOf: [{ type: "string" }, { type: "number" }] }
      }
    });
  });

  it("leaves primitives and arrays of primitives untouched", () => {
    expect(toGeminiResponseSchema("texto")).toBe("texto");
    expect(toGeminiResponseSchema(null)).toBe(null);
    expect(toGeminiResponseSchema([1, "dos", true])).toEqual([1, "dos", true]);
  });
});

describe("resolveAllRefs + toGeminiResponseSchema sobre el schema real", () => {
  // Guardia de regresión de la FORMA real: hoy toJsonSchemaDocument(FinalFeedbackSchema)
  // no emite ningún $ref y devuelve definitions: {}, así que aquí resolveAllRefs es un
  // no-op y lo único que se comprueba de verdad es que toGeminiResponseSchema elimina el
  // additionalProperties: false que sí pone toJsonSchemaDocument. El valor del test está
  // en enterarse si mañana FinalFeedback gana un campo que genere $ref/definitions, o si
  // Effect cambia el shape del documento.
  const doc = Schema.toJsonSchemaDocument(FinalFeedbackSchema, { additionalProperties: false });

  it("documents today's shape: no $ref and empty definitions", () => {
    expect(doc.definitions).toEqual({});
    expect(collectKeys(doc.schema)).not.toContain("$ref");
  });

  it("produces a schema free of every key Gemini rejects", () => {
    const gemini = toGeminiResponseSchema(resolveAllRefs(doc));
    const keys = collectKeys(gemini);

    for (const disallowed of [
      "$schema",
      "$defs",
      "$ref",
      "additionalProperties",
      "definitions",
      "title",
      "examples"
    ]) {
      expect(keys).not.toContain(disallowed);
    }

    // El documento real sí trae additionalProperties: false; es lo que la purga quita.
    expect(collectKeys(doc.schema)).toContain("additionalProperties");
    expect(keys).toContain("is_correct");
    expect(keys).toContain("feedback");
    expect(keys).toContain("citas_pdf");
  });
});
