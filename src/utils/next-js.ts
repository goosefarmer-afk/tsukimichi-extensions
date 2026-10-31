import type { CheerioAPI } from "cheerio";

const NEXT_F_REGEX = /self\.__next_f\.push\(\s*(\[.*])\s*\)\s*;?\s*$/s;

type Deserializer<T> = (payload: unknown) => T;
type Predicate<T> = (payload: unknown) => payload is T;

function extractValueNextJs<T>(
  payload: unknown,
  predicate: Predicate<T>,
  deserializer: Deserializer<T>,
): T | null {
  if (payload == null || (typeof payload !== "object" && !Array.isArray(payload))) return null;

  if (predicate(payload)) return deserializer(payload);

  const children: unknown[] = Array.isArray(payload) ? payload : Object.values(payload);

  for (const child of children) {
    const result = extractValueNextJs(child, predicate, deserializer);
    if (result !== null) return result;
  }

  return null;
}

function resolveNextJsRefs(
  element: unknown,
  chunkCache: Map<string, string>,
  modelCache: Map<string, unknown>,
  resolving: Set<string> = new Set<string>(),
): unknown {
  if (element === null || element === undefined) return element;

  if (Array.isArray(element)) {
    return element.map((el) => resolveNextJsRefs(el, chunkCache, modelCache, resolving));
  }

  if (typeof element === "object" && !Array.isArray(element)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(element)) {
      result[key] = resolveNextJsRefs(value, chunkCache, modelCache, resolving);
    }
    return result;
  }

  if (typeof element === "string" && element.startsWith("$") && element.length >= 2) {
    const str = element;

    if (str === "$undefined") return null;

    if (str === "$Infinity" || str === "$-Infinity" || str === "$NaN" || str === "$-0") {
      return str.substring(1);
    }

    if (str[1] === "$") return str.substring(1);
    if (str[1] === "D") return str.substring(2);
    if (str[1] === "n") return str.substring(2);
    if (str[1] === "Q")
      return resolveMapRef(str.substring(2), chunkCache, modelCache, resolving) ?? element;
    if (str[1] === "W")
      return resolveSetRef(str.substring(2), chunkCache, modelCache, resolving) ?? element;

    // RSC chunk reference
    const cached = chunkCache.get(str.substring(1));
    return cached ?? element;
  }

  return element;
}

function resolveMapRef(
  id: string,
  chunkCache: Map<string, string>,
  modelCache: Map<string, unknown>,
  resolving: Set<string>,
): unknown | null {
  if (resolving.has(id)) return null;

  const entries = modelCache.get(id);
  if (!(entries && Array.isArray(entries))) return null;

  const resolved = resolveNextJsRefs(entries, chunkCache, modelCache, new Set([...resolving, id]));
  if (!Array.isArray(resolved)) return null;

  const result: Record<string, unknown> = {};
  for (const item of resolved) {
    if (Array.isArray(item) && item.length === 2) {
      const key = typeof item[0] === "string" ? item[0] : String(item[0]);
      result[key] = item[1];
    }
  }

  return result;
}

function resolveSetRef(
  id: string,
  chunkCache: Map<string, string>,
  modelCache: Map<string, unknown>,
  resolving: Set<string>,
): unknown | null {
  if (resolving.has(id)) return null;

  const values = modelCache.get(id);
  if (!(values && Array.isArray(values))) return null;

  return resolveNextJsRefs(values, chunkCache, modelCache, new Set([...resolving, id]));
}

function parseJsonAt(body: string, start: number): [unknown | null, number] {
  if (start >= body.length) return [null, start];

  let depth = 0;
  let inString = false;
  let esc = false;
  let i = start;

  while (i < body.length) {
    const c = body[i++];

    if (esc) {
      esc = false;
      continue;
    }

    if (c === "\\" && inString) {
      esc = true;
      continue;
    }

    if (c === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        try {
          return [JSON.parse(body.substring(start, i)), i];
        } catch {
          return [null, i];
        }
      }
    }

    if (depth === 0 && /\s/.test(c!)) {
      try {
        return [JSON.parse(body.substring(start, i - 1)), i];
      } catch {
        return [null, i];
      }
    }
  }

  return [null, i];
}

