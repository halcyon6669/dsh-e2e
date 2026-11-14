# dsh-e2e 设计文档

> 一个跑在 DeepSeek Harness 里的端到端测试插件：用 IDE 的真实运行配置启动服务，发真实 HTTP 请求，抓真实日志，查真实数据库，最后产出一份可复核的证据报告。

---

## 1. 要解决的问题

单元测试证明「函数按我想的那样返回」。它证明不了：

- 服务**能不能起来**（Bean 装配、配置键拼写、端口占用、profile 缺项）
- 请求打进去之后**数据库里到底落了什么**（事务边界、字段映射、列名拼错、双写漏写）
- **日志里有没有**那句话（异常被吞、走了兜底分支、告警没触发）
- 整条链路的**真实耗时**（连接池冷启动、N+1、外部依赖超时）

这些问题的共同点是：**只有把真实进程跑起来才能观察到**。而现实中这类验证通常靠人手工做一遍——打开 IDEA，点绿色三角，用 Postman 发一个请求，再去 DBeaver 里 `select` 一下，最后凭印象说「没问题」。

手工验证有三个结构性缺陷：

1. **不可重复**：环境状态、端口、数据库里的残留数据每次都不同，昨天能过今天不能过，说不清是代码退化了还是环境脏了。
2. **无证据**：结论是「我看了一下，是对的」。没有留下请求原文、响应原文、SQL 结果、日志行。别人无法复核，三个月后的自己也无法复核。
3. **AI 越权判定**：把「这次测试算不算通过」交给一个语言模型，等于把可验证的事实换成不可验证的判断。模型说通过，但数据库里其实没写——这种情况无法被发现。

本插件针对这三点设计：**环境由用例声明并可复位、证据逐条留存、判定完全由确定性断言做出**。

---

## 2. 非目标

明确划出边界，避免插件膨胀成什么都做不好的东西：

| 不做 | 理由 |
|---|---|
| 替代单元测试 | 单测快、可定位；E2E 慢、只适合验证集成点。两者是不同层，不是替代关系 |
| 做性能压测 | 需要并发模型、采样统计、预热策略，是完全不同的工具 |
| 让 AI 判断用例是否通过 | 判定必须是确定性的，见 §7 |
| 管理测试数据全生命周期 | 只提供 setup/teardown 两个挂点，数据设计仍是用例作者的责任 |
| 支持任意数据库 | 当前只实现 PostgreSQL 线协议（含 openGauss/GaussDB），见 §10 |
| 在 CI 里无人值守跑 | 依赖 IDE MCP，本质是开发机上的工具；CI 场景应走 Testcontainers 路线 |

---

## 3. 为什么做成 DSH 插件

因为它需要的四类能力，恰好是宿主已经有的：

| 需要的能力 | 宿主提供 |
|---|---|
| 被模型调用 | `ctx.tools.register(definition, options)` —— 注册成原生工具，模型直接可用 |
| 能启动/停止外部进程 | `ctx.subprocess.spawn` / `ctx.jobs` —— 用于 taskkill、端口探测 |
| 能暴露一个 HTTP 端点给用户看状态 | `ctx.webServer.register({kind, path, handler})` |
| 能有一个真正的界面 | Client 半：`dsh.client` + `window.__ModuleLoader__` + `ctx.slots` |
| 能被用户按需开关、有图标和名称 | bundle 机制：`package.json` → `dsh.bundle.patch` → `cordis.patch.yml` |

**判定链路上没有任何模型调用。** 输入 YAML，输出报告，中间是确定性代码。

模型出现的位置只有两处，都在判定之外：

| 位置 | 做什么 | 为什么不越界 |
|---|---|---|
| `src/ai.js` 生成用例 | 把一段自然语言描述变成 YAML | 生成物必须过和真实用例同一个解析器，不合法就拒绝；而且它产出的是**待审阅的文本**，不是已保存的用例 |
| `src/ai.js` 解释失败 | 读失败报告，产出归因 | 输出进 `run.explanation`，**永不并入 `checks`**；已通过的运行直接 409 拒绝解释 |

这个边界是刻意的。如果插件内部调模型来「理解」日志或「判断」结果，报告的可信度就退化成模型的可信度——而模型恰恰是最不该被信任去判定事实的那一环。让模型写用例、写归因，是把它的长处（语言）用在它不会造成不可验证结论的地方。

---

## 4. 总体架构

两个入口，同一条流水线：

```
   面板（浏览器）                         Agent / 模型
   client.js                              e2e_* 工具
       │                                      │
       │ fetch /plugins/e2e/api/*             │
       ▼                                      ▼
   ┌───────────────────────┐        ┌──────────────────────┐
   │ panel.js              │        │ tools.js             │
   │ 用例 CRUD / 运行 / 报告 │        │ 5 个工具              │
   │ 生成 / 解释            │        │                      │
   └───────────┬───────────┘        └──────────┬───────────┘
               │                               │
               ▼                               ▼
        ┌──────────────────────────────────────────────┐
        │  resolve：用例 + registry → 实际连接           │
        │  （用例只写数据库名，连接在 e2e.registry.yml）   │
        └───────────────────┬──────────────────────────┘
                            │
        ┌───────────────────▼──────────────────────────┐
        │  guard：校验**解析之后**真正会被拨号的地址      │
        │  非 loopback/私网 → 拒绝                       │
        │  名字像生产 → 拒绝                             │
        │  要写库但没显式授权 → 拒绝                      │
        └───────────────────┬──────────────────────────┘
                            │
        ┌───────────────────▼──────────────────────────┐
        │  runner：编排（src/runner.js）                 │
        │  14 步流水线，见 §6                            │
        └──┬────────┬────────┬────────┬────────────────┘
           │        │        │        │
 ┌─────────▼──┐ ┌───▼─────┐ ┌▼─────────────┐ ┌▼─────────────┐
 │ idea.js    │ │service.js│ │ http.js      │ │ db.js+pg.js  │
 │ IDE MCP    │ │日志跟随   │ │ HTTP 客户端   │ │ 数据库客户端  │
 │ SSE+RPC    │ │增量读     │ │ 原始字节      │ │ 线协议手写    │
 └────────────┘ └──────────┘ └──────────────┘ └──────────────┘
           │        │        │        │
        ┌──▼────────▼────────▼────────▼────────────┐
        │  assert：确定性断言（src/assert.js）       │
        │  response / database / logs / calls       │
        └───────────────┬──────────────────────────┘
                        │
        ┌───────────────▼──────────────────────────┐
        │  report：证据与结论（src/report.js）       │
        │  store.js 落盘，JSON（机器）+ MD（人）      │
        └──────────────────────────────────────────┘
```

### 4.1 模块职责

| 文件 | 行数 | 职责 | 关键设计决策 |
|---|---|---|---|
| `index.js` | 150 | 插件入口，`apply(ctx, config)` | 模块解析钩子给整棵依赖图加 generation，改任何 `src/*.js` 都不必重启 DSH |
| `client.js` | 1985 | 浏览器半：项目表 + 侧栏入口 + 用例面板 | 纯手写 bundle，React 来自宿主模块表，见 §16 |
| `src/host.js` | 306 | 组装、示例播种、`/status`、客户端半自检 | 面板首次打开不能是空目录，见 §16.1 |
| `src/panel.js` | 893 | 面板 REST API | 保存先写临时文件再改名，见 §16.2 |
| `src/store.js` | 322 | 用例与报告的唯一磁盘入口 | 路径必须落在 root 内，见 §16.2 |
| `src/projects.js` | 398 | 项目表：按 origin 归并 target、汇总最近结果与分组 | 不存储、只推导；见 §5.10 |
| `src/plan.js` | 139 | 步骤描述、状态判定、组内结论 | 纯函数，Host 算一次浏览器不重算；见 §5.11 |
| `src/edit.js` | 253 | 表单 → YAML 的行级补丁 | 不重新序列化，见 §5.12 |
| `src/ai.js` | 310 | 生成用例、解释失败 | 模型永不参与判定，见 §16.4 |
| `src/scan.js` | 539 | 读 Spring 源码：端点、DTO 约束、实体表名 | 只读，注解解析不引依赖，见 §16.5 |
| `src/scaffold.js` | 294 | 端点 → 用例骨架 | 只生成骨架不猜断言，见 §16.5 |
| `src/tools.js` | 525 | 注册 7 个工具 | 与面板共用 store，不重复实现 |
| `src/case.js` | 708 | YAML 解析与规范化 | 未知字段直接报错（见 §5.4） |
| `src/registry.js` | 389 | target / 数据库注册表 | 支持 `from: db-mcp` 复用已存数据源，见 §5.7 |
| `src/resolve.js` | 158 | 用例 + registry → 实际连接 | 三层合并，缺配置时列出可用名字 |
| `src/guard.js` | 188 | 环境护栏 | 校验解析后的地址（见 §9） |
| `src/runner.js` | 589 | 流水线编排 | `finally` 保证 teardown 与停服 |
| `src/service.js` | 271 | 启停服务、跟随日志 | 端口占用预检（见 §6.2） |
| `src/idea.js` | 275 | IDEA MCP 客户端 | 手写 SSE + JSON-RPC，不引依赖 |
| `src/http.js` | 137 | HTTP 客户端 | 用 `node:http` 而非 `fetch`（见 §4.2） |
| `src/pg.js` | 455 | PostgreSQL 线协议 | 手写，含 SCRAM-SHA-256（见 §4.2） |
| `src/db.js` | 149 | 数据库门面 | 强制只读断言 |
| `src/assert.js` | 254 | 断言引擎 | 每条断言返回统一结构（见 §7.2） |
| `src/report.js` | 306 | 报告渲染 | 双格式：JSON + Markdown |
| `src/yaml.js` + `vendor/js-yaml.mjs` | 43 + 104KB | YAML 解析与输出 | 内置 vendor，见 §4.2 |

`index.js` 151 行、`client.js` 2814 行（浏览器半，手写 bundle，含样式）。合计约 **10,900 行**自有代码 + 104KB vendored YAML 解析器，**零运行时依赖**。

`client.js` 涨得最快，而它没有任何编译期检查：`node --check` 只看语法，看不见一个改了名却没跟着改的变量。这就是 `dev/render.test.mjs` 存在的原因（§17），也是为什么前端每加一个页面都要同时加渲染探针。

### 4.2 三个「为什么要手写」的决策

**为什么 HTTP 客户端不用 `fetch`？**

本地 Spring Boot 常用自签证书。`fetch` 要绕过证书校验得设全局 `NODE_TLS_REJECT_UNAUTHORIZED=0`，污染整个进程；而且 `fetch` 会把响应体按 `Content-Type` 解码，拿不到原始字节，也就无法在报告里给出「服务端实际返回的字节序列」。用 `node:http` + `rejectUnauthorized: false` 可以按请求粒度控制，且 `Buffer` 原样保留。

**为什么数据库客户端手写线协议？**

宿主 profile 里没有任何数据库驱动。引 `pg` 就要处理依赖解析路径（插件目录能否解析到 profile 的 `node_modules`——实测不能，裸 `import('yaml')` 会 `ERR_MODULE_NOT_FOUND`）。手写 PG 线协议约 450 行，覆盖 startup / MD5 / SCRAM-SHA-256 / cleartext 四种认证，代价小于依赖管理的复杂度。副产品是零依赖、可审计。

**为什么 YAML 解析器要 vendor 进仓库？**

同上：插件目录是唯一能从自身解析到依赖的地方。`js-yaml@4.3.2` 的 `dist/js-yaml.mjs` 是零依赖 ESM 单文件（104KB），复制进 `vendor/` 后用 `import(new URL('../vendor/js-yaml.mjs', import.meta.url).href)` 加载。这样插件在任何 cwd 下都能工作。

---

## 5. 用例 DSL

一个用例是一个 YAML 文件。

### 5.1 完整示例

