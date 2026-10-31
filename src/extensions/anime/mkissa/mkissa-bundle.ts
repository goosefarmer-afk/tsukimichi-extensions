import type { BuildInfo } from "./mkissa-key-manager";

interface Base {
  table: string;
  offset: number;
}

interface Alias {
  base: string;
  argIndex: number;
  delta: number;
}

export class MKissaBundle {
  static parse(js: string, seedCount: number): BuildInfo | null {
    const { tables, bases, aliases } = this.decodersFrom(js);
    const buildId = this.extractBuildIdNew(js, tables, bases, aliases, seedCount);
    if (buildId === null) return null;

    const seeds = this.extractSeedsWithTables(js, tables, bases, aliases, seedCount);
    if (seeds === null) return null;

    return {
      buildId,
      seeds,
    };
  }

  private static extractBuildIdNew(
    js: string,
    tables: Map<string, string[]>,
    bases: Map<string, Base>,
    aliases: Map<string, Alias>,
    seedCount: number,
  ): string | null {
    // Find maskDefaultVar - function with default parameter that's assigned to a call
    const maskDefaultVar = this.findMaskDefaultVar(js);

    const candidates: string[] = [];

    if (maskDefaultVar !== null) {
      const assignRegex = new RegExp(
        `\\b${this.escapeRegex(maskDefaultVar)}\\s*=\\s*(${this.CALL_PATTERN})\\s*(?:,|;|\\n)`,
        "g",
      );
      let m;
      while ((m = assignRegex.exec(js)) !== null) {
        candidates.push(m[1]!);
      }
    }

    // Check around "sf="
    const sfIndex = js.indexOf("sf=");
    if (sfIndex !== -1) {
      const windowStart = Math.max(0, sfIndex - 2000);
      const window = js.substring(windowStart, sfIndex);
      const assignRegex = new RegExp(`\\b\\w+\\s*=\\s*(${this.CALL_PATTERN})\\s*(?:,|;|\\n)`, "g");
      let m;
      while ((m = assignRegex.exec(window)) !== null) {
        const call = m[1];
        if (!call?.includes("+")) candidates.push(call!);
      }
    }

    if (candidates.length === 0) {
      const assignRegex = new RegExp(`\\b\\w+\\s*=\\s*(${this.CALL_PATTERN})\\s*(?:,|;|\\n)`, "g");
      let m;
      while ((m = assignRegex.exec(js)) !== null) {
        const call = m[1];
        if (!call?.includes("+")) candidates.push(call!);
      }
    }

    // Try candidates first
    for (const call of candidates) {
      const callMatch = this.CALL_REGEX.exec(call);
      if (!callMatch?.[1]) continue;
      const aliasName = callMatch[1];
      const alias = aliases.get(aliasName);
      if (!alias) continue;
      const base = bases.get(alias.base);
      if (!base) continue;
      const table = tables.get(base.table);
      if (!table) continue;

      for (let rotation = 0; rotation < table.length; rotation++) {
        const decoded = this.resolve({ call, rotation, tables, bases, aliases });
        if (decoded === null) continue;
        if (!this.BUILD_ID_DIGITS_REGEX.test(decoded)) continue;

        const seedsOk =
          this.extractSeedsWithTables(js, tables, bases, aliases, seedCount, rotation) !== null;
        if (seedsOk) return decoded;
      }
    }

    // Fallback: scan all calls
    let match;
    const callRegex = new RegExp(this.CALL_PATTERN, "g");
    while ((match = callRegex.exec(js)) !== null) {
      const call = match[0];
      if (call.includes("+")) continue;
      const aliasName = match[1]!;
      const alias = aliases.get(aliasName);
      if (!alias) continue;
      const base = bases.get(alias.base);
      if (!base) continue;
      const table = tables.get(base.table);
      if (!table) continue;

      for (let rotation = 0; rotation < table.length; rotation++) {
        const decoded = this.resolve({ call, rotation, tables, bases, aliases });
        if (decoded === null) continue;
        if (!this.BUILD_ID_DIGITS_REGEX.test(decoded) || decoded.length < 2 || decoded.length > 8)
          continue;

        const before = js.substring(Math.max(0, match.index - 20), match.index);
        if (before.includes("sf=") || before.includes("kd=")) continue;
        if (this.extractSeedsWithTables(js, tables, bases, aliases, seedCount, rotation) === null)
          continue;
        return decoded;
      }
    }

    return null;
  }