function extractRscPayloads(
  body: string,
  chunkCache: Map<string, string>,
  modelCache: Map<string, unknown>,
): unknown[] {
  const results: unknown[] = [];

  let pos = 0;

  while (pos < body.length) {
    const colonIdx = body.indexOf(":", pos);
    if (colonIdx === -1) break;

    const id = body.substring(pos, colonIdx);
    if (id.length === 0 || !/^[0-9-a-fA-F]+$/.test(id)) {
      pos++;
      continue;
    }

    pos = colonIdx + 1;
    if (pos >= body.length) break;

    if (body[pos] === "T") {
      pos++;
      const commaIdx = body.indexOf(",", pos);
      if (commaIdx === -1) break;

      const byteLen = Number.parseInt(body.substring(pos, commaIdx), 16);
      if (Number.isNaN(byteLen)) break;

      pos = commaIdx + 1;
      let bytes = 0;
      const start = pos;

      while (pos < body.length && bytes < byteLen) {
        const code = body.charCodeAt(pos);
        if (code < 0x80) {
          bytes += 1;
        } else if (code < 0x8_00) {
          bytes += 2;
        } else if (code >= 0xd8_00 && code <= 0xdf_ff) {
          // High surrogate (surrogate pair, 4 UTF-8 bytes)
          bytes += 4;
          pos++;
        } else {
          bytes += 3;
        }
        pos++;
      }

      const chunkContent = body.substring(start, pos);
      chunkCache.set(id, chunkContent);

      try {
        results.push(JSON.parse(chunkContent));
      } catch {
        //ignore
      }
    } else {
      const [element, end] = parseJsonAt(body, pos);
      if (element !== null) {
        results.push(element);
        modelCache.set(id, element);
      }
      pos = end;
    }
  }

  return results;
}

function extractAppRouterPayloads(
  $: CheerioAPI,
  chunkCache: Map<string, string>,
  modelCache: Map<string, unknown>,
): unknown[] {
  return $("script:not([src])")
    .toArray()
    .map((el) => $(el).html() || "")
    .filter((script) => script.includes("self.__next_f.push"))
    .flatMap((script) => {
      try {
        const raw = NEXT_F_REGEX.exec(script)?.[1];
        if (!raw) return [];

        const arr = JSON.parse(raw);
        const content = typeof arr?.[1] === "string" ? arr[1] : null;
        if (!content) return [];

        return extractRscPayloads(content, chunkCache, modelCache);
      } catch {
        return [];
      }
    });
}

function extractPageRouterPayloads($: CheerioAPI): unknown[] {
  const data = $("#__NEXT_DATA__").html();
  if (!data) return [];

  try {
    const root = JSON.parse(data);
    const pageProps = (root as any)?.props?.pageProps;
    return [pageProps, root].filter((v) => v != null);
  } catch {
    return [];
  }
}

/**
 * Extract all Next.js hydrated flight data payloads from inline script tags
 * and returns the first nested element that fulfills the given predicate.
 */
export function extractNextJs<T>(
  $: CheerioAPI,
  predicate: Predicate<T>,
  deserializer: Deserializer<T>,
): T | null {
  const chunkCache = new Map<string, string>();
  const modelCache = new Map<string, unknown>();

  let payloads = extractAppRouterPayloads($, chunkCache, modelCache);
  if (payloads.length === 0) payloads = extractPageRouterPayloads($);

  for (const payload of payloads) {
    const resolvedPayload = resolveNextJsRefs(payload, chunkCache, modelCache);
    const result = extractValueNextJs(resolvedPayload, predicate, deserializer);
    if (result !== null) return result;
  }

  return null;
}

/**
 * Parse raw RSC (React Server Components) flight body and returns
 * the first nested element that fulfills the given predicate.
 */
export function extractNextJsRsc<T>(
  body: string,
  predicate: Predicate<T>,
  deserializer: Deserializer<T>,
): T | null {
  const chunkCache = new Map<string, string>();
  const modelCache = new Map<string, unknown>();
  const payloads = extractRscPayloads(body, chunkCache, modelCache);

  for (const payload of payloads) {
    const resolvedPayload = resolveNextJsRefs(payload, chunkCache, modelCache);
    const result = extractValueNextJs(resolvedPayload, predicate, deserializer);
    if (result !== null) return result;
  }

  return null;
}

function hasNestedProperty(value: unknown, path: string, strict: boolean): boolean {
  const parts = path.split(".");

  const matches = (current: unknown, index: number): boolean => {
    if (index >= parts.length) return true;

    const part = parts[index]!;

    if (part?.endsWith("[]")) {
      const key = part.slice(0, -2);

      if (typeof current !== "object" || current === null || Array.isArray(current)) {
        return false;
      }

      const array = (current as Record<string, unknown>)[key];

      if (!Array.isArray(array) || array.length === 0) return false;

      const matcher = (item: unknown) => matches(item, index + 1);
      return strict ? array.every(matcher) : array.some(matcher);
    }

    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !(part in current)
    ) {
      return false;
    }

    return matches((current as Record<string, unknown>)[part], index + 1);
  };

  return matches(value, 0);
}

/**
 * Infers a predicate from a type by requiring all non-optional properties.
 * For arrays, checks the first element's properties.
 */
export function inferredNextJsPredicate<T>(
  requiredKeys: string[],
  options: {
    isArray: boolean;
    strict: boolean;
  },
): Predicate<T> {
  const { isArray, strict } = options;

  return (payload): payload is T => {
    if (isArray) {
      return (
        Array.isArray(payload) &&
        payload.length > 0 &&
        typeof payload[0] === "object" &&
        payload[0] !== null &&
        requiredKeys.every((key) => hasNestedProperty(payload[0], key, strict))
      );
    }

    return (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      requiredKeys.every((key) => hasNestedProperty(payload, key, strict))
    );
  };
}
