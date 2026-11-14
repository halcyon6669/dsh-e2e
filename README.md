# dsh-e2e

在 DeepSeek Harness 里跑真实端到端测试的插件。

用 IDE 的真实运行配置启动服务 → 发真实 HTTP 请求 → 抓真实日志 → 查真实数据库 → 产出可复核的证据报告。

判定完全由确定性断言做出，模型不参与「这次测试算不算通过」。

## 它解决什么问题

单元测试证明「函数按我想的那样返回」，但证明不了：

- 服务**能不能起来**（Bean 装配、配置键拼写、端口占用）
- 请求打进去后**数据库里到底落了什么**（事务边界、字段映射、列名拼错）
- **日志里有没有**那句话（异常被吞、走了兜底分支）
- 整条链路的**真实耗时**

这些只有把真实进程跑起来才能观察到。手工验证的三个结构性缺陷——不可重复、无证据、结论靠印象——本插件逐一针对。

## 两个使用面

| 使用面 | 适合 |
|---|---|
| **面板**（侧栏「端到端测试」） | 看用例列表、改 YAML、点运行、看证据、让模型起草新用例 |
| **工具**（`e2e_*`，给 Agent 用） | 在对话里让 Agent 自己跑、自己读报告 |

两边跑的是同一条流水线、同一套断言、同一份报告。

## 快速开始

### 1. 装进 profile

```powershell
plugin_manager install_bundle target="C:\Users\administor-\Documents\deepseek-harness\default-workspace\dsh-e2e"
```

插件第一次挂载时，如果用例目录是空的，会把 `examples/` 里的示例连同一个 `e2e.registry.yml` 一起复制进去——打开面板就有能点的东西，而不是一句「没有配置用例目录」。**已有文件永不覆盖**；显式配了 `config.caseDir` 时也不会往里写任何东西。

### 2. 配连接（只配一次）

用例文件里**没有 host、没有端口、没有密码**。连接写在 `e2e.registry.yml`：

```yaml
targets:
  record-local:
    projectPath: E:/project/backend/Record
    configurationName: RecordApplication
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

  # 直接复用 dsh-db-mcp 里已经存好的数据源，密码不用在这里出现
  gauss:
    from: db-mcp
    id: record
    schema: public
```

`e2e.registry.yml` 放在用例目录里（插件按 `用例目录 → 上级目录 → 插件配置` 找），或者用 `config.registryFile` 指定。

密码支持 `${env:NAME}` 与 `${env:NAME:-兜底值}`，所以同一个文件在 CI 里读环境变量、在本机读兜底值。

### 3. 确认环境能跑

```
e2e_probe_environment { projectPath: "E:/project/backend/Record", baseUrl: "https://127.0.0.1:8443" }
```

它会告诉你：IDE MCP 通不通、暴露了哪些运行配置、目标地址答不答。

### 4. 跑一个用例

面板里点运行，或者：

```
e2e_run_case { caseId: "auth-register-confirm", allowWrites: true }
```

## 用例长什么样

```yaml
id: auth-register-confirm
caseId: REG-002                  # 编号：失败清单、报告、工单里引用它
group: Registration              # 用例组：横跨多个接口的一段业务
endpoint: POST /auth/register    # 接口：同一个接口的用例自动归为一组
scenario: error                  # normal = 一切顺利；error = 校验/鉴权/冲突/边界
priority: high                   # high / medium / low，用来排优先级
title: 注册应写入用户与验证码

env:
  target: record-local          # 指向 registry 里的 targets
  databases:
    default: { name: iam, schema: public }   # 只写名字和 schema

setup:
  sql:
    - DELETE FROM users WHERE username = '${user.name}'

request:
  variables:
    user.name: e2e${random.hex}     # 每次运行不同的用户名
  method: POST
  path: /auth/register
  json:
    username: ${user.name}
    password: Passw0rd!2026
    email: ${user.name}@example.test

expect:
  response:
    status: 500
    body_contains: register failed
  database:
    - database: default
      description: 用户应落库且未激活
      sql: SELECT valid_state, role FROM users WHERE username = '${user.name}'
      rowCount: 1
      rows:
        - path: '[0].valid_state'
          equals: '0'

teardown:
  sql:
    - DELETE FROM users WHERE username = '${user.name}'
```

这个文件可以随便复制、贴进 issue、提交进仓库——它不带走任何凭据，也不钉死某台机器的端口。

