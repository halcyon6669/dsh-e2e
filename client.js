/**
 * dsh-e2e — Client half.
 *
 * A plain browser bundle loaded through window.__ModuleLoader__ (same shape as the
 * skill's UI template): no imports of Harness client packages, no iframes, no DOM
 * work outside the component tree, styles from --dsw-alias-* tokens only.
 *
 * The panel is an editor plus a run surface. It never decides anything: the Host
 * half owns the case loader, the guard and the runner, and every answer here is a
 * shape that API returned. The one thing this file is opinionated about is that a
 * case file must be saveable by someone who does not know the YAML by heart — so
 * the editor validates through the real loader before it lets a save through, and
 * the run button shows exactly which assertions decided the verdict.
 */
window.__ModuleLoader__.load({
  id: 'dsh-e2e',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement

    const NS = 'e2e'
    const API = '/plugins/e2e/api'

    /** Set by apply(); bind() reads the active locale at call time. */
    let localeService = null

    const DICT = {
      en: {
        'panel.title': 'End-to-end tests',
        'panel.subtitle': 'Run a real case against a real service: it starts, the request goes out, the database is read back, and every claim comes with evidence.',

        'action.refresh': 'Refresh',
        'action.new': 'New case',
        'action.create': 'Create',
        'action.cancel': 'Cancel',
        'action.save': 'Save',
        'action.saving': 'Saving…',
        'action.validate': 'Check',
        'action.validating': 'Checking…',
        'action.run': 'Run',
        'action.running': 'Running…',
        'action.delete': 'Delete',
        'action.edit': 'Edit',
        'action.runTest': 'Run test',
        'action.backToCases': 'Back to test cases',
        'action.deleteConfirm': 'Delete for real',
        'action.explain': 'Why did it fail?',
        'action.explaining': 'Asking the model…',
        'action.generate': 'Generate from a description',
        'action.generating': 'Generating…',
        'action.scan': 'Scan the project for endpoints',
        'action.scanning': 'Scanning…',
        'action.scaffold': 'Use this endpoint',
        'action.close': 'Close',
        'action.retry': 'Retry',
        'action.reopen': 'Open',
        'action.loading': 'Loading…',

        'label.editor': 'Case file',
        'label.run': 'Run',
        'label.reports': 'Recent runs',
        'label.databases': 'Databases you can name',
        'label.targets': 'Targets',
        'label.registry': 'Registry',
        'label.checks': 'Checks',
        'label.warnings': 'Warnings',
        'label.duration': 'Duration',
        'label.verdict': 'Verdict',
        'label.database': 'Database',
        'label.schema': 'Schema',
        'label.source': 'Source',
        'label.allowWrites': 'Allow setup/teardown SQL to write',
        'label.allowWritesHint': 'Off by default. A case whose setup INSERTs or DELETEs needs this, and a refused run tells you so.',
        'label.keepRunning': 'Leave the service running after the run',
        'label.generateFor': 'Describe the behaviour this case should prove',
        'label.generatePlaceholder': 'e.g. registering with a taken username returns 409 and writes no second row',
        'label.unsaved': 'unsaved changes',
        'label.scan': 'Endpoints in this project',
        'label.scanHint': 'Read from the Spring annotations in the source. Pick one and the request line, the sample body and the TODO comments are filled in for you.',
        'label.scanned': '{files} files · {endpoints} endpoints · {entities} tables',
        'label.endpointBody': 'body',
        'label.endpointNoBody': 'no body',
        'label.noEndpoint': 'no endpoint',
        'label.errorScenarios': 'error scenarios',
        'label.scenario.normal': 'normal',
        'label.scenario.error': 'error',
        'label.priority.high': 'high',
        'label.priority.medium': 'medium',
        'label.priority.low': 'low',
        'label.caseId': 'Case id',
        'label.caseIdDerived': 'assigned on save',
        'label.scenarioHint': 'normal = the path a user takes when nothing goes wrong. error = validation, authorisation, conflict, boundary.',
        'label.priorityHint': 'Triage, not decoration: high means a failure here breaks the product.',

        'state.loading': 'Loading…',
        'state.dirty': 'modified',
        'state.saved': 'saved',

        'verdict.passed': 'passed',
        'verdict.failed': 'failed',
        'verdict.refused': 'refused',
        'verdict.running': 'running',

        'empty.noCaseDir': 'No case directory is configured, so there is nothing to list. Set config.caseDir in the plugin settings to a folder of .yaml cases.',
        'empty.noCases': 'No case files in this folder yet. Create one, or generate one from a description.',
        'empty.selectCase': 'Pick a case on the left, or create one.',
        'empty.noReports': 'No runs yet. The report of every run lands here, with the evidence.',
        'empty.noChecks': 'This run recorded no assertions.',

        'notice.saved': 'Saved {file}.',
        'notice.savedAssigned': 'Saved {file} with case id {caseId}.',
        'notice.deleted': 'Deleted {file}.',
        'notice.validated': 'The case loads and the guard would allow it.',
        'notice.generated': 'Generated with {model}. Read it before you run it.',
        'notice.runStarted': 'Run started — the service is starting.',
        'notice.scanned': 'Found {endpoints} endpoints in {files} files.',
        'notice.scaffolded': 'Skeleton for {path} — fill in the TODOs, then save.',

        'error.title': 'The plugin API is unreachable',
        'error.registry': 'The registry could not be read',
        'error.saveRefused': 'Not saved',

        'section.fatal': 'Fatal',
        'section.why': 'Why it failed',
        'section.evidence': 'Evidence',
        'section.request': 'Request',
        'section.response': 'Response',
        'section.logs': 'Logs',
        'section.database': 'Database',
        'section.timeline': 'Timeline',

        'label.projects': 'Projects',
        'label.projectName': 'Project',
        'label.latestResults': 'Latest results',
        'label.lastActivity': 'Last activity',
        'label.createdAt': 'Created at',
        'label.type': 'Type',
        'label.creator': 'Creator',
        'label.notRun': 'Not run',
        'label.casesCount': '{count} cases',
        'label.type.backend': 'Backend',
        'label.type.frontend': 'Frontend',
        'label.type.fullstack': 'Full stack',
        'label.type.unknown': 'Unknown',
        'label.partial': 'partial',
        'action.openProject': 'Open',
        'action.backToProjects': 'All projects',
        'empty.noProjects': 'No projects yet. A project appears here once a case names a target, or a case directory has a case in it.',
        'time.justNow': 'just now',
        'time.minutesAgo': '{count}m ago',
        'time.hoursAgo': '{count}h ago',
        'time.daysAgo': '{count}d ago',

        'label.testCases': 'Test cases',
        'label.searchCases': 'Search cases',
        'label.latestStatus': 'Latest status',
        'label.testName': 'Test name',
        'label.tests': '{count} tests',
        'label.steps': '{count} steps',
        'label.group': 'Group',
        'label.noChanges': 'No changes yet',
        'label.mode.form': 'Form',
        'label.mode.yaml': 'YAML',
        'label.mode.code': 'Code',
        'label.testCase': 'Test case',
        'label.properties': 'Properties',
        'label.goal': 'Goal',
        'label.status': 'Status',
        'label.mode.history': 'History',
        'label.mode.output': 'Output',
        'label.mode.checks': 'Checkpoints',
        'label.mode.logs': 'Console',
        'label.mode.database': 'Database',
        'label.mode.shots': 'Screenshots',
        'label.noShots': 'This run took no screenshots. A case only has them when it has a browser block.',
        'label.shotOpen': 'Open full size',
        'label.browserConsole': 'Page console',
        'label.noBrowserConsole': 'The page logged nothing.',
        'label.browserFailed': 'The browser journey did not run',
        'label.before': 'Before',
        'label.after': 'After',
        'label.changed': 'Changed',
        'label.unchanged': 'No change',
        'label.noChecks': 'This run recorded no checkpoints.',
        'label.noLogs':
          'This run has no console to show. Runs recorded before the tool started keeping the server output do not have one, and a case that starts no service has no console at all.',
        'label.logsUnscoped':
          'No log line carried this run’s trace id, so these are every line since the request started — they may include unrelated traffic.',
        'label.logsNotAsserted':
          'Kept for evidence, not asserted on: this case does not check the console, so a green run says the service answered, not that it printed nothing alarming.',
        'label.noSnapshots': 'This run read no database rows.',
        'label.afterOnly': 'After the request only',
        'label.readAfterRequest': 'Read after the request',
        'label.snapshotGap':
          'No before/after pair: the query failed both times, or the case asserts on no database.',
        'label.formOnly': 'Setup SQL, captures, teardown and mocks stay in YAML: a form for them would be a text editor with extra steps.',
        'label.lastRun': 'Last run',
        'label.neverRun': 'Never run',
        'label.thisRun': 'This run',
        'label.runAt': 'Ran {when}',
        'label.noHistory': 'No runs on record for this case yet.',

        'action.editTestPlan': 'Edit test plan',
        'action.addMoreTests': 'Add more tests',
        'action.foldGroup': 'Fold this group',
        'action.expandGroup': 'Expand this group',
        'action.runAll': 'Run all {count}',
        'action.done': 'Done',
        'action.saveChanges': 'Save changes',
        'action.addTest': 'Add test',

        'status.all': 'All',
        'status.planned': 'Planned',
        'status.generated': 'Generated',
        'status.running': 'Running',
        'status.passed': 'Passed',
        'status.failed': 'Failed',
        'status.blocked': 'Blocked',

        'summary.empty': 'no tests',
        'summary.allPassed': 'all passed',
        'summary.someFailed': '{count} failed',
        'summary.someBlocked': '{count} blocked',
        'summary.someRunning': '{count} running',
        'summary.someUnrun': '{count} not run',

        'field.title': 'Test name',
        'field.caseId': 'Case id',
        'field.group': 'Group',
        'field.priority': 'Priority',
        'field.scenario': 'Scenario',
        'field.endpoint': 'Endpoint',
        'field.description': 'What it proves',
        'field.method': 'Method',
        'field.path': 'Path',
        'field.status': 'Expected status',

        'empty.noSearchResults': 'No test matches "{query}".',
        'notice.batchStarted': 'Running {count} cases in order — they go one at a time so two cases cannot write the same rows.',
        'notice.fieldsSaved': 'Saved {file}.',
      },
      zh: {
        'panel.title': '端到端测试',
        'panel.subtitle': '在真实服务上跑真实用例：服务启动、请求发出、数据库读回，每个结论都带证据。',

        'action.refresh': '刷新',
        'action.new': '新建用例',
        'action.create': '创建',
        'action.cancel': '取消',
        'action.save': '保存',
        'action.saving': '保存中…',
        'action.validate': '检查',
        'action.validating': '检查中…',
        'action.run': '运行',
        'action.running': '运行中…',
        'action.delete': '删除',
        'action.edit': '编辑',
        'action.runTest': '运行用例',
        'action.backToCases': '返回用例列表',
        'action.deleteConfirm': '确认删除',
        'action.explain': '为什么失败？',
        'action.explaining': '正在询问模型…',
        'action.generate': '根据描述生成',
        'action.generating': '生成中…',
        'action.scan': '扫描项目里的接口',
        'action.scanning': '扫描中…',
        'action.scaffold': '用这个接口',
        'action.close': '关闭',
        'action.retry': '重试',
        'action.reopen': '打开',
        'action.loading': '加载中…',

        'label.testCases': '测试用例',
        'label.editor': '用例文件',
        'label.run': '运行',
        'label.reports': '最近运行',
        'label.databases': '可以引用的数据库',
        'label.targets': '目标',
        'label.registry': '注册表',
        'label.checks': '断言',
        'label.warnings': '警告',
        'label.duration': '耗时',
        'label.verdict': '结论',
        'label.database': '数据库',
        'label.schema': 'Schema',
        'label.source': '来源',
        'label.allowWrites': '允许 setup/teardown 的 SQL 写入',
        'label.allowWritesHint': '默认关闭。setup 里有 INSERT/DELETE 的用例需要它，被拒绝时也会提示你。',
        'label.keepRunning': '运行结束后保留服务',
        'label.generateFor': '描述这个用例要证明的行为',
        'label.generatePlaceholder': '例如：用已存在的用户名注册返回 409，且不写入第二行',
        'label.unsaved': '未保存的修改',
        'label.scan': '项目里的接口',
        'label.scanHint': '从源码里的 Spring 注解读出来。选一个接口，请求行、示例请求体和 TODO 注释就都填好了。',
        'label.scanned': '{files} 个文件 · {endpoints} 个接口 · {entities} 张表',
        'label.endpointBody': '请求体',
        'label.endpointNoBody': '无请求体',
        'label.noEndpoint': '无接口',
        'label.errorScenarios': '异常场景',
        'label.scenario.normal': '正常',
        'label.scenario.error': '异常',
        'label.priority.high': '高',
        'label.priority.medium': '中',
        'label.priority.low': '低',
        'label.caseId': '用例编号',
        'label.caseIdDerived': '保存时分配',
        'label.scenarioHint': '正常 = 一切顺利时用户走的那条路。异常 = 校验失败、鉴权失败、冲突、边界。',
        'label.priorityHint': '用来排优先级，不是装饰：高 = 这里出错产品就坏了。',

        'state.loading': '加载中…',
        'state.dirty': '已修改',
        'state.saved': '已保存',

        'verdict.passed': '通过',
        'verdict.failed': '失败',
        'verdict.refused': '被拒绝',
        'verdict.running': '运行中',

        'empty.noCaseDir': '还没有配置用例目录，所以这里没有可列出的东西。把插件设置里的 config.caseDir 指向存放 .yaml 用例的文件夹。',
        'empty.noCases': '这个文件夹里还没有用例。新建一个，或者根据描述生成一个。',
        'empty.selectCase': '在左边选一个用例，或者新建一个。',
        'empty.noReports': '还没有运行记录。每次运行的报告都会落在这里，带证据。',
        'empty.noChecks': '这次运行没有记录断言。',

        'notice.saved': '已保存 {file}。',
        'notice.savedAssigned': '已保存 {file}，用例编号 {caseId}。',
        'notice.deleted': '已删除 {file}。',
        'notice.validated': '用例可以加载，护栏也会放行。',
        'notice.generated': '由 {model} 生成。运行前请先读一遍。',
        'notice.runStarted': '已开始运行 —— 服务正在启动。',
        'notice.scanned': '在 {files} 个文件里找到 {endpoints} 个接口。',
        'notice.scaffolded': '{path} 的骨架已生成 —— 填好 TODO 再保存。',

        'error.title': '插件 API 不可达',
        'error.registry': '注册表读取失败',
        'error.saveRefused': '未保存',

        'section.fatal': '致命错误',
        'section.why': '为什么失败',
        'section.evidence': '证据',
        'section.request': '请求',
        'section.response': '响应',
        'section.logs': '日志',
        'section.database': '数据库',
        'section.timeline': '时间线',

        'label.projects': '项目',
        'label.projectName': '项目',
        'label.latestResults': '最近结果',
        'label.lastActivity': '最近活动',
        'label.createdAt': '创建时间',
        'label.type': '类型',
        'label.creator': '创建者',
        'label.notRun': '未运行',
        'label.casesCount': '{count} 个用例',
        'label.type.backend': '后端',
        'label.type.frontend': '前端',
        'label.type.fullstack': '全栈',
        'label.type.unknown': '未知',
        'label.partial': '部分完成',
        'action.openProject': '打开',
        'action.backToProjects': '全部项目',
        'empty.noProjects': '还没有项目。用例引用了 target，或者某个用例目录里有用例，项目就会出现在这里。',
        'time.justNow': '刚刚',
        'time.minutesAgo': '{count} 分钟前',
        'time.hoursAgo': '{count} 小时前',
        'time.daysAgo': '{count} 天前',

        'label.testCases': '测试用例',
        'label.searchCases': '搜索用例',
        'label.latestStatus': '最新状态',
        'label.testName': '用例名称',
        'label.tests': '{count} 个用例',
        'label.steps': '{count} 步',
        'label.group': '分组',
        'label.noChanges': '还没有改动',
        'label.mode.form': '表单',
        'label.mode.yaml': 'YAML',
        'label.mode.code': '代码',
        'label.testCase': '用例',
        'label.properties': '属性',
        'label.goal': '目标',
        'label.status': '状态',
        'label.mode.history': '历史',
        'label.mode.output': '输出',
        'label.mode.checks': '检查点',
        'label.mode.logs': '控制台',
        'label.mode.database': '数据库',
        'label.mode.shots': '截图',
        'label.noShots': '这次运行没有截图。只有带 browser 块的用例才有。',
        'label.shotOpen': '查看大图',
        'label.browserConsole': '页面控制台',
        'label.noBrowserConsole': '页面没有输出日志。',
        'label.browserFailed': '浏览器步骤没有跑起来',
        'label.before': '执行前',
        'label.after': '执行后',
        'label.changed': '有变化',
        'label.unchanged': '无变化',
        'label.noChecks': '这次运行没有记录检查点。',
        'label.noLogs': '这次运行没有控制台可看。工具开始保留服务输出之前的旧报告没有，不启动服务的用例也没有。',
        'label.logsUnscoped': '没有日志行带这次运行的 trace id，所以这里是请求开始之后的全部日志，可能混入无关流量。',
        'label.logsNotAsserted':
          '这份日志只是证据，没有被断言：这条用例不检查控制台，所以绿只说明服务答复了，不说明它没有打印过难看的异常。',
        'label.noSnapshots': '这次运行没有读取数据库行。',
        'label.afterOnly': '只有请求之后',
        'label.readAfterRequest': '请求之后读到的',
        'label.snapshotGap': '没有前后对比：查询两次都失败了，或者这条用例没有数据库断言。',
        'label.lastRun': '最近运行',
        'label.neverRun': '从未运行',
        'label.thisRun': '本次运行',
        'label.runAt': '{when} 运行',
        'label.noHistory': '这个用例还没有运行记录。',
        'label.formOnly': '初始化 SQL、变量捕获、清理和 mock 只在 YAML 里改：给它们做表单只会得到一个更难用的文本编辑器。',

        'action.editTestPlan': '编辑测试计划',
        'action.addMoreTests': '添加更多用例',
        'action.foldGroup': '收起这一组',
        'action.expandGroup': '展开这一组',
        'action.runAll': '全部运行 {count} 个',
        'action.done': '完成',
        'action.saveChanges': '保存改动',
        'action.addTest': '添加用例',

        'status.all': '全部',
        'status.planned': '待编写',
        'status.generated': '已生成',
        'status.running': '运行中',
        'status.passed': '通过',
        'status.failed': '失败',
        'status.blocked': '被拦下',

        'summary.empty': '没有用例',
        'summary.allPassed': '全部通过',
        'summary.someFailed': '{count} 个失败',
        'summary.someBlocked': '{count} 个被拦下',
        'summary.someRunning': '{count} 个运行中',
        'summary.someUnrun': '{count} 个未运行',

        'field.title': '用例名称',
        'field.caseId': '用例编号',
        'field.group': '分组',
        'field.priority': '优先级',
        'field.scenario': '场景',
        'field.endpoint': '接口',
        'field.description': '它证明什么',
        'field.method': '方法',
        'field.path': '路径',
        'field.status': '期望状态码',

        'empty.noSearchResults': '没有用例匹配「{query}」。',
        'notice.batchStarted': '按顺序运行 {count} 个用例——一次一个，否则两个用例会写同一批数据行。',
        'notice.fieldsSaved': '已保存 {file}。',
      },
    }

    /* ---------- locale plumbing ---------- */

    function useLocale() {
      const service = localeService
      const subscribe = React.useCallback(
        (onChange) => (typeof service?.subscribe === 'function' ? service.subscribe(onChange) : () => {}),
        [service],
      )
      const getSnapshot = React.useCallback(
        () => (typeof service?.getSnapshot === 'function' ? service.getSnapshot() : 0),
        [service],
      )
      React.useSyncExternalStore(subscribe, getSnapshot)
      return service
    }

    function useT() {
      const service = useLocale()
      return React.useMemo(() => (service ? service.bind(NS) : (key) => key), [service])
    }

    /* ---------- HTTP ---------- */

    async function request(method, path, body) {
      const init = { method, credentials: 'same-origin', headers: { accept: 'application/json' } }
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      const response = await fetch(API + path, init)
      const data = await response.json().catch(() => null)
      // Only the HTTP status decides success here. A 200 body may legitimately say
      // `ok: false` — that is /validate telling the editor what is wrong with the
      // document it is holding, which is an answer, not a failed request.
      if (!response.ok || !data) {
        const error = new Error(String((data && (data.error || data.message)) || `HTTP ${response.status}`))
        error.payload = data
        error.status = response.status
        throw error
      }
      return data
    }

    const apiGet = (path) => request('GET', path)
    const apiPost = (path, body) => request('POST', path, body || {})
    const apiDelete = (path) => request('DELETE', path)

    const q = (value) => encodeURIComponent(String(value))

    /* ---------- small presentational pieces ---------- */

    const TONES = {
      pass: 'var(--dsw-alias-state-success-primary)',
      fail: 'var(--dsw-alias-state-error-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
      brand: 'var(--dsw-alias-brand-primary)',
    }

    function Chip(props) {
      const tone = TONES[props.tone] || TONES.idle
      return h(
        'span',
        {
          className: 'e2e-chip',
          style: {
            color: tone,
            borderColor: `color-mix(in srgb, ${tone} 45%, transparent)`,
            background: `color-mix(in srgb, ${tone} 12%, transparent)`,
          },
        },
        props.children,
      )
    }

    function Btn(props) {
      const variant = props.variant || 'default'
      const className = `e2e-btn${variant === 'primary' ? ' is-primary' : ''}${variant === 'danger' ? ' is-danger' : ''}${
        props.small ? ' is-small' : ''
      }`
      return h(
        'button',
        {
          type: 'button',
          className,
          disabled: props.disabled === true,
          title: props.title || undefined,
          onClick: props.onClick,
        },
        props.children,
      )
    }

    function Section(props) {
      return h(
        'section',
        { className: 'e2e-section' },
        h('h3', { className: 'e2e-section-title' }, props.title),
        props.extra ? h('div', { className: 'e2e-section-extra' }, props.extra) : null,
        props.children,
      )
    }

    function verdictTone(verdict) {
      if (verdict === 'passed') return 'pass'
      if (verdict === 'failed') return 'fail'
      if (verdict === 'refused') return 'warn'
      if (verdict === 'partial') return 'warn'
      if (verdict === 'running') return 'brand'
      return 'idle'
    }

    /* ---------- the project table ---------- */

    /**
     * "23m ago" rather than a timestamp.
     *
     * The question a reader has about a test list is "how stale is this", and a
     * date answers it only after arithmetic. The exact time stays in the title
     * attribute, so nothing is lost.
     */
    function relativeTime(t, iso) {
      if (!iso) return ''
      const at = Date.parse(iso)
      if (!Number.isFinite(at)) return ''
      const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
      if (seconds < 45) return t('time.justNow')
      const minutes = Math.round(seconds / 60)
      if (minutes < 60) return t('time.minutesAgo', { count: minutes })
      const hours = Math.round(minutes / 60)
      if (hours < 24) return t('time.hoursAgo', { count: hours })
      return t('time.daysAgo', { count: Math.round(hours / 24) })
    }

    function absoluteTime(iso) {
      if (!iso) return ''
      const at = Date.parse(iso)
      if (!Number.isFinite(at)) return ''
      return new Date(at).toLocaleString()
    }

    /**
     * The three numbers in "Latest results".
     *
     * Green, red and grey rather than one summary word, because the interesting
     * state is the mixed one: "2 passed, 1 failed" says something a single
     * "failed" chip cannot.
     */
    function ResultCounts({ t, counts }) {
      if (!counts || counts.total === 0) {
        return h(Chip, { tone: 'idle' }, t('label.notRun'))
      }
      const parts = []
      if (counts.passed > 0) parts.push(h(Chip, { key: 'p', tone: 'pass' }, `✓ ${counts.passed}`))
      if (counts.failed > 0) parts.push(h(Chip, { key: 'f', tone: 'fail' }, `✕ ${counts.failed}`))
      // "not run" and "partial" are different things, and the difference is the
      // point: a suite where nothing has run yet is not half-finished work.
      if (counts.notRun > 0) {
        parts.push(
          h(
            Chip,
            { key: 'n', tone: 'warn', title: counts.passed > 0 || counts.failed > 0 ? t('label.partial') : undefined },
            `— ${counts.notRun}`,
          ),
        )
      }
      return h('div', { className: 'e2e-result-counts' }, parts)
    }

    function TypeChip({ t, type }) {
      const label = type ? t(`label.type.${type}`) : t('label.type.unknown')
      return h('span', { className: 'e2e-type-chip' }, h('span', { className: 'e2e-type-dot' }), label)
    }

    /**
     * The landing page: one row per project.
     *
     * Modelled on the test-management page this plugin is meant to live beside —
     * name, latest results, last activity, created at, type, creator — because
     * that is the shape people already read a suite in. Everything shown here
     * comes from `/projects`; nothing is recomputed in the browser, so the page
     * and the agent can never disagree about a count.
     */
    function ProjectTable({ t, projects, onOpen, creator }) {
      if (!projects || projects.length === 0) {
        return h('div', { className: 'e2e-empty-box' }, t('empty.noProjects'))
      }
      return h(
        'div',
        { className: 'e2e-table' },
        h(
          'div',
          { className: 'e2e-table-head' },
          h('span', { className: 'e2e-col-name' }, t('label.projectName')),
          h('span', { className: 'e2e-col-results' }, t('label.latestResults')),
          h('span', { className: 'e2e-col-activity' }, t('label.lastActivity')),
          h('span', { className: 'e2e-col-created' }, t('label.createdAt')),
          h('span', { className: 'e2e-col-type' }, t('label.type')),
          h('span', { className: 'e2e-col-creator' }, t('label.creator')),
        ),
        projects.map((project) =>
          h(
            'button',
            {
              key: project.key,
              type: 'button',
              className: 'e2e-table-row',
              onClick: () => onOpen(project),
              title: `${t('action.openProject')} — ${project.projectPath || project.baseUrl || project.key}`,
            },
            h(
              'span',
              { className: 'e2e-col-name' },
              h('span', { className: 'e2e-project-icon' }, '▤'),
              h('span', { className: 'e2e-project-name' }, project.name),
              h('span', { className: 'e2e-muted e2e-project-targets' }, t('label.casesCount', { count: project.counts.total })),
            ),
            h('span', { className: 'e2e-col-results' }, h(ResultCounts, { t, counts: project.counts })),
            h(
              'span',
              { className: 'e2e-col-activity', title: absoluteTime(project.lastActivityAt) },
              relativeTime(t, project.lastActivityAt),
            ),
            h(
              'span',
              { className: 'e2e-col-created', title: absoluteTime(project.firstSeenAt) },
              absoluteTime(project.firstSeenAt),
            ),
            h('span', { className: 'e2e-col-type' }, h(TypeChip, { t, type: project.type })),
            h('span', { className: 'e2e-col-creator' }, h('span', { className: 'e2e-avatar' }, (creator || '?').slice(0, 2).toUpperCase())),
          ),
        ),
      )
    }

    /* ---------- the case list, and the plan editor ---------- */

    const STATUS_TONES = {
      passed: 'pass',
      failed: 'fail',
      blocked: 'warn',
      running: 'brand',
      generated: 'idle',
      planned: 'idle',
    }

    /** The one-word answer to "is this case OK", with the word in the reader's language. */
    function StatusChip({ t, status }) {
      return h(Chip, { tone: STATUS_TONES[status] || 'idle' }, t(`status.${status || 'planned'}`))
    }

    /**
     * "6 tests · all passed" — the sentence on a group header.
     *
     * The counts arrive from the Host; this only picks which one to lead with,
     * because a group where everything passed and a group where one case failed
     * are different headlines even when they have the same number of tests.
     */
    function groupSummary(t, summary) {
      if (!summary || summary.counts.total === 0) return t('summary.empty')
      const label = {
        allPassed: () => t('summary.allPassed'),
        someFailed: () => t('summary.someFailed', { count: summary.counts.failed }),
        someBlocked: () => t('summary.someBlocked', { count: summary.counts.blocked }),
        someRunning: () => t('summary.someRunning', { count: summary.counts.running }),
        someUnrun: () => t('summary.someUnrun', { count: summary.counts.planned + summary.counts.generated }),
      }[summary.label]
      return label ? label() : t('summary.empty')
    }

    /** A thin bar showing how much of a group passed — the same shape as the row above it. */
    function GroupBar({ summary }) {
      const counts = (summary && summary.counts) || { total: 0 }
      const total = counts.total || 0
      if (total === 0) return null
      const segment = (count, tone) =>
        count > 0 ? h('span', { className: 'e2e-bar-seg', style: { flexGrow: count, background: TONES[tone] } }) : null
      return h(
        'span',
        { className: 'e2e-bar' },
        segment(counts.passed, 'pass'),
        segment(counts.failed, 'fail'),
        segment(counts.blocked, 'warn'),
        segment(counts.running, 'brand'),
        segment(counts.planned + counts.generated, 'idle'),
      )
    }

    /**
     * The test-case list for one project: status tabs, a search box, and rows
     * grouped by use case.
     *
     * Grouped by use case rather than by endpoint because that is the unit a
     * reader thinks in ("checkout", "registration"); the endpoint is still on the
     * row, so the grouping never hides the route.
     */
    function CaseTable({ t, project, filter, onFilter, query, onQuery, onOpen, onEditPlan, onAddTests, onRunAll, running }) {
      const counts = project.statusCounts || { all: 0 }
      const tabs = ['all', 'planned', 'generated', 'running', 'passed', 'failed', 'blocked']
      /**
       * A group folds. "Run all 62" is a list you scan, and a use case with
       * twenty rows pushes the next one off the screen — the header keeps the
       * counts, so a folded group still says whether it needs opening.
       *
       * Kept per table instance, not per group object: the Host sends a fresh
       * list on every refresh, and folding must survive that.
       */
      const [folded, setFolded] = React.useState({})
      const toggle = (name) => setFolded((state) => ({ ...state, [name]: !state[name] }))
      const needle = String(query || '').trim().toLowerCase()
      const matches = (entry) =>
        needle === '' ||
        String(entry.caseId || '').toLowerCase().includes(needle) ||
        String(entry.title || '').toLowerCase().includes(needle) ||
        String(entry.endpoint || '').toLowerCase().includes(needle)

      const groups = (project.groups || [])
        .map((bucket) => ({
          ...bucket,
          cases: bucket.cases.filter((entry) => (filter === 'all' || entry.status === filter) && matches(entry)),
        }))
        .filter((bucket) => bucket.cases.length > 0)

      const total = groups.reduce((sum, bucket) => sum + bucket.cases.length, 0)

      return h(
        'div',
        { className: 'e2e-cases' },
        h(
          'div',
          { className: 'e2e-cases-bar' },
          h('span', { className: 'e2e-label' }, t('label.testCases')),
          h('div', { className: 'e2e-spacer' }),
          h(Btn, { small: true, onClick: onEditPlan }, t('action.editTestPlan')),
          h(Btn, { small: true, onClick: onAddTests }, t('action.addMoreTests')),
          h(
            Btn,
            { small: true, variant: 'primary', onClick: onRunAll, disabled: running || counts.all === 0 },
            running ? t('action.running') : t('action.runAll', { count: counts.all }),
          ),
        ),
        h(
          'div',
          { className: 'e2e-cases-bar' },
          h('input', {
            className: 'e2e-input e2e-search',
            placeholder: t('label.searchCases'),
            value: query,
            onChange: (event) => onQuery(event.target.value),
          }),
        ),
        h(
          'div',
          { className: 'e2e-tabs' },
          tabs.map((tab) =>
            h(
              'button',
              {
                key: tab,
                type: 'button',
                className: `e2e-tab${filter === tab ? ' is-active' : ''}`,
                onClick: () => onFilter(tab),
              },
              t(`status.${tab}`),
              h('span', { className: 'e2e-tab-count' }, String(counts[tab] ?? 0)),
            ),
          ),
        ),
        h(
          'div',
          { className: 'e2e-cases-head' },
          h('span', { className: 'e2e-col-id' }, 'ID'),
          h('span', { className: 'e2e-col-status' }, t('label.latestStatus')),
          h('span', { className: 'e2e-col-name' }, t('label.testName')),
          h('span', { className: 'e2e-col-priority' }, t('field.priority')),
        ),
        total === 0
          ? h('div', { className: 'e2e-empty-box' }, needle ? t('empty.noSearchResults', { query }) : t('empty.noCases'))
          : groups.map((bucket) => {
              const isFolded = Boolean(folded[bucket.name])
              return h(
                'div',
                { key: bucket.name, className: `e2e-plan-group${isFolded ? ' is-folded' : ''}` },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'e2e-plan-group-head',
                    // The chevron says "this opens"; the title says what a click does.
                    title: isFolded ? t('action.expandGroup') : t('action.foldGroup'),
                    'aria-expanded': isFolded ? 'false' : 'true',
                    onClick: () => toggle(bucket.name),
                  },
                  h('span', { className: 'e2e-chevron', 'aria-hidden': 'true' }, isFolded ? '▸' : '▾'),
                  h('span', { className: 'e2e-plan-group-name', title: t('label.group') }, bucket.name),
                  h('span', { className: 'e2e-muted' }, t('label.tests', { count: bucket.summary.counts.total })),
                  bucket.summary.counts.error > 0
                    ? h(
                        Chip,
                        { tone: 'error', title: t('label.scenarioHint') },
                        `${bucket.summary.counts.error} ${t('label.errorScenarios')}`,
                      )
                    : null,
                  h('span', { className: 'e2e-muted' }, '·'),
                  h('span', { className: 'e2e-muted' }, groupSummary(t, bucket.summary)),
                  h('div', { className: 'e2e-spacer' }),
                  h(GroupBar, { summary: bucket.summary }),
                ),
                isFolded
                  ? null
                  : bucket.cases.map((entry) =>
                      h(
                        'button',
                        {
                          key: entry.file,
                          type: 'button',
                          className: 'e2e-case-row',
                          onClick: () => onOpen(entry.file),
                        },
                        h('span', { className: 'e2e-col-id' }, entry.caseId || entry.id),
                        h('span', { className: 'e2e-col-status' }, h(StatusChip, { t, status: entry.status })),
                        h(
                          'span',
                          { className: 'e2e-col-name' },
                          h('span', { className: 'e2e-test-name' }, entry.title || entry.id),
                          entry.endpoint ? h('code', { className: 'e2e-endpoint-tag' }, entry.endpoint) : null,
                        ),
                        h(
                          'span',
                          { className: 'e2e-col-priority' },
                          h(Chip, { tone: entry.priority === 'high' ? 'warn' : 'idle' }, t(`label.priority.${entry.priority || 'medium'}`)),
                          h('span', { className: 'e2e-muted' }, t('label.steps', { count: (entry.steps || []).length })),
                        ),
                      ),
                    ),
              )
            }),
      )
    }

    /** One labelled input in the form view. */
    function Field({ label, value, onChange, placeholder, multiline, options }) {
      if (options) {
        return h(
          'label',
          { className: 'e2e-field' },
          h('span', { className: 'e2e-field-label' }, label),
          h(
            'select',
            { className: 'e2e-input', value: value ?? '', onChange: (event) => onChange(event.target.value) },
            options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
          ),
        )
      }
      if (multiline) {
        return h(
          'label',
          { className: 'e2e-field' },
          h('span', { className: 'e2e-field-label' }, label),
          h('textarea', {
            className: 'e2e-input e2e-field-area',
            rows: 3,
            value: value ?? '',
            placeholder,
            onChange: (event) => onChange(event.target.value),
          }),
        )
      }
      return h(
        'label',
        { className: 'e2e-field' },
        h('span', { className: 'e2e-field-label' }, label),
        h('input', {
          className: 'e2e-input',
          value: value ?? '',
          placeholder,
          onChange: (event) => onChange(event.target.value),
        }),
      )
    }

    /**
     * The form view of one case.
     *
     * It edits a fixed set of fields and nothing else. The rest of the document —
     * setup SQL, captures, teardown, mocks — stays in YAML, because a form for a
     * SQL block is a text editor with fewer features. The banner says so, so the
     * absence reads as a decision rather than a missing feature.
     */
    function CaseForm({ t, fields, onChange }) {
      const set = (path) => (value) => onChange(path, value)
      return h(
        'div',
        { className: 'e2e-form' },
        h(
          'div',
          { className: 'e2e-form-grid' },
          h(Field, { label: t('field.title'), value: fields.title, onChange: set('title') }),
          h(Field, { label: t('field.caseId'), value: fields.caseId, onChange: set('caseId') }),
          h(Field, { label: t('field.group'), value: fields.group, onChange: set('group') }),
          h(Field, {
            label: t('field.priority'),
            value: fields.priority,
            onChange: set('priority'),
            options: [
              { value: 'high', label: t('label.priority.high') },
              { value: 'medium', label: t('label.priority.medium') },
              { value: 'low', label: t('label.priority.low') },
            ],
          }),
          h(Field, {
            label: t('field.scenario'),
            value: fields.scenario,
            onChange: set('scenario'),
            options: [
              { value: 'normal', label: t('label.scenario.normal') },
              { value: 'error', label: t('label.scenario.error') },
            ],
          }),
          h(Field, { label: t('field.endpoint'), value: fields.endpoint, onChange: set('endpoint'), placeholder: 'POST /auth/register' }),
        ),
        h(Field, {
          label: t('field.description'),
          value: fields.description,
          onChange: set('description'),
          multiline: true,
        }),
        h(
          'div',
          { className: 'e2e-form-grid' },
          h(Field, { label: t('field.method'), value: fields['request.method'], onChange: set('request.method') }),
          h(Field, { label: t('field.path'), value: fields['request.path'], onChange: set('request.path') }),
          h(Field, {
            label: t('field.status'),
            value: fields['expect.response.status'],
            onChange: set('expect.response.status'),
            placeholder: '200',
          }),
        ),
        h('p', { className: 'e2e-hint' }, t('label.formOnly')),
      )
    }

    /**
     * The plan editor: every case in the project, grouped, with a form/YAML
     * toggle per case.
     *
     * The toggle is per case, not per page: a person who is renaming six tests
     * wants the form, and the same person adding a SQL assertion to one of them
     * wants the YAML, without switching modes for the whole document.
     */
    function PlanEditor(props) {
      const {
        t,
        project,
        mode,
        onMode,
        onOpen,
        selected,
        fields,
        onField,
        yaml,
        onYaml,
        onSave,
        onDone,
        onAddTest,
        actions,
        busy,
        dirty,
      } = props
      const groups = project.groups || []
      const definition = selected ? selected.definition : null
      return h(
        'div',
        { className: 'e2e-plan' },
        h(
          'div',
          { className: 'e2e-cases-bar' },
          h(
            'div',
            { className: 'e2e-mode' },
            ['form', 'yaml'].map((name) =>
              h(
                'button',
                {
                  key: name,
                  type: 'button',
                  className: `e2e-mode-btn${mode === name ? ' is-active' : ''}`,
                  onClick: () => onMode(name),
                },
                t(`label.mode.${name}`),
              ),
            ),
          ),
          h('span', { className: 'e2e-muted' }, dirty ? t('label.unsaved') : t('label.noChanges')),
          h('div', { className: 'e2e-spacer' }),
          h(Btn, { small: true, onClick: onDone }, t('action.done')),
          h(
            Btn,
            { small: true, variant: 'primary', onClick: onSave, disabled: busy || !dirty },
            busy ? t('action.saving') : t('action.saveChanges'),
          ),
        ),
        // Which case is open, and whether it is saved. Without this the editor is
        // a text box whose subject you have to infer from the list on the left.
        h(
          'div',
          { className: 'e2e-cases-bar' },
          h('span', { className: 'e2e-label' }, t('label.editor')),
          selected
            ? h('code', { className: 'e2e-file', title: selected.path || '' }, selected.file)
            : null,
          definition && definition.caseId
            ? h(
                Chip,
                {
                  tone: definition.caseIdDerived ? 'idle' : 'brand',
                  title: definition.caseIdDerived ? t('label.caseIdDerived') : t('label.caseId'),
                },
                definition.caseIdDerived ? t('label.caseIdDerived') : definition.caseId,
              )
            : null,
          selected && definition
            ? definition.endpoint
              ? h('code', { className: 'e2e-endpoint-tag' }, definition.endpoint)
              : h(Chip, { tone: 'idle' }, t('label.noEndpoint'))
            : null,
          definition && definition.scenario
            ? h(
                Chip,
                { tone: definition.scenario === 'error' ? 'error' : 'success', title: t('label.scenarioHint') },
                t(`label.scenario.${definition.scenario}`),
              )
            : null,
          definition && definition.priority
            ? h(
                Chip,
                { tone: definition.priority === 'high' ? 'warn' : 'idle', title: t('label.priorityHint') },
                t(`label.priority.${definition.priority}`),
              )
            : null,
          selected
            ? dirty
              ? h(Chip, { tone: 'warn', title: t('label.unsaved') }, t('state.dirty'))
              : h(Chip, { tone: 'idle' }, t('state.saved'))
            : null,
          h('div', { className: 'e2e-spacer' }),
          actions,
        ),
        h(
          'div',
          { className: 'e2e-plan-body' },
          h(
            'div',
            { className: 'e2e-plan-list' },
            groups.length === 0
              ? h('div', { className: 'e2e-empty-box' }, t('empty.noCases'))
              : groups.map((bucket) =>
                  h(
                    'div',
                    { key: bucket.name, className: 'e2e-plan-card' },
                    h(
                      'div',
                      { className: 'e2e-plan-group-head' },
                      h('span', { className: 'e2e-plan-group-name' }, bucket.name),
                      h('span', { className: 'e2e-muted' }, t('label.tests', { count: bucket.summary.counts.total })),
                    ),
                    bucket.cases.map((entry) =>
                      h(
                        'button',
                        {
                          key: entry.file,
                          type: 'button',
                          className: `e2e-plan-row${selected && selected.file === entry.file ? ' is-active' : ''}`,
                          onClick: () => onOpen(entry.file),
                        },
                        h('span', { className: 'e2e-col-id' }, entry.caseId || entry.id),
                        h(
                          'span',
                          { className: 'e2e-plan-row-name' },
                          h(Chip, { tone: entry.priority === 'high' ? 'warn' : 'idle' }, t(`label.priority.${entry.priority || 'medium'}`)),
                          h('span', { className: 'e2e-test-name' }, entry.title || entry.id),
                        ),
                        h('span', { className: 'e2e-muted' }, t('label.steps', { count: (entry.steps || []).length })),
                      ),
                    ),
                    // A new case joins the group it was added from: the group is
                    // the author's word for what these tests are about, and making
                    // them type it again is how groups drift apart.
                    h(
                      'button',
                      { type: 'button', className: 'e2e-add-test', onClick: () => onAddTest(bucket) },
                      t('action.addTest'),
                    ),
                  ),
                ),
          ),
          h(
            'div',
            { className: 'e2e-plan-editor' },
            !selected
              ? h('div', { className: 'e2e-empty-box' }, t('empty.selectCase'))
              : mode === 'form'
                ? h(CaseForm, { t, fields, onChange: onField })
                : h('textarea', {
                    className: 'e2e-textarea is-plan',
                    spellCheck: false,
                    value: yaml,
                    onChange: (event) => onYaml(event.target.value),
                  }),
          ),
        ),
      )
    }

    /**
     * What this case did the last N times it ran.
     *
     * A passing case is not a case with nothing to say. The first question
     * anyone asks about a green test is "when did it last pass, and what did it
     * actually see?" — and the answer was already on disk in the report
     * directory, unread, because the panel only ever showed the run it had just
     * started itself.
     */
    function HistoryPanel(props) {
      const { t, history, run, onOpenRun, loading } = props
      const rows = history || []
      return h(
        'div',
        { className: 'e2e-history' },
        h('div', { className: 'e2e-evidence-head' }, rows.length === 0 ? t('label.neverRun') : t('label.lastRun')),
        rows.length === 0
          ? h('div', { className: 'e2e-empty-box' }, t('label.noHistory'))
          : h(
              'div',
              { className: 'e2e-history-list' },
              rows.map((item) =>
                h(
                  'button',
                  {
                    key: item.path,
                    type: 'button',
                    className: `e2e-history-row${run && run.path === item.path ? ' is-active' : ''}`,
                    // The relative time says "how long ago"; the title says when.
                    title: item.startedAt ? t('label.runAt', { when: absoluteTime(item.startedAt) }) : '',
                    onClick: () => onOpenRun(item.path),
                  },
                  h(Chip, { tone: verdictTone(item.verdict) }, t(`verdict.${item.verdict || 'running'}`)),
                  h('span', { className: 'e2e-muted' }, relativeTime(t, item.startedAt)),
                  h('span', { className: 'e2e-muted' }, `${item.checks || 0} ${t('label.checks')}`),
                  item.durationMs ? h('span', { className: 'e2e-muted' }, `${item.durationMs} ms`) : null,
                ),
              ),
            ),
        loading ? h('div', { className: 'e2e-muted' }, t('action.loading')) : null,
        run
          ? h(
              'div',
              { className: 'e2e-history-detail' },
              h('div', { className: 'e2e-evidence-head' }, t('label.thisRun')),
              h(
                'div',
                { className: 'e2e-checks' },
                ((run.report && run.report.checks) || []).map((check, index) => h(CheckRow, { key: index, check })),
              ),
              h(Evidence, { t, evidence: (run.report && run.report.evidence) || null, steps: (run.report && run.report.steps) || [] }),
            )
          : null,
      )
    }

    /**
     * One test case, as a page you read rather than a file you edit.
     *
     * Clicking a case used to drop you straight into the editor, which meant the
     * only thing you could do with a passing test was stare at its YAML. What
     * people actually do with a case they just clicked is *read* it: what is it,
     * what did it last do, what did it see. Editing is a decision, so it gets its
     * own button.
     */
    function CaseDetail(props) {
      const {
        t,
        selected,
        history,
        historyRun,
        onOpenRun,
        historyLoading,
        onEdit,
        onRun,
        running,
        onDone,
      } = props
      const [tab, setTab] = React.useState('checks')
      const definition = selected ? selected.definition : null
      const latest = (history && history[0]) || null
      // The run the reader is looking at. Opening a case loads its newest report,
      // so this is almost always set — the tabs would otherwise all be empty on a
      // case that has run twelve times, which is a lie the page cannot afford.
      const shown = historyRun || null
      const evidence = shown ? (shown.report && shown.report.evidence) || null : null
      const checks = shown ? (shown.report && shown.report.checks) || [] : []
      const steps = (shown && shown.report && shown.report.steps) || []
      const verdict = latest ? latest.verdict : null
      /**
       * The detail page has one tab per question a failing run makes you ask, in
       * the order you ask them: what did it check, what did the service say, what
       * does the database look like now. Code and history are for afterwards.
       *
       * They are tabs rather than one long page because the answers are long and
       * mostly irrelevant to each other: a console dump between you and the
       * checkpoint that failed is a wall, not evidence.
       */
      const tabs = [
        { name: 'checks', label: t('label.mode.checks'), count: checks.length },
        { name: 'logs', label: t('label.mode.logs'), count: (evidence && evidence.logs && evidence.logs.lines && evidence.logs.lines.length) || 0 },
        // Before/after pairs when the report has them, and the after-state on
        // its own when it does not: a report written before snapshots existed
        // still read the rows, and hiding them because the pair is missing
        // throws away the answer to keep the shape of the question.
        {
          name: 'database',
          label: t('label.mode.database'),
          count:
            (evidence && evidence.snapshots && evidence.snapshots.length) ||
            (evidence && evidence.database && evidence.database.length) ||
            0,
        },
        // Only offered when the case has a browser block: a tab that is always
        // there and always empty is a question the page cannot answer.
        ...(evidence && evidence.browser
          ? [{ name: 'shots', label: t('label.mode.shots'), count: (evidence.browser.screenshots || []).length }]
          : []),
        { name: 'code', label: t('label.mode.code'), count: 0 },
        { name: 'history', label: t('label.mode.history'), count: (history || []).length },
      ]
      return h(
        'div',
        { className: 'e2e-detail' },
        h(
          'div',
          { className: 'e2e-detail-head' },
          h(
            'div',
            null,
            h(
              'div',
              { className: 'e2e-detail-kicker' },
              `${t('label.testCase')} · ${(definition && definition.caseId) || (selected && selected.file) || ''}`,
            ),
            h('h3', { className: 'e2e-detail-title' }, (definition && definition.title) || (selected && selected.file) || ''),
          ),
          h('div', { className: 'e2e-spacer' }),
          // The status word, not the verdict word: "Passed" is what the list calls
          // this case, and the detail page must not invent a second vocabulary.
          verdict
            ? h(
                Chip,
                { tone: verdictTone(verdict) },
                t(`status.${verdict === 'passed' ? 'passed' : verdict === 'failed' ? 'failed' : 'generated'}`),
              )
            : h(Chip, { tone: 'idle' }, t('status.planned')),
          h(
            Btn,
            { small: true, variant: 'primary', onClick: onRun, disabled: running },
            running ? t('action.running') : t('action.runTest'),
          ),
          h(Btn, { small: true, onClick: onEdit }, t('action.edit')),
        ),
        h(
          'div',
          { className: 'e2e-detail-body' },
          // The properties column answers "what is this" without opening a tab.
          h(
            'aside',
            { className: 'e2e-detail-side' },
            h('div', { className: 'e2e-detail-side-head' }, t('label.properties')),
            h(
              'div',
              { className: 'e2e-detail-prop' },
              h('span', { className: 'e2e-field-label' }, t('label.caseId')),
              h('span', null, (definition && definition.caseId) || '—'),
            ),
            h(
              'div',
              { className: 'e2e-detail-prop' },
              h('span', { className: 'e2e-field-label' }, t('field.priority')),
              h(Chip, { tone: definition && definition.priority === 'high' ? 'warn' : 'idle' }, t(`label.priority.${(definition && definition.priority) || 'medium'}`)),
            ),
            h(
              'div',
              { className: 'e2e-detail-prop' },
              h('span', { className: 'e2e-field-label' }, t('field.endpoint')),
              definition && definition.endpoint
                ? h('code', { className: 'e2e-endpoint-tag' }, definition.endpoint)
                : h(Chip, { tone: 'idle' }, t('label.noEndpoint')),
            ),
            definition && definition.group
              ? h(
                  'div',
                  { className: 'e2e-detail-prop' },
                  h('span', { className: 'e2e-field-label' }, t('label.group')),
                  h('span', null, definition.group),
                )
              : null,
            h(
              'div',
              { className: 'e2e-detail-prop' },
              h('span', { className: 'e2e-field-label' }, t('label.lastRun')),
              h('span', null, latest ? relativeTime(t, latest.startedAt) : t('label.neverRun')),
            ),
            definition && definition.description
              ? h(
                  'div',
                  { className: 'e2e-detail-prop' },
                  h('span', { className: 'e2e-field-label' }, t('label.goal')),
                  h('div', { className: 'e2e-detail-goal' }, definition.description),
                )
              : null,
          ),
          h(
            'div',
            { className: 'e2e-detail-main' },
            h(
              'div',
              { className: 'e2e-mode' },
              tabs.map((item) =>
                h(
                  'button',
                  {
                    key: item.name,
                    type: 'button',
                    className: `e2e-mode-btn${tab === item.name ? ' is-active' : ''}`,
                    onClick: () => setTab(item.name),
                  },
                  item.count > 0 ? `${item.label} ${item.count}` : item.label,
                ),
              ),
            ),
            tab === 'checks'
              ? h(
                  'div',
                  { className: 'e2e-detail-pane' },
                  checks.length > 0
                    ? h(
                        'div',
                        { className: 'e2e-checks' },
                        checks.map((check, index) => h(CheckRow, { key: index, check })),
                      )
                    : h('div', { className: 'e2e-muted' }, t('label.noChecks')),
                )
              : null,
            tab === 'logs'
              ? h(
                  'div',
                  { className: 'e2e-detail-pane' },
                  evidence && evidence.logs
                    ? h(
                        'div',
                        null,
                        h(
                          'div',
                          { className: 'e2e-muted' },
                          `${evidence.logs.traceId} · ${evidence.logs.scopedLines}/${evidence.logs.totalLines}`,
                        ),
                        // Kept, but not checked: saying so is the difference
                        // between "the run verified its logs" and "here is what
                        // the service printed".
                        evidence.logs.asserted === false
                          ? h('div', { className: 'e2e-muted' }, t('label.logsNotAsserted'))
                          : null,
                        evidence.logs.traceIdPresent
                          ? null
                          : h('div', { className: 'e2e-warning' }, t('label.logsUnscoped')),
                        h('pre', { className: 'e2e-pre is-tall' }, formatBody((evidence.logs.lines || []).join('\n'))),
                      )
                    : h('div', { className: 'e2e-muted' }, t('label.noLogs')),
                )
              : null,
            tab === 'database'
              ? h(
                  'div',
                  { className: 'e2e-detail-pane' },
                  evidence && evidence.snapshots && evidence.snapshots.length > 0
                    ? evidence.snapshots.map((snapshot, index) =>
                        h(DatabaseDiff, { key: index, t, snapshot }),
                      )
                    : evidence && evidence.database && evidence.database.length > 0
                      ? evidence.database.map((entry, index) =>
                          h(DatabaseRows, { key: index, t, entry }),
                        )
                      : h('div', { className: 'e2e-muted' }, t('label.noSnapshots')),
                )
              : null,
            tab === 'code' ? h('pre', { className: 'e2e-pre is-plan' }, (selected && selected.yaml) || '') : null,
            tab === 'shots' ? h(ShotsPane, { t, browser: evidence && evidence.browser }) : null,
            tab === 'history'
              ? h(HistoryPanel, { t, history, run: historyRun, onOpenRun, loading: historyLoading })
              : null,
            // Output stays visible under every tab: whatever the reader is
            // looking at, "what did the service answer" is the next question.
            h(
              'div',
              { className: 'e2e-output' },
              h('div', { className: 'e2e-evidence-head' }, t('label.mode.output')),
              evidence && evidence.response
                ? h(
                    'div',
                    null,
                    h('div', { className: 'e2e-muted' }, `${t('label.status')}: ${evidence.response.status} ${evidence.response.statusText || ''}`),
                    h('pre', { className: 'e2e-pre' }, formatBody(evidence.response.body)),
                  )
                : h('div', { className: 'e2e-muted' }, t('label.noHistory')),
              steps.length > 0
                ? h(
                    'div',
                    { className: 'e2e-steps' },
                    steps.map((item, index) => h('div', { key: index, className: 'e2e-muted' }, `+${item.at} ms · ${item.name}`)),
                  )
                : null,
            ),
          ),
        ),
        h(
          'div',
          { className: 'e2e-cases-bar' },
          h('div', { className: 'e2e-spacer' }),
          h(Btn, { small: true, onClick: onDone }, t('action.backToCases')),
        ),
      )
    }

    function SidebarIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 20
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M4 5.5h16' }),
        h('path', { d: 'M4 12h9' }),
        h('path', { d: 'M4 18.5h6' }),
        h('path', { d: 'M16.5 11.5l3 3-3 3' }),
      )
    }

    /* ---------- the editor ---------- */

    /* ---------- the run surface ---------- */

    function CheckRow(props) {
      const { check } = props
      const tone = check.ok ? TONES.pass : TONES.fail
      return h(
        'div',
        { className: 'e2e-check' },
        h('span', { className: 'e2e-check-mark', style: { color: tone } }, check.ok ? '✓' : '✗'),
        h(
          'div',
          { className: 'e2e-check-body' },
          h('div', { className: 'e2e-check-label' }, check.label),
          check.ok
            ? null
            : h(
                'div',
                { className: 'e2e-check-diff' },
                h('span', null, `expected ${formatValue(check.expected)}`),
                h('span', { className: 'e2e-muted' }, ' · '),
                h('span', null, `actual ${formatValue(check.actual)}`),
              ),
          check.ok || !check.detail ? null : h('div', { className: 'e2e-check-detail' }, String(check.detail)),
        ),
      )
    }

    function formatValue(value) {
      if (value === undefined) return 'undefined'
      if (typeof value === 'string') return value.length > 220 ? `${value.slice(0, 220)}…` : value
      try {
        const text = JSON.stringify(value)
        return text && text.length > 220 ? `${text.slice(0, 220)}…` : String(text)
      } catch {
        return String(value)
      }
    }

    // Evidence bodies are read, not skimmed: a longer limit than a diff line.
    function formatBody(value, limit = 4000) {
      if (value === null || value === undefined) return ''
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      if (!text) return ''
      return text.length > limit ? `${text.slice(0, limit)}\n… truncated` : text
    }

    /**
     * One database assertion, shown as the thing it actually is: a query that ran
     * twice, once before the request and once after, with the rows it returned.
     *
     * The verdict says "expected 1 row, got 0". That tells you the case failed; it
     * does not tell you why. "0 rows before, 0 rows after" says the request never
     * wrote anything. "0 before, 1 after" says it worked and the assertion is
     * wrong. "1 before, 1 after" says the row was already there — the case is
     * passing without testing anything, which is the most expensive kind of green.
     */
    function DatabaseDiff(props) {
      const { t, snapshot } = props
      const rows = (value) => {
        if (!Array.isArray(value) || value.length === 0) return '—'
        return formatValue(value)
      }
      return h(
        'div',
        { className: 'e2e-db-diff' },
        h(
          'div',
          { className: 'e2e-db-head' },
          `${t('label.database')} ${snapshot.database || 'default'}`,
          h(
            'span',
            { className: 'e2e-muted' },
            ` · ${snapshot.beforeCount ?? '?'} → ${snapshot.afterCount ?? '?'}`,
          ),
          snapshot.changed === undefined
            ? null
            : h(
                Chip,
                { tone: snapshot.changed ? 'success' : 'idle' },
                snapshot.changed ? t('label.changed') : t('label.unchanged'),
              ),
        ),
        h('pre', { className: 'e2e-pre' }, snapshot.sql),
        snapshot.changed === undefined
          ? h('div', { className: 'e2e-muted' }, t('label.snapshotGap'))
          : h(
              'div',
              { className: 'e2e-db-pair' },
              h(
                'div',
                null,
                h('div', { className: 'e2e-muted' }, t('label.before')),
                h('pre', { className: 'e2e-pre' }, rows(snapshot.before)),
              ),
              h(
                'div',
                null,
                h('div', { className: 'e2e-muted' }, t('label.after')),
                h('pre', { className: 'e2e-pre' }, rows(snapshot.after)),
              ),
            ),
      )
    }

    /**
     * A database assertion from a report that has no before/after pair.
     *
     * Reports written before snapshots existed carry the rows the query
     * returned after the request and nothing else. That is still the answer to
     * "what was in the table", which is why this is not `DatabaseDiff` with
     * blanks: pretending a pair exists when one half was never read would be a
     * quieter lie than showing the single half that was.
     */
    function DatabaseRows(props) {
      const { t, entry } = props
      const rows = (value) => {
        if (!Array.isArray(value) || value.length === 0) return '—'
        return formatValue(value)
      }
      return h(
        'div',
        { className: 'e2e-db-diff' },
        h(
          'div',
          { className: 'e2e-db-head' },
          `${t('label.database')} ${entry.database || 'default'}`,
          h('span', { className: 'e2e-muted' }, ` · ${entry.rowCount ?? (entry.rows || []).length} rows`),
          h(Chip, { tone: 'idle' }, t('label.afterOnly')),
        ),
        h('pre', { className: 'e2e-pre' }, entry.sql),
        entry.error ? h('div', { className: 'e2e-warning' }, String(entry.error)) : null,
        h(
          'div',
          null,
          h('div', { className: 'e2e-muted' }, t('label.readAfterRequest')),
          h('pre', { className: 'e2e-pre' }, rows(entry.rows)),
        ),
      )
    }

    /**
     * The screenshots a browser journey took, plus the page's own console.
     *
     * The images are served by `/shot?path=…` rather than inlined as data URLs:
     * a base64 PNG in the report JSON would triple the size of every report and
     * make `GET /report` slow for the case that never looks at a picture.
     *
     * Clicking one opens it full size in a new tab. The alternative — a lightbox
     * — is a modal this panel would then have to close on Escape, click-outside
     * and unmount; a browser tab already does all three.
     */
    function ShotsPane(props) {
      const { t, browser } = props
      if (!browser) return h('div', { className: 'e2e-muted' }, t('label.noShots'))
      if (browser.error) {
        return h(
          'div',
          { className: 'e2e-detail-pane' },
          h('div', { className: 'e2e-warning' }, `${t('label.browserFailed')}: ${browser.error}`),
        )
      }
      const shots = browser.screenshots || []
      const lines = browser.console || []
      return h(
        'div',
        { className: 'e2e-detail-pane' },
        shots.length > 0
          ? h(
              'div',
              { className: 'e2e-shots' },
              shots.map((shot, index) =>
                h(
                  'figure',
                  { key: index, className: 'e2e-shot' },
                  h(
                    'a',
                    {
                      className: 'e2e-shot-link',
                      href: `${API}/shot?path=${q(shot.file)}`,
                      target: '_blank',
                      rel: 'noreferrer',
                      title: t('label.shotOpen'),
                    },
                    h('img', { className: 'e2e-shot-img', src: `${API}/shot?path=${q(shot.file)}`, alt: shot.name || '' }),
                  ),
                  h(
                    'figcaption',
                    { className: 'e2e-shot-name' },
                    `${shot.name || ''} · +${shot.at} ms`,
                  ),
                ),
              ),
            )
          : h('div', { className: 'e2e-muted' }, t('label.noShots')),
        h(
          'div',
          { className: 'e2e-evidence-part' },
          h('div', { className: 'e2e-evidence-head' }, t('label.browserConsole')),
          lines.length > 0
            ? h(
                'pre',
                { className: 'e2e-pre' },
                formatBody(
                  lines
                    .map((line) => `${line.level}${line.url ? ` (${line.url})` : ''}: ${line.text}`)
                    .join('\n'),
                ),
              )
            : h('div', { className: 'e2e-muted' }, t('label.noBrowserConsole')),
        ),
      )
    }

    function EvidenceBlock(props) {
      const { title, children } = props
      if (!children) return null
      return h('details', { className: 'e2e-details' }, h('summary', null, title), children)
    }

    /**
     * What a run actually saw: the request, the response, the logs that carried
     * its trace id, the database rows it read back, and when each step happened.
     *
     * Extracted from `RunSurface` because a *past* run has exactly the same
     * evidence in exactly the same shape — the report on disk is the same object
     * the live run summarised. Two renderers would drift, and the one that
     * drifts is always the one you are not looking at.
     */
    function Evidence(props) {
      const { t, evidence, steps } = props
      if (!evidence) return null
      return h(
        EvidenceBlock,
        { title: t('section.evidence') },
        h(
          'div',
          { className: 'e2e-evidence' },
          evidence.request
            ? h(
                'div',
                { className: 'e2e-evidence-part' },
                h('div', { className: 'e2e-evidence-head' }, t('section.request')),
                h('div', { className: 'e2e-muted' }, `${evidence.request.method} ${evidence.request.url}`),
                evidence.request.body === null || evidence.request.body === undefined
                  ? null
                  : h('pre', { className: 'e2e-pre' }, formatBody(evidence.request.body)),
              )
            : null,
          evidence.response
            ? h(
                'div',
                { className: 'e2e-evidence-part' },
                h('div', { className: 'e2e-evidence-head' }, t('section.response')),
                h(
                  'div',
                  { className: 'e2e-muted' },
                  `${evidence.response.status} ${evidence.response.statusText || ''} · ${evidence.response.durationMs} ms`,
                ),
                h('pre', { className: 'e2e-pre' }, formatBody(evidence.response.body)),
              )
            : null,
          evidence.logs
            ? h(
                'div',
                { className: 'e2e-evidence-part' },
                h('div', { className: 'e2e-evidence-head' }, t('section.logs')),
                h(
                  'div',
                  { className: 'e2e-muted' },
                  `${evidence.logs.traceId} · ${evidence.logs.scopedLines}/${evidence.logs.totalLines}`,
                ),
                h('pre', { className: 'e2e-pre is-tall' }, formatBody((evidence.logs.lines || []).join('\n'))),
              )
            : null,
          evidence.database && evidence.database.length > 0
            ? h(
                'div',
                { className: 'e2e-evidence-part' },
                h('div', { className: 'e2e-evidence-head' }, t('section.database')),
                evidence.database.map((entry, index) =>
                  h(
                    'div',
                    { key: index, className: 'e2e-db-entry' },
                    h('div', { className: 'e2e-db-head' }, `${t('label.database')} ${entry.database || 'default'} · ${entry.rowCount ?? '?'} rows`),
                    h('pre', { className: 'e2e-pre' }, entry.sql),
                    entry.rows ? h('pre', { className: 'e2e-pre' }, formatValue(entry.rows)) : null,
                  ),
                ),
              )
            : null,
          steps && steps.length > 0
            ? h(
                'div',
                { className: 'e2e-evidence-part' },
                h('div', { className: 'e2e-evidence-head' }, t('section.timeline')),
                h(
                  'div',
                  { className: 'e2e-steps' },
                  steps.map((item, index) => h('div', { key: index, className: 'e2e-muted' }, `+${item.at} ms · ${item.name}`)),
                ),
              )
            : null,
        ),
      )
    }

    function RunSurface(props) {
      const { t, run, onExplain, explaining, onOpenReport } = props
      if (!run) return null
      const report = run.report
      const checks = (report && report.checks) || []
      const warnings = run.warnings || []
      const evidence = (report && report.evidence) || null
      const steps = (report && report.steps) || []
      return h(
        'div',
        { className: 'e2e-run' },
        h(
          'div',
          { className: 'e2e-run-bar' },
          h('span', { className: 'e2e-muted' }, t('label.verdict')),
          h(Chip, { tone: verdictTone(run.status === 'running' ? 'running' : run.verdict) }, t(`verdict.${run.status === 'running' ? 'running' : run.verdict || 'running'}`)),
          h('span', { className: 'e2e-muted' }, `${checks.length || run.checks || 0} ${t('label.checks')}`),
          run.durationMs ? h('span', { className: 'e2e-muted' }, `${t('label.duration')} ${run.durationMs} ms`) : null,
          h('div', { className: 'e2e-spacer' }),
          run.reportPath ? h(Btn, { small: true, onClick: () => onOpenReport(run.reportPath) }, t('action.reopen')) : null,
          run.verdict === 'failed'
            ? h(Btn, { small: true, onClick: onExplain, disabled: explaining }, explaining ? t('action.explaining') : t('action.explain'))
            : null,
        ),
        run.error
          ? h('div', { className: 'e2e-fatal' }, h('strong', null, t('section.fatal')), h('div', null, run.error))
          : null,
        report && report.fatal ? h('div', { className: 'e2e-fatal' }, h('strong', null, t('section.fatal')), h('div', null, report.fatal.message)) : null,
        warnings.length > 0
          ? h(
              'div',
              null,
              h('div', { className: 'e2e-evidence-head' }, t('label.warnings')),
              h(
                'ul',
                { className: 'e2e-warnings' },
                warnings.map((warning, index) => h('li', { key: index }, String(warning))),
              ),
            )
          : null,
        checks.length === 0 && run.status === 'finished'
          ? h('div', { className: 'e2e-muted' }, t('empty.noChecks'))
          : h('div', { className: 'e2e-checks' }, checks.map((check, index) => h(CheckRow, { key: index, check }))),
        run.explanation
          ? h(
              'div',
              { className: 'e2e-explain' },
              h('div', { className: 'e2e-explain-head' }, t('section.why')),
              h('div', { className: 'e2e-explain-body' }, run.explanation),
            )
          : null,
        h(Evidence, { t, evidence, steps }),
      )
    }

    /* ---------- the generate box ---------- */

    function GenerateBox(props) {
      const { t, onGenerate, generating, error, databases, targets } = props
      const [description, setDescription] = React.useState('')
      return h(
        'div',
        { className: 'e2e-generate' },
        h('label', { className: 'e2e-label' }, t('label.generateFor')),
        h('textarea', {
          className: 'e2e-textarea is-short',
          placeholder: t('label.generatePlaceholder'),
          value: description,
          onChange: (event) => setDescription(event.target.value),
        }),
        targets.length > 0 || databases.length > 0
          ? h(
              'div',
              { className: 'e2e-hint' },
              targets.length > 0 ? `targets: ${targets.join(', ')}` : null,
              targets.length > 0 && databases.length > 0 ? ' · ' : null,
              databases.length > 0 ? `databases: ${databases.join(', ')}` : null,
            )
          : null,
        error ? h('div', { className: 'e2e-error' }, error) : null,
        h(
          'div',
          { className: 'e2e-row' },
          h(
            Btn,
            {
              small: true,
              variant: 'primary',
              disabled: generating || description.trim().length === 0,
              onClick: () => onGenerate(description),
            },
            generating ? t('action.generating') : t('action.generate'),
          ),
        ),
      )
    }

    /* ---------- the scan box ---------- */

    /**
     * Lists the endpoints the project already serves, so a new case starts from the
     * real path and the real body shape instead of from memory.
     *
     * Nothing is written here: picking an endpoint loads a skeleton into the editor,
     * and the editor's Save button is the only thing that touches the disk.
     */
    function ScanBox(props) {
      const { t, onScaffold, onScanned, scaffolding, error } = props
      const [scan, setScan] = React.useState({ status: 'idle', data: null, error: null })
      const [picked, setPicked] = React.useState(null)

      const run = async () => {
        setScan({ status: 'scanning', data: null, error: null })
        try {
          const data = await apiPost('/scan', {})
          setScan({ status: 'ready', data, error: null })
          if (onScanned) {
            onScanned({
              files: data.scannedFiles,
              endpoints: (data.endpoints || []).length,
            })
          }
        } catch (failure) {
          setScan({ status: 'error', data: null, error: failure.message })
        }
      }

      const list = (scan.data && scan.data.endpoints) || []

      return h(
        'div',
        { className: 'e2e-generate' },
        h('label', { className: 'e2e-label' }, t('label.scan')),
        h('div', { className: 'e2e-hint' }, t('label.scanHint')),
        scan.status === 'ready' && scan.data
          ? h(
              'div',
              { className: 'e2e-hint' },
              t('label.scanned', {
                files: scan.data.scannedFiles,
                endpoints: list.length,
                entities: (scan.data.entities || []).length,
              }),
            )
          : null,
        error ? h('div', { className: 'e2e-error' }, error) : null,
        scan.error ? h('div', { className: 'e2e-error' }, scan.error) : null,
        scan.status === 'ready'
          ? h(
              'div',
              { className: 'e2e-endpoints' },
              list.map((endpoint) => {
                const key = `${endpoint.httpMethod} ${endpoint.path}`
                const active = picked === key
                return h(
                  'button',
                  {
                    key,
                    type: 'button',
                    className: `e2e-endpoint${active ? ' is-active' : ''}`,
                    onClick: () => {
                      setPicked(key)
                      onScaffold(endpoint)
                    },
                  },
                  h('span', { className: 'e2e-method' }, endpoint.httpMethod),
                  h('code', { className: 'e2e-endpoint-path' }, endpoint.path),
                  h(
                    'span',
                    { className: 'e2e-muted' },
                    endpoint.requestBody
                      ? `${t('label.endpointBody')} ${endpoint.requestBody.type}`
                      : t('label.endpointNoBody'),
                  ),
                  active && scaffolding ? h('span', { className: 'e2e-muted' }, t('action.scaffold')) : null,
                )
              }),
            )
          : null,
        h(
          'div',
          { className: 'e2e-row' },
          h(
            Btn,
            { small: true, disabled: scan.status === 'scanning', onClick: run },
            scan.status === 'scanning' ? t('action.scanning') : t('action.scan'),
          ),
        ),
      )
    }

    /* ---------- the panel ---------- */

    function MainPanel() {
      const t = useT()

      const [boot, setBoot] = React.useState({ status: 'loading', data: null, error: null })
      // The landing view is the project table; `openProject` switches to the
      // case list + editor for one project. Null means "showing the table".
      const [openProject, setOpenProject] = React.useState(null)
      const [selected, setSelected] = React.useState(null) // { path, file, yaml, original, definition, error }
      const [busy, setBusy] = React.useState(null) // 'save' | 'validate' | 'delete' | 'generate'
      const [notice, setNotice] = React.useState(null)
      const [problems, setProblems] = React.useState(null)
      const [run, setRun] = React.useState(null)
      const [allowWrites, setAllowWrites] = React.useState(false)
      const [keepRunning, setKeepRunning] = React.useState(false)
      const [explaining, setExplaining] = React.useState(false)
      const [creating, setCreating] = React.useState(null) // draft file name
      const [reportText, setReportText] = React.useState(null)
      // Where a freshly generated document will be saved. Kept outside `selected`
      // because a generated case has no file on disk yet.
      const [generatedInto, setGeneratedInto] = React.useState(null)
      // Which page of a project is showing: the case list, or the plan editor.
      // They are two pages rather than two panels because they answer different
      // questions — "what is red" and "what should this test say" — and a page
      // that answers both answers neither well.
      const [view, setView] = React.useState('cases')
      const [filter, setFilter] = React.useState('all')
      const [query, setQuery] = React.useState('')
      // The form's draft. `baseFields` is what was on disk, so "changed" means
      // changed by the person, not by the last save.
      const [draftFields, setDraftFields] = React.useState(null)
      const [baseFields, setBaseFields] = React.useState(null)
      const [planMode, setPlanMode] = React.useState('form')
      // The run whose report is expanded under the history list. Kept apart from
      // `run` (the live run) because reading yesterday's report must not make the
      // page look like something is running right now.
      const [historyRun, setHistoryRun] = React.useState(null)
      const [historyLoading, setHistoryLoading] = React.useState(false)
      const [batch, setBatch] = React.useState(null)
      const [adding, setAdding] = React.useState(false)
      // The group a new case should join, when the reader pressed "Add test"
      // inside a group rather than the toolbar.
      const [pendingGroup, setPendingGroup] = React.useState('')
      // Delete asks twice, and forgets the first answer after a few seconds: a
      // confirmation that stays armed is one stray click away from deleting a file.
      const [confirmDelete, setConfirmDelete] = React.useState(false)
      React.useEffect(() => {
        if (!confirmDelete) return undefined
        const timer = setTimeout(() => setConfirmDelete(false), 4000)
        return () => clearTimeout(timer)
      }, [confirmDelete])

      const refresh = React.useCallback(async () => {
        setBoot((current) => ({ ...current, status: current.data ? current.status : 'loading' }))
        try {
          // Both in parallel: the table and the case list are the same page load,
          // and a second round trip would only make the slower one visible.
          const [data, projectData] = await Promise.all([apiGet('/bootstrap'), apiGet('/projects')])
          setBoot({ status: 'ready', data, projects: projectData, error: null })
        } catch (error) {
          setBoot({ status: 'error', data: null, projects: null, error: error.message })
        }
      }, [])

      React.useEffect(() => {
        refresh()
      }, [refresh])

      // Poll a live run. The Host runs it as a job precisely so this can be a poll.
      const runId = run && run.id
      const runStatus = run && run.status
      React.useEffect(() => {
        if (!runId || runStatus !== 'running') return undefined
        let cancelled = false
        const tick = async () => {
          try {
            const next = await apiGet(`/run?id=${q(runId)}`)
            if (cancelled) return
            setRun(next)
            if (next.status === 'finished') refresh()
          } catch (error) {
            if (!cancelled) setRun((current) => (current ? { ...current, error: error.message } : current))
          }
        }
        const timer = setInterval(tick, 900)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [runId, runStatus, refresh])

      const openCase = async (file) => {
        setProblems(null)
        setRun(null)
        setReportText(null)
        setHistoryRun(null)
        try {
          const data = await apiGet(`/case?file=${q(file)}`)
          // `history` arrives with the case: the Host already knows which reports
          // belong to it, and asking a second time is a second chance to disagree.
          setSelected({ ...data, original: data.yaml })
          // The form starts from what the file says now, and remembers that, so
          // "Save changes" stays disabled until someone actually types.
          const fields = (data.definition && data.definition.fields) || null
          setDraftFields(fields ? { ...fields } : null)
          setBaseFields(fields ? { ...fields } : null)
          // Open the newest report straight away. The detail page's tabs are the
          // questions a run raises — what did it check, what did the console say,
          // what changed in the database — and every one of them is answered by
          // the run that just happened, not by one the reader has to go find.
          const newest = data.history && data.history[0]
          if (newest) await openHistoryRun(newest.path)
        } catch (error) {
          setNotice({ isError: true, message: error.message })
        }
      }

      /**
       * Opens one past run.
       *
       * The report on disk carries the same evidence object a live run does, so
       * this is the same view with a different source — not a reduced "summary"
       * of a test that already passed. A green test you cannot inspect is a green
       * test you have to take on faith.
       */
      const openHistoryRun = async (path) => {
        setHistoryLoading(true)
        try {
          const data = await apiGet(`/report?path=${q(path)}&format=json`)
          setHistoryRun({ path: data.path, report: data.report })
        } catch (error) {
          setNotice({ isError: true, message: error.message })
        } finally {
          setHistoryLoading(false)
        }
      }

      const dirty = selected ? selected.yaml !== selected.original : false

      // "Changed" for the form means "differs from what was on disk when it was
      // opened". Comparing against the live draft instead would light up Save the
      // moment someone types and then types the same thing back.
      const fieldsDirty =
        Boolean(draftFields) &&
        Boolean(baseFields) &&
        Object.keys(draftFields).some((path) => String(draftFields[path] ?? '') !== String(baseFields[path] ?? ''))

      /**
       * Saves the editor's contents.
       *
       * A draft (generated by the model, or scaffolded from an endpoint) has no path
       * yet, so the first save gives it one: the case directory plus the id the
       * document declares. That is why Run can follow straight after Save on a
       * freshly generated case — the two paths converge here rather than in the
       * caller.
       */
      const save = async () => {
        if (!selected) return null
        setBusy('save')
        try {
          let file = selected.path
          if (!file) {
            if (!generatedInto) {
              setNotice({ isError: true, message: t('empty.noCaseDir') })
              return null
            }
            const id =
              (selected.definition && selected.definition.id) ||
              String(selected.file || 'generated-case').replace(/\.ya?ml$/i, '')
            file = `${generatedInto.replace(/[\\/]+$/, '')}/${id}.yaml`
          }
          const result = await apiPost('/case', { file, yaml: selected.yaml })
          // The Host may have inserted a `caseId:` line, so the editor has to adopt
          // what is actually on disk — otherwise the next save would drop it, and
          // the id would change on every save.
          const savedYaml = typeof result.yaml === 'string' ? result.yaml : selected.yaml
          setSelected({ ...selected, path: result.path, file: result.file, yaml: savedYaml, original: savedYaml })
          setGeneratedInto(null)
          // Re-read the form's values from what was written: the save may have
          // inserted a caseId, and the form must show the number that is actually
          // in the file rather than the empty box that was there before.
          try {
            const reread = await apiGet(`/case?file=${q(result.path)}`)
            const fields = (reread.definition && reread.definition.fields) || null
            setDraftFields(fields ? { ...fields } : null)
            setBaseFields(fields ? { ...fields } : null)
          } catch {
            // The save succeeded; a stale form is a cosmetic problem, not a reason
            // to report a failure that did not happen.
          }
          setNotice({
            message: result.assigned
              ? t('notice.savedAssigned', { file: result.file, caseId: result.assigned })
              : t('notice.saved', { file: result.file }),
          })
          refresh()
          return result.path
        } catch (error) {
          const details = error.payload && error.payload.details
          setProblems({ ok: false, problems: [error.message], resolveError: null, notes: details ? [details] : [] })
          setNotice({ isError: true, message: `${t('error.saveRefused')}: ${error.message}` })
          return null
        } finally {
          setBusy(null)
        }
      }

      const validate = async () => {
        if (!selected) return
        setBusy('validate')
        try {
          const result = await apiPost('/validate', { file: selected.path, yaml: selected.yaml })
          setProblems(result)
          setNotice(result.ok ? { message: t('notice.validated') } : null)
        } catch (error) {
          setProblems({ ok: false, problems: [error.message], resolveError: null, notes: [] })
        } finally {
          setBusy(null)
        }
      }

      const startRun = async () => {
        if (!selected) return
        setBusy('run')
        setProblems(null)
        try {
          // A draft must reach the disk first: the run reads the case from a path, and
          // silently running the *previous* contents of that path would report on a
          // case the author is not looking at.
          const file = dirty || !selected.path ? await save() : selected.path
          if (!file) return
          const result = await apiPost('/run', {
            file,
            allowWrites,
            keepServiceRunning: keepRunning,
          })
          setRun(result)
          setNotice({ message: t('notice.runStarted') })
        } catch (error) {
          const payload = error.payload || {}
          setProblems({
            ok: false,
            problems: payload.details || [error.message],
            resolveError: null,
            notes: payload.environment ? [`target ${payload.environment.target} · registry ${payload.environment.registry}`] : [],
          })
          setNotice({ isError: true, message: error.message })
        } finally {
          setBusy(null)
        }
      }

      const remove = async () => {
        if (!selected) return
        setBusy('delete')
        try {
          await apiDelete(`/case?file=${q(selected.path)}`)
          setNotice({ message: t('notice.deleted', { file: selected.file }) })
          setSelected(null)
          refresh()
        } catch (error) {
          setNotice({ isError: true, message: error.message })
        } finally {
          setBusy(null)
        }
      }

      const explain = async () => {
        if (!run) return
        setExplaining(true)
        try {
          const result = await apiPost('/explain', { id: run.id })
          setRun((current) => (current ? { ...current, explanation: result.explanation } : current))
        } catch (error) {
          setNotice({ isError: true, message: error.message })
        } finally {
          setExplaining(false)
        }
      }

      const generate = async (description) => {
        setBusy('generate')
        try {
          const result = await apiPost('/generate', { description })
          const data = boot.data || {}
          setSelected({
            path: null,
            file: 'generated.yaml',
            yaml: result.yaml,
            original: '',
            definition: result.parsed,
            error: null,
          })
          setProblems(null)
          setNotice({ message: t('notice.generated', { model: result.model || 'the model' }) })
          // The generated document is a draft: it has no path until the user saves
          // it, so remember the folder it should land in.
          setCreating(null)
          setAdding(false)
          setGeneratedInto(data.caseDirs && data.caseDirs[0] ? data.caseDirs[0] : null)
          // A draft has no normalised definition yet, so the form has nothing to
          // show. Open it in YAML, which is what a draft actually is.
          setDraftFields(null)
          setBaseFields(null)
          setPlanMode('yaml')
          setView('plan')
        } catch (error) {
          setNotice({ isError: true, message: error.message })
        } finally {
          setBusy(null)
        }
      }

      /**
       * Turns one scanned endpoint into a skeleton in the editor.
       *
       * Like `generate`, the document has no path yet — it is a draft until Save.
       * Unlike `generate`, nothing about it is guessed by a model: the path, method
       * and body all come from the source that serves them.
       */
      const scaffold = async (endpoint) => {
        setBusy('scaffold')
        setProblems(null)
        try {
          const data = boot.data || {}
          const databases = (registry.databases || []).map((db) => db.name)
          const result = await apiPost('/scaffold', {
            path: endpoint.path,
            method: endpoint.httpMethod,
            // Name the one database that exists, when there is exactly one: a
            // skeleton with no database cannot assert anything, and picking for the
            // author when there is no choice is not a guess.
            database: databases.length === 1 ? databases[0] : undefined,
          })
          setSelected({
            path: null,
            file: `${result.id}.yaml`,
            yaml: result.yaml,
            original: '',
            definition: null,
            error: null,
          })
          setGeneratedInto(data.caseDirs && data.caseDirs[0] ? data.caseDirs[0] : null)
          setNotice({ message: t('notice.scaffolded', { path: `${endpoint.httpMethod} ${endpoint.path}` }) })
          // A skeleton is a draft: nothing to put in a form until it is saved and
          // parsed, so show it as what it is.
          setDraftFields(null)
          setBaseFields(null)
          setPlanMode('yaml')
          setAdding(false)
          setView('plan')
        } catch (error) {
          setNotice({ isError: true, message: error.message })
        } finally {
          setBusy(null)
        }
      }

      const openReport = async (path) => {
        // The report directory holds both `<run>.md` and `<run>.json` for the same
        // run. The viewer shows markdown; the Host lists the markdown sibling of
        // every report, so ask for that one instead of the `.json` this row may
        // have been handed.
        const markdown = String(path || '').replace(/\.json$/i, '.md')
        try {
          const data = await apiGet(`/report?path=${q(markdown)}&format=markdown`)
          setReportText({ path: data.path, text: data.markdown })
        } catch (error) {
          setNotice({ isError: true, message: error.message })
        }
      }

      const createCase = async () => {
        const name = String(creating || '').trim()
        if (!name) return
        const data = boot.data || {}
        const dir = (data.caseDirs && data.caseDirs[0]) || null
        if (!dir) {
          setNotice({ isError: true, message: t('empty.noCaseDir') })
          return
        }
        const file = `${dir.replace(/[\\/]+$/, '')}/${name.replace(/\.ya?ml$/i, '')}.yaml`
        setBusy('create')
        try {
          await apiPost('/case', { file, yaml: newCaseTemplate(pendingGroup) })
          setCreating(null)
          setAdding(false)
          await refresh()
          await openCase(file)
          // A new case is a document that has to be filled in, and the form is the
          // fastest way to do that — the YAML view is there for the parts the form
          // deliberately cannot reach.
          setPlanMode('form')
          setView('plan')
        } catch (error) {
          setNotice({ isError: true, message: error.message })
        } finally {
          setBusy(null)
        }
      }

      /** The draft's save: a generated or scaffolded case has no path, so `save` derives one. */
      const saveDraft = async () => {
        await save()
      }

      /** One field changed in the form view. The Host patches the file; this only records intent. */
      const setField = (path, value) => {
        setDraftFields((current) => (current ? { ...current, [path]: value } : current))
      }

      /**
       * Saves the form draft.
       *
       * Only the fields that actually differ are sent: sending all ten would
       * rewrite lines the person never touched, and a save that rewrites
       * untouched lines is a save that can change them.
       */
      const saveFields = async () => {
        if (!selected || !selected.path || !draftFields) return
        const changed = {}
        for (const [path, value] of Object.entries(draftFields)) {
          if (!baseFields || String(baseFields[path] ?? '') !== String(value ?? '')) changed[path] = value
        }
        if (Object.keys(changed).length === 0) return
        setBusy('fields')
        try {
          const result = await apiPost('/case-fields', { file: selected.path, fields: changed })
          setSelected((current) => (current ? { ...current, yaml: result.yaml, original: result.yaml } : current))
          const reread = await apiGet(`/case?file=${q(selected.path)}`)
          const fields = (reread.definition && reread.definition.fields) || null
          setDraftFields(fields ? { ...fields } : null)
          setBaseFields(fields ? { ...fields } : null)
          setNotice({ message: t('notice.fieldsSaved', { file: result.file }) })
          refresh()
        } catch (error) {
          const details = error.payload && error.payload.details
          setNotice({ isError: true, message: `${t('error.saveRefused')}: ${error.message}` })
          if (details) setProblems({ ok: false, problems: [error.message], resolveError: null, notes: [details] })
        } finally {
          setBusy(null)
        }
      }

      /**
       * Runs every case in the project, one after another.
       *
       * The files are the ones the current tab and search are showing, which is
       * what "Run all" means while a filter is on: the button says how many it
       * will run, so it should run that many.
       */
      const runAll = async (files) => {
        if (!files || files.length === 0) return
        setBusy('run-all')
        try {
          const result = await apiPost('/run-all', { files, allowWrites, keepServiceRunning: keepRunning })
          setBatch(result)
          setNotice({ message: t('notice.batchStarted', { count: files.length }) })
        } catch (error) {
          setNotice({ isError: true, message: error.message })
        } finally {
          setBusy(null)
        }
      }

      // Poll a live batch the same way a single run is polled: the Host owns the
      // loop, so closing the page does not stop the run.
      const batchId = batch && batch.id
      const batchStatus = batch && batch.status
      React.useEffect(() => {
        if (!batchId || batchStatus !== 'running') return undefined
        let cancelled = false
        const timer = setInterval(async () => {
          try {
            const next = await apiGet(`/run-all?id=${q(batchId)}`)
            if (cancelled) return
            setBatch(next)
            if (next.status === 'finished') refresh()
          } catch {
            // A poll that fails is not a batch that failed; the next tick retries.
          }
        }, 1200)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [batchId, batchStatus, refresh])

      const data = boot.data
      const caseDirs = (data && data.caseDirs) || []
      const listing = (data && data.cases) || []
      const registry = (data && data.registry) || { targets: [], databases: [], error: null }
      const reports = (data && data.reports && data.reports.reports) || []
      const projectData = boot.projects || { projects: [], creator: null, warnings: [] }
      const projects = projectData.projects || []
      // Re-read the open project from the fresh list on every render. Holding the
      // object captured at click time means a case created or deleted a moment ago
      // stays invisible until the user navigates away and back.
      const project = openProject ? projects.find((item) => item.key === openProject.key) || openProject : null

      const header = h(
        'header',
        { className: 'e2e-header' },
        h(
          'div',
          { className: 'e2e-header-text' },
          project
            ? h(
                'div',
                { className: 'e2e-crumbs' },
                h(
                  'button',
                  { type: 'button', className: 'e2e-crumb', onClick: () => setOpenProject(null) },
                  t('action.backToProjects'),
                ),
                h('span', { className: 'e2e-crumb-sep' }, '/'),
                // The project stays a link whenever a case or the plan editor is
                // open, so "go back to the list" is one click rather than a hunt
                // for a button.
                view !== 'cases'
                  ? h(
                      'button',
                      { type: 'button', className: 'e2e-crumb', onClick: () => setView('cases') },
                      project.name,
                    )
                  : h('span', { className: 'e2e-crumb-current' }, project.name),
                view === 'plan'
                  ? h(
                      'span',
                      null,
                      h('span', { className: 'e2e-crumb-sep' }, '/'),
                      h('span', { className: 'e2e-crumb-current' }, t('action.editTestPlan')),
                    )
                  : null,
                view === 'detail'
                  ? h(
                      'span',
                      null,
                      h('span', { className: 'e2e-crumb-sep' }, '/'),
                      h(
                        'span',
                        { className: 'e2e-crumb-current' },
                        (selected && selected.definition && selected.definition.caseId) || (selected && selected.file) || '',
                      ),
                    )
                  : null,
              )
            : h('h2', { className: 'e2e-title' }, t('label.projects')),
          h('p', { className: 'e2e-subtitle' }, project ? project.projectPath || project.baseUrl || '' : t('panel.subtitle')),
        ),
        h('div', { className: 'e2e-spacer' }),
        h(Btn, { small: true, onClick: refresh }, t('action.refresh')),
        project
          ? h(
              Btn,
              {
                small: true,
                onClick: () => {
                  // One entry point for "make a case", whichever button was pressed:
                  // the toolbar adds to no particular group, a group's own button
                  // adds to that group.
                  setPendingGroup('')
                  setCreating('')
                  setAdding((current) => !current)
                },
              },
              t('action.new'),
            )
          : null,
      )

      if (boot.status === 'loading') {
        return h('div', { className: 'e2e-root' }, h('style', null, STYLE), header, h('div', { className: 'e2e-muted' }, t('state.loading')))
      }
      if (boot.status === 'error') {
        return h(
          'div',
          { className: 'e2e-root' },
          h('style', null, STYLE),
          header,
          h(
            'div',
            { className: 'e2e-error-box' },
            h('strong', null, t('error.title')),
            h('div', null, boot.error),
            h(Btn, { small: true, onClick: refresh }, t('action.retry')),
          ),
        )
      }

      // Inside a project, the case list shows only that project's cases. The Host
      // already put the cases on the project, so the page filters nothing: a
      // second membership rule here is how the list and the table would start to
      // disagree about what belongs to a project.
      const projectCases = project ? project.cases || [] : []
      const failures = project ? project.warnings || [] : []

      const registryPanel = h(
        Section,
        {
          title: t('label.databases'),
          extra: registry.file
            ? h('code', { className: 'e2e-muted', title: registry.file }, `${t('label.registry')}: ${registry.file}`)
            : null,
        },
        registry.error ? h('div', { className: 'e2e-error' }, `${t('error.registry')}: ${registry.error}`) : null,
        registry.targets && registry.targets.length > 0
          ? h(
              'div',
              { className: 'e2e-hint' },
              `${t('label.targets')}: `,
              registry.targets.map((name) => h('code', { key: name, className: 'e2e-code' }, name)),
            )
          : null,
        h(
          'div',
          { className: 'e2e-db-list' },
          (registry.databases || []).map((db) =>
            h(
              'div',
              { key: db.name, className: 'e2e-db' },
              h('code', { className: 'e2e-code' }, db.name),
              h('span', { className: 'e2e-muted' }, db.kind ? `${db.kind} ${db.host}:${db.port}/${db.database}` : db.error || ''),
              db.schema ? h('span', { className: 'e2e-muted' }, `${t('label.schema')} ${db.schema}`) : null,
              h('span', { className: 'e2e-muted' }, db.source ? `${t('label.source')} ${db.source}` : ''),
              h('span', { className: 'e2e-muted' }, db.passwordConfigured ? '•••• set' : 'no password'),
            ),
          ),
        ),
      )

      const runControls = h(
        Section,
        { title: t('label.run') },
        h(
          'label',
          { className: 'e2e-check-row' },
          h('input', {
            type: 'checkbox',
            checked: allowWrites,
            onChange: (event) => setAllowWrites(event.target.checked),
          }),
          h('span', null, t('label.allowWrites')),
        ),
        h('div', { className: 'e2e-hint' }, t('label.allowWritesHint')),
        h(
          'label',
          { className: 'e2e-check-row' },
          h('input', {
            type: 'checkbox',
            checked: keepRunning,
            onChange: (event) => setKeepRunning(event.target.checked),
          }),
          h('span', null, t('label.keepRunning')),
        ),
        problems
          ? h(
              'div',
              { className: `e2e-problems${problems.ok ? ' is-ok' : ''}` },
              problems.resolveError ? h('div', { className: 'e2e-error' }, problems.resolveError) : null,
              (problems.problems || []).map((problem, index) => h('div', { key: index, className: 'e2e-problem' }, String(problem))),
              (problems.notes || []).map((note, index) => h('div', { key: `n${index}`, className: 'e2e-muted' }, String(note))),
            )
          : null,
        h(RunSurface, { t, run, onExplain: explain, explaining, onOpenReport: openReport }),
      )

      const reportsPanel = h(
        Section,
        { title: t('label.reports') },
        reports.length === 0
          ? h('div', { className: 'e2e-empty' }, t('empty.noReports'))
          : h(
              'div',
              { className: 'e2e-reports' },
              reports.slice(0, 25).map((item) =>
                h(
                  'button',
                  {
                    key: item.path,
                    type: 'button',
                    className: 'e2e-report',
                    onClick: () => openReport(item.markdownPath || item.path),
                  },
                  h(Chip, { tone: verdictTone(item.summary && item.summary.verdict) }, (item.summary && item.summary.verdict) || '?'),
                  h('span', { className: 'e2e-report-id' }, (item.summary && item.summary.caseId) || item.name),
                  h(
                    'span',
                    { className: 'e2e-muted' },
                    item.summary && item.summary.durationMs ? `${item.summary.durationMs} ms` : '',
                    item.summary && item.summary.failed ? ` · ${item.summary.failed} failed` : '',
                  ),
                ),
              ),
            ),
        reportText
          ? h(
              'div',
              { className: 'e2e-report-view' },
              h(
                'div',
                { className: 'e2e-editor-bar' },
                h('code', { className: 'e2e-file' }, reportText.path),
                h('div', { className: 'e2e-spacer' }),
                h(Btn, { small: true, onClick: () => setReportText(null) }, t('action.close')),
              ),
              h('pre', { className: 'e2e-pre is-tall' }, reportText.text),
            )
          : null,
      )

      // The two pages inside a project. The case list answers "what is red"; the
      // plan editor answers "what should this test say". They are separate pages
      // because a page that answers both answers neither well — and because the
      // list has to stay scannable while the editor has to stay wide.
      const casesPage = h(
        'div',
        { className: 'e2e-main' },
        h(CaseTable, {
          t,
          project,
          filter,
          onFilter: setFilter,
          query,
          onQuery: setQuery,
          onOpen: (file) => {
            // Clicking a case reads it. Editing is a decision, not a side effect
            // of looking — see `CaseDetail`.
            openCase(file)
            setView('detail')
          },
          onEditPlan: () => setView('plan'),
          onAddTests: () => setAdding((current) => !current),
          onRunAll: () => runAll(projectCases.map((entry) => entry.file)),
          running: busy === 'run-all' || Boolean(batch && batch.status === 'running'),
        }),
        // "Add more tests" opens the two ways a case arrives without being typed:
        // described to the model, or read out of the source. Both are drafts that
        // land in the editor, so neither is a separate page.
        adding
          ? h(
              'div',
              { className: 'e2e-add' },
              h(
                'div',
                { className: 'e2e-create' },
                h('input', {
                  className: 'e2e-input',
                  autoFocus: true,
                  placeholder: 'my-case',
                  value: creating || '',
                  onChange: (event) => setCreating(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') createCase()
                    if (event.key === 'Escape') setAdding(false)
                  },
                }),
                h(
                  'div',
                  { className: 'e2e-row' },
                  h(Btn, { small: true, variant: 'primary', onClick: createCase, disabled: busy === 'create' }, t('action.create')),
                  h(Btn, { small: true, onClick: () => setAdding(false) }, t('action.cancel')),
                ),
              ),
              h(GenerateBox, {
                t,
                onGenerate: generate,
                generating: busy === 'generate',
                error: null,
                databases: (registry.databases || []).map((db) => db.name),
                targets: registry.targets || [],
              }),
              h(ScanBox, {
                t,
                onScaffold: scaffold,
                scaffolding: busy === 'scaffold',
                onScanned: (counts) => setNotice({ message: t('notice.scanned', counts) }),
                error: null,
              }),
            )
          : null,
        failures.map((warning, index) => h('div', { key: `w${index}`, className: 'e2e-warning' }, String(warning))),
        batch
          ? h(
              'div',
              { className: 'e2e-batch' },
              h(Chip, { tone: batch.status === 'running' ? 'brand' : 'idle' }, batch.status),
              h('span', null, `${batch.finished}/${batch.total}`),
              h('span', { className: 'e2e-muted' }, `✓ ${batch.passed} · ✕ ${batch.failed} · — ${batch.refused}`),
            )
          : null,
        runControls,
        registryPanel,
        reportsPanel,
      )

      // Reading a case and editing one are two pages, because they are two
      // intentions. Clicking a row means "show me this test"; pressing Edit means
      // "I am about to change it", and that is when a Save button should appear.
      const detailPage = h(
        'div',
        { className: 'e2e-main' },
        h(CaseDetail, {
          t,
          selected,
          history: selected ? selected.history || [] : [],
          historyRun,
          onOpenRun: openHistoryRun,
          historyLoading,
          onEdit: () => {
            setPlanMode('form')
            setView('plan')
          },
          onRun: startRun,
          running: busy === 'run',
          onDone: () => setView('cases'),
        }),
        run ? h(RunSurface, { t, run, onExplain: explain, explaining: busy === 'explain', onOpenReport: openReport }) : null,
        reportsPanel,
      )

      const planPage = h(
        'div',
        { className: 'e2e-main' },
        h(PlanEditor, {
          t,
          project,
          mode: planMode,
          onMode: setPlanMode,
          selected,
          fields: draftFields || {},
          onField: setField,
          yaml: selected ? selected.yaml : '',
          onYaml: (next) => (selected ? setSelected({ ...selected, yaml: next }) : null),
          // Save means two different things in the two modes, and the button that
          // says "Save changes" has to do the one the reader is looking at.
          onSave: planMode === 'form' ? saveFields : save,
          onDone: () => setView('cases'),
          onOpen: (file) => {
            openCase(file)
            setView('detail')
          },
          // "Add test" from a group: open the create form with that group already
          // filled in. The group is the only thing the reader just said, and
          // asking for it again is how two spellings of one group appear.
          onAddTest: (bucket) => {
            setAdding(true)
            setPendingGroup(bucket.group || '')
          },
          busy: busy !== null,
          dirty: planMode === 'form' ? fieldsDirty : dirty,
          actions: selected
            ? h(
                'div',
                { className: 'e2e-row' },
                h(
                  Btn,
                  { small: true, onClick: validate, disabled: busy !== null },
                  busy === 'validate' ? t('action.validating') : t('action.validate'),
                ),
                h(
                  Btn,
                  { small: true, variant: 'primary', onClick: startRun, disabled: busy !== null },
                  busy === 'run' ? t('action.running') : t('action.run'),
                ),
                // Delete asks twice. A test case is a file someone wrote, and the
                // panel has no undo: one click that removes it is a trap.
                h(
                  Btn,
                  {
                    small: true,
                    variant: confirmDelete ? 'danger' : 'default',
                    onClick: () => {
                      if (confirmDelete) {
                        setConfirmDelete(false)
                        remove()
                      } else {
                        setConfirmDelete(true)
                      }
                    },
                    disabled: busy !== null,
                  },
                  confirmDelete ? t('action.deleteConfirm') : t('action.delete'),
                ),
              )
            : null,
        }),
        // A draft has no file yet. Saying so, with the one button that gives it
        // one, is the difference between "the editor is empty" and "this is not
        // saved anywhere yet".
        generatedInto && selected && !selected.path
          ? h(
              'div',
              { className: 'e2e-banner' },
              h('span', null, t('notice.generated', { model: 'AI' })),
              h(Btn, { small: true, variant: 'primary', onClick: saveDraft, disabled: busy !== null }, t('action.save')),
            )
          : null,
        runControls,
      )

      // The landing view is the project table. It deliberately does not render the
      // editor or the case list: a page that answers "what is red" should not also
      // be a page that answers "what is the indentation of line 14".
      if (!project) {
        return h(
          'div',
          { className: 'e2e-root' },
          h('style', null, STYLE),
          header,
          notice
            ? h(
                'div',
                { className: `e2e-notice${notice.isError ? ' is-error' : ''}` },
                h('span', null, notice.message),
                h('button', { type: 'button', className: 'e2e-btn is-small', onClick: () => setNotice(null) }, '×'),
              )
            : null,
          (projectData.warnings || []).map((warning, index) =>
            h('div', { key: `w${index}`, className: 'e2e-warning' }, String(warning)),
          ),
          h(
            'div',
            { className: 'e2e-projects' },
            h(ProjectTable, {
              t,
              projects,
              creator: projectData.creator,
              onOpen: (next) => {
                setOpenProject(next)
                setSelected(null)
                setRun(null)
                setReportText(null)
                setProblems(null)
                setView('cases')
                setFilter('all')
                setQuery('')
                setDraftFields(null)
                setBaseFields(null)
                setBatch(null)
              },
            }),
          ),
        )
      }

      return h(
        'div',
        { className: 'e2e-root' },
        h('style', null, STYLE),
        header,
        notice
          ? h(
              'div',
              { className: `e2e-notice${notice.isError ? ' is-error' : ''}` },
              h('span', null, notice.message),
              h('button', { type: 'button', className: 'e2e-btn is-small', onClick: () => setNotice(null) }, '×'),
            )
          : null,
        view === 'plan' ? planPage : view === 'detail' ? detailPage : casesPage,
      )
    }

    /* ---------- the new-case template ---------- */

    /**
     * The document a brand new case starts as.
     *
     * `group` is filled in when the reader added the case from inside a group —
     * they already said what these tests are about by clicking there, and asking
     * again is how one group ends up spelled two ways.
     */
    const newCaseTemplate = (group) => [
      '# A case proves one behaviour on a real service.',
      '# It never contains a host, a port, a user or a password for a database:',
      '# it names one, and the registry (e2e.registry.yml) owns the connection.',
      'id: my-case',
      '# caseId is the name you quote in a bug report. The panel assigns the next free',
      '# number for this endpoint when you save, so leave it out if you are writing here.',
      'title: What this case proves',
      'description: >',
      '  One paragraph: which behaviour, and what would break if it regressed.',
      '',
      '# group is the use case these tests belong to ("Registration", "Checkout").',
      '# One group can span several endpoints; the case list groups by it.',
      `group: ${group || 'my-group'}`,
      '# endpoint groups this case with the others on the same route.',
      'endpoint: POST /auth/confirmCode',
      '# normal = nothing goes wrong; error = validation, auth, conflict, boundary.',
      'scenario: normal',
      '# high / medium / low. Triage, not decoration.',
      'priority: medium',
      '',
      'env:',
      '  target: record-local',
      '  databases:',
      '    default:',
      '      name: iam',
      '      schema: public',
      '',
      'request:',
      '  method: POST',
      '  path: /auth/confirmCode',
      '  json:',
      "    username: someone",
      '    code: "123456"',
      '',
      'expect:',
      '  response:',
      '    status: 200',
      '',
      'teardown: {}',
      '',
    ].join('\n')

    /* ---------- styles ---------- */

    const STYLE = `
.e2e-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 16px 18px 18px;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  font-size: 13px;
}
.e2e-header { display: flex; align-items: flex-start; gap: 10px; }
.e2e-header-text { min-width: 0; }
.e2e-crumbs { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.e2e-crumb {
  appearance: none;
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--dsw-alias-brand-primary);
  cursor: pointer;
}
.e2e-crumb:hover { text-decoration: underline; }
.e2e-crumb-sep { color: var(--dsw-alias-label-secondary); }
.e2e-crumb-current { font-weight: 600; color: var(--dsw-alias-label-primary); }
.e2e-title { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: 0.01em; }
.e2e-subtitle { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); max-width: 62ch; }
.e2e-spacer { flex: 1 1 auto; }
.e2e-body { display: flex; gap: 14px; flex: 1 1 auto; min-height: 0; }
.e2e-projects { flex: 1 1 auto; min-height: 0; overflow: auto; }
.e2e-warning {
  font-size: 12px;
  color: var(--dsw-alias-state-warn-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 35%, transparent);
  border-radius: 7px;
  padding: 6px 10px;
}

/* The project table: a grid, so every column lines up across rows without a
   <table> fighting the panel's flex layout. */
.e2e-table { display: flex; flex-direction: column; }
.e2e-table-head,
.e2e-table-row {
  display: grid;
  grid-template-columns: minmax(180px, 2.2fr) minmax(150px, 1.5fr) 110px 170px 110px 70px;
  align-items: center;
  gap: 12px;
  padding: 11px 10px;
  text-align: left;
}
.e2e-table-head {
  font-size: 11.5px;
  letter-spacing: 0.02em;
  color: var(--dsw-alias-label-secondary);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  padding-bottom: 8px;
}
.e2e-table-row {
  appearance: none;
  border: 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  border-radius: 8px;
  transition: background 110ms ease;
}
.e2e-table-row:hover { background: var(--dsw-alias-bg-layer-1); }
.e2e-col-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.e2e-project-icon { color: var(--dsw-alias-label-secondary); font-size: 14px; }
.e2e-project-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e2e-project-targets { font-size: 11px; }
.e2e-result-counts { display: flex; gap: 6px; flex-wrap: wrap; }
.e2e-col-activity, .e2e-col-created { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.e2e-type-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  padding: 2px 9px;
}
.e2e-type-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-label-secondary);
  opacity: 0.65;
}
.e2e-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
}

/* The case list: search + tabs + grouped rows. */
.e2e-cases { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; }
.e2e-cases-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.e2e-search { flex: 0 1 260px; }
.e2e-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  padding-bottom: 2px;
}
.e2e-tab {
  appearance: none;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12.5px;
  padding: 6px 10px 7px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.e2e-tab:hover { color: var(--dsw-alias-label-primary); }
.e2e-tab.is-active {
  color: var(--dsw-alias-brand-primary);
  border-bottom-color: var(--dsw-alias-brand-primary);
}
.e2e-tab-count {
  font-size: 11px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
}
.e2e-tab.is-active .e2e-tab-count {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
  color: var(--dsw-alias-brand-primary);
}
.e2e-cases-head,
.e2e-case-row {
  display: grid;
  grid-template-columns: 110px 130px minmax(180px, 1fr) 130px;
  align-items: center;
  gap: 12px;
  padding: 9px 10px;
  text-align: left;
}
.e2e-cases-head {
  font-size: 11.5px;
  letter-spacing: 0.02em;
  color: var(--dsw-alias-label-secondary);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  padding-bottom: 7px;
}
.e2e-case-row {
  appearance: none;
  border: 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  border-radius: 7px;
  transition: background 110ms ease;
}
.e2e-case-row:hover { background: var(--dsw-alias-bg-layer-1); }
.e2e-col-id { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.e2e-col-status, .e2e-col-priority { display: flex; align-items: center; gap: 6px; }
.e2e-test-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.e2e-test-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e2e-plan-group { display: flex; flex-direction: column; }
.e2e-plan-group.is-folded .e2e-plan-group-head { border-bottom-color: transparent; }
.e2e-plan-group-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  /* The case table's group head is a button (it folds); the plan editor's is a
     div. Resetting the button chrome here keeps both looking the same. */
  background: none;
  border: 0;
  border-radius: 8px;
  text-align: left;
  width: 100%;
  font-family: inherit;
  cursor: pointer;
}
button.e2e-plan-group-head:hover { background: var(--dsw-alias-bg-layer-2); }
.e2e-chevron {
  width: 12px;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 1;
}
.e2e-plan-group-name { font-weight: 600; color: var(--dsw-alias-label-primary); }
.e2e-bar {
  display: flex;
  height: 4px;
  width: 90px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-2);
}
.e2e-bar-seg { display: block; height: 100%; }

/* The plan editor: grouped cards on the left, one document on the right. */
.e2e-plan { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; }
.e2e-mode {
  display: inline-flex;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  overflow: hidden;
}
.e2e-mode-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  padding: 5px 12px;
  cursor: pointer;
}
.e2e-mode-btn.is-active {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
  color: var(--dsw-alias-brand-primary);
}
.e2e-plan-body { display: flex; gap: 14px; flex: 1 1 auto; min-height: 0; }
.e2e-plan-list { flex: 0 0 300px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.e2e-plan-card {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  padding: 8px 8px 6px;
  background: var(--dsw-alias-bg-layer-1);
}
.e2e-plan-row {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  width: 100%;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  padding: 6px 7px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.e2e-plan-row:hover { background: var(--dsw-alias-bg-layer-2); }
.e2e-plan-row.is-active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.e2e-plan-row-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e2e-plan-editor { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.e2e-detail { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 12px; overflow: auto; }
.e2e-detail-head { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.e2e-detail-kicker { font-size: 11.5px; color: var(--dsw-alias-label-secondary); letter-spacing: 0.02em; }
.e2e-detail-title { margin: 2px 0 0; font-size: 17px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.e2e-detail-body { display: flex; align-items: stretch; gap: 14px; min-height: 0; flex: 1 1 auto; }
.e2e-detail-side {
  flex: 0 0 230px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  padding: 12px;
  align-self: flex-start;
}
.e2e-detail-side-head { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.e2e-detail-prop { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; min-width: 0; }
.e2e-detail-goal {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--dsw-alias-bg-l2);
}
.e2e-detail-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.e2e-detail-pane { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.e2e-db-diff {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  padding: 10px;
}
.e2e-db-diff .e2e-db-head { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-primary); }
/* Side by side while there is room, stacked when there is not: two tables of
   rows are compared by eye, and eye comparison needs the pair in one view. */
.e2e-db-pair { display: flex; gap: 8px; flex-wrap: wrap; }
.e2e-db-pair > div { flex: 1 1 260px; min-width: 0; }
.e2e-db-pair .e2e-pre { margin-top: 2px; max-height: 240px; overflow: auto; }
/* Screenshots are the one thing here whose aspect ratio is not ours to choose,
   so the grid gives each one a column and the image fits inside it. */
.e2e-shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.e2e-shot { margin: 0; display: flex; flex-direction: column; gap: 4px; }
.e2e-shot-link { display: block; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; }
.e2e-shot-img { display: block; width: 100%; height: auto; }
.e2e-shot-name { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.e2e-output {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  padding: 12px;
}
.e2e-pre.is-plan { flex: 1 1 auto; min-height: 200px; overflow: auto; }
.e2e-history { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow: auto; }
.e2e-history-list { display: flex; flex-direction: column; gap: 4px; }
.e2e-history-row {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 7px 10px;
  font: inherit;
  font-size: 12.5px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.e2e-history-row:hover { background: var(--dsw-alias-bg-l2); }
.e2e-history-row.is-active { background: var(--dsw-alias-bg-l2); border-color: var(--dsw-alias-border-l1); }
.e2e-history-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  padding-top: 10px;
}
.e2e-form { flex: 1 1 auto; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
.e2e-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;
}
.e2e-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.e2e-field-label { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.e2e-field-area { resize: vertical; min-height: 60px; }
.e2e-batch {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  padding: 6px 10px;
}
.e2e-add {
  appearance: none;
  border: 1px dashed var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  width: 100%;
  border-radius: 6px;
  padding: 6px;
  cursor: pointer;
  margin-top: 4px;
}
.e2e-add:hover { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }

.e2e-btn {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  border-radius: 7px;
  padding: 6px 12px;
  font-size: 12.5px;
  line-height: 1.2;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.e2e-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.e2e-btn:disabled { opacity: 0.5; cursor: default; }
.e2e-btn.is-small { padding: 4px 9px; font-size: 12px; }
.e2e-btn.is-primary {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 60%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
  color: var(--dsw-alias-brand-primary);
}
.e2e-btn.is-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent); }
.e2e-btn.is-danger {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent);
  color: var(--dsw-alias-state-error-primary);
}

.e2e-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11.5px;
  line-height: 1.6;
  white-space: nowrap;
}

.e2e-list {
  width: 268px;
  flex: 0 0 268px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  padding: 10px;
}
.e2e-list-head { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--dsw-alias-label-secondary); padding: 2px 2px 6px; }
.e2e-group { display: flex; flex-direction: column; gap: 4px; }
.e2e-group-dir { font-size: 10.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 4px 2px 2px; }
.e2e-case {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  padding: 7px 8px;
  cursor: pointer;
}
.e2e-case:hover { background: var(--dsw-alias-bg-layer-2); }
.e2e-case.is-active { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.e2e-case-title { font-size: 12.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e2e-case-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e2e-failure { font-size: 11px; color: var(--dsw-alias-state-error-primary); padding: 2px 4px; }

.e2e-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 12px; overflow: auto; padding-right: 2px; }
.e2e-editor { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.e2e-editor-bar { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }
.e2e-file { font-size: 11.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 42ch; }
.e2e-textarea {
  border: 0;
  outline: none;
  resize: vertical;
  width: 100%;
  box-sizing: border-box;
  min-height: 340px;
  padding: 12px 14px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.65;
  tab-size: 2;
}
.e2e-textarea.is-short { min-height: 78px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; }

.e2e-section { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 11px 12px; display: flex; flex-direction: column; gap: 8px; }
.e2e-section-title { margin: 0; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--dsw-alias-label-secondary); }
.e2e-section-extra { font-size: 10.5px; }

.e2e-run { display: flex; flex-direction: column; gap: 8px; }
.e2e-run-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.e2e-checks { display: flex; flex-direction: column; gap: 3px; }
.e2e-check { display: flex; gap: 8px; align-items: flex-start; padding: 3px 0; }
.e2e-check-mark { width: 14px; flex: 0 0 14px; font-weight: 700; }
.e2e-check-body { min-width: 0; }
.e2e-check-label { font-size: 12.5px; }
.e2e-check-diff { font-size: 11.5px; color: var(--dsw-alias-label-secondary); font-family: ui-monospace, monospace; }
.e2e-check-detail { font-size: 11.5px; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; }
.e2e-warnings { margin: 0; padding-left: 18px; font-size: 11.5px; color: var(--dsw-alias-state-warn-primary); }
.e2e-fatal { border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); border-radius: 8px; padding: 8px 10px; font-size: 12px; }
.e2e-explain { border-left: 2px solid var(--dsw-alias-brand-primary); padding-left: 10px; }
.e2e-explain-head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--dsw-alias-label-secondary); margin-bottom: 4px; }
.e2e-explain-body { font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; }

.e2e-problems { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.e2e-problem { color: var(--dsw-alias-state-warn-primary); }
.e2e-problems.is-ok .e2e-problem { color: var(--dsw-alias-state-success-primary); }

.e2e-db-list { display: flex; flex-direction: column; gap: 4px; }
.e2e-db { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; font-size: 11.5px; }
.e2e-code { font-family: ui-monospace, monospace; font-size: 11.5px; background: var(--dsw-alias-bg-layer-2); border-radius: 4px; padding: 1px 5px; }
.e2e-db-entry { margin-top: 6px; }
.e2e-db-head { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }

.e2e-reports { display: flex; flex-direction: column; gap: 2px; max-height: 240px; overflow: auto; }
.e2e-report { display: flex; align-items: center; gap: 8px; border: 0; background: transparent; color: inherit; text-align: left; padding: 4px 5px; border-radius: 6px; cursor: pointer; font-size: 12px; }
.e2e-report:hover { background: var(--dsw-alias-bg-layer-2); }
.e2e-report-id { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e2e-report-view { margin-top: 8px; display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; }

.e2e-pre { margin: 4px 0 0; padding: 9px 11px; border-radius: 7px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); font-family: ui-monospace, monospace; font-size: 11.5px; line-height: 1.55; overflow: auto; max-height: 260px; white-space: pre-wrap; }
.e2e-pre.is-tall { max-height: 520px; }

.e2e-details { font-size: 12px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 8px; }
.e2e-details > summary { cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.e2e-evidence { display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
.e2e-evidence-part { display: flex; flex-direction: column; gap: 2px; }
.e2e-evidence-head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--dsw-alias-label-secondary); margin-bottom: 3px; }
.e2e-steps { display: flex; flex-direction: column; gap: 1px; font-family: ui-monospace, monospace; font-size: 11px; }

.e2e-notice { display: flex; align-items: center; gap: 10px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); border-radius: 8px; padding: 7px 10px; font-size: 12px; }
.e2e-notice.is-error { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.e2e-banner { display: flex; align-items: center; gap: 10px; border: 1px dashed color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent); border-radius: 8px; padding: 7px 10px; font-size: 12px; }

.e2e-empty { font-size: 11.5px; color: var(--dsw-alias-label-secondary); line-height: 1.55; padding: 4px 2px; }
.e2e-empty-box { border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; padding: 22px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.e2e-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); white-space: pre-wrap; }
.e2e-error-box { border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; }
.e2e-muted { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.e2e-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.55; }
.e2e-label { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.e2e-input { border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; padding: 5px 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 12px; outline: none; }
.e2e-input:focus { border-color: var(--dsw-alias-brand-primary); }
.e2e-row { display: flex; gap: 6px; align-items: center; }
.e2e-check-row { display: flex; align-items: center; gap: 7px; font-size: 12px; cursor: pointer; }
.e2e-generate { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.e2e-endpoints { display: flex; flex-direction: column; gap: 3px; max-height: 280px; overflow: auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 4px; background: var(--dsw-alias-bg-base); }
.e2e-endpoint { display: flex; align-items: center; gap: 8px; text-align: left; border: 1px solid transparent; border-radius: 6px; background: transparent; color: inherit; padding: 5px 7px; cursor: pointer; font-size: 12px; }
.e2e-endpoint:hover { background: var(--dsw-alias-bg-layer-2); }
.e2e-endpoint.is-active { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.e2e-method { flex: 0 0 46px; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 10.5px; letter-spacing: 0.04em; color: var(--dsw-alias-brand-primary); }
.e2e-endpoint-path { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e2e-create { display: flex; flex-direction: column; gap: 6px; padding: 4px 2px 8px; }
`

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        localeService = ctx.locale
        ctx.effect(() => ctx.locale.register(NS, 'en', DICT.en))
        ctx.effect(() => ctx.locale.register(NS, 'zh', DICT.zh))

        const t = ctx.locale.bind(NS)

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'e2e', order: 26, label: () => t('panel.title') },
            SidebarIcon,
          ),
        )

        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'e2e' }, MainPanel))
      },
    }
  },
})
