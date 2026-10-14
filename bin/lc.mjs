#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, chmodSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  htmlToText, strWidth, isChineseEnv, style, parseEnvContent, loadEnv, setEnvVar, unsetEnvVar, writeEnv,
} from "./utils.js";
import { renderProgressSummary, renderSolvedTable,renderList,difficultyLabel } from "./render.js";

const PICK = (v, zh) => (zh ? v.zh : v.en);

const COMMANDS = {
  init: {
    usage: "lc init",
    desc: { zh: "初始化：安装 MCP 依赖并配置 Cookie（幂等）", en: "Initialize: install MCP deps and configure Cookie (idempotent)" },
    options: [],
  },
  config: {
    usage: "lc config <get|set|unset|list> [session|lang|locale] [value]",
    desc: { zh: "管理项目根 .env 配置：session（登录 Cookie）、lang（默认编程语言）、locale（显示语言）", en: "Manage project-root .env: session (login Cookie), lang (default language), locale (display language)" },
    options: [],
  },
  list: {
    usage: "lc list [关键词] [选项]",
    desc: { zh: "搜索题目，输出带边框表格", en: "Search problems and print a bordered table" },
    options: [
      ["--difficulty EASY|MEDIUM|HARD", { zh: "按难度筛选", en: "Filter by difficulty" }],
      ["--tags a,b", { zh: "按标签筛选，逗号分隔", en: "Filter by tags, comma-separated" }],
      ["--limit N", { zh: "返回条数，默认 20", en: "Number of results, default 20" }],
      ["--offset N", { zh: "偏移，默认 0", en: "Offset, default 0" }],
      ["--refresh", { zh: "强制重新抓取已解决状态缓存", en: "Force-refresh the solved-status cache" }],
    ],
  },
  progress: {
    usage: "lc progress [选项]",
    desc: { zh: "展示已解决的题目：统计 + 表格（需登录）", en: "Show solved problems: summary + table (login required)" },
    options: [
      ["--difficulty EASY|MEDIUM|HARD", { zh: "仅统计/展示该难度", en: "Only count/show this difficulty" }],
      ["--limit N", { zh: "每页条数，默认 20", en: "Rows per page, default 20" }],
      ["--offset N", { zh: "跳过前 N 条，默认 0", en: "Skip the first N rows, default 0" }],
      ["--refresh", { zh: "忽略缓存，强制重新抓取已解决列表", en: "Ignore cache and re-fetch the solved list" }],
    ],
  },
  random: {
    usage: "lc random [选项]",
    desc: { zh: "随机抽取一题（只打印，不生成文件）", en: "Pick a random problem (print only, no file)" },
    options: [
      ["--difficulty EASY|MEDIUM|HARD", { zh: "限定难度", en: "Restrict difficulty" }],
      ["--tags a,b", { zh: "限定标签，逗号分隔", en: "Restrict tags, comma-separated" }],
    ],
  },
  show: {
    usage: "lc show <slug> [选项]",
    desc: { zh: "下载题目、生成代码文件、打印题面", en: "Fetch a problem, generate the code file, print the statement" },
    options: [
      ["--lang L", { zh: "目标语言，默认取 lc config lang，未设置则 python3", en: "Target language; default from lc config lang, else python3" }],
      ["--force", { zh: "覆盖已存在的代码文件", en: "Overwrite an existing code file" }],
    ],
  },
  run: {
    usage: "lc run <slug> [选项]",
    desc: { zh: "用题目默认样例（或 --input）运行本地代码", en: "Run local code with the problem's default sample (or --input)" },
    options: [
      ["--lang L", { zh: "目标语言，默认取 lc config lang，未设置则 python3", en: "Target language; default from lc config lang, else python3" }],
      ["--input \"...\"", { zh: "自定义测试输入；省略则用题目默认样例", en: "Custom test input; omit to use the problem's default sample" }],
      ["--timeout ms", { zh: "超时，默认 120000", en: "Timeout, default 120000" }],
    ],
  },
  submit: {
    usage: "lc submit <slug> [选项]",
    desc: { zh: "提交本地代码", en: "Submit local code" },
    options: [
      ["--lang L", { zh: "目标语言，默认取 lc config lang，未设置则 python3", en: "Target language; default from lc config lang, else python3" }],
      ["--timeout ms", { zh: "超时，默认 120000", en: "Timeout, default 120000" }],
    ],
  },
};

