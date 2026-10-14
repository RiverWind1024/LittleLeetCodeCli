import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  printHelp,
  printCommandHelp,
  parseArgs,
  LANG_MAP,
  resolveNewPath,
  findExisting,
  normalizeDifficulty,
  formatRandom,
  cmdRandom,
  formatVerdict,
  verdictOk,
  resolveMcpBin,
  cmdConfig,
  mask,
  readDefaultLang,
  chooseLang,
  DEFAULT_LANG_KEY,
  cmdInit,
  cmdList,
  loadSolved,
  cmdProgress,
  cmdShow,
  renderProblemHeader,
  fetchTranslated,
  cmdRun,
  cmdSubmit,
  main,
} from "../bin/lc.mjs";
import {
  parseEnvContent,
  loadEnv,
  setEnvVar,
  unsetEnvVar,
  detectColor,
  createStyle,
  isChineseEnv,
  resolveLocale,
  htmlToText,
} from "../bin/utils.js";
import {
  renderList,
  resolveTitle,
  renderProgressSummary,
  renderSolvedTable,
} from "../bin/render.js";

const tmp = () => mkdtempSync(join(tmpdir(), "lc-"));
const fakeRoot = () => {
  const dir = tmp();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "little-leetcode-cli" }));
  return dir;
};
const PQ = (slug, date, extra = {}) => ({
  titleSlug: slug,
  frontendId: "1",
  title: String(slug).toUpperCase(),
  translatedTitle: slug,
  difficulty: "EASY",
  lastSubmittedAt: date,
  numSubmitted: 1,
  lastResult: "AC",
  ...extra,
});
const NORM = (slug, date, extra = {}) => {
  const q = PQ(slug, date);
  return {
    slug: q.titleSlug,
    frontendId: q.frontendId,
    title: q.title,
    titleCn: q.translatedTitle,
    difficulty: q.difficulty,
    lastSubmittedAt: q.lastSubmittedAt,
    numSubmitted: q.numSubmitted,
    lastResult: q.lastResult,
    ...extra,
  };
};

test("printHelp 打印命令列表", () => {
  const lines = [];
  printHelp((s) => lines.push(s));
  const text = lines.join("\n");
  for (const cmd of ["init", "config", "list", "random", "progress", "show", "run", "submit"]) {
    assert.match(text, new RegExp(cmd));
  }
  assert.match(text, /lc <命令> --help/);
});

test("printCommandHelp 已知命令返回 true 并含选项，未知返回 false", () => {
  const lines = [];
  assert.equal(printCommandHelp("list", (s) => lines.push(s)), true);
  const text = lines.join("\n");
  assert.match(text, /用法：lc list/);
  assert.match(text, /--difficulty/);
  assert.match(text, /--tags/);
  assert.match(text, /--limit/);
  assert.equal(printCommandHelp("nope", () => {}), false);
});

test("parseArgs 识别 -h 与 --help", () => {
  assert.equal(parseArgs(["-h"]).flags.help, true);
  assert.equal(parseArgs(["--help"]).flags.help, true);
  assert.equal(parseArgs(["list", "--help"]).command, "list");
  assert.equal(parseArgs(["list", "--help"]).flags.help, true);
});

test("main: lc <命令> --help 打印该命令用法且不调用 MCP", async () => {
  const out = [];
  let called = false;
  await main(["submit", "--help"], {
    cwd: tmp(), out: (s) => out.push(s),
    callTool: async () => { called = true; return {}; },
  });
  assert.match(out.join("\n"), /用法：lc submit/);
  assert.equal(called, false);
});

test("main: lc help <命令> 与 --help 等价", async () => {
  const out = [];
  await main(["help", "random"], { cwd: tmp(), out: (s) => out.push(s) });
  assert.match(out.join("\n"), /用法：lc random/);
});

test("main: 帮助无需在项目根目录也能用", async () => {
  const notRoot = tmp();
  const out = [];
  await main(["list", "--help"], { cwd: notRoot, out: (s) => out.push(s) });
  assert.match(out.join("\n"), /用法：lc list/);
});

test("main: lc help 未知命令报错并退出码 1", async () => {
  const errs = [];
  const prev = process.exitCode;
  process.exitCode = 0;
  await main(["help", "nope"], { cwd: tmp(), out: () => {}, errOut: (s) => errs.push(s) });
  assert.match(errs.join("\n"), /未知命令：nope/);
  assert.equal(process.exitCode, 1);
  process.exitCode = prev;
});

test("parseArgs 解析命令、位置参数与标志", () => {
  const r = parseArgs(["list", "two", "--difficulty", "Easy", "--tags=a,b", "--verbose"]);
  assert.equal(r.command, "list");
  assert.deepEqual(r.positionals, ["two"]);
  assert.equal(r.flags.difficulty, "Easy");
  assert.equal(r.flags.tags, "a,b");
  assert.equal(r.flags.verbose, true);
});

test("LANG_MAP 含 8 种语言且文件名正确", () => {
  assert.equal(Object.keys(LANG_MAP).length, 8);
  assert.deepEqual(LANG_MAP.python3, { langSlug: "python3", fileName: "solution.py", comment: "#" });
  assert.equal(LANG_MAP.java.fileName, "Solution.java");
});

test("resolveNewPath 生成四位编号路径", () => {
  assert.equal(resolveNewPath("/p", "two-sum", 1, "python3"), "/p/solutions/0001-two-sum/python3/solution.py");
});

test("findExisting 找到已存在的文件", () => {
  const cwd = tmp();
  const dir = join(cwd, "solutions", "0001-two-sum", "python3");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "solution.py"), "x");
  const r = findExisting(cwd, "two-sum", "python3");
  assert.equal(r.path, join(dir, "solution.py"));
  assert.equal(r.matches.length, 1);
});

