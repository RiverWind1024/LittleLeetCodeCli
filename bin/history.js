// 直连 leetcode.cn GraphQL 的取数层。
// 只读接口只需 LEETCODE_SESSION cookie，无需 csrf token（csrf 仅写操作需要）。

const GRAPHQL_URL = "https://leetcode.cn/graphql/";

function buildCookie(session) {
  const s = String(session ?? "").trim();
  if (!s) return "";
  return s.includes("LEETCODE_SESSION=") ? s : `LEETCODE_SESSION=${s}`;
}

export async function lcGraphql(query, variables, { fetchImpl = fetch, session = "", timeoutMs = 20000 } = {}) {
  const res = await fetchImpl(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      referer: "https://leetcode.cn/submissions/",
      cookie: buildCookie(session),
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`获取提交历史失败：HTTP ${res.status}`);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error("获取提交历史失败：接口返回非 JSON 内容");
  }
  if (json?.errors?.length) {
    throw new Error(`获取提交历史失败：${json.errors[0]?.message ?? "未知错误"}`);
  }
  if (!json?.data) throw new Error("获取提交历史失败：接口未返回预期数据");
  return json.data;
}

const SUBMISSION_LIST_QUERY = `query submissionList($offset: Int!, $limit: Int!, $questionSlug: String) {
  submissionList(offset: $offset, limit: $limit, questionSlug: $questionSlug) {
    hasNext
    submissions {
      id
      title
      status
      statusDisplay
      lang
      langName: langVerboseName
      runtime
      memory
      timestamp
      frontendId
      url
      isPending
    }
  }
}`;

export async function fetchSubmissionList(
  slug,
  { session = "", offset = 0, limit = 20, fetchImpl = fetch, timeoutMs = 20000 } = {},
) {
  const data = await lcGraphql(
    SUBMISSION_LIST_QUERY,
    { offset, limit, questionSlug: slug },
    { fetchImpl, session, timeoutMs },
  );
  const subs = data?.submissionList?.submissions ?? [];
  return subs.map((s) => ({
    id: String(s?.id ?? ""),
    title: s?.title ?? "",
    status: s?.status ?? "",
    statusDisplay: s?.statusDisplay ?? "",
    lang: s?.lang ?? "",
    langName: s?.langName ?? s?.lang ?? "",
    runtime: s?.runtime ?? "",
    memory: s?.memory ?? "",
    timestamp: s?.timestamp ?? "",
    frontendId: s?.frontendId ?? "",
    url: s?.url ?? "",
    isPending: s?.isPending ?? "",
  }));
}

const STATS_FIELDS = `id
      runtimePercentile
      memoryPercentile
      passedTestCaseCnt
      totalTestCaseCnt`;

export async function fetchSubmissionStats(ids, { session = "", fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const list = (ids ?? []).map((v) => String(v ?? "")).filter(Boolean);
  const stats = new Map();
  if (list.length === 0) return stats;
  const query = `query {\n${list
    .map((id, i) => `  s${i}: submissionDetail(submissionId: ${JSON.stringify(id)}) { ${STATS_FIELDS} }`)
    .join("\n")}\n}`;
  const data = await lcGraphql(query, {}, { fetchImpl, session, timeoutMs });
  list.forEach((id, i) => {
    const d = data?.[`s${i}`];
    if (!d) return;
    stats.set(id, {
      runtimePercentile: typeof d.runtimePercentile === "number" ? d.runtimePercentile : null,
      memoryPercentile: typeof d.memoryPercentile === "number" ? d.memoryPercentile : null,
      passedTestCaseCnt: d.passedTestCaseCnt ?? null,
      totalTestCaseCnt: d.totalTestCaseCnt ?? null,
    });
  });
  return stats;
}

// outputDetail 是 SubmissionNode 的字段，不是 SubmissionDetail 的直接字段，
// 必须通过 inline fragment 才能取到（否则接口报 Cannot query field "outputDetail"）。
const SUBMISSION_DETAIL_QUERY = `query submissionDetails($submissionId: ID!) {
  detail: submissionDetail(submissionId: $submissionId) {
    id
    code
    timestamp
    statusDisplay
    isMine
    runtime
    memory
    runtimePercentile
    memoryPercentile
    passedTestCaseCnt
    totalTestCaseCnt
    lang
    langVerboseName
    question {
      questionId
      titleSlug
    }
    ... on GeneralSubmissionNode {
      outputDetail {
        codeOutput
        expectedOutput
        input
        compileError
        runtimeError
        lastTestcase
      }
    }
    ... on ContestSubmissionNode {
      outputDetail {
        codeOutput
        expectedOutput
        input
        compileError
        runtimeError
        lastTestcase
      }
    }
  }
}`;

export async function fetchSubmissionDetail(id, { session = "", fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const data = await lcGraphql(
    SUBMISSION_DETAIL_QUERY,
    { submissionId: String(id) },
    { fetchImpl, session, timeoutMs },
  );
  const d = data?.detail;
  if (!d) return null;
  return {
    id: String(d.id ?? id),
    code: d.code ?? "",
    timestamp: d.timestamp ?? "",
    statusDisplay: d.statusDisplay ?? "",
    isMine: d.isMine ?? false,
    runtime: d.runtime ?? "",
    memory: d.memory ?? "",
    runtimePercentile: typeof d.runtimePercentile === "number" ? d.runtimePercentile : null,
    memoryPercentile: typeof d.memoryPercentile === "number" ? d.memoryPercentile : null,
    passedTestCaseCnt: d.passedTestCaseCnt ?? null,
    totalTestCaseCnt: d.totalTestCaseCnt ?? null,
    lang: d.lang ?? "",
    langName: d.langVerboseName ?? d.lang ?? "",
    question: d.question ?? null,
    outputDetail: d.outputDetail ?? null,
  };
}