export function printHelp(out = console.log, { zh = isChineseEnv() } = {}) {
  const t = zh ? {
    usage: "用法：lc <命令> [选项]",
    note: "（需在 LittleLeetCodeCli 项目根目录执行；首次使用先运行 npm link）",
    commands: "命令：",
    helpHint: "命令帮助：lc <命令> --help 或 lc help <命令>",
    footer: `默认语言：lc config lang（未设置则 python3）；--lang 可临时覆盖。支持：${Object.keys(LANG_MAP).join(", ")}。site 固定为 cn。`,
  } : {
    usage: "Usage: lc <command> [options]",
    note: "(Run inside the LittleLeetCodeCli project root; run `npm link` first)",
    commands: "Commands:",
    helpHint: "Command help: lc <command> --help or lc help <command>",
    footer: `Default language: lc config lang (python3 if unset); --lang overrides. Supported: ${Object.keys(LANG_MAP).join(", ")}. Site is fixed to cn.`,
  };
  out(t.usage);
  out(t.note);
  out("");
  out(t.commands);
  const width = Math.max(...Object.values(COMMANDS).map((c) => strWidth(c.usage)));
  for (const c of Object.values(COMMANDS)) {
    out(`  ${c.usage}${" ".repeat(width - strWidth(c.usage))}  ${PICK(c.desc, zh)}`);
  }
  out("");
  out(t.helpHint);
  out(t.footer);
}

// 返回 false 表示命令不存在（调用方可据此设置退出码）
export function printCommandHelp(command, out = console.log, { zh = isChineseEnv() } = {}) {
  const spec = COMMANDS[command];
  if (!spec) return false;
  out(`${zh ? "用法：" : "Usage: "}${spec.usage}`);
  out("");
  out(PICK(spec.desc, zh));
  if (spec.options.length) {
    out("");
    out(zh ? "选项：" : "Options:");
    const w = Math.max(...spec.options.map(([f]) => strWidth(f)));
    for (const [flag, desc] of spec.options) out(`  ${flag}${" ".repeat(w - strWidth(flag))}  ${PICK(desc, zh)}`);
  }
  return true;
}

export function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  let command = null;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "-h") {
      flags.help = true;
    } else if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq !== -1) {
        flags[tok.slice(2, eq)] = tok.slice(eq + 1);
      } else {
        const key = tok.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (command === null) {
      command = tok;
    } else {
      positionals.push(tok);
    }
  }
  return { command, positionals, flags };
}

export const LANG_MAP = {
  python3:    { langSlug: "python3",    fileName: "solution.py",   comment: "#" },
  cpp:        { langSlug: "cpp",        fileName: "solution.cpp",  comment: "//" },
  java:       { langSlug: "java",       fileName: "Solution.java", comment: "//" },
  golang:     { langSlug: "golang",     fileName: "solution.go",   comment: "//" },
  javascript: { langSlug: "javascript", fileName: "solution.js",   comment: "//" },
  typescript: { langSlug: "typescript", fileName: "solution.ts",   comment: "//" },
  rust:       { langSlug: "rust",       fileName: "solution.rs",   comment: "//" },
  c:          { langSlug: "c",          fileName: "solution.c",    comment: "//" },
};

export const DEFAULT_LANG_KEY = "DEFAULT_LANG";
export const FALLBACK_LANG = "python3";

export function readDefaultLang(cwd) {
  const p = join(cwd, ".env");
  if (!existsSync(p)) return null;
  const v = parseEnvContent(readFileSync(p, "utf8"))[DEFAULT_LANG_KEY];
  return v && LANG_MAP[v] ? v : null;
}

export function chooseLang(flags = {}, cwd) {
  return flags.lang ?? readDefaultLang(cwd) ?? FALLBACK_LANG;
}

export function resolveNewPath(cwd, slug, questionId, lang) {
  const id = String(questionId).padStart(4, "0");
  return join(cwd, "solutions", `${id}-${slug}`, lang, LANG_MAP[lang].fileName);
}

export function findExisting(cwd, slug, lang) {
  const root = join(cwd, "solutions");
  if (!existsSync(root)) return { path: null, matches: [] };
  const fileName = LANG_MAP[lang].fileName;
  const matches = [];
  for (const name of readdirSync(root)) {
    if (!name.endsWith(`-${slug}`)) continue;
    const p = join(root, name, lang, fileName);
    if (existsSync(p)) matches.push(p);
  }
  matches.sort();
  return { path: matches[0] ?? null, matches };
}


export function mask(v) {
  const s = String(v);
  return s.length <= 8 ? "*".repeat(s.length) : `${s.slice(0, 4)}****${s.slice(-4)}`;
}