  private static findMaskDefaultVar(js: string): string | null {
    const regex = new RegExp(
      `function\\s+(${this.IDENT})\\s*\\(\\s*\\w+\\s*=\\s*(\\w+)\\s*[,)]`,
      "g",
    );
    let m;
    while ((m = regex.exec(js)) !== null) {
      const varName = m[2];
      if (!varName) continue;
      if (new RegExp(`\\b${this.escapeRegex(varName)}\\s*=\\s*${this.CALL_PATTERN}`).test(js)) {
        return varName;
      }
    }
    return null;
  }

  private static decodersFrom(js: string): {
    tables: Map<string, string[]>;
    bases: Map<string, Base>;
    aliases: Map<string, Alias>;
  } {
    const tables = this.readTables(js);

    const bases = new Map<string, Base>();
    for (const match of js.matchAll(this.BASE_DECODER_REGEX)) {
      const [, name, , expression, tableName] = match;
      if (!name || !expression || !tableName) continue;
      bases.set(name, { table: tableName, offset: this.fold(expression) });
    }

    const aliases = new Map<string, Alias>();
    for (const key of bases.keys()) {
      aliases.set(key, { base: key, argIndex: 0, delta: 0 });
    }

    for (const match of js.matchAll(this.ALIAS_DECODER_REGEX)) {
      const [, name, firstParam, , callee, arg, delta] = match;
      if (!callee || !name) continue;
      if (!bases.has(callee)) continue;

      const argIndex = arg === firstParam ? 0 : 1;
      const deltaValue = delta ? this.fold(delta) : 0;
      aliases.set(name, { base: callee, argIndex, delta: deltaValue });
    }

    return { tables, bases, aliases };
  }

  private static extractSeedsWithTables(
    js: string,
    tables: Map<string, string[]>,
    bases: Map<string, Base>,
    aliases: Map<string, Alias>,
    seedCount: number,
    forcedRotation: number | null = null,
  ): string[] | null {
    const seedArrayRegex = new RegExp(
      `=\\[((?:${this.CALL_PATTERN}\\+${this.CALL_PATTERN},){${seedCount - 1}}${this.CALL_PATTERN}\\+${this.CALL_PATTERN})]`,
      "g",
    );

    for (const match of js.matchAll(seedArrayRegex)) {
      const calls: string[] = [];
      const callRegex = new RegExp(this.CALL_PATTERN, "g");
      let cm;
      while ((cm = callRegex.exec(match[1]!)) !== null) {
        calls.push(cm[0]);
      }

      if (calls.length !== seedCount * 2) continue;

      const firstCallMatch = this.CALL_REGEX.exec(calls[0]!);
      if (!firstCallMatch?.[1]) continue;
      const alias = aliases.get(firstCallMatch[1]);
      if (!alias) continue;
      const base = bases.get(alias.base);
      if (!base) continue;
      const table = tables.get(base.table);
      if (!table) continue;

      if (forcedRotation !== null) {
        const result = this.seedsAt({
          calls,
          rotation: forcedRotation,
          tables,
          bases,
          aliases,
          seedCount,
        });
        if (result !== null) return result;
        continue;
      }

      const matches: string[][] = [];
      for (let rotation = 0; rotation < table.length; rotation++) {
        const result = this.seedsAt({ calls, rotation, tables, bases, aliases, seedCount });
        if (result !== null) matches.push(result);
      }

      if (matches.length === 1) return matches[0]!;
    }

    return null;
  }

  private static seedsAt(args: {
    calls: string[];
    rotation: number;
    tables: Map<string, string[]>;
    bases: Map<string, Base>;
    aliases: Map<string, Alias>;
    seedCount: number;
  }): string[] | null {
    const { calls, rotation, tables, bases, aliases, seedCount } = args;

    const seeds: string[] = [];

    for (let i = 0; i < calls.length; i += 2) {
      const first = calls[i];
      const second = calls[i + 1];

      const a = this.resolve({
        call: first!,
        rotation,
        aliases,
        bases,
        tables,
      });
      if (a === null) return null;

      const b = this.resolve({
        call: second!,
        rotation,
        aliases,
        bases,
        tables,
      });
      if (b === null) return null;

      const combined = a + b;
      if (!this.SEED_REGEX.test(combined)) return null;

      seeds.push(combined);
    }

    return seeds.length === seedCount ? seeds : null;
  }

