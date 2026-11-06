import { test } from "node:test";
import assert from "node:assert/strict";
import { lcGraphql, fetchSubmissionList } from "../bin/history.js";

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