写成连接详情会被**明确拒绝**，不是静默忽略：

```
env.databases.default must not carry connection details (host, password, ...):
a case names a database, it does not connect to one.
```

### 编号、接口、场景、优先级

一个接口会有**多条**用例：正常路径一条，参数校验、权限、冲突、边界各一条。所以每条用例带五个描述字段：

| 字段 | 作用 | 不给时 |
|---|---|---|
| `caseId` | 失败清单、报告、工单里引用的名字，改标题也不会变 | 保存时**自动分配**（`REG-001`、`REG-002`…），面板里显示「保存时分配」 |
| `group` | 用例组（use case），面板清单按它分块 | 退回按 `endpoint` 分组 |
| `endpoint` | 把同一接口的用例归到一组 | 从 `request.method` + `request.path` 推导 |
| `scenario` | `normal` / `error`，组标题上会统计异常场景数 | `normal` |
| `priority` | `high` / `medium` / `low`，组内按它排序 | `medium` |

编号自动分配有两条规矩：

- **文本插入，不重新序列化**。分配编号时只往 `id:` 后面插一行 `caseId:`，注释一个字都不动——注释正是作者写下「这个用例要证明什么」的地方。
- **不回收已删除的编号**。删掉 `REG-002` 之后，下一个仍是 `REG-003`。否则引用过旧编号的报告和工单会指向另一个用例。

同一个目录里两个文件用同一个编号会被拒绝：

```
caseId REG-001 is already used by zz-assign-test.yaml in this folder;
case ids have to be unique so a report can name one case
```

完整 DSL 见 [`docs/design.md`](docs/design.md)。

## 面板

侧栏「端到端测试」，第一屏是**项目表**：

| 列 | 内容 |
|---|---|
| 项目 | 一行一个被测试的服务；名字取代码库文件夹名，没有就取主机名 |
| 最近结果 | `✓ 通过数` / `✕ 失败数` / `— 未运行数`，三个数而不是一个词——混合状态才是有信息量的状态 |
| 最近活动 | 相对时间（`23m ago`），精确时间在悬停提示里 |
| 创建时间 | 这个项目第一次出现在这里的时间 |
| 类型 | 从构建文件读：有 `pom.xml`/`build.gradle` 是后端，有 `package.json` 是前端，都有是全栈 |
| 创建者 | 当前系统用户 |

点一行进入该项目，里面有三个页面：**用例清单**、**用例详情**、**编辑测试计划**。

**用例清单**（默认页）——搜索框、状态页签、三个动作按钮，下面按**用例组**分块：

| 元素 | 内容 |
|---|---|
| 状态页签 | `全部 / 待编写 / 已生成 / 运行中 / 通过 / 失败 / 被拦下`，每个带计数 |
| 组头 | 组名 + `N 个用例` + 一句话结论（`全部通过` / `2 个失败` / `尚未运行`）+ 一条五段进度条 |
| 行 | `ID` / `最近状态` / `用例名`（下面一行小字是接口）/ `优先级` + 步骤数 |
| 动作 | `编辑测试计划` / `添加更多用例` / `运行全部 N` |

**用例详情**（点一行用例）——这一页是**读**，不是改：

| 区域 | 内容 |
|---|---|
| 头部 | `用例 · REG-001`、标题、最近结论、`运行用例`、`编辑` |
| 属性栏 | 编号、优先级、接口、组、最近运行时间、目标（描述原文） |
| 检查点页签 | 这次运行的每一条断言：通过/失败、期望值、实际值、失败时的差值与细节 |
| 控制台页签 | 按 trace id 收集到的日志行；没有一行带 trace id 时明说「这是请求开始之后的全部日志，可能混入无关流量」 |
| 数据库页签 | 每条数据库断言**执行前**与**执行后**的查询结果并排显示，外加「有变化 / 无变化」 |
| 代码页签 | 整份 YAML 原文，只读 |
| 历史页签 | 这个用例在磁盘上的每一次运行，新的在前：结论 + 相对时间 + 断言数 + 耗时 |
| 输出区 | 状态码、响应体、以及本次运行的时间线（每步的 `+N ms`） |

点开一条通过的用例以前是空的——不是因为它无话可说，而是面板只显示「本次会话刚跑过的那一次」。现在打开用例就直接加载磁盘上最新那份报告，页签里的内容全都来自它；历史和实时运行**共用同一个渲染器**（`Evidence`），因为过去的那次运行和刚才那次是同一个对象、同一个形状；两个渲染器一定会漂移，而漂移的那个永远是你没在看的那个。

