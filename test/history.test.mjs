import { test } from "node:test";
import assert from "node:assert/strict";
import { lcGraphql, fetchSubmissionList, fetchSubmissionStats, fetchSubmissionDetail } from "../bin/history.js";
import { submissionStatusLabel, formatTimestamp } from "../bin/render.js";

test("lcGraphql 带上 LEETCODE_SESSION cookie 并返回 data", async () => {
  const captured = {};
  const fakeFetch = async (url, init) => {
    captured.url = url;
    captured.headers = init.headers;
    captured.body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ data: { hello: "world" } }) };
  };
  const data = await lcGraphql("query { hello }", { a: 1 }, { fetchImpl: fakeFetch, session: "JWT_TOKEN" });
  assert.equal(captured.url, "https://leetcode.cn/graphql/");
  assert.equal(captured.headers.cookie, "LEETCODE_SESSION=JWT_TOKEN");
  assert.equal(captured.body.query, "query { hello }");
  assert.deepEqual(captured.body.variables, { a: 1 });
  assert.deepEqual(data, { hello: "world" });
});

test("lcGraphql session 已含 LEETCODE_SESSION= 时不重复拼接", async () => {
  const captured = {};
  const fakeFetch = async (url, init) => {
    captured.headers = init.headers;
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  };
  await lcGraphql("query { hello }", {}, { fetchImpl: fakeFetch, session: "LEETCODE_SESSION=ABC; csrftoken=XYZ" });
  assert.equal(captured.headers.cookie, "LEETCODE_SESSION=ABC; csrftoken=XYZ");
});

test("lcGraphql 接口返回 errors 时抛错并带原因", async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ errors: [{ message: "字段不存在" }] }),
  });
  await assert.rejects(
    () => lcGraphql("query { x }", {}, { fetchImpl: fakeFetch, session: "T" }),
    /获取提交历史失败.*字段不存在/,
  );
});

test("lcGraphql HTTP 非 2xx 时抛错", async () => {
  const fakeFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(
    () => lcGraphql("query { x }", {}, { fetchImpl: fakeFetch, session: "T" }),
    /获取提交历史失败.*HTTP 500/,
  );
});

test("lcGraphql 响应体非 JSON 时抛错", async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    json: async () => { throw new SyntaxError("Unexpected token <"); },
  });
  await assert.rejects(
    () => lcGraphql("query { x }", {}, { fetchImpl: fakeFetch, session: "T" }),
    /获取提交历史失败.*非 JSON/,
  );
});

test("lcGraphql 缺少 data 字段时抛错", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  await assert.rejects(
    () => lcGraphql("query { x }", {}, { fetchImpl: fakeFetch, session: "T" }),
    /获取提交历史失败.*未返回预期数据/,
  );
});

test("fetchSubmissionList 按 slug 查询并归一化字段", async () => {
  const captured = {};
  const fakeFetch = async (url, init) => {
    captured.body = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      json: async () => ({
        data: {
          submissionList: {
            hasNext: true,
            submissions: [{
              id: "754578653",
              title: "两数之和",
              status: "AC",
              statusDisplay: "Accepted",
              lang: "python3",
              langName: "Python3",
              runtime: "3 ms",
              memory: "20.3 MB",
              timestamp: "1791886149",
              frontendId: "19",
              url: "/problems/two-sum/submissions/754578653",
              isPending: "Not Pending",
            }],
          },
        },
      }),
    };
  };
  const list = await fetchSubmissionList("two-sum", { session: "T", offset: 20, limit: 10, fetchImpl: fakeFetch });
  assert.equal(captured.body.variables.questionSlug, "two-sum");
  assert.equal(captured.body.variables.offset, 20);
  assert.equal(captured.body.variables.limit, 10);
  assert.ok(captured.body.query.includes("submissionList"));
  assert.ok(captured.body.query.includes("questionSlug"));
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "754578653");
  assert.equal(list[0].title, "两数之和");
  assert.equal(list[0].status, "AC");
  assert.equal(list[0].statusDisplay, "Accepted");
  assert.equal(list[0].lang, "python3");
  assert.equal(list[0].langName, "Python3");
  assert.equal(list[0].runtime, "3 ms");
  assert.equal(list[0].memory, "20.3 MB");
  assert.equal(list[0].timestamp, "1791886149");
  assert.equal(list[0].frontendId, "19");
  assert.equal(list[0].url, "/problems/two-sum/submissions/754578653");
  assert.equal(list[0].isPending, "Not Pending");
});

test("fetchSubmissionList 缺 submissions 时返回空数组", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) });
  const list = await fetchSubmissionList("two-sum", { session: "T", fetchImpl: fakeFetch });
  assert.deepEqual(list, []);
});

