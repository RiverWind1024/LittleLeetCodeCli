// bin/api.js —— 直连 leetcode.cn 的取数层（只用 Node 内置 fetch，零第三方依赖）
//
// 接口分两类：
//   - 只读（题目 / 搜索 / 进度 / 提交历史）→ GraphQL POST https://leetcode.cn/graphql/
//   - 写操作（运行 / 提交判题）→ REST POST + 轮询 /submissions/detail/<id>/check/
//
// 认证：只读 GraphQL 只需 cookie: LEETCODE_SESSION=<jwt>（实测无需 csrf）。
// 写操作同样以 session 为准；csrf 从任意 GraphQL 响应的 set-cookie 里顺带取得，
// 零额外请求，作为双保险一并带上。

const GRAPHQL_URL = "https://leetcode.cn/graphql/";
const ORIGIN = "https://leetcode.cn";

// 进程内缓存 csrf：leetcode.cn 每次 GraphQL 响应都会在 set-cookie 里回带一个新值，
// 写操作前若已做过 GraphQL 查询（取 questionId 等）就已顺带拿到，无需额外请求。
let csrfToken = "";

export function buildCookie(session) {
  const s = String(session ?? "").trim();
  if (!s) return "";
  return s.includes("LEETCODE_SESSION=") ? s : `LEETCODE_SESSION=${s}`;
}

// 从响应 set-cookie 中提取 csrftoken
function harvestCsrf(headers) {
  const raw = headers?.get?.("set-cookie");
  if (!raw) return "";
  return /csrftoken=([^;]+)/.exec(raw)?.[1] ?? "";
}

// 只读 GraphQL 请求。fetchImpl 可注入，便于离线测试。
// label 用于拼出贴合场景的错误信息（如「获取提交历史失败：HTTP 500」）。
export async function lcGraphql(
  query,
  variables,
  { fetchImpl = fetch, session = "", timeoutMs = 20000, label = "请求 leetcode.cn 失败" } = {},
) {
  const res = await fetchImpl(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      referer: `${ORIGIN}/submissions/`,
      cookie: buildCookie(session),
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const csrf = harvestCsrf(res.headers);
  if (csrf) csrfToken = csrf;
  if (!res.ok) throw new Error(`${label}：HTTP ${res.status}`);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`${label}：接口返回非 JSON 内容`);
  }
  if (json?.errors?.length) {
    throw new Error(`${label}：${json.errors[0]?.message ?? "未知错误"}`);
  }
  if (!json?.data) throw new Error(`${label}：接口未返回预期数据`);
  return json.data;
}

/* ============================ 题目搜索 ============================ */

const SEARCH_PROBLEMS_QUERY = `query problemsetQuestionList(
  $categorySlug: String
  $limit: Int
  $skip: Int
  $filters: QuestionListFilterInput
) {
  problemsetQuestionList(
    categorySlug: $categorySlug
    limit: $limit
    skip: $skip
    filters: $filters
  ) {
    hasMore
    total
    questions {
      title
      titleCn
      titleSlug
      difficulty
      acRate
      topicTags { slug }
    }
  }
}`;

export async function searchProblems(
  { searchKeywords, difficulty, tags, limit = 20, offset = 0 } = {},
  { fetchImpl = fetch, session = "", timeoutMs = 20000 } = {},
) {
  const filters = {};
  if (difficulty) filters.difficulty = String(difficulty).toUpperCase();
  if (Array.isArray(tags) && tags.length) filters.tags = tags;
  if (searchKeywords) filters.searchKeywords = searchKeywords;
  const data = await lcGraphql(
    SEARCH_PROBLEMS_QUERY,
    { categorySlug: null, limit, skip: offset, filters },
    { fetchImpl, session, timeoutMs },
  );
  const list = data?.problemsetQuestionList;
  if (!list) return { hasMore: false, total: 0, questions: [] };
  return {
    hasMore: list.hasMore ?? false,
    total: list.total ?? 0,
    questions: (list.questions ?? []).map((q) => ({
      title: q?.title ?? "",
      titleCn: q?.titleCn ?? "",
      titleSlug: q?.titleSlug ?? "",
      difficulty: q?.difficulty ?? "",
      acRate: q?.acRate ?? null,
      topicTags: (q?.topicTags ?? []).map((t) => t?.slug).filter(Boolean),
    })),
  };
}

/* ============================ 题目详情 ============================ */

// 直连一次即可拿到中英双语题面与全部语言的代码模板，
// 不需要像以前那样再单独发一次请求取中文题面。
const PROBLEM_QUERY = `query ($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    title
    titleSlug
    content
    translatedTitle
    translatedContent
    difficulty
    exampleTestcases
    hints
    similarQuestions
    topicTags { slug }
    codeSnippets { langSlug code }
  }
}`;