```yaml
id: auth-register-confirm
title: 注册后确认验证码，用户状态应被激活
description: |
  真实服务、真实数据库。验证注册写入 users 与 codes，
  确认后 users.valid_state 变 1、codes.valid 变 0。
tags: [auth, database, smoke]

env:
  target: record-local          # 指向 registry 里的 targets，见 §5.7
  healthPath: /actuator/health
  insecureTls: true
  startTimeoutMs: 120000

  databases:
    default: { name: iam, schema: public }   # 只写名字与 schema

setup:
  sql:
    - DELETE FROM codes WHERE username = '${user.name}'
    - DELETE FROM users WHERE username = '${user.name}'
  http:
    - method: POST
      path: /test/reset-fixtures
      expect_status: 200

request:
  method: POST
  path: /auth/register
  headers:
    Content-Type: application/json
  json:
    username: ${user.name}
    password: Passw0rd!2026
    email: ${user.name}@example.test
  timeoutMs: 30000

expect:
  response:
    status: 500                 # 已知的 SMTP 缺陷，见 §11.2
    body_contains: register failed
  database:
    - database: default
      description: 注册应在 users 落一行未激活用户
      sql: SELECT username, valid_state FROM users WHERE username = '${user.name}'
      rowCountAtLeast: 1
      rows:
        - path: '[0].valid_state'
          equals: '0'
    - database: default
      description: 验证码应落一行有效记录
      sql: SELECT code, valid FROM codes WHERE username = '${user.name}'
      rowCountAtLeast: 1
      rows:
        - path: '[0].valid'
          equals: '1'
  logs:
    must_contain:
      - register
    must_not_contain:
      - OutOfMemoryError

teardown:
  sql:
    - DELETE FROM codes WHERE username = '${user.name}'
    - DELETE FROM users WHERE username = '${user.name}'
```

注意 `env` 里**没有 host、没有端口、没有用户名、没有密码**。这个文件可以原样提交进仓库、贴进工单、复制到另一台机器——它描述的是一条测试意图，不是一台机器的连接串。

### 5.2 顶层字段

只有这 14 个，多写一个就报错：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 文件级标识，用于报告文件名和 `e2e_run_case {file}` 的兜底查找 |
| `caseId` | | 可引用的编号（`REG-002`），失败清单/报告/工单里引用它。不给时**保存时自动分配**，见 §5.9 |
| `title` | | 人类可读标题 |
| `description` | | 说明这个用例在验证什么 |
| `tags` | | 字符串数组，仅用于展示和筛选 |
| `group` | | 用例组（use case），面板清单按它分块。不给时退回按 `endpoint` 分组，见 §5.10 |
| `endpoint` | | 接口（`POST /auth/register`），同一接口的用例归为一组。不给时从 `request` 推导 |
| `scenario` | | `normal` / `error`，见 §5.9 |
| `priority` | | `high` / `medium` / `low`，见 §5.9 |
| `env` | ✅ | 环境声明，见 §5.3 |
| `setup` | | 前置准备，见 §5.5 |
| `request` | ✅ | 被测请求 |
| `expect` | ✅ | 断言，见 §5.6 |
| `teardown` | | 收尾清理 |

`caseId` 与 `id` 是两件事，这是刻意的：

- `id` 是**文件级 slug**，跟着文件名走。改标题、改文件名，它就变。
- `caseId` 是**可引用的名字**，一旦分配就不再变。它是失败清单排序的依据，是你在工单里写「REG-002 挂了」时指的东西。

如果只有一个，就必须二选一：要么改标题就丢掉引用关系，要么不能改标题。所以两个都要。

### 5.3 `env` 字段

`env` 是「这一次测试要打向哪里」。它分成两组：**指向目标**的（`target` 及其覆盖项）和**本次运行的开关**。

| 键 | 默认 | 说明 |
|---|---|---|
| `target` | `null` | registry 里的 target 名，提供 `baseUrl`/`projectPath`/`configurationName` 等，见 §5.7 |
| `baseUrl` | 由 target 提供 | 覆盖 target 的服务地址。护栏会校验它 |
| `healthPath` | 由 target 提供 | 就绪探测路径。为 `null` 时只靠日志中的启动行判断 |
| `projectPath` | 由 target 提供 | IDE 认识的项目路径，如 `E:/project/backend/Record` |
| `configurationName` | 由 target 提供 | IDE 运行配置名。启动前会用 `get_run_configurations` 校验它真实存在 |
| `profile` | `null` | 注入 `SPRING_PROFILES_ACTIVE` |
| `insecureTls` | `false` | 跳过证书校验（自签证书场景） |
| `database` | `null` | 单库简写，等价于 `databases.default`，见 §5.4 |
| `databases` | `{}` | 命名数据库引用映射，见 §5.4 |
| `mocks` | `null` | 预留：WireMock 场景。**当前只解析不执行**，见 §11.1 |
| `startTimeoutMs` | 由 target 提供，否则 `120000` | 等服务就绪的上限 |
| `keepServiceRunning` | `false` | 跑完不停止服务（调同一个用例时省启动时间） |
| `serviceRequired` | `true` | 为 `false` 时不连 IDE、不启服务，只发请求+查库（用于测已在跑的服务） |

用例里的值**优先于** registry 里的同名值。所以常见做法是：registry 写本机默认值，用例只在需要时覆盖一条（例如临时指向另一个 `baseUrl`）。

### 5.4 多数据库（只写名字）

`databases` 是**命名映射**，不是数组。这样断言里可以用 `database: default` 精确指向某一个，报告里也会按名字分组。

每个值是一句「引用」：数据库名 + 可选 schema。

```yaml
env:
  databases:
    primary: { name: iam, schema: public }
    replica: { name: iam_replica, schema: public }
```

也可以写成裸字符串，等价于 `{ name: <那个字符串> }`：

```yaml
env:
  databases:
    default: iam
```

**连接详情会被明确拒绝**，不是静默忽略：

```yaml
env:
  databases:
    default:
      name: iam
      host: 127.0.0.1        # ← 这里会报错
```

```
env.databases.default must not carry connection details (host, port, user, password, kind, jdbcUrl, url):
a case names a database, it does not connect to one.
Put the connection in e2e.registry.yml (or add it to the dsh-db-mcp plugin) and reference it by name here.
```

这个限制是本插件最重要的边界之一。理由有三条：

1. **凭据不该进用例**。用例会进 git、进聊天记录、被贴进 issue。连接串留在里面，泄漏只是时间问题。
2. **同一份用例要在多台机器上跑**。开发机的 PostgreSQL 在 5432，CI 里在 5433，另一台机器走 SSH 隧道。把端口写进用例等于把它钉死在一台机器上。
3. **护栏才有意义**。护栏要判断「这个地址是不是生产」。如果地址来自用例，用户写什么就检查什么；只有地址来自 registry 且可以被集中管理时，「生产库不在 registry 里」才成为一个可审计的事实。

设计动机来自一个具体场景：服务同时写两个库时，**只有同时查两个库才能发现「第二个库静默漏写」**。只查一个库的测试永远发现不了这类 bug，因为主库一切正常。

单库场景可以只写 `env.database`，它会自动规范化成 `databases.default`。

**未知字段直接报错**：`env` 里写了 `databse`（拼错）会得到
`unknown env field(s) databse; allowed: target, baseUrl, healthPath, ...`，而不是被静默忽略然后跑出一个「通过」的假结果。这是刻意的：静默忽略拼写错误会让用户以为某个配置生效了，而实际上它从未被读取过。

### 5.5 `setup` / `teardown`

两者结构相同，都支持 `sqlFiles` / `sql` / `http` / `capture` / `mocks`：

```yaml
setup:
  sqlFile: fixtures/users.sql        # 相对用例文件所在目录
  sqlFiles: [a.sql, b.sql]           # 或数组
  sql:                               # 或内联
    - DELETE FROM users WHERE username = '${user.name}'
  http:                              # 通过服务自己的 API 准备状态
    - method: POST
      path: /migration/switch/to-postgres
      expect_status: 200
  capture:                           # 读回服务生成的值
    - name: code.value
      sql: SELECT code FROM codes WHERE username = '${user.name}' AND valid = '1'
      column: code
```

**为什么 setup 要能发 HTTP？**

因为有些状态只能通过服务自己的 API 建立。典型例子：一个双写服务有「切主库」的开关，要验证切换后的行为，就必须先调那个接口。纯 SQL 做不到——SQL 改的是数据，不是服务的内部状态。

`setup.http` 的每条请求带独立 trace id（`${traceId}-setup1`、`-setup2`…），避免准备阶段的日志污染被测请求的日志窗口。

准备请求默认把 `>=400` 视为错误。如果某个准备步骤本来就预期失败（比如一个已知会返回 500 的接口），必须写 `expect_status: 500` 显式声明——否则「意料之外的失败」会被当成正常准备步骤吞掉。

**为什么需要 `capture`？**

因为有一类值**在服务运行之前根本不存在**：验证码、自增 id、签名 token。它们由服务生成并写进数据库，用例作者不可能预先写进 YAML。

`capture` 在 `setup.sql` 和 `setup.http` 之后执行，读一条只读查询，把结果绑定成变量：

```yaml
setup:
  capture:
    - name: code.value          # 绑定成 ${code.value}
      database: default
      sql: SELECT code FROM codes WHERE username = '${user.name}' AND valid = '1'
      column: code              # 省略时取第一行第一列
      required: true            # 读不到就中止（默认 true）
```

没有这个能力，「注册 → 确认验证码」这类用例根本无法自动化——而这恰恰是认证系统最核心的链路。它也是本插件在真机上第一次跑通完整链路时补上的最后一个能力缺口。

**teardown 必须在 `finally` 里执行**，哪怕主流程已经抛异常。理由很实际：脏数据会污染下一次运行，泄漏的服务会占住端口让下一次启动失败。一个失败的用例如果再留下脏环境，就会连锁失败。

`teardown` 的 SQL 用 `ignoreErrors: true` 执行：清理语句失败不应该掩盖真正的失败原因，只记进 `teardown.errors`。

### 5.6 `expect` 的四类断言

**响应**：

```yaml
expect:
  response:
    status: 200                # 精确状态码
    statusIn: [200, 201]       # 或之一
    body_contains: success     # 子串
    body_not_contains: error
    json:                      # 按路径断言
      - path: data.userId
        exists: true
      - path: data.role
        equals: USER
    schema:                    # 结构校验（子集）
      type: object
      required: [code, data]
      properties:
        code: { type: integer, equals: 0 }
    maxDurationMs: 2000        # 耗时上限
```

**数据库**（每个条目独立指定库）：

```yaml
  database:
    - database: default
      description: 用户应被激活
      sql: SELECT valid_state FROM users WHERE username = '${user.name}'
      rowCount: 1              # 精确行数
      # rowCountAtLeast: 1     # 或至少 N 行
      # notEmpty: true
      # empty: true
      # equals: { valid_state: '1' }   # 对第一行做整行比较
      rows:                    # 对结果集逐条断言，path 支持 a.b[0].c
        - path: '[0].valid_state'
          equals: '1'
        - path: '[0].code'
          matches: '^\d{6}$'
```

`rows[].path` 里的 `[0]` 索引的是**整个结果集**，所以 `[0].valid_state` 表示「第一行的 valid_state 列」。支持的操作符与 `expect.response.json` 完全一致（`equals`/`notEquals`/`contains`/`matches`/`exists`/`type`/`greaterThan`/`lessThan`/`in`）。

**日志**：

```yaml
  logs:
    traceId: ${random.traceId} # 可选：显式指定，默认用本次运行的 trace id
    must_contain: [register]
    must_not_contain: [OutOfMemoryError, NullPointerException]
    regex: ['request completed in \d+ms']
    maxLines: 500
```

**跟进请求**（`calls`）：被测请求之后额外发的请求，各自带断言。

```yaml
  calls:
    - description: 一致性自检接口应报告无差异
      method: GET
      path: /migration/validate-consistency
      expect_status: 200
      json_expect:
        - path: consistent
          equals: true
```

`calls` 存在的理由和 `setup.http` 类似：**有些状态只能从服务自己的视角观察**。一个双写服务能报告自己的两库是否一致，而工具如果连不上第二个库，就只能靠这个接口。

### 5.7 `e2e.registry.yml` — 连接放这里

用例只写名字，名字指向 registry。registry 是一个独立的 YAML 文件：

```yaml
targets:
  record-local:
    projectPath: E:/project/backend/Record
    configurationName: RecordApplication
    baseUrl: https://127.0.0.1:8443
    insecureTls: true
    startTimeoutMs: 120000

  record-running:              # 服务已经在跑，不启服务
    baseUrl: https://127.0.0.1:8443
    insecureTls: true

databases:
  iam:
    kind: postgresql
    host: 127.0.0.1
    port: 5432
    database: iam_db
    user: postgres
    password: ${env:IAM_PASSWORD:-iam_postgres_password}
    schema: public

  gauss:
    from: db-mcp               # 复用 dsh-db-mcp 里已存的数据源
    id: record
    schema: public
```

**查找顺序**（第一个存在的赢）：

1. 插件配置里的 `config.registryFile`
2. `<用例目录>/e2e.registry.yml`（或 `.yaml`）
3. `<用例目录的上级>/e2e.registry.yml`
4. 插件的运行时目录

放在用例目录里是最常见的做法——插件会把示例 registry 一起播种进去。

