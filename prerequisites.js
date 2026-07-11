/**
 * CJS shim for Node tools that still use require().
 * Browser loads lib/prerequisites.js directly as a classic script.
 * Canonical Node CJS entry: lib/prerequisites.cjs
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
export default require("./lib/prerequisites.cjs");
