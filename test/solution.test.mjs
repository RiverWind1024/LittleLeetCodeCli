// 题解展示：Markdown 渲染与 lc solution 命令的离线测试（不触网）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStyle } from "../bin/utils.js";
import {
  renderMarkdown, renderSolutionArticle, renderSolutionList, solutionCodeLang,
} from "../bin/render.js";
import { cmdSolution } from "../bin/lc.mjs";

const plain = createStyle(false);
const tmp = () => mkdtempSync(join(tmpdir(), "lc-sol-"));

const MD = [
  "### 方法一：哈希表",
  "",
  "**思路**：用 `map` 查表，时间复杂度 $O(n)$。",
  "",
  "![示意图](https://pic.leetcode.cn/a.png)",
  "",
  "```Python [sol1-Python3]",
  "print(1)",
  "```",
  "",
  "```Java [sol1-Java]",
  "System.out.println(1);",
  "```",
  "",
  "```",
  "no-language block",
  "```",
].join("\n");

const ARTICLES = [
  { slug: "official-solution", title: "官方题解", author: "LeetCode-Solution", isOfficial: true, upvoteCount: 4443, createdAt: "2020-10-02T00:00:00+00:00" },
  { slug: "community-solution", title: "社区题解", author: "someone", isOfficial: false, upvoteCount: 100, createdAt: "2021-01-01T00:00:00+00:00" },
];

const articleOf = (slug) => ({
  slug,
  title: slug === "official-solution" ? "官方题解" : "社区题解",
  content: "```Python\nprint(1)\n```\n\n正文",
  author: slug === "official-solution" ? "LeetCode-Solution" : "someone",
  isOfficial: slug === "official-solution",
  upvoteCount: 1,
  createdAt: "2020-10-02T00:00:00+00:00",
});

const gqlOk = (data) => ({
  ok: true,
  status: 200,
  headers: new Map(),
  json: async () => ({ data }),
});

/* --------------------------- 代码块语言判定 --------------------------- */

test("solutionCodeLang 归一化题解的代码块语言标记", () => {
  assert.equal(solutionCodeLang("Python [sol1-Python3]"), "python3");
  assert.equal(solutionCodeLang("python"), "python3");
  assert.equal(solutionCodeLang("C++ [sol1-C++]"), "cpp");
  assert.equal(solutionCodeLang("golang"), "golang");
  assert.equal(solutionCodeLang("C"), "c");
  assert.equal(solutionCodeLang(""), "");
  assert.equal(solutionCodeLang("bash"), "unknown", "未收录的语言按 unknown 处理");
});

/* --------------------------- Markdown 渲染 --------------------------- */

test("renderMarkdown 只保留 --lang 对应和无语言标记的代码块", () => {
  const py = renderMarkdown(MD, { style: plain, lang: "python3", zh: true });
  assert.match(py, /print\(1\)/);
  assert.match(py, /no-language block/, "无语言标记的块始终保留");
  assert.doesNotMatch(py, /System\.out/);
  assert.match(py, /已隐藏 1 个其他语言的代码块/);

  const java = renderMarkdown(MD, { style: plain, lang: "java", zh: true });
  assert.match(java, /System\.out/);
  assert.doesNotMatch(java, /print\(1\)/);
});

test("renderMarkdown 不传 lang 时保留全部代码块", () => {
  const all = renderMarkdown(MD, { style: plain, zh: true });
  assert.match(all, /print\(1\)/);
  assert.match(all, /System\.out/);
  assert.doesNotMatch(all, /已隐藏/);
});

test("renderMarkdown 处理标题、粗体、行内代码、LaTeX 与图片", () => {
  const text = renderMarkdown(MD, { style: plain, lang: "python3", zh: true });
  assert.match(text, /^方法一：哈希表$/m, "标题去掉 #");
  assert.doesNotMatch(text, /\*\*/, "粗体标记被去掉");
  assert.match(text, /思路：用 `map` 查表，时间复杂度 O\(n\)/, "行内代码与 $...$ 保留可读形式");
  assert.match(text, /\[图\] https:\/\/pic\.leetcode\.cn\/a\.png/);
});

test("renderMarkdown 无语言标记的未收录语言（如 SQL）照常显示", () => {
  const text = renderMarkdown("```sql\nselect 1;\n```", { style: plain, lang: "python3", zh: true });
  assert.match(text, /select 1;/);
  assert.doesNotMatch(text, /已隐藏/);
});

test("renderSolutionList 表格标出官方题解", () => {
  const table = renderSolutionList(ARTICLES, { style: plain, zh: true });
  assert.match(table, /官方/);
  assert.match(table, /LeetCode-Solution/);
  assert.match(table, /社区题解/);
  assert.match(table, /4443/);
});