test("findExisting 命中多个时返回全部并按序取第一个", () => {
  const cwd = tmp();
  for (const d of ["0001-two-sum", "0100-two-sum"]) {
    const dir = join(cwd, "solutions", d, "python3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "solution.py"), "x");
  }
  const r = findExisting(cwd, "two-sum", "python3");
  assert.equal(r.matches.length, 2);
  assert.equal(r.path, join(cwd, "solutions", "0001-two-sum", "python3", "solution.py"));
});

test("parseEnvContent 忽略注释空行并去引号", () => {
  const m = parseEnvContent('# c\n\nA=1\nB="x y"\nC=\'z\'\nD=plain\n');
  assert.deepEqual(m, { A: "1", B: "x y", C: "z", D: "plain" });
});

test("loadEnv 合并 .env 且环境变量优先", () => {
  const cwd = tmp();
  writeFileSync(join(cwd, ".env"), "LEETCODE_SESSION=from_file\n");
  assert.equal(loadEnv(cwd, { LEETCODE_SESSION: "from_env" }).session, "from_env");
  assert.equal(loadEnv(cwd, {}).session, "from_file");
  assert.equal(loadEnv(cwd, { LC_LOCALE: "en" }).env.LC_LOCALE, "en");
});

test("setEnvVar 更新/追加键并保留注释", () => {
  const out = setEnvVar("# 注释\nLEETCODE_SESSION=old\n", "LEETCODE_SESSION", "new");
  assert.match(out, /LEETCODE_SESSION=new/);
  assert.match(out, /# 注释/);
  assert.equal(out.split("\n").filter((l) => l.startsWith("LEETCODE_SESSION")).length, 1);
  assert.match(setEnvVar("", "LEETCODE_SESSION", "v"), /LEETCODE_SESSION=v/);
});

test("unsetEnvVar 删除键且保留其他行", () => {
  const out = unsetEnvVar("A=1\nLEETCODE_SESSION=x\nB=2\n", "LEETCODE_SESSION");
  assert.doesNotMatch(out, /LEETCODE_SESSION/);
  assert.match(out, /A=1/);
  assert.match(out, /B=2/);
});

test("mask 遮蔽中间字符", () => {
  assert.equal(mask("abcdefghijkl"), "abcd****ijkl");
  assert.equal(mask("short"), "*****");
});

test("renderList 渲染带边框表格、英文表头与难度并处理空列表", () => {
  const out = renderList([
    { difficulty: "EASY", title: "Two Sum", titleCn: "两数之和", titleSlug: "two-sum" },
    { difficulty: "HARD", title: "Hard One", titleSlug: "hard-one" },
  ], { zh: false });
  const lines = out.split("\n");
  assert.match(lines[0], /^┌/);
  assert.match(lines[lines.length - 1], /┘$/);
  assert.match(lines[1], /DIFFICULTY/);
  assert.match(lines[1], /TITLE/);
  assert.match(lines[1], /SLUG/);
  assert.match(out, /EASY/);
  assert.match(out, /HARD/);
  assert.match(out, /Two Sum/);
  assert.doesNotMatch(out, /难度|简单/);
  assert.equal(renderList([], { zh: false }), "No matching problems");
  assert.equal(renderList([], { zh: true }), "无匹配题目");
});

test("isChineseEnv 识别中文环境", () => {
  assert.equal(isChineseEnv({ LANG: "zh_CN.UTF-8" }), true);
  assert.equal(isChineseEnv({ LANG: "zh" }), true);
  assert.equal(isChineseEnv({ LANG: "en_US.UTF-8" }), false);
  assert.equal(isChineseEnv({ LC_ALL: "zh_CN" }), true);
  assert.equal(isChineseEnv({ LANG: "zh_CN.UTF-8", LC_ALL: "en_US.UTF-8" }), false);
  assert.equal(isChineseEnv({}), false);
});

test("resolveLocale: LC_LOCALE 优先于 LC_ALL/LANG，支持 zh/en/auto", () => {
  assert.equal(resolveLocale({ LC_LOCALE: "en", LANG: "zh_CN.UTF-8" }), "en");
  assert.equal(resolveLocale({ LC_LOCALE: "zh", LANG: "en_US.UTF-8" }), "zh");
  assert.equal(resolveLocale({ LC_LOCALE: "EN" }), "en");
  assert.equal(resolveLocale({ LC_LOCALE: "zh_CN" }), "zh");
  assert.equal(resolveLocale({ LC_LOCALE: "auto", LANG: "zh_CN.UTF-8" }), "zh");
  assert.equal(resolveLocale({ LC_LOCALE: "auto", LANG: "en_US.UTF-8" }), "en");
  assert.equal(resolveLocale({ LC_LOCALE: "", LANG: "zh_CN.UTF-8" }), "zh");
  assert.equal(resolveLocale({}), "en");
});

test("resolveTitle 按语言取标题并回退", () => {
  const q = { title: "Two Sum", titleCn: "两数之和", titleSlug: "two-sum" };
  assert.equal(resolveTitle(q, true), "两数之和");
  assert.equal(resolveTitle(q, false), "Two Sum");
  assert.equal(resolveTitle({ title: "Two Sum", titleSlug: "two-sum" }, true), "Two Sum");
  assert.equal(resolveTitle({ titleCn: "两数之和", titleSlug: "two-sum" }, false), "两数之和");
  assert.equal(resolveTitle({ titleSlug: "two-sum" }, true), "two-sum");
});

test("renderList 标题按语言显示单列并回退", () => {
  const row = { difficulty: "EASY", title: "Two Sum", titleCn: "两数之和", titleSlug: "two-sum" };
  const en = renderList([row], { zh: false });
  assert.match(en, /Two Sum/);
  assert.doesNotMatch(en, /两数之和/);
  const zh = renderList([row], { zh: true });
  assert.match(zh, /两数之和/);
  assert.doesNotMatch(zh, /Two Sum/);
  const fb = renderList([{ difficulty: "EASY", title: "Two Sum", titleSlug: "two-sum" }], { zh: true });
  assert.match(fb, /Two Sum/);
});

test("renderList 提供 solved 集合时显示状态列，否则不显示", () => {
  const row = { difficulty: "EASY", title: "Two Sum", titleCn: "两数之和", titleSlug: "two-sum" };
  const withSolved = renderList([row], { zh: false, solved: new Set(["two-sum"]) });
  assert.match(withSolved, /STATUS/);
  assert.match(withSolved, /✓/);
  const unsolved = renderList([row], { zh: false, solved: new Set(["other"]) });
  assert.doesNotMatch(unsolved, /✓/);
  const without = renderList([row], { zh: false });
  assert.doesNotMatch(without, /STATUS/);
});

test("normalizeDifficulty 归一化并校验", () => {
  assert.equal(normalizeDifficulty(undefined), undefined);
  assert.equal(normalizeDifficulty("easy"), "EASY");
  assert.equal(normalizeDifficulty("Hard"), "HARD");
  assert.throws(() => normalizeDifficulty("EASYISH"), /--difficulty 需为 EASY\|MEDIUM\|HARD/);
});

test("formatRandom 展示中文名/难度/标签/链接与 show 提示", () => {
  const out = formatRandom({
    title: "Two Sum", titleCn: "两数之和", titleSlug: "two-sum",
    difficulty: "EASY", topicTags: ["array", "hash-table"],
  });
  assert.match(out, /两数之和/);
  assert.match(out, /简单/);
  assert.match(out, /Array|array/);
  assert.match(out, /https:\/\/leetcode\.cn\/problems\/two-sum\//);
  assert.match(out, /lc show two-sum/);
});

test("cmdRandom 先取 total 再按随机 offset 取一题", async () => {
  const calls = [];
  const out = [];
  await cmdRandom(
    { positionals: [], flags: { difficulty: "hard", tags: "array" } },
    {
      cwd: tmp(), session: "", out: (s) => out.push(s), random: () => 0.5,
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (args.offset === 0) return { problems: { total: 100, questions: [{ titleSlug: "first", difficulty: "HARD" }] } };
        return { problems: { total: 100, questions: [{ titleSlug: "picked", difficulty: "HARD" }] } };
      },
    }
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, { difficulty: "HARD", tags: ["array"], limit: 1, offset: 0 });
  assert.deepEqual(calls[1].args, { difficulty: "HARD", tags: ["array"], limit: 1, offset: 50 });
  assert.match(out.join("\n"), /picked/);
});

test("cmdRandom offset 为 0 时只调用一次", async () => {
  const calls = [];
  await cmdRandom({ positionals: [], flags: {} }, {
    cwd: tmp(), session: "", out: () => {}, random: () => 0,
    callTool: async (name, args) => { calls.push(args); return { problems: { total: 10, questions: [{ titleSlug: "first", difficulty: "EASY" }] } }; },
  });
  assert.equal(calls.length, 1);
});

test("cmdRandom 无匹配题目时报错", async () => {
  await assert.rejects(
    cmdRandom({ positionals: [], flags: {} }, {
      cwd: tmp(), session: "", out: () => {},
      callTool: async () => ({ problems: { total: 0, questions: [] } }),
    }),
    /没有符合条件的题目/
  );
});

test("detectColor 按 TTY / NO_COLOR / FORCE_COLOR 判定", () => {
  assert.equal(detectColor({ isTTY: true }, {}), true);
  assert.equal(detectColor({ isTTY: false }, {}), false);
  assert.equal(detectColor({}, {}), false);
  assert.equal(detectColor({ isTTY: true }, { NO_COLOR: "1" }), false);
  assert.equal(detectColor({ isTTY: false }, { FORCE_COLOR: "1" }), true);
  assert.equal(detectColor({ isTTY: false }, { FORCE_COLOR: "0" }), false);
});

test("createStyle 关闭颜色时输出纯文本，开启时包 ANSI", () => {
  const off = createStyle(false);
  assert.equal(off.green("x"), "x");
  assert.equal(off.dim("y"), "y");
  const on = createStyle(true);
  assert.match(on.green("x"), /\u001b\[32mx\u001b\[0m/);
});

test("renderList 上色时列宽仍对齐（宽度按纯文本计算）", () => {
  const out = renderList(
    [{ difficulty: "EASY", title: "Two Sum", titleCn: "两数之和", titleSlug: "two-sum" }],
    { style: createStyle(true) }
  );
  // 去掉 ANSI 后各行「显示宽度」应一致（中文占 2 列）
  const dw = (s) => {
    let w = 0;
    for (const ch of s) w += /[⺀-鿿　-〿＀-￯]/.test(ch) ? 2 : 1;
    return w;
  };
  const widths = out.split("\n").map((l) => dw(l.replace(/\[\d+m/g, "")));
  assert.equal(new Set(widths).size, 1, `各行宽度不一致: ${widths.join(",")}`);
});

test("formatVerdict 成功时输出摘要", () => {
  const out = formatVerdict({
    start: { submission_id: "754558502" },
    checkUrl: "https://leetcode.cn/submissions/detail/754558502",
    check: {
      status_msg: "Accepted", state: "SUCCESS",
      total_correct: 65, total_testcases: 65,
      elapsed_time: 76, status_memory: "20.3 MB",
    },
  });
  assert.match(out, /Accepted/);
  assert.match(out, /65\/65 用例/);
  assert.match(out, /76ms/);
  assert.match(out, /20\.3 MB/);
  assert.match(out, /754558502/);
  assert.doesNotMatch(out, /失败用例/);
});

test("formatVerdict 失败时展示首个失败用例", () => {
  const out = formatVerdict({
    checkUrl: "https://x/detail",
    check: {
      status_msg: "Wrong Answer", state: "FAILURE",
      total_correct: 64, total_testcases: 65,
      elapsed_time: 50, status_memory: "18 MB",
      last_testcase: "[2,7,11,15]\n9",
      expected_output: "[0,1]",
      std_output: "[1,0]",
    },
  });
  assert.match(out, /Wrong Answer/);
  assert.match(out, /64\/65 用例/);
  assert.match(out, /首个失败用例/);
  assert.match(out, /输入/);
  assert.match(out, /\[0,1\]/);
  assert.match(out, /\[1,0\]/);
});

test("formatVerdict 兼容 run 的 std_output_list 差异", () => {
  const out = formatVerdict({
    check: {
      status_msg: "Wrong Answer", state: "FAILURE",
      total_testcases: 2,
      std_output_list: ["ok", "bad"],
      expected_std_output_list: ["ok", "good"],
    },
  });
  assert.match(out, /用例 #2/);
  assert.match(out, /good/);
  assert.match(out, /bad/);
});

test("判题结果缺失时如实提示，不误报为失败或通过", () => {
  const out = formatVerdict({ titleSlug: "two-sum", start: { interpret_id: "runcode_x" }, checkUrl: "https://x/c" });
  assert.match(out, /未取到判题结果/);
  assert.doesNotMatch(out, /✓/);
  assert.doesNotMatch(out, /✗/);
  assert.doesNotMatch(out, /首个失败用例/);
});

test("code_answer 为空数组时不输出残缺的失败详情", () => {
  const out = formatVerdict({
    check: { status_msg: "Runtime Error", state: "SUCCESS", run_success: false, code_answer: [], runtime_error: "boom" },
  });
  assert.match(out, /boom/);
  assert.doesNotMatch(out, /首个失败用例/);
  assert.doesNotMatch(out, /返回值/);
});

test("formatVerdict 不把 run_code 的 state=SUCCESS 当作通过", () => {
  // 真实回归：run_code 即使报 Runtime Error，state 也是 "SUCCESS"（仅表示执行完成）
  const out = formatVerdict({
    start: { interpret_id: "runcode_1" },
    check: {
      status_msg: "Runtime Error", state: "SUCCESS",
      run_success: false, code_answer: [],
      runtime_error: "3,2,4 is not a valid value of type integer[]",
      total_correct: null, total_testcases: null,
      status_runtime: "N/A", status_memory: "N/A",
    },
  });
  assert.doesNotMatch(out, /✓/, "Runtime Error 不得显示为通过");
  assert.match(out, /✗/);
  assert.match(out, /Runtime Error/);
  assert.match(out, /not a valid value of type integer/);
  assert.doesNotMatch(out, /N\/A/, "N/A 不应出现在摘要里");
});

test("verdictOk 判定通过与否", () => {
  assert.equal(verdictOk({ check: { status_msg: "Accepted", state: "SUCCESS" } }), true);
  assert.equal(verdictOk({ check: { correct_answer: true, status_msg: "Accepted" } }), true);
  assert.equal(verdictOk({ check: { status_msg: "Wrong Answer", state: "FAILURE" } }), false);
  assert.equal(verdictOk({ check: { status_msg: "Runtime Error", state: "SUCCESS" } }), false);
  assert.equal(verdictOk(null), false);
});

test("判题失败时 cmdRun 以非 0 退出码结束", async () => {
  const cwd = tmp();
  const dir = join(cwd, "solutions", "0001-two-sum", "python3");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "solution.py"), "print(1)");
  const codes = [];
  await cmdRun(
    { positionals: ["two-sum"], flags: {} },
    {
      cwd, session: "s", out: () => {},
      setExitCode: (n) => codes.push(n),
      callTool: async () => ({ check: { status_msg: "Wrong Answer", state: "FAILURE", total_correct: 1, total_testcases: 2 } }),
    }
  );
  assert.deepEqual(codes, [1]);

  const okCodes = [];
  await cmdRun(
    { positionals: ["two-sum"], flags: {} },
    {
      cwd, session: "s", out: () => {},
      setExitCode: (n) => okCodes.push(n),
      callTool: async () => ({ check: { status_msg: "Accepted", state: "SUCCESS", correct_answer: true } }),
    }
  );
  assert.deepEqual(okCodes, []);
});

test("htmlToText 去标签、换行、解码实体", () => {
  const out = htmlToText("<p>你好</p><p>a &amp; b<br/>line</p>");
  assert.match(out, /你好/);
  assert.match(out, /a & b/);
  assert.match(out, /line/);
  assert.doesNotMatch(out, /<[^>]+>/);
});

test("htmlToText 把上下标渲染为 ^ 和 _，不丢语义", () => {
  assert.equal(htmlToText("<code>x<sub>i</sub><sup>y<sub>i</sub></sup></code>"), "x_i^y_i");
  assert.equal(htmlToText("<code>10<sup>9</sup> + 7</code>"), "10^9 + 7");
  assert.equal(htmlToText("<code>2<sup>30</sup> = 1073741824</code>"), "2^30 = 1073741824");
});

test("resolveMcpBin 优先本地 bin，否则回退 npx", () => {
  const cwd = tmp();
  const binDir = join(cwd, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, "leetcode-mcp-server"), "");
  const local = resolveMcpBin(cwd);
  assert.equal(local.cmd, join(binDir, "leetcode-mcp-server"));
  assert.equal(local.local, true);

  const fallback = resolveMcpBin(tmp());
  assert.equal(fallback.cmd, "npx");
  assert.equal(fallback.local, false);
});

test("cmdConfig set/get/unset/list 操作 .env 并遮蔽输出", () => {
  const cwd = tmp();
  const out = [];
  const deps = { cwd, out: (s) => out.push(s) };

  cmdConfig({ positionals: ["set", "session", "abcdefghijkl"] }, deps);
  assert.equal(readFileSync(join(cwd, ".env"), "utf8").trim(), "LEETCODE_SESSION=abcdefghijkl");

  cmdConfig({ positionals: ["get", "session"] }, deps);
  assert.equal(out.at(-1), "abcd****ijkl");

  cmdConfig({ positionals: ["list"] }, deps);
  assert.match(out.at(-1), /^LEETCODE_SESSION=abcd\*\*\*\*ijkl$/);

  cmdConfig({ positionals: ["unset", "session"] }, deps);
  assert.doesNotMatch(readFileSync(join(cwd, ".env"), "utf8"), /LEETCODE_SESSION/);

  assert.throws(() => cmdConfig({ positionals: ["set", "bogus", "x"] }, deps), /lc config <get\|set\|unset\|list> \[session\|lang\]/);
});

test("cmdConfig unset 未设置时提示且不报错", () => {
  const cwd = tmp();
  const out = [];
  cmdConfig({ positionals: ["unset", "session"] }, { cwd, out: (s) => out.push(s) });
  assert.equal(out.at(-1), "未设置");
});

test("cmdConfig set/get/unset/list 支持 lang（明文，不脱敏）", () => {
  const cwd = tmp();
  const out = [];
  const deps = { cwd, out: (s) => out.push(s) };

  cmdConfig({ positionals: ["set", "lang", "cpp"] }, deps);
  assert.equal(readFileSync(join(cwd, ".env"), "utf8").trim(), "DEFAULT_LANG=cpp");

  cmdConfig({ positionals: ["get", "lang"] }, deps);
  assert.equal(out.at(-1), "cpp");

  cmdConfig({ positionals: ["list"] }, deps);
  assert.match(out.at(-1), /^DEFAULT_LANG=cpp$/);

  cmdConfig({ positionals: ["unset", "lang"] }, deps);
  assert.doesNotMatch(readFileSync(join(cwd, ".env"), "utf8"), /DEFAULT_LANG/);

  assert.throws(() => cmdConfig({ positionals: ["set", "lang", "bogus"] }, deps), /支持的语言/);
});

test("cmdConfig 同时保存 session 与 lang", () => {
  const cwd = tmp();
  const out = [];
  const deps = { cwd, out: (s) => out.push(s) };
  cmdConfig({ positionals: ["set", "session", "abcdefghijkl"] }, deps);
  cmdConfig({ positionals: ["set", "lang", "golang"] }, deps);
  cmdConfig({ positionals: ["list"] }, deps);
  const lines = out.slice(-2);
  assert.match(lines[0], /^LEETCODE_SESSION=abcd\*\*\*\*ijkl$/);
  assert.match(lines[1], /^DEFAULT_LANG=golang$/);
});

test("readDefaultLang/chooseLang 解析默认语言，命令行优先", () => {
  const cwd = tmp();
  assert.equal(readDefaultLang(cwd), null);
  writeFileSync(join(cwd, ".env"), "DEFAULT_LANG=java\n");
  assert.equal(readDefaultLang(cwd), "java");
  assert.equal(chooseLang({}, cwd), "java");
  assert.equal(chooseLang({ lang: "rust" }, cwd), "rust");
  writeFileSync(join(cwd, ".env"), "DEFAULT_LANG=bogus\n");
  assert.equal(readDefaultLang(cwd), null);
  assert.equal(chooseLang({}, cwd), "python3");
});

test("cmdInit：本地已装则跳过 npm，未配会话则引导写入", async () => {
  const cwd = tmp();
  mkdirSync(join(cwd, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(cwd, "node_modules", ".bin", "leetcode-mcp-server"), "");
  let npmCalled = false;
  const out = [];
  await cmdInit({}, {
    cwd,
    env: {},
    out: (s) => out.push(s),
    exec: () => { npmCalled = true; return { status: 0 }; },
    promptCookie: async () => "cookie123",
  });
  assert.equal(npmCalled, false);
  assert.match(readFileSync(join(cwd, ".env"), "utf8"), /LEETCODE_SESSION=cookie123/);
});

test("cmdInit：本地依赖缺失时调用 npm install", async () => {
  const cwd = tmp();
  const calls = [];
  await cmdInit({}, {
    cwd,
    env: {},
    out: () => {},
    exec: (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; },
    promptCookie: async () => "",
  });
  assert.equal(calls[0][0], "npm");
  assert.deepEqual(calls[0][1], ["install"]);
});

test("loadSolved 分页抓取、按 slug 去重并按最近提交倒序写入缓存", async () => {
  const dir = fakeRoot();
  let calls = 0;
  const r = await loadSolved({
    cwd: dir, session: "s",
    callTool: async (name, args) => {
      calls++;
      const page = args.offset === 0
        ? [PQ("c", "2026-01-01"), PQ("a", "2026-01-03")]
        : [PQ("a", "2026-01-03"), PQ("b", "2026-01-02")];
      return { questions: { totalNum: 3, questions: page } };
    },
  });
  assert.equal(calls, 2);
  assert.equal(r.stale, false);
  assert.deepEqual(r.solved.map((s) => s.slug), ["a", "b", "c"]);
  assert.deepEqual(r.solved[0], {
    slug: "a", frontendId: "1", title: "A", titleCn: "a",
    difficulty: "EASY", lastSubmittedAt: "2026-01-03", numSubmitted: 1, lastResult: "AC",
  });
  assert.equal(existsSync(join(dir, ".lc-cache", "solved.json")), true);
});

test("loadSolved 24h 内缓存命中不重新抓取，过期后重抓", async () => {
  const dir = fakeRoot();
  let calls = 0;
  const callTool = async () => { calls++; return { questions: { totalNum: 1, questions: [PQ("a", "2026-01-01")] } }; };
  const times = [1_000_000, 1_000_000, 100_000_000_000];
  let i = 0;
  const now = () => times[Math.min(i++, times.length - 1)];
  const first = await loadSolved({ cwd: dir, session: "s", callTool, now });
  assert.equal(calls, 1);
  assert.equal(first.solved.length, 1);
  const hit = await loadSolved({ cwd: dir, session: "s", callTool, now });
  assert.equal(calls, 1, "命中缓存不应再抓取");
  assert.equal(hit.solved.length, 1);
  const expired = await loadSolved({ cwd: dir, session: "s", callTool, now });
  assert.equal(calls, 2, "过期应重新抓取");
  assert.equal(expired.solved.length, 1);
});

test("loadSolved --refresh 强制重抓，缓存损坏时也重抓并修复", async () => {
  const dir = fakeRoot();
  let calls = 0;
  const callTool = async () => { calls++; return { questions: { totalNum: 1, questions: [PQ("a", "2026-01-01")] } }; };
  await loadSolved({ cwd: dir, session: "s", callTool });
  await loadSolved({ cwd: dir, session: "s", callTool, refresh: true });
  assert.equal(calls, 2, "refresh 应重新抓取");
  const cachePath = join(dir, ".lc-cache", "solved.json");
  writeFileSync(cachePath, "not-json");
  await loadSolved({ cwd: dir, session: "s", callTool });
  assert.equal(calls, 3, "缓存损坏应重抓");
  assert.equal(JSON.parse(readFileSync(cachePath, "utf8")).solved.length, 1);
});

test("loadSolved 抓取失败时用过期缓存并标记 stale，无缓存则报错", async () => {
  const dir = fakeRoot();
  const cachePath = join(dir, ".lc-cache", "solved.json");
  mkdirSync(join(dir, ".lc-cache"), { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ fetchedAt: 0, solved: [NORM("a", "2026-01-01")] }));
  const failing = async () => { throw new Error("boom"); };
  const stale = await loadSolved({ cwd: dir, session: "s", callTool: failing });
  assert.equal(stale.stale, true);
  assert.equal(stale.solved[0].slug, "a");
  const dir2 = fakeRoot();
  await assert.rejects(loadSolved({ cwd: dir2, session: "s", callTool: failing }), /boom/);
});

test("loadSolved 无 session 时返回 null 且不请求", async () => {
  let called = false;
  const r = await loadSolved({ cwd: fakeRoot(), session: "", callTool: async () => { called = true; } });
  assert.equal(r, null);
  assert.equal(called, false);
});

test("renderProgressSummary 统计已解决数量与难度分布", () => {
  const solved = [
    PQ("a", "2026-01-01"),
    PQ("b", "2026-01-02", { difficulty: "MEDIUM" }),
    PQ("c", "2026-01-03", { difficulty: "HARD" }),
  ];
  assert.equal(renderProgressSummary(solved, { zh: true }), "已解决 3 · 简单 1 · 中等 1 · 困难 1");
  assert.equal(renderProgressSummary(solved, { zh: false }), "Solved 3 · EASY 1 · MID 1 · HARD 1");
});

test("renderSolvedTable 渲染难度/标题/slug/日期/次数并支持过滤与分页", () => {
  const solved = [
    NORM("a", "2026-01-01"),
    NORM("b", "2026-01-02", { difficulty: "MEDIUM", numSubmitted: 5 }),
    NORM("c", "2026-01-03", { difficulty: "HARD", lastSubmittedAt: "2026-02-10T08:00:00" }),
  ];
  const all = renderSolvedTable(solved, { zh: true });
  assert.match(all, /难度/);
  assert.match(all, /标题/);
  assert.match(all, /题号/);
  assert.match(all, /最近提交/);
  assert.match(all, /次数/);
  assert.match(all, /2026-02-10/);
  assert.doesNotMatch(all, /T08:00:00/);

  const allEn = renderSolvedTable(solved, { zh: false });
  assert.match(allEn, /DIFFICULTY/);
  assert.match(allEn, /TITLE/);
  assert.match(allEn, /SLUG/);
  assert.match(allEn, /EASY/);
  assert.match(allEn, /MID/);
  assert.match(allEn, /HARD/);

  const filtered = renderSolvedTable(solved, { zh: true, difficulty: "MEDIUM" });
  assert.match(filtered, /b/);
  assert.doesNotMatch(filtered, /c/);
  const page = renderSolvedTable(solved, { zh: true, limit: 1, offset: 1 });
  assert.match(page, /b/);
  assert.doesNotMatch(page, /a/);
  assert.doesNotMatch(page, /c/);
});

test("cmdProgress 需要登录，成功后输出统计与表格", async () => {
  const dir = fakeRoot();
  await assert.rejects(
    cmdProgress({ positionals: [], flags: {} }, {
      cwd: dir, session: "", out: () => {}, warn: () => {}, zh: true,
      callTool: async () => { throw new Error("不应调用"); },
    }),
    /需要登录/
  );
  const dir2 = fakeRoot();
  const out2 = [];
  await cmdProgress({ positionals: [], flags: {} }, {
    cwd: dir2, session: "s", out: (s) => out2.push(s), zh: true,
    callTool: async (name) => ({ questions: { totalNum: 2, questions: [PQ("a", "2026-01-01"), PQ("b", "2026-01-02", { difficulty: "HARD" })] } }),
  });
  assert.match(out2[0], /已解决 2 · 简单 1 · 中等 0 · 困难 1/);
  assert.match(out2.join("\n"), /最近提交/);
});

test("cmdProgress 支持 --difficulty/--limit/--offset，stale 时告警", async () => {
  const dir = fakeRoot();
  const out = [];
  const warnings = [];
  mkdirSync(join(dir, ".lc-cache"), { recursive: true });
  writeFileSync(join(dir, ".lc-cache", "solved.json"),
    JSON.stringify({ fetchedAt: 0, solved: [NORM("a", "2026-01-01"), NORM("b", "2026-01-02", { difficulty: "HARD" })] }));
  await cmdProgress({ positionals: [], flags: { difficulty: "hard" } }, {
    cwd: dir, session: "s", out: (s) => out.push(s), warn: (s) => warnings.push(s), zh: true,
    callTool: async () => { throw new Error("net down"); },
  });
  assert.equal(warnings.length, 1, "stale 应告警");
  assert.match(warnings[0], /已使用过期缓存/);
  assert.match(out[0], /已解决 2 · 简单 1 · 中等 0 · 困难 1/);
  assert.match(out.join("\n"), /b/);
  assert.doesNotMatch(out.join("\n"), /`a`|(^|│ )a( │|$)/);
  const out2 = [];
  const dir3 = fakeRoot();
  await cmdProgress({ positionals: [], flags: { limit: "1", offset: "1" } }, {
    cwd: dir3, session: "s", out: (s) => out2.push(s), zh: true,
    callTool: async () => ({ questions: { totalNum: 2, questions: [PQ("a", "2026-01-01"), PQ("b", "2026-01-02")] } }),
  });
  assert.match(out2.join("\n"), /a/);
  assert.doesNotMatch(out2.join("\n"), /b/);
});

test("cmdList 传参并渲染结果", async () => {
  const captured = [];
  const out = [];
  await cmdList(
    { positionals: ["sum"], flags: { difficulty: "Easy", tags: "hash-table,array", limit: "5" } },
    {
      cwd: "/tmp",
      session: "s",
      out: (s) => out.push(s),
      warn: () => {},
      callTool: async (name, args, opts) => {
        captured.push({ name, args, session: opts.session });
        return { problems: { questions: [{ difficulty: "Easy", title: "Two Sum", titleSlug: "two-sum" }] } };
      },
    }
  );
  assert.equal(captured[0].name, "search_problems");
  assert.deepEqual(captured[0].args, { limit: 5, searchKeywords: "sum", difficulty: "EASY", tags: ["hash-table", "array"] });
  assert.equal(captured[0].session, "s");
  assert.match(out.at(-1), /two-sum/);
});

test("cmdList 默认 limit 为 20", async () => {
  let args;
  await cmdList({ positionals: [], flags: {} }, {
    cwd: "/tmp",
    session: "",
    out: () => {},
    callTool: async (n, a) => { args = a; return { problems: { questions: [] } }; },
  });
  assert.equal(args.limit, 20);
});

test("cmdList --limit 非法时报错，difficulty 大小写归一", async () => {
  await assert.rejects(
    cmdList({ positionals: [], flags: { limit: "abc" } }, { cwd: "/tmp", session: "", out: () => {}, callTool: async () => ({}) }),
    /--limit 需为正整数/
  );
  let args;
  await cmdList({ positionals: [], flags: { difficulty: "medium" } }, {
    cwd: "/tmp", session: "", out: () => {},
    callTool: async (n, a) => { args = a; return { problems: { questions: [] } }; },
  });
  assert.equal(args.difficulty, "MEDIUM");
});

test("cmdShow 生成代码文件并打印描述，二次调用跳过", async () => {
  const cwd = tmp();
  const out = [];
  const deps = {
    cwd,
    session: "",
    out: (s) => out.push(s),
    fetchTranslated: async () => null,
    callTool: async () => ({
      problem: {
        questionId: "1",
        content: "<p>Given an array.</p>",
        codeSnippets: [{ langSlug: "python3", code: "class Solution:\n    pass" }],
      },
    }),
  };
  await cmdShow({ positionals: ["two-sum"], flags: {} }, deps);
  const p = join(cwd, "solutions", "0001-two-sum", "python3", "solution.py");
  assert.match(readFileSync(p, "utf8"), /class Solution/);
  assert.match(out.join("\n"), /Given an array\./);

  const out2 = [];
  await cmdShow({ positionals: ["two-sum"], flags: {} }, { ...deps, out: (s) => out2.push(s) });
  assert.match(out2.join("\n"), /已存在，跳过/);
});

test("renderProblemHeader 生成注释头：标题+题面，空行也用注释符", () => {
  assert.equal(
    renderProblemHeader("两数之和", "给定一个数组。\n\n返回下标。", "#"),
    "# 两数之和\n#\n# 给定一个数组。\n#\n# 返回下标。\n\n"
  );
  assert.equal(renderProblemHeader(null, "只有题面。", "//"), "// 只有题面。\n\n");
  assert.equal(renderProblemHeader("Only Title", "", "#"), "# Only Title\n\n");
  assert.equal(renderProblemHeader(null, "", "#"), "");
});

test("cmdShow 生成文件顶部写入题目注释（中文优先，在代码之前）", async () => {
  const cwd = tmp();
  await cmdShow({ positionals: ["two-sum"], flags: {} }, {
    cwd, session: "", out: () => {},
    fetchTranslated: async () => ({ title: "两数之和", content: "<p>给定一个整数数组。</p>" }),
    callTool: async () => ({ problem: { questionId: "1", title: "Two Sum", content: "<p>Given an array.</p>", codeSnippets: [{ langSlug: "python3", code: "class Solution:\n    pass" }] } }),
  });
  const src = readFileSync(join(cwd, "solutions", "0001-two-sum", "python3", "solution.py"), "utf8");
  assert.match(src, /^# 两数之和\n/);
  assert.match(src, /# 给定一个整数数组。/);
  assert.doesNotMatch(src, /Two Sum/);
  assert.ok(src.indexOf("两数之和") < src.indexOf("class Solution"), "注释应在代码之前");
});

test("cmdShow 文件头部注释使用对应语言的注释符", async () => {
  const cwd = tmp();
  await cmdShow({ positionals: ["two-sum"], flags: { lang: "cpp" } }, {
    cwd, session: "", out: () => {},
    fetchTranslated: async () => null,
    callTool: async () => ({ problem: { questionId: "1", title: "Two Sum", content: "<p>Given an array.</p>", codeSnippets: [{ langSlug: "cpp", code: "class Solution {};" }] } }),
  });
  const src = readFileSync(join(cwd, "solutions", "0001-two-sum", "cpp", "solution.cpp"), "utf8");
  assert.match(src, /^\/\/ Two Sum\n/);
  assert.match(src, /\/\/ Given an array\./);
});

test("cmdShow 无题面且无标题时不写头部注释", async () => {
  const cwd = tmp();
  await cmdShow({ positionals: ["two-sum"], flags: {} }, {
    cwd, session: "", out: () => {},
    fetchTranslated: async () => null,
    callTool: async () => ({ problem: { questionId: "1", codeSnippets: [{ langSlug: "python3", code: "x" }] } }),
  });
  assert.equal(readFileSync(join(cwd, "solutions", "0001-two-sum", "python3", "solution.py"), "utf8"), "x\n");
});

test("cmdShow 未指定 --lang 时使用 .env 默认语言，--lang 可覆盖", async () => {
  const cwd = tmp();
  writeFileSync(join(cwd, ".env"), "DEFAULT_LANG=cpp\n");
  await cmdShow({ positionals: ["two-sum"], flags: {} }, {
    cwd, session: "", out: () => {},
    fetchTranslated: async () => null,
    callTool: async () => ({ problem: { questionId: "1", codeSnippets: [{ langSlug: "cpp", code: "x" }] } }),
  });
  assert.equal(readFileSync(join(cwd, "solutions", "0001-two-sum", "cpp", "solution.cpp"), "utf8"), "x\n");

  await cmdShow({ positionals: ["two-sum"], flags: { lang: "rust" } }, {
    cwd, session: "", out: () => {},
    fetchTranslated: async () => null,
    callTool: async () => ({ problem: { questionId: "1", codeSnippets: [{ langSlug: "rust", code: "fn f() {}" }] } }),
  });
  assert.equal(readFileSync(join(cwd, "solutions", "0001-two-sum", "rust", "solution.rs"), "utf8"), "fn f() {}\n");
});

test("cmdShow --force 覆盖已有文件", async () => {
  const cwd = tmp();
  const dir = join(cwd, "solutions", "0001-two-sum", "python3");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "solution.py"), "old");
  await cmdShow(
    { positionals: ["two-sum"], flags: { force: true } },
    {
      cwd, session: "", out: () => {},
      fetchTranslated: async () => null,
      callTool: async () => ({ problem: { questionId: "1", content: "<p>x</p>", codeSnippets: [{ langSlug: "python3", code: "new" }] } }),
    }
  );
  assert.equal(readFileSync(join(dir, "solution.py"), "utf8"), "# x\n\nnew\n");
});

test("cmdShow 无匹配 snippet 时写入空模板", async () => {
  const cwd = tmp();
  await cmdShow(
    { positionals: ["two-sum"], flags: { lang: "cpp" } },
    {
      cwd, session: "", out: () => {},
      fetchTranslated: async () => null,
      callTool: async () => ({ problem: { questionId: "1", content: "<p>x</p>", codeSnippets: [] } }),
    }
  );
  assert.equal(
    readFileSync(join(cwd, "solutions", "0001-two-sum", "cpp", "solution.cpp"), "utf8"),
    "// x\n\n// TODO: implement\n"
  );
});

test("formatVerdict 通过时显示击败百分比", () => {
  const out = formatVerdict({
    check: {
      status_msg: "Accepted", state: "SUCCESS", correct_answer: true,
      total_correct: 11513, total_testcases: 11513, elapsed_time: 99,
      status_memory: "18.9 MB",
      runtime_percentile: 24.1601, memory_percentile: 97.5676,
    },
  });
  assert.match(out, /99ms（击败 24\.2%）/);
  assert.match(out, /18\.9 MB（击败 97\.6%）/);
});

test("formatVerdict 百分位缺失或非数值时不显示击败", () => {
  const out = formatVerdict({
    check: { status_msg: "Accepted", state: "SUCCESS", elapsed_time: 50, status_memory: "10 MB", runtime_percentile: null },
  });
  assert.match(out, /50ms/);
  assert.doesNotMatch(out, /击败/);
});

test("语法错误优先打印 full_runtime_error 的完整内容", () => {
  const out = formatVerdict({
    check: {
      status_msg: "Runtime Error", state: "SUCCESS",
      runtime_error: "Line 8: SyntaxError: invalid syntax",
      full_runtime_error: "SyntaxError: invalid syntax\n                ^^\n    seen[num] = if\nLine 8  (Solution.py)",
      total_correct: 0, total_testcases: 65, status_memory: "N/A", memory: 13264000,
    },
  });
  assert.match(out, /seen\[num\] = if/, "应包含出错源码行");
  assert.match(out, /\^\^/, "应包含指示符");
  assert.match(out, /Line 8/);
  assert.match(out, /13\.3 MB/, "status_memory 为 N/A 时应回退用 memory 字节数");
  assert.doesNotMatch(out, /N\/A/);
});

test("编译错误读取 compile_error 字段", () => {
  const out = formatVerdict({
    check: { status_msg: "Compile Error", compile_error: "error: expected ';'", full_compile_error: "error: expected ';' at line 3\n  int x = 1" },
  });
  assert.match(out, /expected ';' at line 3/);
  assert.match(out, /int x = 1/);
});

test("多行失败输入对齐到值列", () => {
  const out = formatVerdict({
    check: {
      status_msg: "Wrong Answer", state: "FAILURE",
      last_testcase: "[2,7,11,15]\n9", expected_output: "[0,1]", std_output: "[1,2]",
    },
  });
  const lines = out.split("\n");
  const i = lines.findIndex((l) => l.includes("输入"));
  assert.match(lines[i + 1], /^\s+9$/, "续行应缩进对齐，而不是顶格");
});

test("cmdShow 优先展示中文标题与题面", async () => {
  const out = [];
  await cmdShow(
    { positionals: ["two-sum"], flags: {} },
    {
      cwd: tmp(), session: "", out: (s) => out.push(s),
      fetchTranslated: async () => ({ title: "两数之和", content: "<p>给定一个整数数组。</p>" }),
      callTool: async () => ({ problem: { questionId: "1", title: "Two Sum", content: "<p>Given an array.</p>", codeSnippets: [] } }),
    }
  );
  const text = out.join("\n");
  assert.match(text, /两数之和/);
  assert.match(text, /给定一个整数数组。/);
  assert.doesNotMatch(text, /Two Sum/);
});

test("cmdShow 中文不可用时回退英文", async () => {
  const out = [];
  await cmdShow(
    { positionals: ["two-sum"], flags: {} },
    {
      cwd: tmp(), session: "", out: (s) => out.push(s),
      fetchTranslated: async () => null,
      callTool: async () => ({ problem: { questionId: "1", title: "Two Sum", content: "<p>Given an array.</p>", codeSnippets: [] } }),
    }
  );
  const text = out.join("\n");
  assert.match(text, /Two Sum/);
  assert.match(text, /Given an array\./);
});

test("fetchTranslated 网络异常时返回 null，不抛错", async () => {
  const zh = await fetchTranslated("two-sum", { fetchImpl: async () => { throw new Error("boom"); } });
  assert.equal(zh, null);
  const zh2 = await fetchTranslated("two-sum", { fetchImpl: async () => ({ ok: false }) });
  assert.equal(zh2, null);
  const zh3 = await fetchTranslated("two-sum", {
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: { question: { translatedTitle: "两数之和", translatedContent: "<p>x</p>" } } }) }),
  });
  assert.deepEqual(zh3, { title: "两数之和", content: "<p>x</p>" });
});