const SOLVED_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SOLVED_CACHE_FILE = "solved.json";

function readRawSolvedCache(cachePath) {
  if (!existsSync(cachePath)) return null;
  let cache;
  try { cache = JSON.parse(readFileSync(cachePath, "utf8")); } catch { return null; }
  if (!cache || !Array.isArray(cache.solved) || typeof cache.fetchedAt !== "number") return null;
  return cache;
}

function writeSolvedCache(cachePath, solved, now) {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ fetchedAt: now(), solved }));
}

function normalizeSolvedQuestion(q) {
  return {
    slug: q.titleSlug,
    frontendId: q.frontendId,
    title: q.title,
    titleCn: q.translatedTitle,
    difficulty: q.difficulty,
    lastSubmittedAt: q.lastSubmittedAt,
    numSubmitted: q.numSubmitted,
    lastResult: q.lastResult,
  };
}

async function fetchSolvedPages({ cwd, session, timeoutMs, call }) {
  const acc = [];
  const LIMIT = 100;
  for (let offset = 0; offset < 20000; ) {
    const data = await call(
      "get_problem_progress",
      { offset, limit: LIMIT, questionStatus: "SOLVED" },
      { session, cwd, timeoutMs },
    );
    const page = data?.questions;
    if (!page) throw new Error("获取已解决列表失败：接口未返回预期数据");
    const qs = page.questions ?? [];
    acc.push(...qs);
    offset += qs.length;
    if (qs.length === 0 || offset >= (page.totalNum ?? offset)) break;
  }
  const map = new Map();
  for (const q of acc) if (q?.titleSlug) map.set(q.titleSlug, q);
  return [...map.values()]
    .map(normalizeSolvedQuestion)
    .sort((a, b) => (b.lastSubmittedAt || "").localeCompare(a.lastSubmittedAt || ""));
}

export async function loadSolved({ cwd, session = "", refresh = false, timeoutMs = 120000, callTool: call = callTool, now = () => Date.now() } = {}) {
  if (!session) return null;
  const cachePath = join(cwd, ".lc-cache", SOLVED_CACHE_FILE);
  const raw = readRawSolvedCache(cachePath);
  const fresh = raw && now() - raw.fetchedAt < SOLVED_CACHE_TTL_MS ? raw.solved : null;
  if (!refresh && fresh) return { solved: fresh, stale: false };
  try {
    const solved = await fetchSolvedPages({ cwd, session, timeoutMs, call });
    writeSolvedCache(cachePath, solved, now);
    return { solved, stale: false };
  } catch (e) {
    if (raw) return { solved: raw.solved, stale: true };
    throw e;
  }
}



export async function cmdProgress(opts, deps) {
  const {
    callTool: call = callTool, cwd, session = "", out = console.log,
    warn = (s) => console.error(s), style: st = style, now,
  } = deps;
  requireSession(session);
  const limit = Number(opts.flags.limit ?? 20);
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`--limit 需为正整数，收到：${opts.flags.limit}`);
  const offset = Number(opts.flags.offset ?? 0);
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`--offset 需为非负整数，收到：${opts.flags.offset}`);
  const difficulty = normalizeDifficulty(opts.flags.difficulty);
  const timeoutMs = Number(opts.flags.timeout) > 0 ? Number(opts.flags.timeout) : 120000;
  const { solved, stale } = await loadSolved({
    cwd, session, refresh: opts.flags.refresh === true, timeoutMs, callTool: call, now,
  });
  if (stale) warn("注意：已解决列表刷新失败，已使用过期缓存");
  out(renderProgressSummary(solved, { style: st, zh: deps.zh ?? isChineseEnv() }));
  out(renderSolvedTable(solved, { style: st, zh: deps.zh ?? isChineseEnv(), difficulty, limit, offset }));
}



export function resolveMcpBin(cwd) {
  const local = join(cwd, "node_modules", ".bin", "leetcode-mcp-server");
  if (existsSync(local)) return { cmd: local, args: [], local: true };
  return { cmd: "npx", args: ["-y", "@jinzcdev/leetcode-mcp-server"], local: false };
}