test("renderSolutionArticle 头部带官方标记、作者、赞数与网页链接", () => {
  const text = renderSolutionArticle(articleOf("official-solution"), {
    style: plain, zh: true, lang: "python3", titleSlug: "two-sum",
  });
  assert.match(text, /官方题解 {2}官方题解/);
  assert.match(text, /LeetCode-Solution · 👍 1/);
  assert.match(text, /https:\/\/leetcode\.cn\/problems\/two-sum\/solution\/official-solution\//);
  assert.match(text, /print\(1\)/);
});

/* --------------------------- lc solution 命令 --------------------------- */

function makeDeps(over = {}) {
  const out = [];
  const calls = [];
  const callTool = async (name, args) => {
    calls.push([name, args]);
    if (name === "list_problem_solutions") {
      return { total: ARTICLES.length, articles: ARTICLES.slice(0, args.limit ?? 20) };
    }
    if (name === "get_problem_solution") return articleOf(args.slug);
    throw new Error(`unexpected tool: ${name}`);
  };
  return {
    deps: {
      cwd: tmp(), session: "", zh: true, out: (s) => out.push(s), style: plain, callTool, calls,
      fetchImpl: async () => gqlOk({ question: { questionId: "1" } }),
      ...over,
    },
    out,
    calls,
  };
}

test("cmdSolution 默认打印官方题解全文", async () => {
  const { deps, out } = makeDeps();
  await cmdSolution({ positionals: ["two-sum"], flags: {} }, deps);
  const text = out.join("\n");
  assert.match(text, /官方题解 {2}官方题解/);
  assert.match(text, /print\(1\)/);
});

test("cmdSolution --list 输出题解表格", async () => {
  const { deps, out, calls } = makeDeps();
  await cmdSolution({ positionals: ["two-sum"], flags: { list: true, limit: "2" } }, deps);
  assert.match(out.join("\n"), /社区题解/);
  assert.equal(calls[0][1].limit, 2);
});

test("cmdSolution --id 按序号取题解", async () => {
  const { deps, out, calls } = makeDeps();
  await cmdSolution({ positionals: ["two-sum"], flags: { id: "2" } }, deps);
  assert.match(out.join("\n"), /社区题解 {2}社区题解/);
  assert.deepEqual(calls.map(([n]) => n), ["list_problem_solutions", "get_problem_solution"]);
  assert.equal(calls[1][1].slug, "community-solution");
});

test("cmdSolution --id 可直接给题解 slug", async () => {
  const { deps, out, calls } = makeDeps();
  await cmdSolution({ positionals: ["two-sum"], flags: { id: "community-solution" } }, deps);
  assert.match(out.join("\n"), /社区题解/);
  assert.deepEqual(calls.map(([n]) => n), ["get_problem_solution"]);
});

test("cmdSolution --raw 输出原始 Markdown", async () => {
  const { deps, out } = makeDeps();
  await cmdSolution({ positionals: ["two-sum"], flags: { raw: true } }, deps);
  assert.match(out.join("\n"), /```Python/);
});

test("cmdSolution 题目 slug 不存在时报错", async () => {
  const { deps } = makeDeps({
    callTool: async () => ({ total: 0, articles: [] }),
    fetchImpl: async () => ({ ok: true, status: 200, headers: new Map(), json: async () => ({ data: { question: null } }) }),
  });
  await assert.rejects(
    cmdSolution({ positionals: ["no-such-problem"], flags: {} }, deps),
    /未找到题目/,
  );
});

test("cmdSolution 题目存在但无题解时给出提示", async () => {
  const { deps, out } = makeDeps({ callTool: async () => ({ total: 0, articles: [] }) });
  await cmdSolution({ positionals: ["two-sum"], flags: {} }, deps);
  assert.match(out.join("\n"), /该题暂无题解/);
});

test("cmdSolution 参数校验：缺少 slug、--limit 非法、--lang 不支持", async () => {
  const { deps } = makeDeps();
  await assert.rejects(cmdSolution({ positionals: [], flags: {} }, deps), /用法：lc solution/);
  await assert.rejects(cmdSolution({ positionals: ["two-sum"], flags: { limit: "0" } }, deps), /--limit 需为正整数/);
  await assert.rejects(cmdSolution({ positionals: ["two-sum"], flags: { lang: "brainfuck" } }, deps), /不支持的语言/);
  await assert.rejects(cmdSolution({ positionals: ["two-sum"], flags: { id: "0" } }, deps), /--id 需从 1 开始/);
});