export async function fetchProblem(titleSlug, { fetchImpl = fetch, session = "", timeoutMs = 20000 } = {}) {
  const data = await lcGraphql(PROBLEM_QUERY, { titleSlug }, { fetchImpl, session, timeoutMs });
  const q = data?.question;
  if (!q) throw new Error(`未找到题目：${titleSlug}`);
  let similarQuestions = [];
  if (q.similarQuestions) {
    try {
      similarQuestions = JSON.parse(q.similarQuestions)
        .slice(0, 3)
        .map((x) => ({ titleSlug: x?.titleSlug ?? "", difficulty: x?.difficulty ?? "" }));
    } catch {
      similarQuestions = [];
    }
  }
  return {
    titleSlug: q.titleSlug ?? titleSlug,
    questionId: q.questionId ?? "",
    title: q.title ?? "",
    content: q.content ?? "",
    translatedTitle: q.translatedTitle ?? "",
    translatedContent: q.translatedContent ?? "",
    difficulty: q.difficulty ?? "",
    exampleTestcases: q.exampleTestcases ?? "",
    hints: q.hints ?? [],
    similarQuestions,
    topicTags: (q.topicTags ?? []).map((t) => t?.slug).filter(Boolean),
    codeSnippets: (q.codeSnippets ?? []).map((s) => ({ langSlug: s?.langSlug ?? "", code: s?.code ?? "" })),
  };
}

// 只需要 questionId 时用这个，省掉拉整份题面的开销
export async function fetchQuestionId(titleSlug, { fetchImpl = fetch, session = "", timeoutMs = 20000 } = {}) {
  const data = await lcGraphql(
    `query ($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId } }`,
    { titleSlug },
    { fetchImpl, session, timeoutMs },
  );
  const id = data?.question?.questionId;
  if (id === undefined || id === null || id === "") {
    throw new Error(`未找到题目：${titleSlug}`);
  }
  return String(id);
}

/* ============================ 用户解题进度 ============================ */

const PROGRESS_QUERY = `query userProgressQuestionList($filters: UserProgressQuestionListInput) {
  userProgressQuestionList(filters: $filters) {
    totalNum
    questions {
      translatedTitle
      frontendId
      title
      titleSlug
      difficulty
      lastSubmittedAt
      numSubmitted
      questionStatus
      lastResult
      topicTags { slug }
    }
  }
}`;

export async function fetchProgress(
  { offset = 0, limit = 100, questionStatus, difficulty } = {},
  { fetchImpl = fetch, session = "", timeoutMs = 20000 } = {},
) {
  const filters = { skip: offset, limit };
  if (questionStatus) filters.questionStatus = questionStatus;
  if (difficulty) filters.difficulty = Array.isArray(difficulty) ? difficulty : [difficulty];
  const data = await lcGraphql(PROGRESS_QUERY, { filters }, { fetchImpl, session, timeoutMs });
  const list = data?.userProgressQuestionList;
  if (!list) return { totalNum: 0, questions: [] };
  return {
    totalNum: list.totalNum ?? 0,
    questions: list.questions ?? [],
  };
}

/* ============================ 提交历史 ============================ */

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
    { fetchImpl, session, timeoutMs, label: "获取提交历史失败" },
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
  const data = await lcGraphql(query, {}, { fetchImpl, session, timeoutMs, label: "获取提交历史失败" });
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
    { fetchImpl, session, timeoutMs, label: "获取提交历史失败" },
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