export function callTool(name, toolArgs, opts = {}) {
  const {
    session = "",
    cwd = process.cwd(),
    timeoutMs = 120000,
    resolveBin = resolveMcpBin,
  } = opts;

  return new Promise((resolve, reject) => {
    const resolved = resolveBin(cwd);
    const { cmd, args } = resolved;
    if (resolved.local === false) {
      process.stderr.write("提示：未找到本地 MCP server，回退使用 npx（可运行 lc init 安装到本地）。\n");
    }
    const env = { ...process.env };
    if (session) env.LEETCODE_SESSION = session;

    const child = spawn(cmd, [...args, "--site", "cn"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => finish(new Error(`MCP 调用超时（${timeoutMs}ms）`)), timeoutMs);

    function finish(err, data) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.stdin.end(); } catch { /* ignore */ }
      child.kill();
      if (err) reject(err); else resolve(data);
    }

    child.on("error", (e) => finish(new Error(`无法启动 MCP server：${e.message}`)));
    child.stdin.on("error", () => { /* 写端提前关闭：交由 exit/超时 处理 */ });
    child.on("exit", (code) => {
      if (!settled) finish(new Error(`MCP server 提前退出（code ${code}）\n${stderr.trim()}`));
    });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== 2) continue;
        if (msg.error) return finish(new Error(msg.error.message ?? "MCP 调用失败"));
        const text = msg.result?.content?.[0]?.text ?? "";
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
        return finish(null, data);
      }
    });

    const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "lc", version: "1.0.0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: toolArgs } });
  });
}

const SESSION_KEY = "LEETCODE_SESSION";



const CONFIG_USAGE = "用法：lc config <get|set|unset|list> [session|lang] [value]";

const CONFIG_KEYS = {
  session: { envKey: SESSION_KEY, secret: true },
  lang: { envKey: DEFAULT_LANG_KEY, secret: false, validate: (v) => LANG_MAP[v] },
};

function resolveConfigKey(key) {
  const spec = CONFIG_KEYS[key];
  if (!spec) throw new Error(`${CONFIG_USAGE}\n（lang 支持：${Object.keys(LANG_MAP).join(", ")}）`);
  return spec;
}

export function cmdConfig(opts, deps) {
  const { cwd, out = console.log } = deps;
  const [action, key, value] = opts.positionals;
  const envPath = join(cwd, ".env");
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

  if (action === "set") {
    const spec = resolveConfigKey(key);
    if (!value) throw new Error(CONFIG_USAGE);
    if (spec.validate && !spec.validate(value)) {
      throw new Error(`不支持的语言：${value}（支持：${Object.keys(LANG_MAP).join(", ")}）`);
    }
    writeEnv(envPath, setEnvVar(current, spec.envKey, value));
    out(`已写入 .env：${spec.envKey}=${spec.secret ? mask(value) : value}`);
  } else if (action === "get") {
    const spec = resolveConfigKey(key);
    const v = parseEnvContent(current)[spec.envKey] ?? "";
    out(v ? (spec.secret ? mask(v) : v) : "未设置");
  } else if (action === "unset") {
    const spec = resolveConfigKey(key);
    const has = Object.prototype.hasOwnProperty.call(parseEnvContent(current), spec.envKey);
    if (!has) { out("未设置"); return; }
    writeEnv(envPath, unsetEnvVar(current, spec.envKey));
    out(`已移除 ${spec.envKey}`);
  } else if (action === "list") {
    const map = parseEnvContent(current);
    const keys = Object.keys(map);
    if (!keys.length) { out("（.env 为空）"); return; }
    const secrets = new Set(Object.values(CONFIG_KEYS).filter((s) => s.secret).map((s) => s.envKey));
    for (const k of keys) out(`${k}=${secrets.has(k) ? mask(map[k]) : map[k]}`);
  } else {
    throw new Error(CONFIG_USAGE);
  }
}

async function promptCookieInteractive() {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question("请输入 LEETCODE_SESSION Cookie（可留空跳过）：", res));
  rl.close();
  return answer;
}

export async function cmdInit(opts, deps) {
  const { cwd, out = console.log, exec = spawnSync, promptCookie = promptCookieInteractive, env = process.env } = deps;
  const bin = join(cwd, "node_modules", ".bin", "leetcode-mcp-server");

  if (!existsSync(bin)) {
    out("未检测到本地 MCP server，正在安装依赖…");
    const r = exec("npm", ["install"], { cwd, stdio: "inherit" });
    if (r.status !== 0) throw new Error("npm install 失败，请手动运行 npm install");
  } else {
    out("MCP server 依赖已就绪。");
  }

  const { session } = loadEnv(cwd, env);
  if (session) {
    out(`已配置 Cookie（${mask(session)}），跳过。`);
  } else {
    const cookie = await promptCookie();
    if (cookie && cookie.trim()) {
      const envPath = join(cwd, ".env");
      const cur = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
      writeEnv(envPath, setEnvVar(cur, SESSION_KEY, cookie.trim()));
      out("已写入 .env 的 LEETCODE_SESSION。");
    } else {
      out("未设置 Cookie，run/submit 暂不可用。可稍后运行：lc config set session <cookie>");
    }
  }
  out("下一步：lc list / lc show <slug> / lc submit <slug>");
}