数据库页签是这里唯一需要后端配合的地方。报告里原本只有「断言查到了什么」，没有「请求之前查到了什么」——于是「期望 1 行，实际 0 行」只能告诉你它失败了，告诉不了你为什么。现在每条数据库断言跑两次（请求前后各一次），两半成对写进 `evidence.snapshots`，`changed` 字段说明这中间有没有变化。这让三种截然不同的失败一眼可分：

| 前 → 后 | 说明 |
|---|---|
| `0 → 0` | 请求根本没写入任何东西 |
| `0 → 1` | 写入了，断言写错了 |
| `1 → 1` | 这一行本来就在——用例通过了，但什么都没测。这是最贵的一种绿 |

`1 → 1` 的用例不会失败，所以只有把前后摆在一起才看得出来。

**编辑测试计划**——左栏是同一批用例，按组排成卡片，每组底部一个 `+ 添加用例`；右栏是选中那条的编辑器，顶部一行显示文件名、编号、接口、场景、优先级。右栏有两种写法，一个开关切换：

- **表单**：标题、编号、组、优先级、场景、接口、描述、方法、路径、期望状态码十个字段。改完点 `保存修改`，只提交真的改过的字段。
- **YAML**：整份文件原文，适合写 setup SQL、变量捕获、teardown、mocks——表单管不到的东西。

`保存` 在两个模式下是同一个按钮、同一个后端路径，但**做的是读者正在看的那件事**：表单模式提交字段补丁，YAML 模式提交全文。`完成` 回清单，未保存时显示 `未保存的修改`。

- **检查** 不跑服务，只回答「这份文档能不能解析、目标解不解析得出来、护栏会不会拒」
- **运行** 后台跑，前端轮询；跑完给 verdict、逐条断言、以及请求/响应/日志/数据库/时间线全部证据
- **AI 生成** 用当前会话选中的模型起草一份新用例，生成物必须过和真实用例同一个解析器才允许保存
- **扫描接口** 读源码里的 Spring 注解，列出这个项目实际提供哪些端点；选一个就把请求行、示例请求体和 TODO 注释填进编辑器
- **解释失败** 只解释，不改判定——红跑不会因为模型说「看起来没问题」而变绿

### 为什么点开用例不是打开编辑器

点一行是**读**，按 `编辑` 才是**改**。看起来这是两页做一件事，但把「看一眼」和「准备改它」合成一步，代价是每次查看一个通过的用例都会看到一个 `保存修改` 按钮——一个在你不打算改任何东西时也亮着的保存按钮，迟早会被按下。

### 为什么通过的用例也要能看到细节

「这个绿测试上次什么时候通过的？它到底看到了什么？」——这两个问题在任何一次排查里都会出现，而答案早就在报告目录里躺着，只是面板从来没问过。

历史由 `GET /case` 一起下发（Host 已经知道哪些报告属于它，问第二次就多一次答错的机会），打开用例时顺手加载最新那份报告的全文，点历史里的另一条再换。取到的报告和刚才实时跑出来的**是同一个形状**，所以两处共用 `Evidence` 这一个渲染器。

匹配历史时 `caseId`、`id`、文件 stem 三个键都在集合里：`caseId` 是后来才加的字段，旧报告把它填成了文件 id，只按现在的 `caseId` 查会让一批本来通过的用例显示「未运行」。

### 为什么状态有六种而不是两种

`被拦下` 不是 `失败`。护栏在拨号之前就拒绝了（远程主机、缺凭据、没开写权限），这条用例**从未开始**；报成失败会让人去读一条根本没跑过的断言。同理 `待编写` 不是 `通过`——骨架只发请求不断言，四十个绿的骨架等于什么都没测，把它算成通过是这类工具最贵的一种错。

状态由 Host 算好下发（`src/plan.js`），浏览器不再推导一遍：推导两遍，总有一天推得不一样。

### 为什么组名要人写

一个「用例组」（use case）可以横跨多个接口——读一篇文章是 `GET /articles` 加 `GET /articles/{id}`，写一篇是 `POST` 加 `GET` 校验。从路径推不出来，所以 `group` 是作者写的字段；没写就退回按接口分组，那只是能看，不是有意义。

### 为什么表单是补丁而不是重新序列化