test("cmdShow 缺少 questionId 时报错", async () => {
  await assert.rejects(
    cmdShow({ positionals: ["two-sum"], flags: {} }, {
      cwd: tmp(), session: "", out: () => {},
      fetchTranslated: async () => null,
      callTool: async () => ({ problem: { content: "<p>x</p>", codeSnippets: [] } }),
    }),
    /未返回 questionId/
  );
});

test("cmdShow/cmdRun 不支持的 --lang 抛错并列出支持项", async () => {
  await assert.rejects(
    cmdShow({ positionals: ["two-sum"], flags: { lang: "haskell" } }, { cwd: tmp(), session: "", out: () => {}, callTool: async () => ({}) }),
    /不支持的语言：haskell/
  );
  await assert.rejects(
    cmdRun({ positionals: ["two-sum"], flags: { lang: "haskell" } }, { cwd: tmp(), session: "s", out: () => {}, callTool: async () => ({}) }),
    /不支持的语言：haskell/
  );
});

test("cmdRun 未登录报错，已登录调用 run_code 且省略 dataInput", async () => {
  const cwd = tmp();
  const dir = join(cwd, "solutions", "0001-two-sum", "python3");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "solution.py"), "print(1)");

  await assert.rejects(
    cmdRun({ positionals: ["two-sum"], flags: {} }, { cwd, session: "", out: () => {}, callTool: async () => ({}) }),
    /需要登录/
  );

  const captured = [];
  await cmdRun(
    { positionals: ["two-sum"], flags: {} },
    { cwd, session: "s", out: () => {}, callTool: async (name, args, opts) => { captured.push({ name, args, opts }); return { ok: true }; } }
  );
  assert.equal(captured[0].name, "run_code");
  assert.equal(captured[0].opts.timeoutMs, 125000);
  assert.equal(captured[0].args.timeoutMs, 120000);
  assert.equal(captured[0].args.lang, "python3");
  assert.equal(captured[0].args.typedCode, "print(1)");
  assert.equal(captured[0].args.dataInput, undefined);
});