export async function cmdList(opts, deps) {
  const {
    callTool: call = callTool, cwd, session = "", out = console.log,
    warn = (s) => console.error(s), style: st = style, now,
  } = deps;
  const limit = Number(opts.flags.limit ?? 20);
  const offset = Number(opts.flags.offset ?? 0);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`--limit 需为正整数，收到：${opts.flags.limit}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`--offset 需为非负整数，收到：${opts.flags.offset}`);
  }
  const args = { limit };
  if (offset > 0) args.offset = offset;
  if (opts.positionals[0]) args.searchKeywords = opts.positionals[0];
  const difficulty = normalizeDifficulty(opts.flags.difficulty);
  if (difficulty) args.difficulty = difficulty;
  if (opts.flags.tags) {
    args.tags = String(opts.flags.tags).split(",").map((s) => s.trim()).filter(Boolean);
  }
  const data = await call("search_problems", args, { session, cwd });
  if (data && data.raw !== undefined) { out(String(data.raw)); return; }
  const questions = data?.problems?.questions ?? [];

  let solved;
  if (session) {
    try {
      const r = await loadSolved({
        cwd, session, refresh: opts.flags.refresh === true,
        timeoutMs: Number(opts.flags.timeout) > 0 ? Number(opts.flags.timeout) : 120000,
        callTool: call, now,
      });
      if (r.stale) warn("注意：已解决列表刷新失败，已使用过期缓存");
      solved = new Set(r.solved.map((s) => s.slug));
    } catch (e) {
      warn(`提示：已解决列表获取失败（${e.message}），本次不显示状态列`);
    }
  }
  out(renderList(questions, { style: st, zh: deps.zh ?? isChineseEnv(), solved }));
}

const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];

export function normalizeDifficulty(v) {
  if (v === undefined) return undefined;
  const d = String(v).toUpperCase();
  if (!DIFFICULTIES.includes(d)) {
    throw new Error(`--difficulty 需为 ${DIFFICULTIES.join("|")}，收到：${v}`);
  }
  return d;
}

export function formatRandom(q, { style: st = style, zh = isChineseEnv() } = {}) {
  const diff = difficultyLabel(q.difficulty);
  const label = zh ? diff.cn : diff.en;
  const primary = zh ? (q.titleCn || q.title || q.titleSlug) : (q.title || q.titleCn || q.titleSlug);
  const secondary = zh ? q.title : q.titleCn;
  const lines = [zh ? "随机一题" : "Random Problem", ""];
  lines.push(`  ${st.bold(primary)}  ${st[diff.color](`[${label}]`)}`);
  if (secondary && secondary !== primary) lines.push(`  ${st.dim(secondary)}`);
  if (Array.isArray(q.topicTags) && q.topicTags.length) lines.push(`  ${st.dim(q.topicTags.join(" · "))}`);
  if (q.titleSlug) {
    lines.push(`  ${st.dim(`https://leetcode.cn/problems/${q.titleSlug}/`)}`);
    lines.push(`  ${st.dim(`lc show ${q.titleSlug}`)}`);
  }
  return lines.join("\n");
}

export async function cmdRandom(opts, deps) {
  const {
    callTool: call = callTool, cwd, session = "", out = console.log,
    style: st = style, random = Math.random,
  } = deps;
  const args = {};
  const difficulty = normalizeDifficulty(opts.flags.difficulty);
  if (difficulty) args.difficulty = difficulty;
  if (opts.flags.tags) {
    args.tags = String(opts.flags.tags).split(",").map((s) => s.trim()).filter(Boolean);
  }

  const first = await call("search_problems", { ...args, limit: 1, offset: 0 }, { session, cwd });
  if (first && first.raw !== undefined) { out(String(first.raw)); return; }
  const total = first?.problems?.total ?? 0;
  if (total <= 0) throw new Error("没有符合条件的题目");

  const offset = Math.min(Math.floor(random() * total), total - 1);
  const data = offset === 0 ? first : await call("search_problems", { ...args, limit: 1, offset }, { session, cwd });
  if (data && data.raw !== undefined) { out(String(data.raw)); return; }
  const question = data?.problems?.questions?.[0];
  if (!question) throw new Error("未取到题目，请稍后重试");
  out(formatRandom(question, { style: st, zh: deps.zh ?? isChineseEnv() }));
}

const TRANSLATED_QUERY =
  "query($t:String!){question(titleSlug:$t){translatedTitle translatedContent}}";

// MCP 的 get_problem 只返回英文 content；这里直连 leetcode.cn 公开 GraphQL 取中文题面。
// 任何失败都静默回退（返回 null），不影响 show 主体流程。
export async function fetchTranslated(slug, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  try {
    const res = await fetchImpl("https://leetcode.cn/graphql/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        referer: `https://leetcode.cn/problems/${slug}/`,
      },
      body: JSON.stringify({ query: TRANSLATED_QUERY, variables: { t: slug } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res || !res.ok) return null;
    const q = (await res.json())?.data?.question;
    if (!q) return null;
    return { title: q.translatedTitle || null, content: q.translatedContent || null };
  } catch {
    return null;
  }
}