表单保存时不 parse-and-dump，而是**按行改文本**（`src/edit.js`）：改一个字段就换一行，缺的字段插在它该在的块里，其余字节原样不动。

dump 语法上无损，信息上有损：注释、空行、引号风格、字段顺序全丢。而注释正是作者写「这个用例要证明什么」的地方——把一条用例交给表单改一次优先级就把它思考的痕迹擦掉，那这个表单不如一个 textarea。

补丁在 **Host 侧**做，因为磁盘是权威：浏览器若补丁自己上次取到的副本，就会把别处的改动静默回滚。

### 为什么批量运行是串行的

`运行全部` 一次提交整个文件列表，后台一条接一条跑（`POST /run-all` 立刻返回 batch id，前端 1.2 秒轮询一次）。

串行是刻意的：两条用例打同一个服务的同一个库会交错写，产生的失败看起来像 flaky，实际是调度问题。代价是墙钟时间，换来的是结果不依赖调度。

一条用例被拒**不会中断整批**——它变成一条 `refused` 记录，下一条继续。否则一个缺凭据会掩盖后面全部结果，那正好是「运行全部」不该做的事。

### 一个项目是怎么来的

没有任何文件声明「项目」。项目表是从现有东西推出来的：

- registry 里每个 target 是一个项目入口，**按 baseUrl 的 origin 归并**——`record-local`（会启动 JVM）和 `record-running`（打一个已经在跑的服务）指向同一个 `https://127.0.0.1:8443`，那是同一个服务的两种连法，不是两个项目。分成两行会让页面上的每个计数都错。
- 一个用例都不引用 target 时，它所在的目录自己成为一个项目，否则那些用例没有地方显示。

所以新加一个 target，项目表里立刻多一行（`未运行`）；不是等有人写第一个用例才出现。

### 为什么类型要读构建文件而不是猜

`package.json` 和 `pom.xml` 都是磁盘上的一句话。猜（看路径里有没有 `frontend`、看文件扩展名）会在路径改名那天开始撒谎，而一个说「后端」说错的标签比没有标签更糟——它让人跳过检查。

### 为什么不手写 YAML

手写容易错的地方不是缩进（缩进错了检查器会指出行号和插入符号），是**不知道该写什么**：路径拼错、字段名猜错、DTO 的约束没看、请求体里少了必填字段。这些都是源码里写着的。

「扫描接口」把这几件事从源码里读出来：`@RequestMapping`/`@PostMapping` 给路径与方法，DTO 的字段声明给请求体形状，Bean Validation 注解（`@NotBlank`/`@Length`/`@Pattern`）给必填与取值约束，`@TableName` 给表名。

生成出来的骨架**不含断言**——源码没说该返回什么，猜出来的断言只会「断言代码做了它当前做的事」，那是永远不会失败的测试。断言仍然要人写，TODO 注释就写在需要它的地方。

生成器产出的值会提升成具名变量（`variables.username: e2e${random.hex}`，body 里写 `${username}`），因为数据库断言必须引用**同一个**值：在断言 SQL 里再写一次 `${random.hex}` 会生成第二个值，永远查不到刚写入的那行。

### 为什么保存要写临时文件

保存流程是「写临时文件 → 用真正的解析器校验 → 失败就删掉并拒绝 → 成功才改名到目标」。磁盘上出现一份坏用例比拒绝一次保存糟得多：它会在列表里长期显示为一个红点，而写它的那一刻恰恰是你最不知道自己在写什么的时候。

### 为什么运行是后台的

一次真实运行要启动 JVM、轮询就绪、连库、收日志——挂在 HTTP 请求上会让面板卡住，而且浏览器一走请求就断。所以 `POST /run` 立刻返回 run id，前端按 900ms 轮询状态。

## 七个工具

| 工具 | 用途 |
|---|---|
| `e2e_list_cases` | 列出可用用例（含 target 与数据库名） |
| `e2e_list_databases` | 列出 registry 里的 target 与数据源（**不含密码**） |
| `e2e_probe_environment` | 检查这台机器现在能不能跑用例 |
| `e2e_scan_endpoints` | 读源码，列出项目实际提供的 HTTP 端点（只读） |
| `e2e_scaffold_case` | 把其中一个端点变成用例骨架（返回 YAML，不落盘） |
| `e2e_run_case` | 跑一个用例，产出报告 |
| `e2e_read_report` | 读已生成的报告 |