**三层合并**：registry 提供默认值 → 用例 `env` 里的同名字段覆盖 → `${env:NAME}` 在最后展开。所以 `baseUrl` 可以只写在 registry 里，用例临时要打另一个地址时再覆盖。

**`${env:NAME}` 与 `${env:NAME:-兜底值}`**：让同一个文件在 CI 里读环境变量、在本机读兜底值。这是「不把密码写进文件」和「本机开箱即用」之间的折中——兜底值只用于本地开发库。

**`from: db-mcp`**：直接引用 dsh-db-mcp 插件里已经保存的数据源，连密码都不用在这里出现。插件读 `~/.dsh/db-mcp/datasources.json`，再用 dsh-db-mcp 自己的 AES-256-GCM 密钥解开密码（信封 `v1.<iv>.<tag>.<ct>`，AAD 是数据源 id）。所以**改密码只需改 dsh-db-mcp 一处**。

```yaml
databases:
  gauss:
    from: db-mcp
    id: record        # dsh-db-mcp 里的数据源 id
```

id 写错时会明确告诉你有哪些：

```
databases.gauss imports db-mcp:gaussdb, which is not registered there;
dsh-db-mcp has: dbeaver-sample-database-sqlite, mysql, record
```

**名字写错时的报错是可操作的**。`resolveEnvironment` 找不到 target 或数据库时，错误消息里带完整的可用清单：

```
unknown target "record-locl". This registry declares: record-local, record-running.
Add it to e2e.registry.yml, or run e2e_list_databases to see what is configured.
```

这比 `undefined is not an object` 有用得多，也是 `e2e_list_databases` 工具存在的主要理由。

**一个数据库在 registry 里写一次，被多个用例引用**。这是它相对「每个用例内联连接」的核心收益：轮换密码改一处；CI 换库改一处；审计「这台机器能碰到哪些库」只需读一个文件。

### 5.8 变量与生成器

`${...}` 插值，可用：

| 变量 | 说明 |
|---|---|
| `${case.id}` / `${case.title}` | 用例自身信息 |
| `${user.name}` 等 | 用例里自定义的任意键，声明在 `request.variables` 下 |
| `${random.uuid}` | 随机 UUID |
| `${random.hex}` | 随机 hex 串（16 位） |
| `${random.int}` | 随机整数（100000–999999） |
| `${now.iso}` | 当前时间 ISO 8601 |
| `${now.epochMs}` | 当前毫秒时间戳 |
| `${random.traceId}` | 本次运行的 trace id（32 位 hex） |
| `${run.id}` | 本次运行的 id |

自定义变量只在 `request.variables` 里声明，**不从进程环境变量读取**——环境变量在不同机器上不同，会让同一个用例在别人的机器上跑出不同结果。

```yaml
request:
  variables:
    user.name: e2e-${random.hex}
  path: /auth/register
  json:
    username: ${user.name}
```

注意 `user.name` 本身可以引用生成器，所以 `e2e-${random.hex}` 会展开成 `e2e-a1b2c3d4e5f6a7b8`。

未定义的变量**保留字面占位符**（`${typo.name}` 原样进请求体），不会变成空串。这样错误一眼可见，而不是悄悄发一个缺字段的请求。

> 已知缺口：`interpolate()` 支持 `options.missing` 回调，但 runner 当前没有传，所以未定义变量不会在加载阶段报错，只会在请求体里留下字面量。理想行为是在 `loadCaseFile` 阶段就把未定义变量列为错误。

生成器的意义在于**每次运行用不同的用户名**。否则第二次运行会撞上第一次留下的唯一索引冲突，测试就变成了「只能跑一次」。

### 5.9 编号、接口、场景、优先级

一个接口会有多条用例。`POST /auth/register` 至少值得测四件事：正常注册、用户名重复、密码不满足 `@Pattern`、邮箱格式非法。把它们当成同一个接口的四条用例，而不是四个互不相干的文件，需要一个能把它们联系起来的字段。

草图见 [`case-organization.drawio`](case-organization.drawio)（用 draw.io 打开可继续改）：项目 → 接口 → 场景三层，每个场景框上写着它的 `caseId` 与 `scenario`。

| 字段 | 取值 | 不给时 | 为什么需要 |
|---|---|---|---|
| `caseId` | 任意短字符串，约定 `前缀-三位数` | 保存时自动分配 | 失败清单、报告、工单引用的名字 |
| `endpoint` | `METHOD /path` | 从 `request.method` + `request.path` 推导 | 把同一接口的用例归组 |
| `scenario` | `normal` / `error` | `normal` | 分组标题要能说「这个接口有没有测过失败」 |
| `priority` | `high` / `medium` / `low` | `medium` | 组内排序，也用来决定先修哪个 |

**`endpoint` 为什么要显式写。** 推导规则是 `request.method` + `request.path` 拼起来，但带路径变量的接口会分裂：`GET /users/1` 和 `GET /users/2` 是同一个接口，推导出来却是两条。所以 `endpoint` 允许手写，写成 `GET /users/{id}`，两条用例就归到一组。

**编号自动分配的两条规矩。** 见 `src/store.js` 的 `nextCaseId()` 与 `src/case.js` 的 `withCaseId()`：

1. **文本插入，不重新序列化。** 分配编号时只往 `id:` 后面插一行 `caseId:`。如果走「解析成对象 → 加字段 → dump 回 YAML」，文件里所有注释都会消失，而注释正是作者写下「这个用例要证明什么」「为什么用这个值」的地方。一份丢了注释的用例文件，比一份没有编号的更难维护。
2. **不回收已删除的编号。** 取的是目录里已用编号的**最大值 + 1**，不是文件数量 + 1。删掉 `REG-002` 之后下一个仍然是 `REG-003`。否则三周前引用过 `REG-002` 的报告和工单，会指向一个完全不同的用例。

**编号必须唯一。** 同一个目录里两个文件用同一个 `caseId` 会被拒绝：

```
caseId REG-001 is already used by zz-assign-test.yaml in this folder;
case ids have to be unique so a report can name one case
```

查重在 `saveCase()` 里做，不在 loader 里：只有一次目录列举才能回答「这个编号别人用了没有」，而 loader 只看得见一个文件。

**派生编号不是真编号。** 手工写文件、不写 `caseId` 时，loader 会派生一个（`REG-post-auth-register`）并把 `caseIdDerived` 置为 `true`。面板据此显示「保存时分配」而不是把派生值伪装成作者写的编号——一个看起来像编号、改标题就会变的字符串，比没有编号更容易误导人。

### 5.10 项目：用例上面的一层

用例回答「这个接口对不对」。在问这个问题之前还有一个问题：「我有哪几个服务，现在哪个是红的」。所以面板的第一屏是项目表，不是文件列表。

**没有任何文件声明「项目」。** 它是推出来的，见 `src/projects.js`：

1. registry 里每个 target 是一个入口，**按 `baseUrl` 的 origin 归并**。
2. 一个用例都不引用 target 时，它所在的目录自己成为一个项目。

第一条是关键。`record-local`（会启动 JVM）和 `record-running`（打一个已经在跑的服务）指向同一个 `https://127.0.0.1:8443`——那是**同一个服务的两种连法**，不是两个项目。一开始按 `projectPath` 归并时，`record-running` 没有 `projectPath`，于是它单独成行、`0 个用例`，而 `Record` 那行显示 `3 个用例`。同一个服务的用例被分到两行里，页面上的每个计数都是错的。

```
key = originKey(target.baseUrl) || projectKey(target.projectPath) || `target:${name}`
```

兜底顺序是刻意的：先问「这个地址是谁」，再问「这份代码是谁」，都不行才退化成 target 自己的名字。`originKey()` 把 `https://127.0.0.1:8443/` 与 `https://127.0.0.1:8443` 归一成同一个键（URL 解析后取 `protocol + host`），因为它们是同一个服务。

**计数来自最新报告，不是历史平均。** `latestByCase()` 按 `modifiedAt` 倒序读报告目录，每个 `caseId` 只取第一条。`listReports()` 已经按修改时间倒序排过，所以「第一次见到的」就是最新的。一个用例跑过一百次，页面上的「最近结果」只反映最后那一次——「它现在是不是好的」问的是最后一次。

**每条报告按两个键索引：`caseId` 和 `id`。** 这不是多余的：`caseId` 字段是后来才加的，在那之前写下的报告把它填成了文件 id。于是加完字段的当天，三个明明跑通过的用例在项目表上全变成了「未运行」——报告就在目录里，只是对不上号。这种错最难发现，因为它看起来像「这些测试还没写」。现在一个用例可以用当前 `caseId` 或它的文件 id 找到自己的最后一次运行，升级不会把历史抹掉。

**三种状态，不是一个词。** `passed` / `failed` / `notRun` 三个数各自显示，因为混合状态才是有信息量的状态：`✓ 2 ✕ 1` 说明的东西，一个 `failed` 徽章说不出来。而项目的 `lastVerdict` 只在**全部用例都跑过且都通过**时才是 `passed`，否则是 `partial`——「我跑的那一条通过了」和「这个项目是绿的」是两件事。

**类型读构建文件，不猜。** `pom.xml`/`build.gradle`/`build.gradle.kts` → 后端，`package.json` → 前端，两者都有 → 全栈，都没有 → `null`（显示「未知」）。猜（看路径里有没有 `frontend`、看扩展名）会在路径改名那天开始撒谎，而一个说「后端」说错的标签比没有标签更糟：它让人跳过检查。

**没有用例的项目也要出现。** 新加一个 target、还没写用例时，`counts.total === 0`，页面显示「未运行」。如果项目只从用例反推，那个 target 在写第一条用例之前是完全不可见的——而「我加了个服务但还没写测试」恰恰是最需要看见的状态。

**列表面是只读的。** `listProjects()` 只 stat 文件和读报告，不建任何目录。一个会在渲染时创建目录的列表，第一次打开和第二次打开会不一样。

### 5.11 用例清单：状态、分组、步骤数

点进项目之后是清单页。它要回答的问题和项目表不同：「这一组用例里，哪条还没写、哪条从来没跑、哪条被拦下了」。

**六种状态，不是两种。** `src/plan.js` 的 `caseStatus()`：

| 状态 | 什么时候 | 为什么单独一个词 |
|---|---|---|
| `planned` | 没有报告，且这条用例**不断言任何东西** | 骨架只发请求。四十个绿的骨架等于什么都没测 |
| `generated` | 没有报告，但有断言 | 「写好了，还没跑」和「还没写」是两种待办 |
| `running` | 有一条正在跑 | 否则运行中的用例看起来像「从未运行」 |
| `passed` | 最新 verdict 是 `passed` | |
| `failed` | 最新 verdict 是别的（`failed`/`error`） | |
| `blocked` | 最新 verdict 是 `refused` | 护栏在拨号**之前**拒绝了：远程主机、缺凭据、没开写权限。它没失败，是没开始；报成失败会让人去读一条根本没跑过的断言 |

`planned` 与 `generated` 的区别是这套状态里最容易被当成多余的那一对，也是最该保留的：脚手架产出的用例**刻意不含断言**（§16.5），一个把「发了个请求、服务没崩」算成通过的清单，会让整个套件看起来是绿的。

**状态在 Host 算，浏览器不重算。** `listProjects()` 给每条用例写 `status`，给每个项目写 `statusCounts`，给每个组写 `summary`。浏览器只负责显示。推导两遍，总有一天推得不一样——那时你会有两个页面，同一批用例，两个数字。

**分组按 `group`，不是按 `endpoint`。** `groupByEndpoint()` 这个名字是历史遗留（它现在按 `group` 分，没写 `group` 才退回 `endpoint`）。一个用例组可以横跨多个接口：读一篇文章是 `GET /articles` 加 `GET /articles/{id}`，注册是 `POST /auth/register` 加 `POST /auth/confirmCode`。从路径推不出来，所以 `group` 是作者写的字段。

组间按组名字母序排，不是按插入序。插入序取决于文件名，改一个无关文件的名字就会让整页重排。

**步骤数是描述，不是计划。** `describeSteps()` 按 runner 的 `step()` 调用顺序产出 `{kind, label}`：启服务（只有 `env.projectPath` 存在时）、`setup.http`、`setup.sql`、`capture`、`request`、四类断言、`teardown`。它是**描述**，runner 自己有真正的执行序列（因为它才知道要启哪个服务、拨哪个库）。两边的顺序一致是刻意的，不一致时步骤数就会开始撒谎。

### 5.12 编辑测试计划：表单是补丁，不是重新序列化

编辑页右栏有两种写法，一个开关切换：**表单**和 **YAML**。