export function renderProblemHeader(title, text, comment) {
  const c = comment.endsWith(" ") ? comment : comment + " ";
  const lines = [];
  if (title) lines.push(c + title);
  if (text) {
    if (lines.length) lines.push(comment);
    for (const l of String(text).split("\n")) lines.push(l ? c + l : comment);
  }
  return lines.length ? lines.join("\n") + "\n\n" : "";
}

export async function cmdShow(opts, deps) {
  const {
    callTool: call = callTool, cwd, session = "", out = console.log, style: st = style,
    fetchTranslated: fetchZh = fetchTranslated,
  } = deps;
  const slug = opts.positionals[0];
  if (!slug) throw new Error("用法：lc show <slug> [--lang L] [--force]");
  const lang = chooseLang(opts.flags, cwd);
  const meta = LANG_MAP[lang];
  if (!meta) throw new Error(`不支持的语言：${lang}（支持：${Object.keys(LANG_MAP).join(", ")}）`);

  const data = await call("get_problem", { titleSlug: slug }, { session, cwd });
  if (data && data.raw !== undefined) { out(String(data.raw)); return; }
  const problem = data?.problem ?? data;
  if (problem.questionId === undefined || problem.questionId === null) {
    throw new Error("get_problem 未返回 questionId，无法生成目录名");
  }
  const path = resolveNewPath(cwd, slug, problem.questionId, lang);

  const zh = await fetchZh(slug);
  const zhTitle = zh?.title || problem.title || null;
  const title = zhTitle || slug;
  const body = htmlToText(zh?.content || problem.content || "");

  if (existsSync(path) && !opts.flags.force) {
    out(`${st.dim("已存在，跳过：")}${path}${st.dim("（--force 覆盖）")}`);
  } else {
    const snippet = (problem.codeSnippets ?? []).find((s) => s.langSlug === meta.langSlug);
    const header = renderProblemHeader(zhTitle, body, meta.comment);
    const code = header + (snippet ? `${snippet.code}\n` : `${meta.comment} TODO: implement\n`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, code);
    out(`${st.green("✓ 已生成：")}${path}`);
  }
  const diff = difficultyLabel(problem.difficulty);
  out("");
  out(`${st.bold(title)}  ${st[diff.color](`[${diff.cn}]`)}`);
  out(st.dim(`https://leetcode.cn/problems/${slug}/`));
  out("");
  out(body);
}

function emit(out, data, st, setExitCode = (n) => { process.exitCode = n; }) {
  if (data && typeof data === "object" && data.raw !== undefined) { out(String(data.raw)); return; }
  out(formatVerdict(data, { style: st }));
  if (!verdictOk(data)) setExitCode(1);
}

export function extractCheck(data) {
  if (!data || typeof data !== "object") return null;
  return data.check ?? data;
}

const meaningful = (v) =>
  v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0) && String(v).trim() !== "";

function pickFailure(c) {
  if (c.last_testcase) {
    return { input: c.last_testcase, expected: c.expected_output, actual: c.std_output ?? c.code_output };
  }
  const got = c.std_output_list;
  const exp = c.expected_std_output_list;
  if (Array.isArray(got) && got.length) {
    let i = got.findIndex((v, idx) => String(v).trim() !== String(exp?.[idx] ?? "").trim());
    if (i === -1) i = 0;
    return { input: `用例 #${i + 1}`, expected: exp?.[i], actual: got[i] };
  }
  if (meaningful(c.code_answer)) {
    return { input: "返回值", expected: c.expected_code_answer, actual: c.code_answer };
  }
  return null;
}