test("cmdRun 遇到 {raw} 时原样打印文本", async () => {
  const cwd = tmp();
  const dir = join(cwd, "solutions", "0001-two-sum", "python3");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "solution.py"), "print(1)");
  const out = [];
  await cmdRun(
    { positionals: ["two-sum"], flags: {} },
    { cwd, session: "s", out: (s) => out.push(s), callTool: async () => ({ raw: "Error: 未通过" }) }
  );
  assert.equal(out.at(-1), "Error: 未通过");
});

test("cmdRun --input 传入 dataInput", async () => {
  const cwd = tmp();
  const dir = join(cwd, "solutions", "0001-two-sum", "python3");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "solution.py"), "print(1)");
  let args;
  await cmdRun(
    { positionals: ["two-sum"], flags: { input: "1 2\n3" } },
    { cwd, session: "s", out: () => {}, callTool: async (n, a) => { args = a; return {}; } }
  );
  assert.equal(args.dataInput, "1 2\n3");
});

test("cmdRun/cmdSubmit --timeout 非法时报错", async () => {
  const cwd = tmp();
  const dir = join(cwd, "solutions", "0001-two-sum", "python3");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "solution.py"), "print(1)");
  const deps = { cwd, session: "s", out: () => {}, callTool: async () => ({}) };
  await assert.rejects(cmdRun({ positionals: ["two-sum"], flags: { timeout: "abc" } }, deps), /--timeout 需为正整数/);
  await assert.rejects(cmdRun({ positionals: ["two-sum"], flags: { timeout: "-1" } }, deps), /--timeout 需为正整数/);
  await assert.rejects(cmdSubmit({ positionals: ["two-sum"], flags: { timeout: "0" } }, deps), /--timeout 需为正整数/);
});

