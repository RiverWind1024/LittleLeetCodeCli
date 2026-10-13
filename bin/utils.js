import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, chmodSync, realpathSync } from "node:fs";

export function parseEnvContent(content) {
  const map = {};
  for (const raw of String(content).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    map[k] = v;
  }
  return map;
}

export function loadEnv(cwd, env = process.env) {
  const merged = { ...env };
  const p = join(cwd, ".env");
  if (existsSync(p)) {
    const parsed = parseEnvContent(readFileSync(p, "utf8"));
    for (const [k, v] of Object.entries(parsed)) {
      if (merged[k] === undefined) merged[k] = v;
    }
  }
  return { session: merged.LEETCODE_SESSION ?? "" };
}

export function setEnvVar(content, key, value) {
  const lines = String(content).split("\n");
  let found = false;
  const out = lines.map((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return line;
    const eq = t.indexOf("=");
    if (eq === -1) return line;
    if (t.slice(0, eq).trim() === key) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    if (out.length && out[out.length - 1].trim() !== "") out.push("");
    out.push(`${key}=${value}`);
  }
  return out.join("\n").replace(/\n*$/, "\n");
}

export function writeEnv(envPath, content) {
  writeFileSync(envPath, content, { mode: 0o600 });
  chmodSync(envPath, 0o600);
}

export function unsetEnvVar(content, key) {
  const out = String(content).split("\n").filter((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return true;
    const eq = t.indexOf("=");
    if (eq === -1) return true;
    return t.slice(0, eq).trim() !== key;
  });
  return out.join("\n").replace(/\n*$/, "\n");
}

export function strWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    w += /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
  }
  return w;
}

export function htmlToText(html) {
  return String(html)
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi,
      (_, inner) => "\n" + inner.replace(/<[^>]+>/g, "").split("\n").map((l) => (l.trim() ? "  " + l.trim() : "")).join("\n") + "\n")
    .replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, "^$1")
    .replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, "_$1")
    .replace(/<li[^>]*>/gi, "  - ")
    .replace(/<\/(p|div|pre|li|ul|ol|h[1-6]|blockquote|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, "").replace(/^[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}