表单管十个字段（`src/edit.js` 的 `EDITABLE_FIELDS`）：标题、编号、组、优先级、场景、接口、描述、方法、路径、期望状态码。就这些。setup SQL、变量捕获、teardown、mocks 只走 YAML——**给它们做表单等于做一个更差的文本编辑器**。

**保存时不 parse-and-dump，而是按行改文本。** 改一个字段就换掉那一行，缺的字段插在它该在的块里，其余字节原样不动。理由在 §17 里也写了一遍，因为它是这个模块存在的全部原因：dump 语法上无损，信息上有损——注释、空行、引号风格、字段顺序全丢，而注释正是作者写「这个用例要证明什么」的地方。一条用例被表单改一次优先级就擦掉思考痕迹，那这个表单不如一个 textarea。

补丁里两个位置要算对：

- **缺的顶层键**插在最后一个「值是同行标量」的顶层键之后，跳过 `description: >` 和 `env:` 这类块头。插到文件末尾会落在 `expect.database` 的列表项下面，读起来像断言的一部分。
- **缺的中间段**要先建成空块再往下走。`expect.response.headers.x-trace` 必须写成 `headers:` 加一行 `x-trace:`，写成 `headers: trace-1` 会把 mapping 变成字符串，文件当场不能加载。这条是测试抓出来的，不是想出来的。

**补丁在 Host 侧做**（`POST /case-fields` → `saveFields()` → `applyFields()` → `saveCase()`），不在浏览器里。磁盘是权威：浏览器若补丁自己上次取到的副本，就会把别处的改动静默回滚，而它看起来像一次正常的保存。走 Host 还让表单和 YAML 共用同一条保存路径，于是临时文件、解析器校验、编号分配、重名检查全部一致。

**`Save` 在两种模式下是一个按钮，两个意思**：表单模式提交字段补丁，YAML 模式提交全文。按钮做读者正在看的那件事，不做上一次做的那个。

### 5.13 批量运行：串行，且一条被拒不停整批

`运行全部 N` 提交整个文件列表到 `POST /run-all`，立刻拿到 batch id，前端 1.2 秒轮询 `GET /run-all?id=`。

**串行是刻意的。** 两条用例打同一个服务的同一个库会交错写，产生的失败看起来像 flaky，实际是调度问题。代价是墙钟时间，换来的是结果不依赖调度。

**一条被拒不会中断整批。** 它变成一条 `refused` 记录，下一条继续。否则一个缺凭据会掩盖后面全部结果，那正好是「运行全部」不该做的事。

**被拒的记录走同一个记录形状。** 第一版手写了一个对象字面量，`caseId` 填的是文件名——于是真机上批量跑出来两条 `refused`，列表上显示 `auth-register.yaml`，而每条正常记录显示 `REG-auth-register-confirm`。现在它经过 `newRunRecord()`，用 `error.path` 和 `error.loaded` 取真实身份（`prepareRun()` 抛错时把已加载的用例一起带出来，因为拒绝也要说清楚拒绝的是谁，而重新读文件只是第二次机会失败在别的原因上）。

---

## 6. 执行流水线

`src/runner.js` 的 `runCase()` 严格按 14 步执行，每步记入 `steps[]` 和 `evidence`：

```
0.  resolve          用例 + registry → 实际连接（名字变成 host/port/密码）
1.  guard            校验**解析之后**的目标（非生产、允许写、IDE 端口合法）
2.  ide.connected    连 IDE MCP，握手
3.  service.started  用运行配置启动，等就绪行 / healthPath
4.  database.connected 连所有命名库
5.  setup.sql        执行前置 SQL
6.  setup.http       发前置 HTTP
7.  setup.capture    读回服务生成的值，绑成变量
8.  request.sent     发被测请求（注入 trace 头）
9.  response.received 收响应
10. logs.collected   按 trace id 收日志
11. probe.sent       发 expect.calls 里的跟进请求
12. database.asserted 执行只读断言查询
13. teardown.http / teardown.sql  清理
14. service.stopped  停服务，轮询确认端口释放
```

`resolve` 在 guard 之前，这个顺序是必须的：用例里已经没有地址了，**护栏能检查的唯一地址是解析出来的那个**。先解析再检查，检查的才是真正会被拨号的目标。

### 6.1 为什么先启服务再连数据库

看起来反直觉，但顺序是有意的：**服务启动可能失败，而连接数据库几乎不会失败**。如果先连库，启动失败时报告里会有一堆「数据库已连接」的成功步骤，掩盖真正的失败点。先启服务，失败就立刻暴露在第一步。

### 6.2 端口占用预检

`startService()` 在调用 `execute_run_configuration` **之前**先检查 `baseUrl` 的端口有没有 listener。如果有，直接抛错：

```
port 8443 is already in use (pid 32060); stop that process first
```

这个检查是踩过坑才加的。没有它的时候发生过：旧进程还占着 8443，IDE 报告「启动成功」，日志也出现了 `Started RecordApplication`，但实际请求打到了**旧进程**——于是测试在验证一段根本没被执行的代码。这种假通过比失败危险得多。

### 6.3 日志跟随

`service.js` 的 `LogFollower` 按**字节偏移**增量读 `fullOutputPath`：

```js
readFrom(fromByte) → { text, nextOffset, lossy, spillPath? }
```

不是「每次重读整个文件」，而是记住上次读到哪，只读新增部分。这样长跑的服务不会让内存随日志增长而爆掉。

就绪判定用 `READY_PATTERNS`：

```js
[/Started\s+\S+\s+in\s+[\d.]+\s+seconds/i, /Tomcat started on port/i,
 /Netty started on port/i, /JVM running for/i, /Listening on\s+\S+/i]
```

命中任意一条即认为就绪；若配置了 `healthPath`，额外要求该路径返回 2xx。

### 6.4 停服的坑

IDEA MCP **没有** `stop_run_configuration`（已知限制 IJPL-214387）。`stopService()` 只能：

1. 先试 `xdebug_control_session(STOP)`（对普通 run 通常无效，但 debug 模式有效）
2. 用 `findListenerPid(port)` 找到监听进程
3. `taskkill /PID <pid> /T /F`（Windows）或 `kill -9`（POSIX）
4. **轮询端口直到真正释放**

第 4 步不能省。`xdebug_control_session(STOP)` 可能返回 `Timeout waiting for session to stop`，而端口其实已经释放了——**返回值不可信**，只能以端口状态为准。

---

## 7. 判定模型

### 7.1 判定完全确定性

```js
const verdict = fatal || failed.length > 0 ? 'failed' : 'passed'
```

就这一行。没有模型参与，没有「AI 觉得应该算通过」。`fatal` 是编排级异常（服务起不来、数据库连不上），`failed` 是断言失败列表。两者都空才 `passed`。

这个设计是本文档最核心的约束。原因：**如果判定可以出错，整个工具就失去了存在意义**。一个人工判断的测试，出错时你至少还能怀疑「是不是人看错了」；一个模型判断的测试出错时，你连怀疑的着力点都没有——你不知道它是看了什么得出这个结论的。

模型可以做的是**归因**：读到失败报告后，说「看起来是 SMTP 连接超时导致的 500」。这是有价值的，而且它是可证伪的——人可以去看日志验证这个说法。但「这次测试是否通过」必须由代码说了算。

### 7.2 统一的断言结构

每条断言返回同一个形状：

```js
{ ok: boolean, label: string, expected: any, actual: any, detail?: string }
```

好处是报告渲染、失败聚合、退出码计算都只需处理一种结构。新增断言类型不需要改报告层。

### 7.3 支持的操作符

`compare(actual, spec)` 支持：

| 操作符 | 语义 |
|---|---|
| `equals` | 深比较（`deepEqual`） |
| `notEquals` | 深比较取反 |
| `contains` | 字符串子串 / 数组包含 |
| `matches` | 正则匹配 |
| `exists` | 路径是否存在（区分「不存在」与「值为 null」） |
| `type` | 类型名：`string`/`number`/`boolean`/`object`/`array`/`null` |
| `greaterThan` / `lessThan` | 数值比较 |
| `in` | 枚举包含 |

### 7.4 路径读取

`readPath(value, path)` 支持 `a.b[0].c` 形式。数据库断言的 `rows[].path` 用 `[0].column` 直接索引结果集第一行。

---

## 8. 证据模型

### 8.1 报告结构

```jsonc
{
  "runId": "...",
  "caseId": "auth-register-confirm",
  "title": "...",
  "verdict": "passed" | "failed",
  "startedAt": "...",
  "durationMs": 12345,
  "fatal": null | { "message": "...", "name": "...", "details": [...] },
  "steps": [{ "name": "service.started", "at": 1200, "...": "..." }],
  "checks": [{ "ok": true, "label": "...", "expected": "...", "actual": "..." }],
  "failedChecks": [...],
  "warnings": ["..."],
  "evidence": {
    "request":  { "method": "...", "url": "...", "headers": {...}, "body": "..." },
    "response": { "status": 500, "headers": {...}, "bodyText": "...", "durationMs": 87 },
    "logs":     { "traceId": "...", "traceIdPresent": false, "lines": [...] },
    "database": [{ "database": "default", "sql": "...", "rows": [...], "checks": [...] }],
    "setup":    [...],
    "teardownHttp": [...],
    "probes":   [...]
  },
  "teardown": { "sql": [...], "http": [...], "service": {...}, "errors": [] },
  "environment": {
    "target": "record-local",
    "baseUrl": "https://127.0.0.1:8443",
    "configurationName": "RecordApplication",
    "projectPath": "E:/project/backend/Record",
    "registry": "C:\\...\\e2e.registry.yml",
    "databases": {
      "default": {
        "registryName": "iam",
        "source": "C:\\...\\e2e.registry.yml",
        "kind": "postgresql", "host": "127.0.0.1", "port": 5432,
        "database": "iam_db", "schema": "public"
      }
    }
  }
}
```

`environment` 里**没有密码**——它来自 `describeEnvironment()`，只报告「连到了哪里」，不报告「用什么连的」。`source` 字段指回凭据的来源（registry 文件路径，或 `db-mcp:<id>`），这样报告自己就回答了「要改密码该去哪儿改」。

### 8.2 双格式输出

- **JSON**（`${runId}__${caseId}.json`）：给机器读，给下一次运行做基线对比
- **Markdown**（`${runId}__${caseId}.md`）：给人读，章节顺序是 `Fatal` → `Checks` → `Why it failed` → `Warnings` → `Setup requests` → `Request` → `Response` → `Logs` → `Probe calls` → `Database` → `Teardown` → `Timeline`

顺序是刻意的：**结论在前，证据在后**。人先看「过没过、哪条没过」，需要深究时才往下翻原始请求和日志。反过来（先贴 500 行日志再给结论）是最难用的报告形态。

### 8.3 脱敏

`redactReport(report, secrets)` 在写盘前跑一遍：

- `secrets` 数组里的字面值（用例里声明的数据库密码等）→ 替换为 `***`
- 模式匹配：`password`/`token`/`authorization`/`Bearer`/JWT/手机号/身份证

报告会进 git、进聊天记录、被贴到 issue 里。密码明文出现在其中是迟早会出事的。

---

## 9. 安全护栏

`guard.js` 是**默认拒绝**的设计：

```js
const ALLOWED_HOST_PATTERNS = [
  /^localhost$/i, /^127\./, /^0\.0\.0\.0$/, /^::1$/, /^\[::1\]$/,
  /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
]
const PRODUCTION_HINTS = ['prod','production','live','prd','online','master','release','生产']
```

四道检查，全部针对**解析之后**的目标：

1. **主机必须是 loopback 或私网**。公网地址需要 `allowRemote: true` 显式放开。
2. **名字不能像生产**。`baseUrl`、数据库名、数据库主机名里出现 `prod`/`生产` 等一律拒绝，即使 `allowRemote` 也不行。因为「允许远程」和「允许打生产」是两件事。
3. **写操作需要显式授权**。`allowWrites` 默认 `false`。此时只要 setup/teardown 里出现 `INSERT`/`UPDATE`/`DELETE`/`MERGE`/`TRUNCATE`/`DROP`/`ALTER`/`CREATE`/`REPLACE`/`UPSERT`，整个用例**直接拒绝运行**——不是跳过那段 SQL 继续跑。跳过会让用例在一个没准备好的环境里跑出无意义的结论。

   这条检查会**读取 `sqlFile` 的内容**，不只是内联的 `sql:`。只查内联 SQL 的护栏等于没有护栏：把 `DELETE` 放进 `fixtures/reset.sql` 就绕过去了。因此 `checkTargets()` 是 async 的。
4. **IDE 端口合法**。

**为什么护栏校验解析后的地址而不是 YAML？**

