// 取数层（bin/api.js）的离线测试：全部通过注入 fetchImpl，不触网。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCookie, lcGraphql, searchProblems, fetchProblem, fetchQuestionId,
  fetchProgress, runCode, submitSolution, pollCheck,
} from "../bin/api.js";

const gqlResp = (data, { status = 200, headers } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: headers ?? new Map(),
  json: async () => ({ data }),
});

const jsonResp = (obj, { status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Map(),
  text: async () => (typeof obj === "string" ? obj : JSON.stringify(obj)),
});

/* --------------------------- 基础工具 --------------------------- */

test("buildCookie 为裸 JWT 补上 LEETCODE_SESSION 前缀", () => {
  assert.equal(buildCookie("JWT"), "LEETCODE_SESSION=JWT");
  assert.equal(buildCookie("LEETCODE_SESSION=ABC; csrftoken=XYZ"), "LEETCODE_SESSION=ABC; csrftoken=XYZ");
  assert.equal(buildCookie(""), "");
  assert.equal(buildCookie(undefined), "");
});

test("lcGraphql 从响应 set-cookie 里顺带取到 csrf", async () => {
  const fakeFetch = async () => gqlResp(
    { hello: "world" },
    { headers: new Map([["set-cookie", "aliyunf_tc=abc; Path=/, csrftoken=CSRF123; Domain=.leetcode.cn"]]) },
  );
  await lcGraphql("query { hello }", {}, { fetchImpl: fakeFetch, session: "T" });
  // csrf 已缓存，后续写操作会带上（通过 runCode 的 headers 断言）
  const seen = [];
  await runCode(
    { titleSlug: "two-sum", lang: "python3", typedCode: "x", timeoutMs: 1000, pollIntervalMs: 1 },
    {
      session: "TOK",
      fetchImpl: async (url, init) => {
        seen.push(init.headers);
        if (url.includes("/graphql/")) return gqlResp({ question: { questionId: "1" } });
        if (url.includes("interpret_solution")) return jsonResp({ interpret_id: "runcode_1" });
        return jsonResp({ state: "SUCCESS", status_msg: "Accepted" });
      },
    },
  );
  const postHeaders = seen.find((h) => h.cookie?.includes("csrftoken"));
  assert.ok(postHeaders, "写操作应带上缓存的 csrf");
  assert.match(postHeaders.cookie, /csrftoken=CSRF123/);
  assert.match(postHeaders.cookie, /LEETCODE_SESSION=TOK/);
});

test("lcGraphql 的 label 决定错误信息前缀", async () => {
  const fakeFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(
    () => lcGraphql("query { x }", {}, { fetchImpl: fakeFetch, label: "获取提交历史失败" }),
    /^Error: 获取提交历史失败：HTTP 503$/,
  );
});

/* --------------------------- 题目搜索 --------------------------- */

test("searchProblems 把筛选条件装进 GraphQL variables", async () => {
  let body = null;
  const fakeFetch = async (url, init) => {
    body = JSON.parse(init.body);
    return gqlResp({ problemsetQuestionList: { hasMore: false, total: 0, questions: [] } });
  };
  await searchProblems(
    { searchKeywords: "two sum", difficulty: "easy", tags: ["array"], limit: 10, offset: 20 },
    { fetchImpl: fakeFetch, session: "T" },
  );
  assert.equal(body.variables.limit, 10);
  assert.equal(body.variables.skip, 20);
  assert.deepEqual(body.variables.filters, {
    difficulty: "EASY", tags: ["array"], searchKeywords: "two sum",
  });
});

test("searchProblems 无条件时不带 filters 字段", async () => {
  let body = null;
  const fakeFetch = async (url, init) => {
    body = JSON.parse(init.body);
    return gqlResp({ problemsetQuestionList: { hasMore: false, total: 0, questions: [] } });
  };
  await searchProblems({}, { fetchImpl: fakeFetch });
  assert.deepEqual(body.variables.filters, {});
});

test("searchProblems 接口无数据时返回空列表而非抛错", async () => {
  const fakeFetch = async () => gqlResp({});
  const out = await searchProblems({}, { fetchImpl: fakeFetch });
  assert.deepEqual(out, { hasMore: false, total: 0, questions: [] });
});