/* ============================ 运行 / 提交判题 ============================ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 判题结果尚未就绪的状态
function isPendingState(state) {
  if (typeof state !== "string") return true;
  const s = state.toUpperCase();
  return s === "PENDING" || s === "STARTED";
}

async function readBody(res) {
  if (typeof res.text === "function") return await res.text();
  if (typeof res.json === "function") return JSON.stringify(await res.json());
  return "";
}

// 写操作请求头：session 必需，csrf 带上但实测非必需（双保险）
function judgeHeaders(session, titleSlug) {
  const cookie = [buildCookie(session), csrfToken ? `csrftoken=${csrfToken}` : ""]
    .filter(Boolean)
    .join("; ");
  return {
    "content-type": "application/json",
    cookie,
    "x-csrftoken": csrfToken,
    origin: ORIGIN,
    referer: `${ORIGIN}/problems/${titleSlug}/`,
  };
}

async function postJudge(url, body, headers, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await readBody(res);
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try {
      msg = JSON.parse(text)?.error ?? msg;
    } catch {
      /* 非 JSON，保留原文 */
    }
    throw new Error(`请求失败（HTTP ${res.status}）：${msg}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("请求失败：接口返回非 JSON 内容");
  }
}

// 轮询判题结果直到就绪。429 表示限流，按 retry-after 或指数退避重试。
export async function pollCheck(
  checkUrl,
  headers,
  { fetchImpl = fetch, timeoutMs = 120000, pollIntervalMs = 1500, requestTimeoutMs = 20000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let intervalMs = Math.max(1, pollIntervalMs);
  while (true) {
    if (Date.now() > deadline) throw new Error(`判题超时（${timeoutMs}ms）`);
    const res = await fetchImpl(checkUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers?.get?.("retry-after")) * 1000;
      const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter, 30000)
        : Math.min(intervalMs * 2, 10000);
      await sleep(backoffMs);
      intervalMs = backoffMs;
      continue;
    }
    if (!res.ok) throw new Error(`查询判题结果失败：HTTP ${res.status}`);
    const text = await readBody(res);
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("查询判题结果失败：接口返回非 JSON 内容");
    }
    if (!data || typeof data !== "object") {
      throw new Error("查询判题结果失败：接口未返回预期数据");
    }
    if (!isPendingState(data.state)) return data;
    await sleep(intervalMs);
  }
}

// 跑一次代码（不计入提交历史）。对应 MCP 的 run_code。
export async function runCode(
  { titleSlug, lang, typedCode, dataInput = "", questionId, timeoutMs = 120000, pollIntervalMs = 1500 } = {},
  { fetchImpl = fetch, session = "" } = {},
) {
  const qid = questionId ?? (await fetchQuestionId(titleSlug, { fetchImpl, session }));
  const startUrl = `${ORIGIN}/problems/${titleSlug}/interpret_solution/`;
  const start = await postJudge(
    startUrl,
    { data_input: dataInput, lang, question_id: qid, typed_code: typedCode },
    judgeHeaders(session, titleSlug),
    { fetchImpl },
  );
  if (!start?.interpret_id) {
    throw new Error("运行失败：接口未返回 interpret_id");
  }
  const checkUrl = `${ORIGIN}/submissions/detail/${start.interpret_id}/check/`;
  const check = await pollCheck(checkUrl, judgeHeaders(session, titleSlug), {
    fetchImpl, timeoutMs, pollIntervalMs,
  });
  return { titleSlug, questionId: qid, start, checkUrl, check };
}

// 正式提交（计入提交历史）。对应 MCP 的 submit_solution。
export async function submitSolution(
  { titleSlug, lang, typedCode, questionId, timeoutMs = 120000, pollIntervalMs = 1500 } = {},
  { fetchImpl = fetch, session = "" } = {},
) {
  const qid = questionId ?? (await fetchQuestionId(titleSlug, { fetchImpl, session }));
  const startUrl = `${ORIGIN}/problems/${titleSlug}/submit/`;
  const start = await postJudge(
    startUrl,
    { lang, question_id: qid, typed_code: typedCode },
    judgeHeaders(session, titleSlug),
    { fetchImpl },
  );
  if (start?.submission_id === undefined || start?.submission_id === null || start?.submission_id === "") {
    throw new Error("提交失败：接口未返回 submission_id");
  }
  const checkUrl = `${ORIGIN}/submissions/detail/${start.submission_id}/check/`;
  const check = await pollCheck(checkUrl, judgeHeaders(session, titleSlug), {
    fetchImpl, timeoutMs, pollIntervalMs,
  });
  return { titleSlug, questionId: qid, start, checkUrl, check };
}

/* ============================ 统一入口 ============================ */

// 保留与旧 MCP 层一致的 tool 名与返回形状，CLI 侧无需感知底层差异。
// fetchImpl 可注入，便于离线测试。
export async function callTool(name, toolArgs = {}, opts = {}) {
  const { session = "", timeoutMs = 120000, fetchImpl = fetch } = opts;
  switch (name) {
    case "search_problems": {
      const problems = await searchProblems(toolArgs, { session, timeoutMs, fetchImpl });
      return {
        filters: { tags: toolArgs.tags, difficulty: toolArgs.difficulty, searchKeywords: toolArgs.searchKeywords },
        pagination: { limit: toolArgs.limit, offset: toolArgs.offset },
        problems,
      };
    }
    case "get_problem": {
      const problem = await fetchProblem(toolArgs.titleSlug, { session, timeoutMs, fetchImpl });
      return { titleSlug: toolArgs.titleSlug, problem };
    }
    case "get_problem_progress": {
      const questions = await fetchProgress(toolArgs, { session, timeoutMs, fetchImpl });
      return {
        filters: {
          offset: toolArgs.offset,
          limit: toolArgs.limit,
          questionStatus: toolArgs.questionStatus,
          difficulty: toolArgs.difficulty,
        },
        questions,
      };
    }
    case "run_code":
      return runCode(toolArgs, { session, fetchImpl });
    case "submit_solution":
      return submitSolution(toolArgs, { session, fetchImpl });
    default:
      throw new Error(`未知的工具：${name}`);
  }
}