这是引入 registry 之后必须改的一件事。用例里现在只有一个数据库名字（`name: iam`），`iam` 到底指向 `127.0.0.1:5432` 还是 `prod-db.corp:5432`，**只有查完 registry 才知道**。如果护栏去读 YAML，它看到的是一串名字，检查不出任何东西——那是一种「看起来有护栏」的假象，比没有护栏更危险。

所以 `checkTargets(definition, resolved, options)` 的第二个参数是解析结果，报错文案里也带来源：

```
database "default" (db-mcp:record) points at 10.0.5.11, which is not a loopback or private-network address
the target points at https://api.example.com, which is not a loopback or private-network address
```

`(db-mcp:record)` 这一段是刻意的：密码错时要改的是 dsh-db-mcp，不是这个插件；报告必须让人一眼看出该去哪儿改。

另外，`expect.database[].sql` 走的是 `runAssertionQuery()`，它**强制只读**（`select|with|show|explain|values`），与 `allowWrites` 无关。断言查询改数据是永远不允许的——那会让「验证」变成「制造」。

被拒绝时工具返回：

```json
{ "ok": false, "verdict": "refused", "error": "...", "problems": ["..."] }
```

注意 `verdict: "refused"` 与 `"failed"` 是分开的。**拒绝运行不是测试失败**——前者说明用例配置有问题，后者说明被测代码有问题。混在一起会误导人。

---

## 10. 数据库支持边界

当前只实现 **PostgreSQL 线协议**：`kind` 接受 `postgresql` / `postgres` / `opengauss` / `gaussdb`（别名 `postgres`/`pg`→`postgresql`、`gauss`→`gaussdb`、`open-gauss`→`opengauss`）。

`kind` 写在 registry 里，不在用例里。所以「这个库能不能连」是 registry 的属性，不是某条用例的属性。

其它 `kind` 会报错并给出可操作的替代方案：

> this build speaks the PostgreSQL wire protocol only (PostgreSQL, openGauss/GaussDB). For a database it cannot reach directly, assert its state through the service's own endpoint in `expect.response` or a setup/teardown request, or point `env.databases` at a PostgreSQL-compatible copy of the data.

从 dsh-db-mcp 导入时（`from: db-mcp`），只有 pg 系的 `kind` 会被接受；MySQL/SQLite/Oracle 的数据源会被明确拒绝，而不是导入后运行时才炸。

**这是诚实的限制，不是遗漏。** 加 Oracle 支持需要手写 TNS 协议或引入 `oracledb` 原生驱动（要编译，跨平台成本高）。在当前场景下，`expect.calls` 已经能覆盖大部分需求：服务自己知道它的数据是否一致，问它就行。

### 10.1 GaussDB / openGauss 兼容性

已实测的差异（`docs/gaussdb_connection_and_compatibility.md` 有完整矩阵）：

| 语法 | PostgreSQL 15 | openGauss 5.0 |
|---|---|---|
| `ON CONFLICT (col) DO UPDATE` | ✅ | ❌ |
| `ON CONFLICT DO NOTHING` | ✅ | ❌ |
| `ON DUPLICATE KEY UPDATE` | ❌ | ✅ |
| `MERGE INTO` | ✅ | ✅ |

`getMetaData()` 返回 `PostgreSQL 9.2.4` 是**假的版本号**，不能用 `getDatabaseMajorVersion()` 判断方言。只能用 `select version()` 的字符串。

另外 `search_path` 是 `"$user",public`，且 schema `gaussdb` 存在，所以 `current_schema()` 返回 `gaussdb` 而不是 `public`。**必须在 JDBC URL 里钉死 `?currentSchema=public`**，不能依赖默认行为。

---

## 11. 已知缺口（诚实清单）

设计文档如果不写缺口，就是把缺陷伪装成设计。以下是当前明确未完成的部分：

### 11.1 WireMock 只解析不执行

`env.mocks` 和 `setup.mocks` 会被 `case.js` 规范化成 `{scenario, stubFile}`，但 `runner.js` **从未消费它**——不启动 WireMock，不加载 stub。

后果：用例里写 `mocks:` 不会有任何效果，也不会报错。这是一个**静默无效**的配置项，比报错更糟。

修复方向：在 `startService()` 之前启动 WireMock 进程，用 `stubFile` 加载映射，跑完后停止。需要在 `env` 里加 `mocks.port`。

### 11.2 traceId 需要服务端配合

插件会往请求里注入 `X-Trace-Id`，然后按这个 id 过滤日志。但**服务端必须真的把它写进日志**才能生效。

以 Record 项目为例：`logback.xml` 的 pattern 只有 `%X{requestURI} %X{sessionId} %X{userId}`，`MDCUserInfoInsertFilter`（`@Order(-200)`）从不读任何 trace 头。所以服务端日志里永远没有这个 id。

插件对此的处理是**诚实降级**而不是静默放宽：

- 若没有一行日志带 trace id，`warnings` 里加一条：
  > no log line carried the trace id … so log assertions fall back to every line of this run and may match unrelated traffic. Add the header to the logging MDC (logback pattern `%X{traceId}`)…
- `evidence.logs.traceIdPresent = false` 记录下来
- 报告里 Logs 段落标注 `(no line carried it: every line of this run was scanned instead)`

这样报告不会假装日志是按 trace 精确匹配的。

**修复方式（服务端）**：在 `MDCUserInfoInsertFilter` 里 `MDC.put("traceId", request.getHeader("X-Trace-Id"))`，并在 `logback.xml` pattern 里加 `%X{traceId}`。

### 11.3 没有 Oracle 直连

见 §10。

### 11.4 用例没有并行执行

`e2e_run_case` 的 `isConcurrencySafe: () => false`。理由是端口和数据库 fixture 天然冲突——两个用例同时启服务会抢同一个端口。

### 11.5 没有基线对比

报告存了 JSON，但没有「和上次运行比，哪些断言从过变不过」的能力。这是下一步最有价值的功能，因为「回归」比「失败」更有信息量。

### 11.6 变量声明顺序敏感

`buildVariables` 按声明顺序插值，所以 `user.email: ${user.name}@x` 只有在 `user.name` 声明在它**前面**时才生效。反过来写会得到字面量 `${user.name}@x`。

这不算 bug（和 shell 的变量展开行为一致），但容易踩。理想做法是做两轮插值或拓扑排序。

### 11.7 `capture` 只支持单值

`setup.capture` 每条只取一行一列。要取多行（比如「把所有 fixture id 收集起来」）需要写多条 capture，或者先只取第一行。

另外 `capture` 只能读数据库，不能从 `setup.http` 的响应体里提取值。所以「调登录接口拿 token」目前做不到——那需要 `capture` 支持 `from: response`。

### 11.8 热重载曾是静默失效的

开发期用 `POST /plugins/e2e/api/reload` 换代码，最初实现是给入口模块加 `?v=N`：

```js
import(new URL(`./src/host.js?v=${generation}`, import.meta.url).href)
```

**这是无效的。** ESM 的模块缓存按每个模块**解析后的 URL** 建键，`?v=` 只改变了 `host.js` 自己的 URL；`host.js` 内部 `import './tools.js'` 仍然解析到不带查询串的 URL，拿到的是缓存里的旧模块。结果是：端点返回 `{"ok":true,"generation":2}`，进程继续跑旧代码。**一个报告成功的失败**，比直接报错更浪费调试时间。

实测验证（`dev/reload.test.mjs` 的雏形）：

```
first  = ORIGINAL
second = ORIGINAL
NESTED MODULE CACHED (bug)
```

修复用 `node:module` 的 `registerHooks()`，在 resolve 阶段给**本包目录下所有**模块 URL 追加 generation：

```js
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context)
    if (generation === 0 || !result.url.startsWith(rootUrl)) return result
    return { ...result, url: `${result.url}${result.url.includes('?') ? '&' : '?'}dshE2eGen=${generation}` }
  },
})
```

两个约束：`registerHooks` 是进程级的，所以必须用 `rootUrl` 前缀把作用域限制在本插件目录内，否则会干扰宿主和其它插件；它只在 Node ≥ 22.15 / 23.5 存在，老版本降级成「不热重载」而不是崩溃。

`dev/reload.test.mjs` 专门锁住这件事：改一个**入口不直接 import** 的模块（`src/yaml.js`，路径是 `index.js → host.js → tools.js → case.js → yaml.js`），断言第二次 reload 后读到的是新值；再写一个语法错误，断言 reload 返回 500 而不是静默成功。

### 11.9 运行时装入的插件可能进不了 client 模块图

见 §16.6。这里只记结论：`ClientModuleRegistry` 在构造时一次性扫描 Loader entries 并缓存，之后只处理被标 dirty 的 entry。运行时 link 进来的插件，其 `dsh.client` 声明出现在扫描之后，于是**永久缺席且无任何日志**。

插件用 `nudgeClientScan()` 主动触发一次重新扫描来绕过它，并在 `/status` 暴露 `client.registered`。但这依赖 registry 的内部行为（`internal/plugin` 事件 + `dirty`/`flush`），属于**非契约依赖**：宿主升级后可能失效。

真正的修法在宿主侧——`resolveMeta` 应该对运行时新增的 Loader entry 也生效，或者 `reconcilePackage` 应该在 entry 出现时自动跑。在它修好之前，这个 nudge 是唯一能让「运行时装插件」和「面板」同时成立的办法。

### 11.10 registry 不能在面板里改

数据源现在只能手改 `e2e.registry.yml`。面板能读、能校验、能在报错里提示，但不能增删。

原因不是难，而是**写回 YAML 会丢掉注释**——而 registry 里的注释（「这个 id 换成你机器上的」「生产库不要加进来」）恰恰是这个文件最有价值的部分之一。要正确做这件事需要一个保留注释的 YAML 编辑器（ruamel 那种），这超出「一个插件顺手做掉」的范围。

在它实现之前，名字写错时的报错必须足够好——这就是 `e2e_list_databases` 与 `describeRegistry()` 存在的理由。

### 11.11 `exports` 里不放 `./package.json` 会让自检说谎

`package.json` 的 `exports` 最初只导出了 `.`、`./client`、`./locale/*.json`、`./icon`。这在这份代码自己的运行路径上完全够用——插件从不 `require` 自己的 manifest。

但 `/status` 的 `clientDiagnostics` 曾经用 `require.resolve('dsh-e2e/package.json')` 去读 manifest。这条路在 `exports` 没有 `./package.json` 时抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`，于是诊断输出是：

```json
{ "resolve": { "error": "Package subpath './package.json' is not defined by \"exports\" ..." } }
```

**这条报错与「面板为什么没出现」毫无关系**，但它出现在诊断字段里，等于告诉排查的人「你的插件有问题」。一个自检字段如果会自己制造假警报，比没有这个字段更糟。

两处都修了：

1. `exports` 加上 `"./package.json": "./package.json"` —— 让任何工具（包括 DSH 自己的）能读到 manifest，这是包的基本礼貌。
2. 诊断改为**按 registry 的方式读**：从解析出的模块路径向上找 `package.json`（即 `nearest` 那一步），不用包说明符。理由是 `resolveMeta` 本来就不走说明符，复刻它的真实路径才能解释它的真实行为。

现在输出的是事实：

```json
{ "manifestPath": "...\\dsh-e2e\\package.json", "name": "dsh-e2e",
  "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-locale"] },
  "clientExport": "./client.js", "clientFile": 55569 }