test("searchProblems 归一化题目字段并保留 paidOnly", async () => {
  const fakeFetch = async () => gqlResp({
    problemsetQuestionList: {
      hasMore: true, total: 2,
      questions: [
        { titleSlug: "kill-process", paidOnly: true, topicTags: [{ slug: "tree" }] },
        { titleSlug: "combine-two-tables", topicTags: [{ slug: "database" }] },
      ],
    },
  });
  const out = await searchProblems({}, { fetchImpl: fakeFetch });
  assert.equal(out.total, 2);
  assert.equal(out.questions[0].paidOnly, true);
  assert.deepEqual(out.questions[0].topicTags, ["tree"]);
  assert.equal(out.questions[1].paidOnly, false);
  assert.deepEqual(out.questions[1].topicTags, ["database"]);
});

/* --------------------------- 题目详情 --------------------------- */

test("fetchProblem 归一化标签与代码模板", async () => {
  const fakeFetch = async () => gqlResp({
    question: {
      questionId: "1", title: "Two Sum", titleSlug: "two-sum",
      content: "<p>EN</p>", translatedTitle: "两数之和", translatedContent: "<p>中文</p>",
      difficulty: "EASY", exampleTestcases: "[]", hints: ["h"],
      similarQuestions: JSON.stringify([{ titleSlug: "3sum", difficulty: "MEDIUM" }, { titleSlug: "x", difficulty: "EASY" }]),
      topicTags: [{ slug: "array" }],
      codeSnippets: [{ langSlug: "python3", code: "c" }],
    },
  });
  const p = await fetchProblem("two-sum", { fetchImpl: fakeFetch });
  assert.equal(p.questionId, "1");
  assert.equal(p.translatedTitle, "两数之和");
  assert.deepEqual(p.topicTags, ["array"]);
  assert.deepEqual(p.codeSnippets, [{ langSlug: "python3", code: "c" }]);
  // similarQuestions 只取前 3 条
  assert.equal(p.similarQuestions.length, 2);
});

test("fetchProblem 的 similarQuestions 不是合法 JSON 时降级为空数组", async () => {
  const fakeFetch = async () => gqlResp({
    question: { questionId: "1", titleSlug: "two-sum", similarQuestions: "not-json" },
  });
  const p = await fetchProblem("two-sum", { fetchImpl: fakeFetch });
  assert.deepEqual(p.similarQuestions, []);
});

test("fetchProblem 查不到题目时抛错", async () => {
  const fakeFetch = async () => gqlResp({ question: null });
  await assert.rejects(() => fetchProblem("nope", { fetchImpl: fakeFetch }), /未找到题目：nope/);
});

test("fetchQuestionId 只取 questionId 字段", async () => {
  let body = null;
  const fakeFetch = async (url, init) => {
    body = JSON.parse(init.body);
    return gqlResp({ question: { questionId: 42 } });
  };
  assert.equal(await fetchQuestionId("two-sum", { fetchImpl: fakeFetch }), "42");
  assert.match(body.query, /questionId/);
  assert.doesNotMatch(body.query, /codeSnippets/);
});

/* --------------------------- 解题进度 --------------------------- */

test("fetchProgress 把 offset 转成 skip 并把难度包成数组", async () => {
  let body = null;
  const fakeFetch = async (url, init) => {
    body = JSON.parse(init.body);
    return gqlResp({ userProgressQuestionList: { totalNum: 3, questions: [] } });
  };
  const out = await fetchProgress(
    { offset: 100, limit: 100, questionStatus: "SOLVED", difficulty: "EASY" },
    { fetchImpl: fakeFetch },
  );
  assert.deepEqual(body.variables.filters, {
    skip: 100, limit: 100, questionStatus: "SOLVED", difficulty: ["EASY"],
  });
  assert.equal(out.totalNum, 3);
});

/* --------------------------- 判题轮询 --------------------------- */

test("pollCheck 在 PENDING 时持续轮询直到就绪", async () => {
  let n = 0;
  const fakeFetch = async () => {
    n++;
    return jsonResp(n < 3 ? { state: "PENDING" } : { state: "SUCCESS", status_msg: "Accepted" });
  };
  const out = await pollCheck("https://x/check/", {}, { fetchImpl: fakeFetch, timeoutMs: 5000, pollIntervalMs: 1 });
  assert.equal(n, 3);
  assert.equal(out.status_msg, "Accepted");
});

test("pollCheck 把 STARTED 也视为未就绪", async () => {
  let n = 0;
  const fakeFetch = async () => {
    n++;
    return jsonResp(n < 2 ? { state: "STARTED" } : { state: "SUCCESS" });
  };
  await pollCheck("https://x/check/", {}, { fetchImpl: fakeFetch, timeoutMs: 5000, pollIntervalMs: 1 });
  assert.equal(n, 2);
});