test("cmdRun/cmdSubmit 缺少 slug 时给出用法提示", async () => {
  const deps = { cwd: tmp(), session: "s", out: () => {}, callTool: async () => ({}) };
  await assert.rejects(cmdRun({ positionals: [], flags: {} }, deps), /用法：lc run <slug>/);
  await assert.rejects(cmdSubmit({ positionals: [], flags: {} }, deps), /用法：lc submit <slug>/);
});

test("cmdConfig 写入的 .env 权限为 0600", () => {
  const cwd = tmp();
  cmdConfig({ positionals: ["set", "session", "abcdefghijkl"] }, { cwd, out: () => {} });
  assert.equal(statSync(join(cwd, ".env")).mode & 0o777, 0o600);
});

test("cmdSubmit 调用 submit_solution", async () => {
  const cwd = tmp();
  const dir = join(cwd, "solutions", "0001-two-sum", "python3");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "solution.py"), "print(1)");
  const captured = [];
  await cmdSubmit(
    { positionals: ["two-sum"], flags: {} },
    { cwd, session: "s", out: () => {}, callTool: async (name, args) => { captured.push({ name, args }); return {}; } }
  );
  assert.equal(captured[0].name, "submit_solution");
  assert.equal(captured[0].args.titleSlug, "two-sum");
});