```

**教训**：诊断代码自己也是代码，也会出错。一个报错字段必须回答「它要回答的那个问题」，而不是回答「我这条读取路径顺不顺利」。

### 11.12 扫描器只认 Spring MVC 注解

`src/scan.js` 读的是 Spring 的注解（`@RestController`/`@RequestMapping`/`@PostMapping`/`@RequestBody`）与 Bean Validation 的约束注解，外加 MyBatis-Plus 的 `@TableName`。

换一个框架（Express、FastAPI、ASP.NET、JAX-RS）它读不到端点，`e2e_scan_endpoints` 会返回 0 条并给出 `warnings`。**它不会假装成功**：没有端点就明确说没有，而不是猜几个出来。

这不是能力问题，是刻意收窄——一个「什么都能扫一点」的扫描器会把猜测混进事实里，而骨架的全部价值在于它写的东西源码里真的有。

另外它不做跨文件类型解析：`private AddressDto address;` 只会得到一个字段名，不会展开成嵌套结构。展开需要真正的语法树，而当前用的是正则 + 括号配对——够用，但边界清楚。

### 11.13 侧栏图标抛异常时，整格静默消失

面板做完之后，侧栏里一直没有「端到端测试」这个入口。`/status` 说 `client.registered=true`，bundle 在模块图里，`main` 面板也能打开——三件事都成立，但侧栏那一格就是空的。

原因是一行漏掉的声明：

```js
function SidebarIcon(props) {
  return h('svg', { width: size, height: size, /* … */ })
}
```

`size` 从未声明。`SidebarIcon` 每次渲染都抛 `ReferenceError`，React 的错误边界把这一格吞掉，页面其余部分照常工作——**没有报错、没有日志、没有空白面板**，只有一个不存在的按钮。

三个检查器全都没抓到它，而且都"合理地"没抓到：

| 检查器 | 为什么没抓到 |
| --- | --- |
| `node --check` | 未声明的标识符是运行时错误，不是语法错误 |
| `dev/client.test.mjs` | 它把 bundle 当**文本**读，文本里 `size` 看起来完全正常 |
| `dev/render.test.mjs` | 它只渲染了注册进 `main` 的组件，侧栏组件从未被调用 |

所以修法不只是补上 `const size = props && typeof props.size === 'number' ? props.size : 20`，而是让探针**像 shell 那样真的渲染一次侧栏组件**：

```js
const icon = sidebarComponent({ size: 20 })
assert.equal(icon.props.width, 20)
```

验证方式是把修复删掉再跑一遍——`17 passed, 2 failed`，恢复后 `19 passed, 0 failed`。一个不能在你删掉修复时报错的探针，等于没有这个探针。

教训写在 README 里的一句话：**注册进 slot 的组件也是组件，也要被渲染过一次才算测过。** 「注册成功了」和「渲染得出来」是两件事，而只有后者是用户能看见的。

---

## 12. 真机验证记录

两个示例用例都在真实环境跑通了完整链路：真实 IDEA（`RecordApplication` 运行配置）、真实 Spring Boot 服务（`https://127.0.0.1:8443`）、真实 PostgreSQL 15（`iam_db`）。

### 12.1 `auth-register-confirm` — PASS（~7.8s）

| 断言 | 结果 |
|---|---|
| service readiness | ✅ `Tomcat started on port 8443 (https)` |
| response.status | ✅ 500 |
| response.body contains | ✅ `register failed` |
| users 行数 / valid_state / role | ✅ 1 / `0` / `USER` |
| codes 行数 / valid / code 格式 | ✅ 1 / `1` / `230285` 匹配 `^\d{6}$` |

这个用例演示了本工具最核心的价值：**响应码是 500，但数据库写入完全正确**。这一组合精确定位了故障点——写库成功、失败发生在写库之后的发邮件环节（`MailSendException: Got bad greeting from SMTP host: smtp.168.com, port 465`）。如果只看 HTTP 状态码，会误判成「注册功能坏了」；只看数据库，会误判成「一切正常」。

### 12.2 `auth-confirm-code` — PASS（~7.8s）

演示完整组合：`setup.sql` 清场 → `setup.http` 注册（`expect_status: 500`）→ `setup.capture` 取验证码 → `request` 用它确认 → `expect.database` 断言两表终态。

| 断言 | 结果 |
|---|---|
| service readiness | ✅ |
| response.status | ✅ 200 |
| response.body contains | ✅ `code verify successfully` |
| users.valid_state | ✅ `0` → `1` |
| codes.valid | ✅ `1` → `0` |

两个用例都在 `finally` 里停掉了服务，端口 8443 事后确认已释放。

### 12.3 真机跑出来的三个 bug

开发过程中，只有真跑才能暴露的问题（都已修复）：

1. **`teardown` 引用了重构后不存在的 `db` 变量** → `ReferenceError: db is not defined`。纯语法检查发现不了，因为 `db` 在 `try` 块里定义过，`finally` 里作用域不可见。修复：在 `finally` 里重新 `dbFor('default')`。
2. **`user.name: e2e${random.hex}` 里的生成器没展开** → 字面量 `${random.hex}` 原样进了请求体，每次运行都用同一个「唯一」用户名，第二次就撞唯一索引。修复：`buildVariables` 对自己声明的变量值也做一次插值。
3. **`rowCount` 断言没实现，`rows` 被误当成数字** → 断言报 `null vs 1`。修复：`rowCount` 单独字段，`rows` 改为逐行断言列表。

第 1 个是纯粹的编码疏忽，第 2、3 个是**设计缺口**——它们在写文档时才被想清楚，但只有真跑才被证实。

### 12.4 端口预检抓到了真实事故

第一次真跑时报告直接给出：

```
port 8443 is already listening (pid 22436), so starting "RecordApplication"
would either fail or leave the case talking to the old process.
```

那是之前手工验证时遗留的进程。如果没有这个预检，IDE 会报告「启动成功」，日志会出现 `Started RecordApplication`，但请求实际打到旧进程——**测试在验证一段根本没被执行的代码**，然后给出一个绿色的「通过」。

### 12.5 重构后的回归验证

引入 registry / resolve / 面板之后重跑：

| 项目 | 结果 |
|---|---|
| `auth-confirm-code`（经面板 `POST /run`，`allowWrites: true`） | **passed**，7 断言 / 0 失败，约 20s |
| `auth-register-confirm`（经工具 `e2e_run_case`） | passed |
| 报告落盘 | `run-...__auth-confirm-code.{json,md}`，`checks=7 warnings=0 steps=12` |
| 证据完整性 | `request` / `response`（200，24 字节）/ `database`（2 条）/ `capture` / `setup` / `teardownHttp` 全部在 |
| 用例文件 | 已不含任何 host/port/password，只有 `target: record-local` + `databases.default: {name: iam, schema: public}` |

这一步验证的是**重构没有改变判定语义**：同一个用例、同一套断言，改动前 passed，改动后仍 passed，且证据结构一致。数据来源换了一层（registry → 解析 → 连接），但断言看到的仍然是真实数据库里的真实行。

### 12.6 重构过程中修掉的三个 bug

都只有真跑或真读代码才能发现：

1. **registry 被当成坏用例** —— 它和用例放在同一目录，`loadCaseDirectory` 把它当 YAML 用例解析，于是列表里永远有一条 `unknown top-level field(s) targets, databases` 的失败。修复：`isRegistryFileName()` 过滤。同时补了一条测试确保「真坏的用例仍会被报出来」——否则这个过滤就变成了藏。
2. **示例 registry 引用了不存在的 dsh-db-mcp 数据源** —— 示例里写死 `id: gaussdb`，但机器上实际叫 `record`。装到别人机器上必然报错。修复：示例里把那段注释掉，并说明去哪里查真实 id。一个装到别人机器上必然报错的示例，比没有示例更糟。
3. **面板看不到自己** —— 见 §16.6。这个最贵：代码全对，静态检查全绿，接口真跑通过，但浏览器里就是不出现，而且没有任何错误信息。

第 3 个的教训值得单独记：**「没有报错」不等于「正常工作」**。一个从未被加载的模块不会报错，一个从未被调用的注册函数不会报错。所以在 `/status` 里加了一个直接回答这个问题的字段（`client.registered`），而不是等下次再靠猜。

### 12.7 骨架闭环验证

「扫描 → 生成 → 编辑 → 保存 → 运行」这条新链路自己也要跑一遍，否则它只是几个能返回 JSON 的函数。

拿 `POST /auth/register` 生成的骨架，补上三条断言（`status: 500`、`body_contains: register failed`、一条查 `users` 表的 SQL），跑：

| 项目 | 结果 |
|---|---|
| 运行 | **passed**，5 断言 / 0 失败 |
| 报告 | `run-2026-11-14T14-11-17-703Z-07e3d1__post-auth-register.md` |
| 变量贯通 | 请求体 `{"username":"e2e81d316933253dd8a",...}` 与断言 SQL `WHERE username = 'e2e81d316933253dd8a'` **是同一个值** |

最后一行是这个功能能不能用的全部判据。如果生成器把 `${random.hex}` 直接写进 body，这两处就会是两个不同的随机串，断言永远查不到刚插入的行——而报告只会说「期望 1 行，实际 0 行」，看起来像是业务 bug。§16.5 记了这个坑。

跑完已删除该临时用例：它验证的是链路，不是一个要长期维护的测试。

### 12.8 面板验收时暴露的四个缺陷

扫描链路通了以后，把面板的每个路由都用真实请求打了一遍。四个缺陷全都是「静态检查全绿、单元测试全绿、但真跑就是不对」的类型：

| 缺陷 | 症状 | 为什么测试没抓到 |
|---|---|---|
| `client.js` 读 `endpoint.method`，Host 发的是 `httpMethod` | 端点列表照常渲染，METHOD 那一列空白；点「用这个接口」发出 `method: undefined`，Host 读成「任意方法」 | 字段名不一致不抛错，只是安静地少显示一列。现在 `dev/client.test.mjs` 直接读 `src/scan.js` 断言字段名，并断言 bundle 里不存在 `/endpoint\.method\b/` |
| `/report` 的两个分支代码完全一样 | 请求 markdown 却拿到 JSON 报告时，前端渲染出 `undefined` | `if (format === 'json' \|\| result.format === 'json') return result; return result` 两行都合法，覆盖率 100% |
| 保存/校验的报错里带着已删除的临时文件路径 | `invalid YAML (…\case.yaml.tmp-26556-…:2:8)`，用户既看不到自己认得的文件名，那个文件也已经不在了 | 报错**内容**是对的，只是名字错了；而错误路径没人读 |
| 上面那条的第一版修复没有生效 | 只改了 `error instanceof CaseError` 分支，而 YAML 语法错误不是 `CaseError`，走 else 分支 | 改完没重跑，是靠 `curl` 真发一次才看出来的 |

第三条的修法值得记：

```js
function describeAtPath(message, temporary, final) {
  return String(message).split(temporary).join(final)
}
```

两个分支都要过这一层。教训是**改写错误信息的代码本身也要被测试**，所以 `dev/unit.test.mjs` 新增了 `panel save` 段，直接断言错误里含真实文件名、不含 `/\.tmp-\d+-\d+/`、且目录里没有残留文件——三条一起断言，因为「改对了名字但留下垃圾文件」和「没改名字」一样糟。

### 12.9 编号自动分配的真机验证

`caseId` / `endpoint` / `scenario` / `priority` 落地后，用真实请求把分配链路打了一遍：

```
POST /next-case-id {"endpoint":"POST /auth/register"}   → {"caseId":"REG-001"}
POST /next-case-id {"endpoint":"GET /health"}           → {"caseId":"HEA-001"}
POST /next-case-id {"endpoint":""}                      → 422 "next-case-id needs an endpoint, like \"POST /auth/register\""
```

写一个**没有** `caseId` 的用例并保存：

```jsonc
POST /case
{ "file": "...\\zz-assign-test.yaml", "yaml": "id: zz-assign-test\ntitle: …" }
→ { "caseId": "REG-001", "assigned": "REG-001",
    "yaml": "id: zz-assign-test\ncaseId: REG-001\ntitle: …" }
```

返回的 `yaml` 里那一行是插在 `id:` 后面的，其余每一行（包括注释、中文标题、字段顺序）原样保留。

再存一次同一份文本：`assigned` 为空、`caseId` 仍是 `REG-001`、文件里只有**一行** `caseId:`。

用另一个文件抢同一个编号：

```
→ 422 "caseId REG-001 is already used by zz-assign-test.yaml in this folder;
       case ids have to be unique so a report can name one case"
```

`GET /bootstrap` 的用例列表带上了分组：

```
POST /auth/confirmCode  total=2 normal=2 error=0
  CC-auth-confirm-code      [normal/medium] 确认验证码应激活用户并使验证码失效
  CC-post-auth-confirmcode  [normal/medium] POST /auth/confirmCode — confirmCode
POST /auth/register     total=1 normal=1 error=0
  REG-auth-register-confirm [normal/medium] 注册后确认验证码，用户状态应被激活
```

注意 `CC-` 与 `REG-` 这两条是**派生**编号（`caseIdDerived: true`）——它们是手写的老用例，还没经过一次保存。面板会把它们显示成「保存时分配」而不是伪装成作者写的编号；一旦在面板里保存，就会变成 `CC-001` 这样的真编号。

验证用的两个临时用例已删除，用例目录恢复为 4 个文件。

### 12.10 用例清单与编辑页的真机验证

`group` / `plan.js` / `edit.js` 落地后，用真实请求打了一遍：

```
GET /projects
→ Record | statusCounts all=3 planned=0 generated=0 running=0 passed=3 failed=0 blocked=0
  group=POST /auth/confirmCode total=2 label=allPassed
    CC-auth-confirm-code       status=passed steps=8 asserts=True
    CC-post-auth-confirmcode   status=passed steps=1 asserts=False
  group=POST /auth/register  total=1 label=allPassed
    REG-auth-register-confirm  status=passed steps=6 asserts=True
```