export function verdictOk(data) {
  const c = extractCheck(data);
  if (!c) return false;
  // 注意：run_code 的 state 恒为 "SUCCESS"（表示「执行完成」），不能用来判定正确与否。
  return c.correct_answer === true || /accepted/i.test(String(c.status_msg ?? ""));
}

export function formatVerdict(raw, { style: st = style } = {}) {
  const c = extractCheck(raw);
  const url = raw?.checkUrl ? "  " + st.dim(raw.checkUrl) : "";

  // 服务器偶尔在判题结果就绪前返回（无 check / 无 status_msg）：如实说明，不要误报为失败
  if (!c || c.status_msg === undefined) {
    return [
      st.yellow("… 未取到判题结果（可能仍在判题中，可稍后重试）"),
      url,
    ].filter(Boolean).join("\n");
  }

  const status = c.status_msg ?? c.state ?? "未知";
  const ok = verdictOk(raw);
  const lines = [`${ok ? st.green("✓") : st.red("✗")} ${st.bold(ok ? st.green(status) : st.red(status))}`];

  const bits = [];
  // 「击败 X%」：仅在百分位是数值时附加到对应指标
  const beated = (v) => (typeof v === "number" ? `（击败 ${v.toFixed(1)}%）` : "");
  if (c.total_testcases != null) bits.push(`${c.total_correct ?? 0}/${c.total_testcases} 用例`);
  if (c.elapsed_time != null) bits.push(`${c.elapsed_time}ms${beated(c.runtime_percentile)}`);
  else if (c.status_runtime && c.status_runtime !== "N/A") bits.push(String(c.status_runtime));
  if (c.status_memory && c.status_memory !== "N/A") bits.push(`${c.status_memory}${beated(c.memory_percentile)}`);
  else if (typeof c.memory === "number" && c.memory > 0) bits.push(`${(c.memory / 1e6).toFixed(1)} MB${beated(c.memory_percentile)}`);
  const id = c.submission_id ?? raw?.start?.submission_id ?? raw?.start?.interpret_id;
  if (id) bits.push(`ID ${id}`);
  if (bits.length) lines.push("  " + st.dim(bits.join("  ·  ")));

  if (!ok) {
    if (c.invalid_testcase) {
      lines.push("");
      lines.push("  " + st.yellow("测试数据格式不被 LeetCode 接受（--input 写法有误？）"));
    }
    // 优先用 full_* 版本：它带出错行与源码上下文，runtime_error/compile_error 只是首行摘要
    const errText = c.full_runtime_error || c.runtime_error || c.full_compile_error || c.compile_error;
    if (errText) {
      lines.push("");
      for (const l of String(errText).replace(/\s+$/, "").split("\n")) lines.push("  " + st.red(l));
    }
    const f = pickFailure(c);
    if (f) {
      const rows = [["输入", f.input], ["期望", f.expected], ["实际", f.actual]].filter(([, v]) => meaningful(v));
      if (rows.length) {
        lines.push("");
        lines.push("  " + st.yellow("首个失败用例"));
        for (const [k, v] of rows) {
          const vs = String(v).replace(/\s+$/, "").split("\n");
          lines.push(`    ${st.dim(k)}  ${vs[0]}`);
          const pad = " ".repeat(4 + strWidth(k) + 2);
          for (let i = 1; i < vs.length; i++) lines.push(pad + vs[i]);
        }
      }
    }
  }
  if (url) lines.push(url);
  return lines.join("\n");
}

function requireSession(session) {
  if (!session) {
    throw new Error("该操作需要登录：请先运行 lc init，或 lc config set session <cookie>。\nCookie 获取方法：浏览器登录 leetcode.cn → F12 → Application → Cookies → 复制 LEETCODE_SESSION 的值。");
  }
}

function pickCodeFile(cwd, slug, lang, out) {
  const meta = LANG_MAP[lang];
  if (!meta) throw new Error(`不支持的语言：${lang}（支持：${Object.keys(LANG_MAP).join(", ")}）`);
  const { path, matches } = findExisting(cwd, slug, lang);
  if (!path) throw new Error(`找不到代码文件，请先运行：lc show ${slug} --lang ${lang}`);
  if (matches.length > 1) {
    out(`注意：匹配到多个文件，使用第一个：\n${matches.map((m) => "  " + m).join("\n")}`);
  }
  return { path, meta };
}