test("pollCheck 遇到 429 时退避后重试", async () => {
  let n = 0;
  const fakeFetch = async () => {
    n++;
    if (n === 1) return { ok: false, status: 429, headers: new Map([["retry-after", "0"]]), text: async () => "" };
    return jsonResp({ state: "SUCCESS" });
  };
  const out = await pollCheck("https://x/check/", {}, { fetchImpl: fakeFetch, timeoutMs: 5000, pollIntervalMs: 1 });
  assert.equal(n, 2);
  assert.equal(out.state, "SUCCESS");
});

test("pollCheck 超过 timeoutMs 时抛超时错误", async () => {
  const fakeFetch = async () => jsonResp({ state: "PENDING" });
  await assert.rejects(
    () => pollCheck("https://x/check/", {}, { fetchImpl: fakeFetch, timeoutMs: 20, pollIntervalMs: 1 }),
    /判题超时/,
  );
});

test("pollCheck 接口非 2xx 时抛错", async () => {
  const fakeFetch = async () => jsonResp("oops", { status: 500 });
  await assert.rejects(
    () => pollCheck("https://x/check/", {}, { fetchImpl: fakeFetch, timeoutMs: 1000 }),
    /查询判题结果失败：HTTP 500/,
  );
});

/* --------------------------- 运行 / 提交 --------------------------- */

test("runCode 先取 questionId 再 POST interpret_solution 并轮询", async () => {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, init });
    if (url.includes("/graphql/")) return gqlResp({ question: { questionId: "1" } });
    if (url.includes("interpret_solution")) return jsonResp({ interpret_id: "runcode_9" });
    return jsonResp({ state: "SUCCESS", status_msg: "Accepted", correct_answer: true });
  };
  const out = await runCode(
    { titleSlug: "two-sum", lang: "python3", typedCode: "code", dataInput: "1 2", timeoutMs: 5000, pollIntervalMs: 1 },
    { session: "TOK", fetchImpl: fakeFetch },
  );
  assert.equal(out.questionId, "1");
  assert.equal(out.start.interpret_id, "runcode_9");
  const post = seen.find((s) => s.url.includes("interpret_solution"));
  assert.equal(post.init.method, "POST");
  assert.deepEqual(JSON.parse(post.init.body), {
    data_input: "1 2", lang: "python3", question_id: "1", typed_code: "code",
  });
  assert.match(post.init.headers.referer, /problems\/two-sum\/$/);
});

test("runCode 允许直接传入 questionId 省掉一次查询", async () => {
  let gqlCalled = false;
  const fakeFetch = async (url) => {
    if (url.includes("/graphql/")) { gqlCalled = true; return gqlResp({}); }
    if (url.includes("interpret_solution")) return jsonResp({ interpret_id: "runcode_9" });
    return jsonResp({ state: "SUCCESS" });
  };
  const out = await runCode(
    { titleSlug: "two-sum", lang: "python3", typedCode: "code", questionId: "7", timeoutMs: 5000, pollIntervalMs: 1 },
    { session: "TOK", fetchImpl: fakeFetch },
  );
  assert.equal(gqlCalled, false);
  assert.equal(out.questionId, "7");
});

test("runCode 未返回 interpret_id 时抛错", async () => {
  const fakeFetch = async (url) => {
    if (url.includes("/graphql/")) return gqlResp({ question: { questionId: "1" } });
    return jsonResp({});
  };
  await assert.rejects(
    () => runCode({ titleSlug: "two-sum", lang: "python3", typedCode: "c" }, { session: "T", fetchImpl: fakeFetch }),
    /未返回 interpret_id/,
  );
});

test("submitSolution 未返回 submission_id 时抛错", async () => {
  const fakeFetch = async (url) => {
    if (url.includes("/graphql/")) return gqlResp({ question: { questionId: "1" } });
    return jsonResp({});
  };
  await assert.rejects(
    () => submitSolution({ titleSlug: "two-sum", lang: "python3", typedCode: "c" }, { session: "T", fetchImpl: fakeFetch }),
    /未返回 submission_id/,
  );
});

test("写操作失败时把接口返回的 error 带到异常信息里", async () => {
  const fakeFetch = async (url) => {
    if (url.includes("/graphql/")) return gqlResp({ question: { questionId: "1" } });
    return jsonResp({ error: "User is not authenticated" }, { status: 403 });
  };
  await assert.rejects(
    () => runCode({ titleSlug: "two-sum", lang: "python3", typedCode: "c" }, { session: "T", fetchImpl: fakeFetch }),
    /User is not authenticated/,
  );
});