用例启动失败时**先跑 `e2e_probe_environment`**——它把「IDE 没开」「端口不对」「配置名写错」直接区分开。名字写错时 `e2e_list_databases` 会告诉你实际有哪些。不知道有哪些端点可测时，先 `e2e_scan_endpoints`。

## 设计原则

1. **判定必须确定性**。模型可以解释失败，不能决定成败。
2. **证据必须可复核**。每条结论背后有请求原文、响应原文、SQL 结果、日志行。
3. **失败必须留下干净环境**。`finally` 里的 teardown 和停服不是可选项。
4. **配置错误必须响亮**。拼错字段名报错，不静默忽略跑出假通过。
5. **用例里不许有凭据**。名字进用例，连接进 registry；护栏校验的是**解析之后**真正会被拨号的那个地址——只看 YAML 等于什么都没看。
6. **缺口要写出来**。见 [`docs/design.md`](docs/design.md) §11。

## 已知限制

- **只支持 PostgreSQL 线协议**（PostgreSQL / openGauss / GaussDB）。其它数据库通过 `expect.calls` 问服务自己。
- **WireMock 只解析不执行**（`env.mocks` 当前无效果）。
- **日志按 traceId 过滤需要服务端配合**：插件注入 `X-Trace-Id`，但服务端得真的把它写进 MDC。没写时插件会诚实降级并在报告里标注。
- **用例不能并行**：端口和数据库 fixture 会冲突。
- **AI 生成需要一个选中的模型**。没选时按钮会告诉你原因，编辑器与运行按钮照常可用。
- **扫描器只认 Spring MVC 注解**。换框架时 `e2e_scan_endpoints` 会返回 0 条并给出 `warnings`，不会猜。它也不做跨文件类型展开（`private AddressDto address` 只得到字段名）。

## 开发

```powershell
cd C:\Users\administor-\Documents\deepseek-harness\default-workspace\dsh-e2e

# 全部十一个套件（都不需要 IDE；registry 那套会读本机的 dsh-db-mcp 数据源）
npm test

# 探针（需要真环境）
node dev/idea.test.mjs       # IDEA MCP 连接
node dev/pg.test.mjs         # PostgreSQL 线协议
node dev/idea-run.test.mjs   # 启动运行配置并读输出
```

`dev/registry.test.mjs` 有两个刻意的设计：

- 它**不要求**示例 registry 里有 `from: db-mcp` 条目。示例把那段注释掉了，因为写死一个数据源 id 意味着装到别人机器上必然报错。探针改为读本机 `~/.dsh/db-mcp/datasources.json`，找一个 PostgreSQL 系数据源，临时构造一个 registry 来验证解密链路——这样它在任何机器上都有意义。
- 它顺手验证「名字写错时会不会说出有哪些名字」，因为那是这个 lookup 存在的全部理由。

`dev/render.test.mjs` 存在的理由：`dev/client.test.mjs` 把 bundle 当**文本**读，所以看不见只在组件运行时才发生的 `ReferenceError`。重构时把一个变量在一个地方改了名、JSX 里还留着旧名字——`node --check` 通过、bundle 加载成功、面板一片空白。这个探针用一套最小的 hooks 运行时把真正的 factory 跑起来，桩掉 `fetch`，然后对**实际渲染出的文字**做断言。

它有个自身陷阱值得记下：`useEffect`/`useCallback` 必须真的比较依赖数组。第一版忽略 deps，于是 `useEffect(refresh)` 每轮都跑、`refresh` 每次 set 新状态、探针无限重渲染——那是探针的 bug，不是面板的 bug，但看起来完全像面板卡死了。

它还有第二个陷阱：`className` 常常带修饰后缀（`e2e-plan-row` 与 `e2e-plan-row-name`、`e2e-mode-btn` 与 `e2e-mode-btn is-active`）。用 `/e2e-plan-row/` 这样的正则去数元素，会把修饰类也算进去——三条用例数成六条，然后你花一小时怀疑渲染逻辑。按空格拆开再比：

```js
String(node.props.className || '').split(' ').includes('e2e-plan-row')
```

第三个陷阱是它一开始只渲染 `main` 面板。侧栏入口是一个**独立的组件**（`SidebarIcon`），注册进 `sidebar.panellist`，而它只在侧栏那一格里渲染。曾经它引用了 `size` 却从未声明——`node --check` 通过、`client.test.mjs` 通过（那是文本检查）、`render.test.mjs` 通过（它只渲染主面板），而用户看到的是一整排侧栏图标里少了一个，没有报错、没有日志。现在探针会像 shell 那样真的渲染一次侧栏组件：