test("fetchSubmissionStats 用别名一次查多条并返回 Map", async () => {
  const captured = {};
  const fakeFetch = async (url, init) => {
    captured.body = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      json: async () => ({
        data: {
          s0: { id: "1", runtimePercentile: 51.66, memoryPercentile: 40.87, passedTestCaseCnt: 65, totalTestCaseCnt: 65 },
          s1: { id: "2", runtimePercentile: 36.3, memoryPercentile: 58.44, passedTestCaseCnt: 64, totalTestCaseCnt: 65 },
        },
      }),
    };
  };
  const stats = await fetchSubmissionStats(["1", "2"], { session: "T", fetchImpl: fakeFetch });
  assert.ok(captured.body.query.includes('s0: submissionDetail(submissionId: "1")'));
  assert.ok(captured.body.query.includes('s1: submissionDetail(submissionId: "2")'));
  // 统计批次不选 code，避免响应体膨胀
  assert.ok(!captured.body.query.includes("code"));
  assert.equal(stats.size, 2);
  // 顺序与入参一致
  assert.deepEqual([...stats.keys()], ["1", "2"]);
  assert.equal(stats.get("1").runtimePercentile, 51.66);
  assert.equal(stats.get("1").memoryPercentile, 40.87);
  assert.equal(stats.get("1").passedTestCaseCnt, 65);
  assert.equal(stats.get("1").totalTestCaseCnt, 65);
  assert.equal(stats.get("2").runtimePercentile, 36.3);
});

test("fetchSubmissionStats 跳过无效 id 的 null 结果", async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ data: { s0: null, s1: { id: "2", runtimePercentile: 10 } } }),
  });
  const stats = await fetchSubmissionStats(["1", "2"], { session: "T", fetchImpl: fakeFetch });
  assert.equal(stats.size, 1);
  assert.ok(stats.has("2"));
  assert.ok(!stats.has("1"));
});

test("fetchSubmissionStats 空 id 列表不发请求", async () => {
  let called = false;
  const fakeFetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({ data: {} }) }; };
  const stats = await fetchSubmissionStats([], { session: "T", fetchImpl: fakeFetch });
  assert.equal(called, false);
  assert.equal(stats.size, 0);
});

test("fetchSubmissionDetail 返回源码与失败诊断", async () => {
  const captured = {};
  const fakeFetch = async (url, init) => {
    captured.body = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      json: async () => ({
        data: {
          detail: {
            id: "754578653",
            code: "class Solution:\n    pass\n",
            timestamp: 1791886149,
            statusDisplay: "Accepted",
            isMine: true,
            runtime: "3 ms",
            memory: "20.3 MB",
            runtimePercentile: 51.66,
            memoryPercentile: 40.87,
            passedTestCaseCnt: 65,
            totalTestCaseCnt: 65,
            lang: "python3",
            langVerboseName: "Python3",
            question: { questionId: "1", titleSlug: "two-sum" },
            outputDetail: {
              codeOutput: "", expectedOutput: "", input: "",
              compileError: "", runtimeError: "", lastTestcase: "",
            },
          },
        },
      }),
    };
  };
  const d = await fetchSubmissionDetail("754578653", { session: "T", fetchImpl: fakeFetch });
  assert.equal(captured.body.variables.submissionId, "754578653");
  assert.ok(captured.body.query.includes("code"));
  // outputDetail 是 SubmissionNode 的字段，必须用 inline fragment 才能取到
  assert.ok(captured.body.query.includes("... on GeneralSubmissionNode"));
  assert.equal(d.id, "754578653");
  assert.equal(d.code, "class Solution:\n    pass\n");
  assert.equal(d.statusDisplay, "Accepted");
  assert.equal(d.runtimePercentile, 51.66);
  assert.equal(d.passedTestCaseCnt, 65);
  assert.equal(d.langName, "Python3");
  assert.equal(d.question.titleSlug, "two-sum");
  assert.equal(d.outputDetail.runtimeError, "");
});

test("fetchSubmissionDetail 查不到时返回 null", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ data: { detail: null } }) });
  const d = await fetchSubmissionDetail("1", { session: "T", fetchImpl: fakeFetch });
  assert.equal(d, null);
});

test("submissionStatusLabel 映射已知状态", () => {
  assert.deepEqual(submissionStatusLabel("AC"), { cn: "通过", en: "Accepted", color: "green" });
  assert.equal(submissionStatusLabel("WA").color, "red");
  assert.equal(submissionStatusLabel("TLE").color, "yellow");
  assert.equal(submissionStatusLabel("RE").cn, "运行错误");
});

test("submissionStatusLabel 未知状态原样返回且为 dim", () => {
  const r = submissionStatusLabel("XX");
  assert.equal(r.cn, "XX");
  assert.equal(r.en, "XX");
  assert.equal(r.color, "dim");
});

test("formatTimestamp 秒级时间戳转本地时间", () => {
  const out = formatTimestamp("1791886149");
  assert.match(out, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  const d = new Date(1791886149 * 1000);
  assert.ok(out.startsWith(String(d.getFullYear())));
});

test("formatTimestamp 非法值原样返回", () => {
  assert.equal(formatTimestamp(""), "");
  assert.equal(formatTimestamp("abc"), "abc");
});
