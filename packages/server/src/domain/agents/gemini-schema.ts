import { JsonSchema } from "effect";

const isRef = (value: unknown): value is { readonly $ref: string } =>
  typeof value === "object" && value !== null && "$ref" in value &&
  typeof (value as { readonly $ref: unknown }).$ref === "string";

const substituteRefs = (
  node: unknown,
  definitions: JsonSchema.Definitions,
  stack: ReadonlySet<string>
): unknown => {
  if (Array.isArray(node)) {
    return node.map((item) => substituteRefs(item, definitions, stack));
  }

  if (typeof node !== "object" || node === null) {
    return node;
  }

  if (isRef(node)) {
    if (stack.has(node.$ref)) {
      throw new Error(`Cyclic $ref detected while resolving schema: ${node.$ref}`);
    }

    const resolved = JsonSchema.resolve$ref(node.$ref, definitions);
    if (resolved === undefined) {
      throw new Error(`Unable to resolve $ref: ${node.$ref}`);
    }

    return substituteRefs(resolved, definitions, new Set(stack).add(node.$ref));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    result[key] = substituteRefs(value, definitions, stack);
  }
  return result;
};

/** Inlinea el $ref de nivel superior y los anidados usando las definitions. */
export const resolveAllRefs = (
  document: JsonSchema.Document<"draft-2020-12">
): JsonSchema.JsonSchema => {
  const withResolvedTop = JsonSchema.resolveTopLevel$ref(document);
  return substituteRefs(withResolvedTop.schema, withResolvedTop.definitions, new Set()) as JsonSchema.JsonSchema;
};

const DISALLOWED_KEYS = new Set([
  "$schema",
  "$defs",
  "$ref",
  "additionalProperties",
  "definitions",
  "title",
  "examples"
]);

/** Purga las claves que la API de Gemini rechaza. */
export const toGeminiResponseSchema = (schema: unknown): unknown => {
  if (Array.isArray(schema)) {
    return schema.map((item) => toGeminiResponseSchema(item));
  }

  if (typeof schema !== "object" || schema === null) {
    return schema;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (DISALLOWED_KEYS.has(key)) {
      continue;
    }
    result[key] = toGeminiResponseSchema(value);
  }
  return result;
};