function parseTimeout(flag) {
  if (flag === undefined) return 120000;
  const ms = Number(flag);
  if (!Number.isInteger(ms) || ms <= 0) {
    throw new Error(`--timeout 需为正整数毫秒数，收到：${flag}`);
  }
  return ms;
}

export async function cmdRun(opts, deps) {
  const { callTool: call = callTool, cwd, session = "", out = console.log, style: st = style, setExitCode } = deps;
  const slug = opts.positionals[0];
  if (!slug) throw new Error("用法：lc run <slug> [--lang L] [--input \"...\"] [--timeout ms]");
  requireSession(session);
  const lang = chooseLang(opts.flags, cwd);
  const { path, meta } = pickCodeFile(cwd, slug, lang, out);
  const timeoutMs = parseTimeout(opts.flags.timeout);
  const args = {
    titleSlug: slug,
    lang: meta.langSlug,
    typedCode: readFileSync(path, "utf8"),
    timeoutMs,
  };
  if (opts.flags.input) args.dataInput = String(opts.flags.input);
  const data = await call("run_code", args, { session, cwd, timeoutMs: timeoutMs + 5000 });
  emit(out, data, st, setExitCode);
}

export async function cmdSubmit(opts, deps) {
  const { callTool: call = callTool, cwd, session = "", out = console.log, style: st = style, setExitCode } = deps;
  const slug = opts.positionals[0];
  if (!slug) throw new Error("用法：lc submit <slug> [--lang L] [--timeout ms]");
  requireSession(session);
  const lang = chooseLang(opts.flags, cwd);
  const { path, meta } = pickCodeFile(cwd, slug, lang, out);
  const timeoutMs = parseTimeout(opts.flags.timeout);
  const data = await call("submit_solution", {
    titleSlug: slug,
    lang: meta.langSlug,
    typedCode: readFileSync(path, "utf8"),
    timeoutMs,
  }, { session, cwd, timeoutMs: timeoutMs + 5000 });
  emit(out, data, st, setExitCode);
}

const PROJECT_NAME = "little-leetcode-cli";

export function ensureProjectRoot(cwd) {
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      if (JSON.parse(readFileSync(pkgPath, "utf8")).name === PROJECT_NAME) return;
    } catch { /* 落到下方错误提示 */ }
  }
  throw new Error(
    `当前目录不是 LittleLeetCodeCli 项目根目录：${cwd}\n` +
    `请切换到项目根目录后再运行 lc`
  );
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const d = {
    cwd: process.cwd(),
    out: (s = "") => console.log(s),
    errOut: (s = "") => console.error(s),
    callTool,
    exec: spawnSync,
    promptCookie: promptCookieInteractive,
    ...deps,
  };

  const { session, env: mergedEnv } = loadEnv(d.cwd);
  d.zh = d.zh ?? isChineseEnv(mergedEnv);

  const opts = parseArgs(argv);

  // 帮助优先于项目根守卫：任何目录下都能查看用法
  if (opts.command === "help" || opts.flags.help === true) {
    const target = opts.command === "help" ? opts.positionals[0] : opts.command;
    if (target && !COMMANDS[target]) {
      d.errOut(`未知命令：${target}`);
      printHelp(d.out, { zh: d.zh });
      process.exitCode = 1;
    } else if (target) {
      printCommandHelp(target, d.out, { zh: d.zh });
    } else {
      printHelp(d.out, { zh: d.zh });
    }
    return;
  }

  try {
    ensureProjectRoot(d.cwd);
    switch (opts.command) {
      case "init":    await cmdInit(opts, d); break;
      case "config":  cmdConfig(opts, d); break;
      case "list":    await cmdList(opts, { ...d, session }); break;
      case "random":  await cmdRandom(opts, { ...d, session }); break;
      case "progress": await cmdProgress(opts, { ...d, session }); break;
      case "show":    await cmdShow(opts, { ...d, session }); break;
      case "run":     await cmdRun(opts, { ...d, session }); break;
      case "submit":  await cmdSubmit(opts, { ...d, session }); break;
      case null:      printHelp(d.out, { zh: d.zh }); break;
      default:
        d.errOut(`未知命令：${opts.command}`);
        printHelp(d.out, { zh: d.zh });
        process.exitCode = 1;
    }
  } catch (e) {
    d.errOut(`错误：${e.message}`);
    process.exitCode = 1;
  }
}

// 入口守卫：npm link / 全局安装会以软链方式调用，此时 argv[1] 是软链路径，
// 而 import.meta.url 已是真实路径，故先 realpath 再比较。
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