三条用例的 `group` 都是空字符串，所以分组回退到 `endpoint`——这正是设计里说的「没写只是能看，不是有意义」。`CC-post-auth-confirmcode` 的 `asserts=False` 说明它是骨架级用例（只发请求），但因为它有一条历史 `passed` 报告，状态仍显示 `passed`：**状态反映最后一次运行，`asserts` 只决定「从未运行」时是 `planned` 还是 `generated`**。两者是不同的问题，页面上分开显示。

`POST /case-fields` 真机测试（临时用例 `zz-fields-test.yaml`，带注释与嵌套块）：

```jsonc
POST /case-fields
{ "file": "...\\zz-fields-test.yaml",
  "fields": { "title": "Renamed by the form", "group": "Registration", "priority": "high" } }

→ { "caseId": "REG-001", "assigned": "REG-001",
    "yaml": "# A case proves one behaviour.\nid: zz-fields-test\ncaseId: REG-001\n
             title: Renamed by the form\npriority: high\nscenario: normal\n
             endpoint: POST /auth/register\ngroup: Registration\n
             \n# This comment explains the request.\nrequest:\n  method: POST\n  …" }
```

三件事同时成立，这是这条路径存在的意义：

1. `title` **就地替换**（行数没变）
2. `group` 是**新键**，插在 `endpoint:` 之后、注释之前——不是插到文件末尾落在 `expect.database` 的列表项下面
3. `# This comment explains the request.` 与 `request:`/`json:` 块**逐字保留**

同一个请求里还顺带分配了 `caseId: REG-001`（插在 `id:` 之后），证明「表单补丁 + 编号分配 + 注释保留」三件事在同一条保存路径上兼容，不是三条互相打架的路径。

批量运行：

```
POST /run-all {"files":["auth-register.yaml","auth-confirm-code.yaml"]}
→ {"id":"batch-…","status":"running","total":2,…}

GET /run-all?id=batch-…
→ {"status":"finished","total":2,"refused":2,
   "runs":[{"caseId":"REG-auth-register-confirm","verdict":"refused",
            "error":"refusing to run case \"auth-register-confirm\": … writes are disabled …"}, …]}
```

**这里抓到一个真 bug**：第一版的 `refused` 记录是手写的对象字面量，`caseId` 填的是文件名，于是这两行在页面上显示 `auth-register.yaml`，而每条正常记录显示 `REG-auth-register-confirm`。修法是让它走 `newRunRecord()`，并且 `prepareRun()` 抛错时把已加载的用例一起带出来（`error.path` / `error.loaded`）——拒绝也要说清楚拒绝的是谁，重新读文件只是第二次机会失败在别的原因上。

允许写库后同一条用例真的跑通了：

```
POST /run-all {"files":["auth-register.yaml"],"allowWrites":true}
→ {"status":"finished","passed":1,"runs":[{"verdict":"passed","durationMs":10475,
     "checks":9,"reportPath":"…\\run-2026-11-14T16-21-45-566Z-8136e5__REG-auth-register-confirm.md"}]}
```

---

## 13. 工具接口

注册了 7 个工具。它们和面板共用 `store.js`，所以两边看到的用例列表、报告列表完全一致。

### `e2e_list_cases`

列出可用用例。

```jsonc
{ "dir": "可选，默认用配置的 caseDir" }
```

每条带 `id`/`title`/`tags`/`description`/`file`/`name`/`target`/`configuration`/`databases`。`failures` 是解析失败的文件的清单——**坏用例会出现在这里，而不是被静默跳过**，否则「列表里少了一个用例」这件事没人会发现。

### `e2e_list_databases`

列出 registry 里的 target 与数据源。

```jsonc
{ "caseDir": "可选，用来定位 registry" }
```

返回 `{ registryFile, targets: [{name, baseUrl, configurationName, projectPath}], databases: [{name, source, kind, host, port, database, user, schema, passwordConfigured}] }`。

**永远不含密码**，只有 `passwordConfigured: true/false`。这个工具存在的理由：名字写错时，与其让人去翻 `e2e.registry.yml`，不如直接问插件有哪些名字。

### `e2e_probe_environment`

检查这台机器现在能不能跑用例：IDE MCP 通不通、暴露了哪些运行配置、目标地址答不答。

```jsonc
{ "projectPath": "E:/project/backend/Record", "baseUrl": "https://127.0.0.1:8443", "idePort": 64342 }
```

**用例启动失败时先跑这个。** 它把「IDE 没开」「端口不对」「配置名写错」这三类最常见的问题直接区分开。

### `e2e_run_case`

跑一个用例。

```jsonc
{
  "file": "相对 caseDir 的路径，或绝对路径",
  "caseId": "或用例 id（二选一）",
  "allowRemote": false,
  "allowWrites": false,
  "keepServiceRunning": false,
  "idePort": 64342,
  "traceHeader": "X-Trace-Id"
}
```

超时 15 分钟。返回 `{ ok, verdict, reportPath, summary }`。

解析失败（名字写错、缺 baseUrl）时返回 `verdict: "refused"` 并附上可用的名字，**不抛异常**——「你的配置不对」是一个可操作的答案，不是一次崩溃。

### `e2e_read_report`

读已生成的报告。

```jsonc
{ "path": "报告路径", "format": "markdown" | "json" }
```

路径必须在报告目录内。不在时退回普通文件读取，这样用户手上指向别处的旧路径仍然可读。

### `e2e_scan_endpoints`

读源码，列出项目实际提供的 HTTP 端点。

```jsonc
{ "projectPath": "项目根目录（可选，默认取 registry 里第一个有 projectPath 的 target）" }
```

返回 `{ ok, projectPath, scannedFiles, controllers, entities, warnings, endpoints }`。每个端点带 `method`、`path`、`controller`、`javaMethod`、`file`、`line`，以及 `requestBody: { type, fields }`——字段上只写源码真的声明了的约束（`minLength`/`maxLength`/`pattern`/`email`），没声明的字段不会带上空值，因为「没有约束」和「约束是空的」在报告里长得一样会误导人。

只读，不写任何文件。工具结果必须是无损 JSON，所以内部过一次 `JSON.stringify`/`parse`——一个 `undefined` 属性会让宿主拒掉整个回答。

### `e2e_scaffold_case`

把扫描到的一个端点变成用例骨架。

```jsonc
{
  "path": "/auth/register",        // 必填
  "method": "POST",                // 同一个路径有多个方法时才需要
  "projectPath": "...",            // 可选
  "target": "record-local",        // 可选，默认第一个 target
  "database": "iam",               // 可选，写进 env.databases.default.name
  "schema": "public",              // 可选
  "id": "post-auth-register",      // 可选，默认按方法与路径生成
  "expectStatus": 200              // 可选，不知道就别传
}
```

返回 `{ ok, id, target, caseId, yaml, endpoint, notes, warnings }`。**不落盘**：骨架是要在编辑器里改的草稿，每点一次列表就产生一个半成品文件比没有更方便，只是更乱。

`caseId` 由调用方铸，不由生成器铸：只有 `src/panel.js` 和 `src/tools.js` 能看见用例目录里已经占了哪些号，而 `src/scaffold.js` 刻意保持为纯函数（端点 → YAML），它的测试也依赖这一点。

### 13.1 面板 REST API

面板走同一套逻辑，只是换了个传输层。全部挂在 `/plugins/e2e/api`：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/status` | 插件状态、工具名、用例目录、`client.registered` |
| GET | `/bootstrap` | 一次拿全：用例（含 `groups`）、registry、报告、IDE 设置 |
| GET | `/cases` | 用例列表 |
| GET | `/case?file=` | 读一个用例（含原始 YAML 与四个描述字段） |
| POST | `/case` | 保存（先写临时文件校验，见 §16.2；无 `caseId` 时自动分配，见 §5.9） |
| DELETE | `/case?file=` | 删除 |
| POST | `/next-case-id` | 查某个接口的下一个空闲编号（面板在保存前就能显示它） |
| POST | `/validate` | 只校验，不运行 |
| GET | `/databases` | registry 里的 target 与数据源 |
| GET | `/reports` | 报告列表 |
| GET | `/projects` | 项目表：按服务归并、带最近结果与活动时间（见 §5.10） |
| GET | `/report?path=&format=` | 读一份报告 |
| POST | `/run` | 启动运行，**立刻返回 run id** |
| GET | `/run?id=` | 轮询运行状态 |
| POST | `/explain` | 让模型解释失败（不改判定） |
| POST | `/generate` | 让模型起草用例 |
| POST | `/scan` | 扫描项目源码，列出端点（见 §13 `e2e_scan_endpoints`） |
| POST | `/scaffold` | 端点 → 用例骨架（见 §13 `e2e_scaffold_case`） |
| POST | `/case-fields` | 表单补丁：只提交改过的字段，Host 侧做行级补丁后走同一条保存路径（§5.12） |
| POST | `/run-all` | 批量运行，立刻返回 batch id（§5.13） |
| GET | `/run-all?id=` | 轮询批次进度 |

`/bootstrap` 存在的理由：面板一打开需要用例、registry、报告、IDE 设置四样东西。四个请求就是四次往返、四次可能的失败、四份要分别处理的 loading 状态。一个请求换来一个「要么全有要么全无」的初始状态，前端代码简单得多。用例列表里还带一份 `groups`（按 `group` 分组、带场景计数与 `summary`），前端不需要自己再算一遍分组——算两遍就会有一天算得不一样。同理每条用例的状态由 `/projects` 算好下发（§5.11）。

`POST /case` 的返回值里必须带 `yaml`：保存可能插入了一行 `caseId:`，编辑器要显示磁盘上真正的内容，否则下一次保存会把刚分配的那行丢掉。`POST /case-fields` 同样返回 `yaml`，理由相同。

**带 `mutate: true` 的路由**（`POST /case`、`DELETE /case`、`POST /next-case-id`、`POST /case-fields`、`POST /validate`、`POST /run`、`POST /run-all`、`POST /explain`、`POST /generate`、`POST /scan`、`POST /scaffold`）会校验 `Origin` 头与 `Host` 一致，否则 403。这挡住跨站请求伪造——一个本地 HTTP 服务如果可以被任意网页 POST，那就等于把「跑测试、写文件」的能力开放给了浏览器里打开的每一个标签页。没有 `Origin` 头的请求（curl、脚本）放行，因为它们不是 CSRF 的载体。

---

## 14. 目录结构

```
dsh-e2e/
├── index.js                 插件入口（inject: webServer）+ 热重载钩子
├── client.js                浏览器半：项目表 + 用例清单 + 编辑测试计划
├── package.json             bundle 元数据（含 dsh.client 段）
├── cordis.patch.yml         插入到宿主插件列表
├── icon.svg                 面板图标
├── locale/
│   ├── en.json              meta.title = "End-to-end tests"
│   └── zh.json              meta.title = "端到端测试"
├── src/
│   ├── host.js              组装、示例播种、/status、客户端半自检
│   ├── panel.js             面板 REST API
│   ├── store.js             用例与报告的唯一磁盘入口（路径守卫、编号分配）
│   ├── projects.js          项目表：按 origin 归并 target、按最新报告汇总
│   ├── plan.js              步骤描述、状态判定、组内结论（纯函数）
│   ├── edit.js              表单 → YAML 的行级补丁
│   ├── ai.js                生成用例、解释失败
│   ├── scan.js              读 Spring 源码：端点、DTO 字段与约束、实体表名
│   ├── scaffold.js          端点 → 用例骨架（不含断言）
│   ├── tools.js             7 个工具注册
│   ├── case.js              YAML 解析与规范化
│   ├── registry.js          target / 数据库注册表 + dsh-db-mcp 导入
│   ├── resolve.js           用例 + registry → 实际连接
│   ├── guard.js             环境护栏（校验解析后的地址）
│   ├── runner.js            14 步流水线
│   ├── service.js           启停服务 + 日志跟随
│   ├── idea.js              IDEA MCP 客户端
│   ├── http.js              HTTP 客户端
│   ├── pg.js                PostgreSQL 线协议
│   ├── db.js                数据库门面
│   ├── assert.js            断言引擎
│   ├── report.js            报告渲染
│   └── yaml.js              YAML 加载与输出
├── vendor/
│   └── js-yaml.mjs          零依赖 ESM（104KB）
├── examples/                示例用例 + 示例 registry
├── dev/                     十个套件 + 真环境探针
└── docs/
    ├── design.md            本文档
    └── gaussdb_connection_and_compatibility.md
