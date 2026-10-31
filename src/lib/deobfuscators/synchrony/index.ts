import { getQuickJS } from "quickjs-emscripten";
// @ts-expect-error no-types
import synchronyScript from "./assets/synchrony-v2.4.5.1.txt";

export class Deobfuscator {
  // private static readonly SCRIPT_NAME = "synchrony-v2.4.5.1.js";
  private static scriptContent: string | null = null;

  private static loadScript(): string {
    if (Deobfuscator.scriptContent) return Deobfuscator.scriptContent;

    Deobfuscator.scriptContent = synchronyScript;
    return synchronyScript;
  }

  async deobfuscateScript(source: string): Promise<string | null> {
    const originalScript = Deobfuscator.loadScript();

    const regex = /export\{(.*) as Deobfuscator,(.*) as Transformer\};/;
    const match = regex.exec(originalScript);

    if (!match) return null;

    const [_, deob, trans] = match;
    const replacement = `const Deobfuscator = ${deob}, Transformer = ${trans}`;
    const synchronyScript = originalScript.replace(regex, replacement);

    const QuickJSWASMModule = await getQuickJS();
    const vm = QuickJSWASMModule.newContext();
    try {
      vm.evalCode(`
                globalThis.console = {
                    log: () => {},
                    warn: () => {},
                    error: () => {},
                    trace: () => {}
                }
            `);

      vm.evalCode(synchronyScript);

      const sourceHandle = vm.newString(source);
      vm.setProp(vm.global, "source", sourceHandle);
      sourceHandle.dispose();

      const result = vm.evalCode(
        "new Deobfuscator().deobfuscateSource(source)"
      );
      if (result.error) {
        result.error.dispose();
        return null;
      }

      const value = vm.dump(result.value);
      result.value.dispose();

      return typeof value === "string" ? value : null;
    } catch {
      return null;
    } finally {
      vm.dispose();
    }
  }
}
