import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lcGraphql, fetchSubmissionList, fetchSubmissionStats, fetchSubmissionDetail } from "../bin/history.js";
import { submissionStatusLabel, formatTimestamp, renderHistoryTable, renderSubmissionDetail } from "../bin/render.js";
import { cmdHistory, main } from "../bin/lc.mjs";

const fakeRoot = () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "little-leetcode-cli" }));
  return dir;
};

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

const HISTORY_ROW = {
  id: "754578653",
  title: "两数之和",
  status: "AC",
  statusDisplay: "Accepted",
  lang: "python3",
  langName: "Python3",
  runtime: "3 ms",
  memory: "20.3 MB",
  timestamp: "1791886149",
  runtimePercentile: 51.66,
  memoryPercentile: 40.87,
  passedTestCaseCnt: 65,
  totalTestCaseCnt: 65,
};

test("renderHistoryTable 中文表头与内容", () => {
  const out = renderHistoryTable([HISTORY_ROW], { zh: true });
  for (const h of ["提交时间", "状态", "语言", "耗时", "内存", "击败%", "用例", "ID"]) {
    assert.ok(out.includes(h), `缺少表头 ${h}`);
  }
  assert.ok(out.includes("通过"));
  assert.ok(out.includes("Python3"));
  assert.ok(out.includes("3 ms"));
  assert.ok(out.includes("20.3 MB"));
  assert.ok(out.includes("51.7%"));
  assert.ok(out.includes("65/65"));
  assert.ok(out.includes("754578653"));
});

test("renderHistoryTable 英文表头", () => {
  const out = renderHistoryTable([HISTORY_ROW], { zh: false });
  for (const h of ["TIME", "STATUS", "LANG", "RUNTIME", "MEMORY", "BEAT %", "CASES", "ID"]) {
    assert.ok(out.includes(h), `缺少表头 ${h}`);
  }
  assert.ok(out.includes("Accepted"));
});

test("renderHistoryTable 击败%为 0 时显示占位符", () => {
  const out = renderHistoryTable([{ ...HISTORY_ROW, runtimePercentile: 0 }], { zh: true });
  assert.ok(out.includes("—"));
  assert.ok(!out.includes("0.0%"));
});

test("renderHistoryTable 缺失统计字段时显示占位符", () => {
  const out = renderHistoryTable([{ id: "1", status: "RE", timestamp: "1791886149" }], { zh: true });
  assert.ok(out.includes("—"));
  assert.ok(out.includes("运行错误"));
});

test("renderHistoryTable 空列表返回空状态文案", () => {
  assert.equal(renderHistoryTable([], { zh: true }), "暂无提交记录");
  assert.equal(renderHistoryTable([], { zh: false }), "No submissions");
});

const DETAIL_FIXTURE = {
  id: "754578653",
  code: "class Solution:\n    def twoSum(self, nums):\n        return [0, 1]\n",
  timestamp: 1791886149,
  statusDisplay: "Accepted",
  runtime: "3 ms",
  memory: "20.3 MB",
  runtimePercentile: 51.66,
  memoryPercentile: 40.87,
  passedTestCaseCnt: 65,
  totalTestCaseCnt: 65,
  langName: "Python3",
  outputDetail: {
    codeOutput: "", expectedOutput: "", input: "",
    compileError: "", runtimeError: "", lastTestcase: "",
  },
};

test("renderSubmissionDetail 输出摘要与源码", () => {
  const out = renderSubmissionDetail(DETAIL_FIXTURE, { zh: true });
  assert.ok(out.includes("754578653"));
  assert.ok(out.includes("Accepted"));
  assert.ok(out.includes("Python3"));
  assert.ok(out.includes("3 ms"));
  assert.ok(out.includes("51.7%"));
  assert.ok(out.includes("40.9%"));
  assert.ok(out.includes("65/65"));
  assert.ok(out.includes("class Solution:"));
  assert.ok(out.includes("    def twoSum(self, nums):"));
  assert.ok(out.includes("源码"));
});

