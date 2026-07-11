import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Resolve .js specifiers to sibling .ts files for --experimental-strip-types. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".js") && specifier.startsWith(".")) {
    try {
      const parent = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
      const asTs = new URL(specifier.replace(/\.js$/, ".ts"), pathToFileURL(parent));
      if (existsSync(fileURLToPath(asTs))) {
        return nextResolve(asTs.href, context);
      }
    } catch {
      // fall through
    }
  }
  return nextResolve(specifier, context);
}
