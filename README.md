# 轻量LeetCode CLI

`lc` 是一个零运行时依赖的 CLI（单文件 `bin/lc.mjs`，只用 Node 内置模块），用命令行刷 [leetcode.cn](https://leetcode.cn) 。
核心是通过 [leetcode-mcp-server](https://github.com/jinzcdev/leetcode-mcp-server) 连接 leetcode，
完成刷题闭环：**列题 → 生成代码文件 → 写代码 → 跑样例 → 提交**。

> 为什么做这个：感觉 vscode 和 IDEA 上的 LeetCode 插件不太好用，干脆自己写一个轻量化的小工具，直接通过终端运行（以及避免老板发现你在刷leetcode）。



## 特性

- **零运行时依赖** — 单文件 `bin/lc.mjs`，只用 Node 内置模块，`npm install` 只为装 MCP server，不用了直接删除
- **完整闭环** — `list` → `show` → `run` → `submit`，全程不出终端
- **多语言** — python3 / cpp / java / golang / javascript / typescript / rust / c
- **随机刷题** — `lc random` 在筛选范围内均匀抽题
- **已做标记** — 登录后 `list` 显示 ✅/空 状态列，`progress` 查看已解决统计与最近提交
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

---

## 环境要求

- **Node.js >= 20**（开发环境使用 v24）
- 一个 leetcode.cn 账号（仅 `run` / `submit` 需要）

站点固定为 `cn`，不可切换。

## 快速开始

```bash
npm install          # 安装 MCP server 依赖
npm link             # 把 lc 链接到 PATH（一次性）
lc init              # 引导配置登录 Cookie
lc list two-sum          # 搜题
lc progress --limit 10   # 已解决统计与列表（需登录）
lc random            # 随机抽一题（可加 --difficulty / --tags）
lc show two-sum      # 下载题目并生成 solution.py（题面默认中文）
lc run two-sum       # 用默认样例跑一遍
lc submit two-sum    # 提交
```

> **命令受项目根目录约束。** 无论怎么调用，`lc` 都会校验当前目录是不是 LightLeetCodeCli
> 项目根目录，否则报错退出——不会在别处误建 `solutions/` 或误读 `.env`。
> 不想用 `npm link` 也可以直接 `node bin/lc.mjs <命令>`，
> 或 `npm run lc -- <命令>`（注意：用 `npm run` 时，命令前的 `--` 不能省）。

---

## 认证

`run` 和 `submit` 需要登录，`progress` 同样需要；
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
lc config list             # 列出所有键（值脱敏）
```

Cookie 存在项目根的 `.env`（已在 `.gitignore` 中）：

```
LEETCODE_SESSION=<你的cookie>
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
| `init` | 安装 MCP 依赖；未配置 Cookie 时交互引导写入 |
| `config <get\|set\|unset\|list> [key] [value]` | 管理 `.env`（目前仅 `session`） |
| `list [关键词]` | 搜索题目，输出带边框表格；登录后含已解决状态列 |
| `random` | 随机抽取一题（只打印，不生成文件） |
| `progress` | 已解决题目的统计与列表（需登录）；已解决列表缓存在 `.lc-cache/` |
| `show <slug>` | 取题目、生成代码文件、打印中文题面 |
| `run <slug>` | 用题目默认样例运行本地代码 |
| `submit <slug>` | 提交本地代码 |

> 任何命令都可以用 `lc <命令> --help`（或 `lc help <命令>`）查看该命令的完整用法。

### 通用选项

| 选项 | 默认 | 适用命令 | 说明 |
|---|---|---|---|
| `--lang <L>` | `python3` | `show` `run` `submit` | 目标语言 |
| `--timeout <ms>` | `120000` | `run` `submit` | 超时，同时透传给 LeetCode |

### 各命令选项

| 选项 | 适用命令 | 说明 |
|---|---|---|
| `--difficulty EASY\|MEDIUM\|HARD` | `list` `random` `progress` | 难度过滤（大小写不敏感） |
| `--tags a,b` | `list` `random` | 标签过滤，逗号分隔 |
| `--limit N` | `list` `progress` | 条数，默认 `20`（`progress` 按最近提交倒序） |
| `--offset N` | `progress` | 跳过前 N 条 |
| `--refresh` | `list` `progress` | 忽略 24h 缓存，强制重新拉取已解决列表 |
| `--force` | `show` | 覆盖已存在的代码文件 |
| `--input "..."` | `run` | 自定义测试输入；不给则用题目默认样例 |

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
- **标题语言**：`list` 按当前 locale 自动选中文/英文标题（`LC_ALL`/`LANG` 以 zh 开头即中文，`LC_ALL` 优先）。
- **已解决缓存**：`progress` 与 `list` 把已解决列表缓存到 `.lc-cache/solved.json`（24 小时），
  刷新失败时静默降级用旧缓存并在 stderr 告警。
- **判题结果**：输出摘要（状态 / 通过用例 / 耗时 / 内存 / 提交 ID / 详情链接），
  失败时直接给出首个失败用例的输入、期望与实际。判题未通过时退出码为 `1`。
- **题面语言**：`show` 优先展示中文标题与题面（直连 leetcode.cn 公开接口，无需登录）；
  取不到中文时自动回退英文。
- 退出码：成功 `0`，出错 `1`。

---

## 开发

```bash
npm test           # 88 个单元/集成测试（node:test）
```

测试不依赖网络：MCP 调用与中文题面抓取都通过注入的假实现验证，因此可离线跑。

### 相关文档

- [设计文档](docs/superpowers/specs/2026-10-13-leetcode-cli-design.md)
- [实施计划](docs/superpowers/plans/2026-10-13-leetcode-cli.md)

VS Code 用户还可以在 `.vscode/mcp.json` 里直接挂同一个 MCP server，用 AI 助手刷题。

---

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| `lc: command not found` | 还没 `npm link`，或改用 `node bin/lc.mjs <命令>` |
| `该操作需要登录…` | Cookie 缺失或过期，重新执行 `lc config set session` |
| `当前目录不是 LightLeetCodeCli 项目根目录` | 不在项目根目录，`cd` 回去再运行 |
| `未找到本地 MCP server，回退使用 npx` | 本地依赖缺失，跑一次 `npm install` |
| `MCP server 提前退出` | 依赖损坏，尝试 `rm -rf node_modules && npm install` |
| `MCP 调用超时` | 调大 `--timeout`，或检查网络 |

---

## 致谢

本项目的题面获取、用例运行、代码提交等能力，全部依赖
**[leetcode-mcp-server](https://github.com/jinzcdev/leetcode-mcp-server)**（作者 [@jinzcdev](https://github.com/jinzcdev)，npm [`@jinzcdev/leetcode-mcp-server`](https://www.npmjs.com/package/@jinzcdev/leetcode-mcp-server)）。

`lc` 本体只做命令行交互与本地文件管理，真正的 LeetCode 通信、GraphQL 查询、判题轮询都在这个 MCP server 里完成。没有它就没有这个工具，感谢作者的开源与维护。

同时也感谢 LeetCode 提供的平台，以及所有开源社区的贡献者。