```js
const icon = sidebarComponent({ size: 20 })
assert.equal(icon.props.width, 20)
```

**注册进 slot 的组件也是组件，也要被渲染过一次才算测过。**

`dev/edit.test.mjs` 盯的是表单补丁：一个字段改了、注释还在、别的块没动、缺的键插在该在的位置。它抓到过一个真 bug——写 `expect.response.headers.x-trace` 时把中间缺失的段当成了叶子，产出 `headers: trace-1`，把 mapping 写成了字符串，文件当场不能加载。所以有一条测试专门断言 `headers:` 后面必须是空的。

`dev/scope.test.mjs` 是最后补的那张网。它用 `acorn` 解析**每个会跑的文件**（`client.js`、`index.js`、`src/*.js`），按作用域收集声明与引用，然后问「这个读到的名字，在它自己能看到的作用域里有没有绑过」。侧栏那个 `size` 就属于这一类：语法正确、文本检查正确、只在渲染时炸。

它第一版是「这个名字在这个文件里任何地方声明过吗」，那版抓不到第二个同类 bug：`src/runner.js` 里有两个循环，一个写 `for (const [index, expectation] of ...)`、另一个写 `for (const expectation of ...)`，后者读 `index` 而自己没声明。`node --check` 通过、单测全绿，只有真的对着服务跑一次才炸出 `fatal: ReferenceError: index is not defined`。扁平版之所以漏掉它，是因为 `index` 在别处（另一个函数里）确实声明过——**一个只抓得到你已经修完的 bug 的检查，是装饰**。所以现在是按作用域解析的，并且它自己带两条反向测试：兄弟作用域的声明必须不可见，闭包里的必须可见。没有 parser 的机器上它打印一行说明然后跳过——一个在缺依赖时失败的探针，只会教会人忽略它。

改完代码后热重载：

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:1629/plugins/e2e/api/reload
```

热重载会用 `node:module` 的 resolve 钩子给整棵依赖图换 generation，所以改 `src/` 下任何文件都生效，不用重启 DSH。代价是 `index.js` 自身每个进程只加载一次——**改了 `index.js` 必须重启**。

`GET /plugins/e2e/api/status` 会报告 `client.registered`：浏览器半是不是真的进了 client 模块图。为 `false` 时面板不会出现，而这个字段会直接说清楚。

## 结构

```
index.js              插件入口（inject: webServer）+ 热重载钩子
client.js             浏览器半（项目表 + 用例清单 + 用例详情 + 编辑测试计划，纯手写 bundle）
src/host.js           组装、示例播种、/status、客户端半自检
src/panel.js          面板 REST API（用例 CRUD / 运行 / 批量运行 / 报告 / 生成 / 表单补丁）
src/store.js          用例与报告的唯一磁盘入口（路径守卫、编号分配）
src/projects.js       项目表：按 origin 归并 target、按最新报告汇总结果与分组
src/plan.js           用例的步骤描述、状态判定、组内结论（纯函数）
src/edit.js           表单 → YAML 的行级补丁（不重新序列化）
src/ai.js             生成用例、解释失败（模型永不参与判定）
src/scan.js           读 Spring 源码：端点、DTO 字段与约束、实体表名
src/scaffold.js       端点 → 用例骨架（不含断言）
src/tools.js          7 个工具注册
src/case.js           YAML 解析与规范化
src/registry.js       target / 数据库注册表 + dsh-db-mcp 导入
src/resolve.js        用例 + registry → 实际连接
src/guard.js          环境护栏（默认拒绝，校验解析后的地址）
src/runner.js         流水线编排
src/service.js        启停服务 + 日志跟随
src/idea.js           IDEA MCP 客户端（SSE + JSON-RPC）
src/http.js           HTTP 客户端（node:http，保留原始字节）
src/pg.js             PostgreSQL 线协议（含 SCRAM-SHA-256）
src/db.js             数据库门面（强制只读断言）
src/assert.js         断言引擎
src/report.js         报告渲染（JSON + Markdown）
vendor/js-yaml.mjs    零依赖 YAML 解析器
examples/             示例用例 + 示例 registry
docs/design.md        设计文档
```

零运行时依赖。

## License

MIT
