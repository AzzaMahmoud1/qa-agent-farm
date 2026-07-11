/** Target allowlist — deny loopback/private by default. */

const BLOCKED = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "169.254.169.254",
]);

export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED.has(host)) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
  if (/^169\.254\.\d+\.\d+$/.test(host)) return true;
  return false;
}

export function isUrlAllowlisted(
  url: string,
  allowlist: string[],
  options: { allowLoopback?: boolean } = {},
): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    const list = allowlist.map((e) => e.toLowerCase().trim()).filter(Boolean);
    const allowLoopback = options.allowLoopback === true;

    if (isPrivateOrLoopbackHost(host)) {
      if (!allowLoopback) return false;
      return list.some((e) => host === e || e === "localhost" || e === "127.0.0.1");
    }
    if (!list.length) return false;
    return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
  } catch {
    return false;
  }
}
