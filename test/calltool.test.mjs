// callTool 是一层内部门面：把旧的 MCP tool 名与返回形状映射到直连实现。
// 这里验证「映射关系」，底层请求细节由 test/api.test.mjs 覆盖。
import { test } from "node:test";
import assert from "node:assert/strict";
import { callTool } from "../bin/api.js";

const gqlResp = (data) => ({
  ok: true,
  status: 200,
  headers: new Map(),
  json: async () => ({ data }),
});

test("callTool search_problems 返回 filters/pagination/problems 结构", async () => {
  const fakeFetch = async () => gqlResp({
    problemsetQuestionList: {
      hasMore: true,
      total: 2,
      questions: [
        { title: "Two Sum", titleCn: "两数之和", titleSlug: "two-sum", difficulty: "EASY", acRate: 0.5, topicTags: [{ slug: "array" }] },
        { title: "Three Sum", titleCn: "三数之和", titleSlug: "3sum", difficulty: "MEDIUM", acRate: 0.3, topicTags: [] },
      ],
    },
  });
  const out = await callTool(
    "search_problems",
    { searchKeywords: "sum", difficulty: "EASY", limit: 20, offset: 0 },
    { session: "TOK", fetchImpl: fakeFetch },
  );
  assert.deepEqual(out.filters, { tags: undefined, difficulty: "EASY", searchKeywords: "sum" });
  assert.deepEqual(out.pagination, { limit: 20, offset: 0 });
  assert.equal(out.problems.total, 2);
  assert.equal(out.problems.hasMore, true);
  assert.deepEqual(out.problems.questions[0], {
    title: "Two Sum", titleCn: "两数之和", titleSlug: "two-sum", difficulty: "EASY", acRate: 0.5, paidOnly: false, topicTags: ["array"],
  });
  // topicTags 归一化成 slug 字符串数组
  assert.deepEqual(out.problems.questions[1].topicTags, []);
});

test("callTool get_problem 返回 titleSlug/problem 结构且含中英题面", async () => {
  const fakeFetch = async () => gqlResp({
    question: {
      questionId: "1",
      title: "Two Sum",
      titleSlug: "two-sum",
      content: "<p>EN</p>",
      translatedTitle: "两数之和",
      translatedContent: "<p>中文</p>",
      difficulty: "EASY",
      exampleTestcases: "[2,7,11,15]\n9",
      hints: ["h1"],
      similarQuestions: JSON.stringify([{ titleSlug: "3sum", difficulty: "MEDIUM" }]),
      topicTags: [{ slug: "array" }, { slug: "hash-table" }],
      codeSnippets: [
        { langSlug: "python3", code: "class Solution: pass" },
        { langSlug: "rust", code: "fn f() {}" },
      ],
    },
  });
  const out = await callTool("get_problem", { titleSlug: "two-sum" }, { session: "TOK", fetchImpl: fakeFetch });
  assert.equal(out.titleSlug, "two-sum");
  assert.equal(out.problem.questionId, "1");
  assert.equal(out.problem.translatedTitle, "两数之和");
  assert.equal(out.problem.translatedContent, "<p>中文</p>");
  assert.deepEqual(out.problem.topicTags, ["array", "hash-table"]);
  assert.equal(out.problem.codeSnippets.length, 2, "直连可拿到全部语言的模板，不做裁剪");
  assert.deepEqual(out.problem.similarQuestions, [{ titleSlug: "3sum", difficulty: "MEDIUM" }]);
});

test("callTool get_problem_progress 返回 filters/questions 结构", async () => {
  const fakeFetch = async () => gqlResp({
    userProgressQuestionList: {
      totalNum: 1,
      questions: [{ titleSlug: "two-sum", frontendId: "1", difficulty: "EASY", numSubmitted: 2 }],
    },
  });
  const out = await callTool(
    "get_problem_progress",
    { offset: 0, limit: 100, questionStatus: "SOLVED" },
    { session: "TOK", fetchImpl: fakeFetch },
  );
  assert.deepEqual(out.filters, { offset: 0, limit: 100, questionStatus: "SOLVED", difficulty: undefined });
  assert.equal(out.questions.totalNum, 1);
  assert.equal(out.questions.questions[0].titleSlug, "two-sum");
});

test("callTool run_code 返回 start/checkUrl/check 结构", async () => {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes("/graphql/")) return gqlResp({ question: { questionId: "1" } });
    if (url.includes("interpret_solution")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ interpret_id: "runcode_1" }) };
    }
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ state: "SUCCESS", status_msg: "Accepted", correct_answer: true }),
    };
  };
  const out = await callTool(
    "run_code",
    { titleSlug: "two-sum", lang: "python3", typedCode: "class Solution: pass", timeoutMs: 5000, pollIntervalMs: 1 },
    { session: "TOK", fetchImpl: fakeFetch },
  );
  assert.equal(out.titleSlug, "two-sum");
  assert.equal(out.questionId, "1");
  assert.equal(out.start.interpret_id, "runcode_1");
  assert.match(out.checkUrl, /submissions\/detail\/runcode_1\/check\/$/);
  assert.equal(out.check.status_msg, "Accepted");

  const post = seen.find((s) => s.url.includes("interpret_solution"));
  assert.equal(post.method, "POST");
  assert.deepEqual(post.body, {
    data_input: "", lang: "python3", question_id: "1", typed_code: "class Solution: pass",
  });
});

test("callTool submit_solution 返回 submission_id 与判题结果", async () => {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes("/graphql/")) return gqlResp({ question: { questionId: "42" } });
    if (url.includes("/submit/")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ submission_id: 1886375866 }) };
    }
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ state: "SUCCESS", status_msg: "Wrong Answer", correct_answer: false }),
    };
  };
  const out = await callTool(
    "submit_solution",
    { titleSlug: "two-sum", lang: "python3", typedCode: "class Solution: pass", timeoutMs: 5000, pollIntervalMs: 1 },
    { session: "TOK", fetchImpl: fakeFetch },
  );
  assert.equal(out.start.submission_id, 1886375866);
  assert.match(out.checkUrl, /submissions\/detail\/1886375866\/check\/$/);
  assert.equal(out.check.correct_answer, false);

  const post = seen.find((s) => s.url.includes("/submit/"));
  assert.equal(post.method, "POST");
  // submit 不带 data_input
  assert.deepEqual(post.body, { lang: "python3", question_id: "42", typed_code: "class Solution: pass" });
});

test("callTool 未知工具名时抛错", async () => {
  await assert.rejects(
    () => callTool("no_such_tool", {}, { session: "TOK" }),
    /未知的工具/,
  );
});