test("main 未登录时 list 仍可调用", async () => {
  const cwd = fakeRoot();
  const out = [];
  let called = null;
  await main(["list", "two"], {
    cwd,
    out: (s) => out.push(s),
    callTool: async (name) => { called = name; return { problems: { questions: [] } }; },
  });
  assert.equal(called, "search_problems");
  assert.match(out.at(-1), /无匹配题目/);
});

test("main 未知命令设置退出码", async () => {
  const errs = [];
  await main(["bogus"], { cwd: fakeRoot(), errOut: (s) => errs.push(s), out: () => {} });
  assert.equal(process.exitCode, 1);
  assert.match(errs.join("\n"), /未知命令/);
  process.exitCode = 0;
});

test("非项目根目录运行时拒绝执行并提示", async () => {
  const errs = [];
  const cwd = tmp();
  await main(["list"], { cwd, errOut: (s) => errs.push(s), out: () => {} });
  assert.equal(process.exitCode, 1);
  assert.match(errs.join("\n"), /不是 LittleLeetCodeCli 项目根目录/);
  assert.match(errs.join("\n"), /切换到项目根目录后再运行/);
  process.exitCode = 0;
});

test("CLI 经软链调用时仍能执行（npm link / 全局安装路径）", () => {
  const dir = tmp();
  const link = join(dir, "lc-link");
  symlinkSync(fileURLToPath(new URL("../bin/lc.mjs", import.meta.url)), link);
  const r = spawnSync(process.execPath, [link, "help"], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /lc <命令>/);
});

test("CLI 直接执行时打印帮助", () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("../bin/lc.mjs", import.meta.url)), "help"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /lc <命令>/);
});