test("renderSubmissionDetail 失败时给出输入/期望/实际", () => {
  const out = renderSubmissionDetail({
    ...DETAIL_FIXTURE,
    statusDisplay: "Wrong Answer",
    passedTestCaseCnt: 3,
    outputDetail: {
      codeOutput: "[3]", expectedOutput: "[2]", input: "nums=[1,2], target=3",
      compileError: "", runtimeError: "", lastTestcase: "",
    },
  }, { zh: true });
  assert.ok(out.includes("首个失败用例"));
  assert.ok(out.includes("输入"));
  assert.ok(out.includes("期望"));
  assert.ok(out.includes("实际"));
  assert.ok(out.includes("[3]"));
  assert.ok(out.includes("[2]"));
});

test("renderSubmissionDetail 运行时错误单独标红输出", () => {
  const out = renderSubmissionDetail({
    ...DETAIL_FIXTURE,
    outputDetail: {
      codeOutput: "", expectedOutput: "", input: "",
      compileError: "", runtimeError: "IndexError: list index out of range", lastTestcase: "",
    },
  }, { zh: true });
  assert.ok(out.includes("IndexError: list index out of range"));
});

test("renderSubmissionDetail 英文模式使用英文标签", () => {
  const out = renderSubmissionDetail(DETAIL_FIXTURE, { zh: false });
  assert.ok(out.includes("Code"));
  assert.ok(out.includes("Language"));
});

test("cmdHistory 缺 slug 报用法", async () => {
  await assert.rejects(
    () => cmdHistory({ positionals: [], flags: {} }, { cwd: "/tmp", session: "T" }),
    /用法：lc history <slug>/,
  );
});

test("cmdHistory 未登录时报需要登录", async () => {
  await assert.rejects(
    () => cmdHistory({ positionals: ["two-sum"], flags: {} }, { cwd: "/tmp", session: "" }),
    /该操作需要登录/,
  );
});

test("cmdHistory 校验 limit 与 offset", async () => {
  const deps = { cwd: "/tmp", session: "T" };
  await assert.rejects(
    () => cmdHistory({ positionals: ["two-sum"], flags: { limit: "0" } }, deps),
    /--limit 需为正整数/,
  );
  await assert.rejects(
    () => cmdHistory({ positionals: ["two-sum"], flags: { limit: "abc" } }, deps),
    /--limit 需为正整数/,
  );
  await assert.rejects(
    () => cmdHistory({ positionals: ["two-sum"], flags: { limit: "101" } }, deps),
    /--limit 不能超过 100/,
  );
  await assert.rejects(
    () => cmdHistory({ positionals: ["two-sum"], flags: { offset: "-1" } }, deps),
    /--offset 需为非负整数/,
  );
});

test("cmdHistory 校验 --id 必须为数字", async () => {
  await assert.rejects(
    () => cmdHistory({ positionals: ["two-sum"], flags: { id: "abc" } }, { cwd: "/tmp", session: "T" }),
    /--id 需为数字提交 ID/,
  );
});

test("cmdHistory 先取列表再批量取统计并输出表格", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.query.includes("submissionList")) {
      return {
        ok: true, status: 200,
        json: async () => ({
          data: {
            submissionList: {
              hasNext: true,
              submissions: [
                { id: "1", status: "AC", statusDisplay: "Accepted", lang: "python3", langName: "Python3", runtime: "3 ms", memory: "20.3 MB", timestamp: "1791886149" },
                { id: "2", status: "WA", statusDisplay: "Wrong Answer", lang: "python3", langName: "Python3", runtime: "N/A", memory: "N/A", timestamp: "1791886100" },
              ],
            },
          },
        }),
      };
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        data: {
          s0: { id: "1", runtimePercentile: 51.66, memoryPercentile: 40.87, passedTestCaseCnt: 65, totalTestCaseCnt: 65 },
          s1: { id: "2", runtimePercentile: 0, memoryPercentile: 0, passedTestCaseCnt: 0, totalTestCaseCnt: 65 },
        },
      }),
    };
  };
  const out = [];
  await cmdHistory(
    { positionals: ["two-sum"], flags: {} },
    { cwd: "/tmp", session: "T", fetchImpl: fakeFetch, out: (s) => out.push(s), zh: true },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].variables.questionSlug, "two-sum");
  assert.ok(calls[1].query.includes('s0: submissionDetail(submissionId: "1")'));
  assert.ok(calls[1].query.includes('s1: submissionDetail(submissionId: "2")'));
  const text = out.join("\n");
  assert.ok(text.includes("65/65"));
  assert.ok(text.includes("0/65"));
  assert.ok(text.includes("51.7%"));
});