  private static resolve(options: {
    call: string;
    rotation: number;
    tables: Map<string, string[]>;
    bases: Map<string, Base>;
    aliases: Map<string, Alias>;
  }): string | null {
    const { call, rotation, tables, bases, aliases } = options;

    const match = this.CALL_REGEX.exec(call);
    if (!match?.[1]) return null;

    const alias = aliases.get(match[1]);
    if (!alias) return null;

    const base = bases.get(alias.base);
    if (!base) return null;

    const table = tables.get(base.table);
    if (!table || table.length === 0) return null;

    const args: number[] = [];
    if (match[2]) {
      const val = Number.parseInt(match[2]);
      if (!Number.isNaN(val)) args.push(val);
    }

    if (match[3]) {
      const val = Number.parseInt(match[3]);
      if (!Number.isNaN(val)) args.push(val);
    }

    const arg = args[alias.argIndex];
    if (arg == null) return null;

    const index = arg + alias.delta - base.offset + rotation;
    const wrappedIndex = ((index % table.length) + table.length) % table.length;

    return table[wrappedIndex] ?? null;
  }

  private static readTables(js: string): Map<string, string[]> {
    const tables = new Map<string, string[]>();

    for (const match of js.matchAll(this.TABLE_HEAD_REGEX)) {
      const tableName = match[1];
      if (!tableName) continue;
      const array = this.readStringArray(js, match.index + match[0].length - 1);
      if (array) tables.set(tableName, array);
    }

    return tables;
  }

  private static readStringArray(js: string, open: number): string[] | null {
    const items: string[] = [];
    let i = open + 1;

    while (i < js.length) {
      const c = js[i];

      if (c === "]") {
        return items;
      } else if (c === "," || c === " ") i++;
      else if (c === '"' || c === "'") {
        const quote = c;
        const sb: string[] = [];
        i++;

        while (i < js.length && js[i] !== quote) {
          if (js[i] === "\\") {
            sb.push(js[i + 1]!);
            i += 2;
          } else {
            sb.push(js[i]!);
            i++;
          }
        }

        if (i >= js.length) return null;
        i++;
        items.push(sb.join(""));
      } else return null;
    }

    return null;
  }

  private static fold(expression: string): number {
    let total = 0;
    const terms = expression.replace(/\s/g, "").matchAll(this.TERM_REGEX);

    for (const termMatch of terms) {
      let term = termMatch[0];
      let sign = 1;

      while (term.startsWith("+") || term.startsWith("-")) {
        if (term.startsWith("-")) sign = -sign;
        term = term.substring(1);
      }

      let value = this.parseFactor(sign, term);
      if (value === null) return 0;
      total += value;
    }

    return total;
  }

  private static parseFactor(sign: number, factor: string): number | null {
    let negative = sign < 0;
    let digits = factor;

    while (digits.startsWith("+") || digits.startsWith("-")) {
      if (digits.startsWith("-")) negative = !negative;
      digits = digits.substring(1);
    }

    const magnitude = Number.parseInt(digits);
    if (Number.isNaN(magnitude)) return null;

    const signed = negative ? -magnitude : magnitude;
    if (signed < Number.MIN_SAFE_INTEGER || signed > Number.MAX_SAFE_INTEGER) return null;
    return signed;
  }

  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private static readonly BUILD_ID_DIGITS_REGEX = /^\d{2,10}$/;

  private static readonly IDENT = `[$A-Za-z0-9_]+`;

  private static readonly TABLE_HEAD_REGEX =
    /function (\w+)\(\)\s*\{\s*(?:const|let|var)\s+\w+\s*=\s*\[/g;

  private static readonly BASE_DECODER_REGEX =
    /function (\w+)\((\w+)(?:,\w+)*\)\{return \2=\2-\(?([-\d+*\s]+?)\)?,(\w+)\(\)\[\2\]\}/g;

  private static readonly ALIAS_DECODER_REGEX =
    /function (\w+)\((\w+),(\w+)\)\{return (\w+)\((\w+)((?:[-+][\d+*\s-]+)?)\)\}/g;

  private static readonly CALL_PATTERN = `(\\w+)\\(\\s*(-?\\d+)\\s*(?:,\\s*(-?\\d+)\\s*)?\\)`;
  private static readonly CALL_REGEX = new RegExp(this.CALL_PATTERN);

  private static readonly SEED_REGEX = /[A-Za-z0-9+/]{11}=/;

  private static readonly TERM_REGEX = /[-+]*\d+(?:\*[-+]*\d+)*/g;
}
