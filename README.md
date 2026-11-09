# 小巧LeetCode CLI

`lc` 是一个零运行时依赖的 CLI（只用 Node 内置模块，无任何第三方包），用命令行刷 [leetcode.cn](https://leetcode.cn) 。
核心是直接调用 leetcode.cn 的 GraphQL 与判题接口，
完成刷题闭环：**列题 → 生成代码文件 → 写代码 → 跑样例 → 提交**。

> 为什么做这个：感觉 vscode 和 IDEA 上的 LeetCode 插件不太好用，干脆自己写一个小巧的工具，直接通过终端运行（以及避免老板发现你在刷leetcode）。



## 特性

- **零运行时依赖** — 只用 Node 内置模块，无需 `npm install`，`node_modules` 为空
- **直连 leetcode.cn** — GraphQL 查询与判题都自己实现，不经任何中间服务
- **完整闭环** — `list` → `show` → `run` → `submit`，全程不出终端
- **多语言** — python3 / cpp / java / golang / javascript / typescript / rust / c
- **随机刷题** — `lc random` 在筛选范围内均匀抽题
- **已做标记** — 登录后 `list` 显示 ✅/空 状态列，`progress` 查看已解决统计与最近提交
- **提交历史** — `lc history <slug>` 查某题的历次提交：状态、耗时、内存、击败百分位、通过用例数，`--id` 看单次源码
- **自约束** — 命令只在项目根目录有效，不会在别处误建目录或误读凭据

## 目录

- [特性](#特性)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [认证](#认证)
- [命令参考](#命令参考)
- [目录约定](#目录约定)
- [输出样式](#输出样式)
- [开发](#开发)
- [故障排查](#故障排查)
- [致谢](#致谢)
- [License](#license)

---

## 环境要求

- **Node.js >= 20**（开发环境使用 v24）
- 一个 leetcode.cn 账号（仅 `run` / `submit` 需要）

站点固定为 `cn`，不可切换。

## 快速开始

```bash
npm link             # 把 lc 链接到 PATH（一次性，无需 npm install）
lc init              # 引导配置登录 Cookie
lc list two-sum          # 搜题
lc progress --limit 10   # 已解决统计与列表（需登录）
lc random            # 随机抽一题（可加 --difficulty / --tags）
lc show two-sum      # 下载题目并生成 solution.py（题面随 locale，中文环境为中文）
lc run two-sum       # 用默认样例跑一遍
lc submit two-sum    # 提交
```

> **命令受项目根目录约束。** 无论怎么调用，`lc` 都会校验当前目录是不是 LittleLeetCodeCli
> 项目根目录，否则报错退出——不会在别处误建 `solutions/` 或误读 `.env`。
> 不想用 `npm link` 也可以直接 `node bin/lc.mjs <命令>`，
> 或 `npm run lc -- <命令>`（注意：用 `npm run` 时，命令前的 `--` 不能省）。

---

## 认证

`run` 和 `submit` 需要登录，`progress` 和 `history` 同样需要；
`list` 未登录时只不显示状态列，`show` 不需要登录。

### 获取 Cookie

1. 浏览器登录 <https://leetcode.cn>
2. `F12` → **Application**（应用）→ **Storage → Cookies** → `https://leetcode.cn`
3. 找到 `LEETCODE_SESSION`，复制 **Value** 列的内容

### 配置

```bash
lc init                    # 交互式，粘贴即可（推荐）
lc config set session <值>  # 或手动写入
lc config get session      # 查看（脱敏：abcd****wxyz）
lc config unset session    # 移除
lc config list             # 列出所有键（session 脱敏，其余明文）
lc config set lang cpp     # 设置默认编程语言（不再每次传 --lang）
lc config set locale en    # 设置显示语言（zh|en|auto，默认 auto 跟随系统）
```

Cookie 存在项目根的 `.env`（已在 `.gitignore` 中）：

```
LEETCODE_SESSION=<你的cookie>
DEFAULT_LANG=cpp
```

**环境变量优先于 `.env`**，临时用一次可以：

```bash
LEETCODE_SESSION=<值> lc submit two-sum
```

> Cookie 大约一到四周会过期。过期后 `run` / `submit` 会报「该操作需要登录」，重新取一次即可。

---

## 命令参考

| 命令 | 说明 |
|---|---|
| `init` | 未配置 Cookie 时交互引导写入（零依赖，无需安装任何包） |
| `config <get\|set\|unset\|list> [key] [value]` | 管理 `.env`（`session` 登录 Cookie、`lang` 默认语言、`locale` 显示语言 zh/en/auto） |
| `list [关键词]` | 搜索题目，输出带边框表格；登录后含已解决状态列 |
| `random` | 随机抽取一题（只打印，不生成文件） |
| `progress` | 已解决题目的统计与列表（需登录）；已解决列表缓存在 `.lc-cache/` |
| `show <slug>` | 取题目、生成代码文件、按 locale 打印中/英题面 |
| `run <slug>` | 用题目默认样例运行本地代码 |
| `submit <slug>` | 提交本地代码 |
| `history <slug>` | 查看某题的历史提交记录与得分（需登录） |

> 任何命令都可以用 `lc <命令> --help`（或 `lc help <命令>`）查看该命令的完整用法。

### 通用选项

| 选项 | 默认 | 适用命令 | 说明 |
|---|---|---|---|
| `--lang <L>` | 见下 | `show` `run` `submit` | 目标语言；优先级：`--lang` > `lc config lang` > `python3` |
| `--timeout <ms>` | `120000` | `run` `submit` | 超时，同时透传给 LeetCode |

### 各命令选项

| 选项 | 适用命令 | 说明 |
|---|---|---|
| `--difficulty EASY\|MEDIUM\|HARD` | `list` `random` `progress` | 难度过滤（大小写不敏感） |
| `--tags a,b` | `list` `random` | 标签过滤，逗号分隔 |
| `--limit N` | `list` `progress` `history` | 条数，默认 `20`（`progress` 按最近提交倒序；`history` 上限 `100`） |
| `--offset N` | `progress` `history` | 跳过前 N 条 |
| `--refresh` | `list` `progress` | 忽略 24h 缓存，强制重新拉取已解决列表 |
| `--force` | `show` | 覆盖已存在的代码文件 |
| `--input "..."` | `run` | 自定义测试输入；不给则用题目默认样例 |
| `--id <提交ID>` | `history` | 查看单次提交的完整详情（含源码与失败诊断） |

### 查看提交历史

```bash
lc history two-sum                    # 该题的历史提交表格
lc history two-sum --limit 30         # 每页条数（默认 20，上限 100）
lc history two-sum --offset 20        # 翻页
lc history two-sum --id 754578653     # 单次提交详情（含源码与失败诊断）
```

表格列：提交时间 / 状态 / 语言 / 耗时 / 内存 / 击败% / 用例 / ID。

- 状态：`✓ 通过` 表示 Accepted；`✗ 答案错误`、`✗ 超时` 等表示失败。
- 击败% 是运行时间的击败百分位；失败提交无有效百分位时显示 `—`。
- `--id` 输出的源码是完整代码，可直接重定向到文件：`lc history two-sum --id 754578653 > solution.py`。
- 若提示「未查到提交记录」但你确定提交过，通常是 Cookie 已过期，重新执行 `lc config set session <cookie>`。

### 支持的语言

| `--lang` | langSlug | 生成的文件 |
|---|---|---|
| `python3`（默认） | `python3` | `solution.py` |
| `cpp` | `cpp` | `solution.cpp` |
| `java` | `java` | `Solution.java` |
| `golang` | `golang` | `solution.go` |
| `javascript` | `javascript` | `solution.js` |
| `typescript` | `typescript` | `solution.ts` |
| `rust` | `rust` | `solution.rs` |
| `c` | `c` | `solution.c` |

---

## 目录约定

```
solutions/
└── 0001-two-sum/
    └── python3/
        └── solution.py
```

规则：`solutions/<四位题号>-<slug>/<lang>/<文件名>`

题号由 LeetCode 的 `questionId` 补零到四位得到；文件名由语言决定。
`run` / `submit` 按 `solutions/*-<slug>/<lang>/<文件名>` 定位代码文件，
若匹配到多个会列出全部并使用第一个。

---

## 输出样式

- **颜色**：仅在输出到真实终端时启用；重定向到文件或管道时自动去色。
  遵循 `NO_COLOR`（设置即禁用）与 `FORCE_COLOR`（非 `0` 即强制启用）约定。
- **难度配色**：简单=绿、中等=黄、困难=红；列宽按显示宽度计算，中文占 2 列。
- **状态列**：登录后 `list` 每行显示状态列，已解决标绿色 ✅；未登录时不显示该列。
- **显示语言**：命令输出与帮助文本按 locale 自动中英切换；优先级 `lc config locale`（写入 `.env` 的 `LC_LOCALE`）> 系统 `LC_ALL`/`LANG`（以 `zh` 开头即中文）。`locale` 设为 `auto`（默认）时跟随系统。
- **已解决缓存**：`progress` 与 `list` 把已解决列表缓存到 `.lc-cache/solved.json`（24 小时），
  `submit` 判题通过后会自动刷新该缓存；刷新失败时静默降级用旧缓存并在 stderr 告警。
- **判题结果**：输出摘要（状态 / 通过用例 / 耗时 / 内存 / 提交 ID / 详情链接），
  失败时直接给出首个失败用例的输入、期望与实际。判题未通过时退出码为 `1`。
- **题面语言**：`show` 按 locale 展示中/英文标题与题面（中文取不到时回退英文），生成的文件注释同样随 locale；
  上标/下标会渲染为 `x_i^y_i` 这类纯文本，不丢数学语义。
- **文件题面注释**：`show` 生成的文件顶部带题目注释（标题 + 完整题面，按语言用 `#` / `//`）。
- 退出码：成功 `0`，出错 `1`。

---

## 开发

```bash
npm test           # 164 个单元/集成测试（node:test）
```

测试不依赖网络：所有 LeetCode 请求都通过注入的假 `fetch` 验证，因此可离线跑。

VS Code 用户还可以在 `.vscode/mcp.json` 里挂 [leetcode-mcp-server](https://github.com/jinzcdev/leetcode-mcp-server)，
用 AI 助手刷题——那条链路与 `lc` CLI 完全解耦，不影响 CLI 的零依赖。

---

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| `lc: command not found` | 还没 `npm link`，或改用 `node bin/lc.mjs <命令>` |
| `该操作需要登录…` | Cookie 缺失或过期，重新执行 `lc config set session` |
| `当前目录不是 LittleLeetCodeCli 项目根目录` | 不在项目根目录，`cd` 回去再运行 |
| `请求 leetcode.cn 失败：HTTP 5xx` | LeetCode 服务端异常，稍后重试 |
| `判题超时（120000ms）` | 调大 `--timeout`，或检查网络 |

---

## 致谢

`lc` 直接访问 leetcode.cn 的公开接口：题目与搜索用 GraphQL，运行与提交用官方判题 REST 接口
（判题接口未提供 GraphQL mutation，只能轮询 `/check/`）。接口实现参考了
**[leetcode-mcp-server](https://github.com/jinzcdev/leetcode-mcp-server)**（作者 [@jinzcdev](https://github.com/jinzcdev)，npm [`@jinzcdev/leetcode-mcp-server`](https://www.npmjs.com/package/@jinzcdev/leetcode-mcp-server)）
的实现思路，感谢作者的开源与维护。

同时也对 LeetCode 官方 MCP Server 的提供方致谢——它让 AI 助手也能用上这套接口。

同时感谢 LeetCode 提供的平台，以及所有开源社区的贡献者。

---

## License

[MIT](LICENSE) © 2026 RiverWind1024