test("cmdHistory 列表为空时提示 Cookie 可能过期", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ data: { submissionList: { hasNext: false, submissions: [] } } }) });
  const out = [];
  const warns = [];
  await cmdHistory(
    { positionals: ["two-sum"], flags: {} },
    { cwd: "/tmp", session: "T", fetchImpl: fakeFetch, out: (s) => out.push(s), warn: (s) => warns.push(s), zh: true },
  );
  assert.ok(out.join("\n").includes("未查到"));
  assert.ok(warns.join("\n").includes("Cookie"));
});

test("cmdHistory --id 输出单次详情", async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({
      data: {
        detail: {
          id: "754578653",
          code: "class Solution:\n    pass\n",
          timestamp: 1791886149,
          statusDisplay: "Accepted",
          runtime: "3 ms",
          memory: "20.3 MB",
          runtimePercentile: 51.66,
          memoryPercentile: 40.87,
          passedTestCaseCnt: 65,
          totalTestCaseCnt: 65,
          lang: "python3",
          langVerboseName: "Python3",
          outputDetail: { codeOutput: "", expectedOutput: "", input: "", compileError: "", runtimeError: "", lastTestcase: "" },
        },
      },
    }),
  });
  const out = [];
  await cmdHistory(
    { positionals: ["two-sum"], flags: { id: "754578653" } },
    { cwd: "/tmp", session: "T", fetchImpl: fakeFetch, out: (s) => out.push(s), zh: true },
  );
  const text = out.join("\n");
  assert.ok(text.includes("754578653"));
  assert.ok(text.includes("class Solution:"));
});

test("main: lc history --help 打印该命令用法且不调用接口", async () => {
  const out = [];
  await main(["history", "--help"], {
    cwd: fakeRoot(),
    out: (s) => out.push(s),
    errOut: () => {},
    zh: true,
  });
  assert.match(out.join("\n"), /用法：lc history <slug>/);
});

test("main: lc history 走 cmdHistory 分支", async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ data: { submissionList: { hasNext: false, submissions: [] } } }),
  });
  const out = [];
  const warns = [];
  await main(["history", "two-sum"], {
    cwd: fakeRoot(),
    out: (s) => out.push(s),
    errOut: () => {},
    warn: (s) => warns.push(s),
    fetchImpl: fakeFetch,
    session: "T",
    zh: true,
  });
  assert.ok(out.join("\n").includes("未查到"));
});

test("main: lc help 总览列出 history 命令", async () => {
  const out = [];
  await main(["help"], {
    cwd: fakeRoot(),
    out: (s) => out.push(s),
    errOut: () => {},
    zh: true,
  });
  assert.match(out.join("\n"), /lc history <slug>/);
});

test("renderSubmissionDetail 标签与值按显示宽度对齐", () => {
  const valueCol = (line, label) => {
    const tail = line.slice(line.indexOf(label) + label.length);
    return line.indexOf(tail.trim());
  };
  for (const zh of [true, false]) {
    const out = renderSubmissionDetail(DETAIL_FIXTURE, { zh });
    const L = zh
      ? { time: "时间", lang: "语言", runtime: "耗时", memory: "内存", cases: "用例" }
      : { time: "Time", lang: "Language", runtime: "Runtime", memory: "Memory", cases: "Cases" };
    const cols = Object.values(L).map((label) => {
      const line = out.split("\n").find((l) => l.includes(label));
      return valueCol(line, label);
    });
    assert.equal(new Set(cols).size, 1, `zh=${zh} 时值未对齐：${cols.join(",")}`);
  }
});