```

**双半插件**：Host 半（`index.js` + `src/`）提供工具与 REST API，Client 半（`client.js`）提供面板。`package.json` 的 `dsh.client` 段声明 `platform: 'web'`、`immediately: true`，`exports["./client"]` 指向 bundle。

两个半的耦合只有一条：`fetch('/plugins/e2e/api/*')`。面板不 import 任何 Host 代码，Host 不知道面板长什么样。

---

## 15. 演进路线

按价值排序：

1. **基线对比**（§11.5）——「上次过、这次不过」是回归，比「这次不过」信息量大得多。需要给每条 check 一个稳定 key（`label` 的哈希），然后和上一次同 `caseId` 的 JSON 比对。
2. **WireMock 落地**（§11.1）——补上外部依赖的隔离能力。
3. **traceId 服务端配合**（§11.2）——需要在被测项目里改两行代码，收益是日志断言变精确。
4. **用例依赖**——`depends_on: [other-case]`，让「先注册再登录」这类多步流程能拆成独立可复用的用例。
5. **CI 模式**——不依赖 IDE，用 `java -jar` 或 `docker run` 启服务，让同一套用例能在流水线里跑。
6. **面板里改 registry**——现在 registry 只能手改文件。让面板能增删数据源（并且写回时保留注释）是个独立的问题，值得单独做。
7. **扫描器认更多框架**（§11.12）——目前只认 Spring MVC 注解。Express、FastAPI、ASP.NET 各要一套，但骨架生成的价值与框架无关。

---

## 16. 面板与 AI

### 16.1 首次打开不能是空的

插件挂载时，如果**没有显式配置** `config.caseDir` / `config.caseDirs`，它会：

1. 在运行时目录下建 `cases/`
2. 如果这个目录里**一个 `*.yml` / `*.yaml` 都没有**，把 `examples/` 里的示例用例和示例 registry 复制进去

两条约束：**已有文件永不覆盖**（用户改过的示例是他自己的），**显式配置了目录时绝不写入**（那是用户的文件夹，不是插件的地盘）。

一个装好之后打开是「没有配置用例目录」的面板，等于一个没装。而一个会往用户指定目录里悄悄塞文件的插件更糟。所以分界线是「这个目录是不是插件自己挑的」。

### 16.2 保存必须经过真正的解析器

```
写 <path>.tmp-<pid>-<time>
  → loadCaseFile(tmp)   ← 和真实运行完全同一个解析器
  → 失败：unlink + 422（把 details 一起返回给编辑器）
  → 成功：rename(tmp, path)
```

磁盘上出现一份坏用例，比拒绝一次保存糟得多：它会在列表里长期显示为一个红点，而写它的那一刻恰恰是你最不知道自己在写什么的时候。先写临时文件还顺带解决了「写到一半崩溃留下半个文件」——`rename` 是原子的。

返回 422 时带 `details`，编辑器直接把问题显示在文档旁边，而不是弹一句「保存失败」。

### 16.3 运行必须是后台的

`POST /run` 立刻返回 run id，前端按 900ms 轮询 `GET /run?id=`。

一次真实运行要：连 IDE → 启 JVM → 轮询就绪行 → 连库 → 跑 SQL → 发请求 → 收日志 → 断言 → teardown → 停服。**十几秒到几分钟**。挂在 HTTP 请求上有三个问题：浏览器超时、用户关标签页就断（而服务还在跑、还占着端口）、面板整页卡住没法看别的。

轮询不是最优雅的方案，但它是唯一在「服务端必须跑很久」和「客户端随时可能离开」之间都成立的那个。

### 16.4 模型写 YAML，不写判定

`src/ai.js` 提供两个能力：

**生成用例**：给一段自然语言描述，产出 YAML。

- 上下文里注入 registry 里**真实存在的** target 名与数据库名，所以生成物引用的是这台机器上真有的名字
- 同时注入现有用例的 id 列表，避免 id 撞车
- system prompt 明确禁止发明连接串
- `temperature: 0.2`——要的是稳定复现，不是创意
- 生成物必须**过和真实用例同一个 YAML 解析器**（`parseYaml`），并且是一个带 `id` 与 `request` 的映射才允许返回

最后一条是关键：模型输出的 YAML 如果不是一个合法用例，那它就不是一个用例，不管它看起来多合理。

> 注意这里校验的是**能解析**，不是**能跑**。`parseYaml` 只保证语法与顶层形状；`normalizeCase` 的字段级校验（未知字段、数据库引用格式）发生在用户点保存时——那时生成物已经是磁盘上的候选文件，报错会精确指到行。生成阶段就做全量规范化的话，模型一次小错就得整段重来，反而更难用。

**解释失败**：给一份失败的 report，产出归因。

- 只读 `failedChecks` / `warnings` / `fatal` / `request` / `response` / `database` 摘要
- system prompt 里写死：`The assertions already decided the verdict; you never change it`
- 输出进 `run.explanation`，**永不并入 `checks`**

理由在 §7.1 已经说过，这里是它的具体落地：**模型可以归因，不能判决**。一个人工判断的测试出错时，你至少还能怀疑「是不是人看错了」；一个模型判断的测试出错时，你连怀疑的着力点都没有。而归因是可证伪的——人说「看起来是 SMTP 超时」，你可以去看日志验证。

失败报告在归因前会先问「这条不是已经过了吗」：已通过的运行、还没跑完的运行、没有报告的运行，都直接 409 拒绝，不让模型去解释一件没有发生的事。

### 16.5 骨架来自源码，断言来自人

用户的反馈很直接：「手工写 yaml 可能不太好，容易有格式问题」。

但格式问题其实已经有定位了——检查器对坏缩进会给出 `invalid YAML (…:4:14): bad indentation of a mapping entry`，附行号片段和 `------------------^` 插入符号。真正的痛点不是「写错缩进」，是**不知道该写什么**：

- 路径记成 `/auth/confirm` 而不是 `/auth/confirmCode`
- 请求体字段名靠猜（`userName` 还是 `username`）
- DTO 上有 `@NotBlank`、`@Length(min=6,max=6)`、`@Pattern`，但没人会去翻那几个文件
- 想知道能测什么，得先把整个项目读一遍

这些全都是源码里写着的。`src/scan.js` 把 Spring 注解读成结构化数据（`@RequestMapping`/`@PostMapping` 给路径与方法、DTO 字段声明给请求体形状、Bean Validation 给约束、`@TableName` 给表名），`src/scaffold.js` 把它变成骨架。

三条设计约束：

1. **骨架不含断言。** 源码没说该返回什么。猜一个 `status: 200` 出来的断言只会「断言代码做了它当前做的事」——那是永远不会失败的测试，比没有测试更糟，因为它占据了一个测试的名字。TODO 注释写在需要断言的位置，人填。
2. **生成器值必须提升成具名变量。** 初版把 `username: e2e${random.hex}` 直接写进 body，结果数据库断言没法引用同一个值：在断言 SQL 里再写一次 `${random.hex}` 会生成**第二个**值，永远查不到刚插入的那行。所以 `buildBody` 检测到样例值含 `${` 就写进 `request.variables`，body 里改写 `${username}`，TODO 注释也跟着改成 `where username = '${username}'`。这是实测发现的，不是设计时想到的。
3. **不落盘。** 骨架是要在编辑器里改的草稿。每点一次端点列表就产生一个半成品文件，只是把混乱从内存搬到磁盘。

顺带修掉一个扫描器的真 bug：类级 `@RequestMapping("/auth")` 被当成端点，产出幻影 `GET /auth/auth`。修法是记录类注解的位置索引并在循环里跳过它——修前 12 条（含 4 条幻影），修后 8 条真实端点。

### 16.6 面板为什么不能只靠 `dsh.client` 声明

这是个真实的坑，值得记下来。

`@deepseek-ai/dsh-client-modules` 的 `ClientModuleRegistry` 在**构造时**对每个 Loader entry 做一次 `resolveMeta` 扫描并缓存结果。它之后只会重新处理被标 dirty 的 entry。

dsh-e2e 是**运行时** link 进 profile 的：它的 `dsh.client` 声明和 `client.js` 出现在扫描之后。于是它永久缺席 client 模块图，`main` 和 `sidebar.panellist` 里都没有它，而**没有任何日志**说明为什么。

`src/host.js` 的 `nudgeClientScan()` 处理这件事：挂载后检查 `graph().entries` 里有没有自己，没有就 `ctx.emit('internal/plugin', ctx.fiber)`（registry 自己的失效路径），等一个微任务队列排空再查。

结果写进 `/status` 的 `clientNudge`：

```json
{ "nudged": true, "via": "internal/plugin", "problems": [] }
```

并且 `/status` 的 `client.registered` 直接回答「浏览器半到底进没进模块图」。为 `false` 时面板不会出现——这个字段让「面板不见了」从「玄学」变成「一行 JSON」。

### 16.7 前端只用自己的 token

面板样式全部走 `--dsw-alias-*`（`bg-base` / `bg-layer-1` / `label-primary` / `border-l1` / `brand-primary` / `state-success-primary` 等），混色用 `color-mix(in srgb, var(...) N%, transparent)`。没有一处 hex 或 `rgb()` 字面量——`dev/client.test.mjs` 会扫出来。

这样主题切换、字体缩放、暗色模式全部自动跟随宿主，插件不需要知道当前是什么主题。

文案全部走 Client locale（`ctx.locale.register` + `bind`），en/zh 两套字典的键集必须相同，`dev/client.test.mjs` 会逐条比对，并且检查代码里出现的每个 `t('...')` 键都真的存在于字典中。硬编码的英文 UI 文案同样会被抓出来。

### 16.8 检查与运行是两件事

面板上的「检查」按钮**不启服务、不发请求、不碰数据库**，它只回答三个问题：

1. 这份 YAML 能解析成一个用例吗（`loadCaseFile`）
2. `target` 和数据库名解析得出来吗（`resolveEnvironment`）
3. 护栏会不会拒（`checkTargets`）

三件事都在毫秒级完成。而「运行」要几十秒。分开它们是因为：**绝大多数错误是配置错误**，而配置错误应该在你按下运行之前就告诉你。让用户等 30 秒启动 JVM 才得到一句「数据库名字写错了」，是一种浪费。

`/validate` 用 `200 + {ok: false, problems: [...]}` 回答「文档哪里不对」。**这是答案，不是请求失败**——HTTP 200 表示「我成功检查完了」，`ok: false` 表示「检查结论是不合格」。前端因此把成功判定写成 `!response.ok || !data`，而不是 `data.ok === false`；后者会把每一次正常的「检查不通过」当成网络错误弹一个红框。

`allowWrites` 在检查时固定为 `false`，所以含 `DELETE` 的用例检查结果会是：

```
the case contains INSERT/UPDATE/DELETE statements but database writes are disabled
(pass allowWrites to override)
```

这是诚实的默认答案——**用户还没有授权写库**，此时说「这个用例能跑」是不对的。面板把这条显示成「问题」而不是「错误」，并在运行栏旁边给一个勾选框；勾上再检查就通过了。

---

## 17. 设计原则小结

如果只能记住六条：

1. **判定必须确定性**。模型可以解释失败，不能决定成败。
2. **证据必须可复核**。每条结论背后要有请求原文、响应原文、SQL 结果、日志行。
3. **失败必须留下干净环境**。`finally` 里的 teardown 和停服不是可选项。
4. **配置错误必须响亮**。拼错字段名要报错，不能静默忽略跑出假通过。
5. **用例里不许有凭据**。名字进用例，连接进 registry。护栏校验的是解析之后真正会被拨号的那个地址——只看 YAML 等于什么都没看。
6. **缺口要写出来**。§11 的存在是为了让使用者知道哪里不能信这个工具。

还有一条是关于**写入**的，因为它在本项目里出现了三次，每次都用同一个形状解决：

> **用户写的文件，只做最小的插入，不做重排。**

自动分配 `caseId` 用文本插入（§5.9）、表单保存走行级补丁（§5.12）、保存走临时文件再改名（§16.2）、生成的骨架不落盘（§16.5）——四条都是同一件事：文件的排版和注释是作者的，工具的职责是加一行、或者什么都不加，而不是把它重写成「等价的」形式。重新序列化一份 YAML 在语法上是无损的，在信息上是有损的：注释、空行、引号风格、字段顺序全都丢了。

还有一条是关于**推导**的，也是三次：

> **能算一次就不要算两次。**

状态在 Host 算（§5.11）、分组在 Host 算、`/bootstrap` 带 `groups`（§13.1）。浏览器不重算的理由不是性能：推导两遍，总有一天推得不一样，那时你会有两个页面显示同一批用例的两个数字，而没有任何办法判断哪个对。
