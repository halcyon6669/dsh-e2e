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
        'action.deleteConfirm': 'Delete for real',
        'action.explain': 'Why did it fail?',
        'action.explaining': 'Asking the model…',
        'action.generate': 'Generate from a description',
        'action.generating': 'Generating…',
        'action.scan': 'Scan the project for endpoints',
        'action.scanning': 'Scanning…',
        'action.importPicked': 'Import {count}',
        'action.importing': 'Importing…',
        'action.selectAll': 'Select all',
        'action.clearSelection': 'Clear',
        'action.close': 'Close',
        'action.retry': 'Retry',
        'action.reopen': 'Open',
        'action.loading': 'Loading…',

        'label.editor': 'Case file',
        'label.run': 'Run',
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
        'label.allowWritesOn': 'Writes allowed: setup/teardown SQL may change rows this run.',
        'action.settings': 'Settings',
        'label.settings': 'Settings',
        'label.settingsHint':
          'What this machine has, pointed at by the registry. The databases come from dsh-db-mcp; the run configurations come from the IDE MCP.',
        'label.settingsDatabase': 'Database',
        'label.settingsDatabaseEntry': 'Registry entry',
        'label.settingsSource': 'dsh-db-mcp source',
        'label.settingsSourceNone': 'keep its own connection',
        'label.settingsNotPostgres': 'not PostgreSQL-wire, cannot be used',
        'label.settingsIde': 'IDE run configuration',
        'label.settingsTarget': 'Target',
        'label.settingsPort': 'Port',
        'label.settingsPortHint':
          'Where the service listens. Read from the project\'s application.yml where that file names one; a project that names none leaves this empty, and the number has to be typed here.',
        'label.settingsConfiguration': 'Configuration',
        'label.settingsConfigurationNone': 'not set',
        'empty.noDatabases': 'The registry defines no database. Add one to the registry file, then pick it here.',
        'empty.noTargets': 'The registry defines no target, so there is nothing to point at an IDE configuration.',
        'empty.noConfigurations': 'The IDE reported no run configuration for this project.',
        'notice.settingsSaved': 'Settings saved.',
        'label.keepRunning': 'Leave the service running after the run',
        'label.generateFor': 'Describe the behaviour this case should prove',
        'label.generatePlaceholder': 'e.g. registering with a taken username returns 409 and writes no second row',
        'label.unsaved': 'unsaved changes',
        'label.scan': 'Endpoints in this project',
        'label.scanHint': 'Read from the Spring annotations in the source. Tick the endpoints that deserve a case, and each one becomes a case file to fill in.',
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
        'empty.noChecks': 'This run recorded no assertions.',
        'empty.noEndpoints': 'The scan found no endpoints in this project. Check the project path, or that it is a Spring project.',

        'notice.saved': 'Saved {file}.',
        'notice.savedAssigned': 'Saved {file} with case id {caseId}.',
        'notice.deleted': 'Deleted {file}.',
        'notice.casesDeleted': 'Deleted {count} case(s).',
        'notice.casesPartlyDeleted': '{done} deleted, {failed} failed: {errors}',
        'notice.validated': 'The case loads and the guard would allow it.',
        'notice.generated': 'Generated with {model}. Read it before you run it.',
        'notice.runStarted': 'Run started — the service is starting.',
        'notice.imported': 'Imported {count} case(s).',
        'notice.importedPartly': 'Imported {count} case(s); {skipped} were left alone.',
        'notice.nothingToDelete': 'Nothing here has a target or a case directory, so there is nothing to delete.',

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
        'label.notRun': 'Not run',
        'label.type.unknown': 'Unknown',
        'action.openProject': 'Open',
        'action.home': 'Back to home',
        'empty.noProjects': 'No projects yet. A project appears here once a case names a target, or a case directory has a case in it.',
        'time.justNow': 'just now',
        'time.minutesAgo': '{count}m ago',
        'time.hoursAgo': '{count}h ago',
        'time.daysAgo': '{count}d ago',
        'label.searchCases': 'Search cases',
        'label.latestStatus': 'Latest status',
        'label.testName': 'Test name',
        'label.tests': '{count} tests',
        'label.steps': '{count} steps',
        'label.stepCount': 'Steps',
        'label.group': 'Group',
        'label.noChanges': 'No changes yet',
        'label.mode.form': 'Form',
        'label.mode.yaml': 'YAML',
        'label.mode.code': 'Code',
        'label.testCase': 'Test case',
        'label.properties': 'Properties',        'label.status': 'Status',
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
          'This run has no console to show: it started no service, so nothing printed a line. A run that starts a service keeps its output even when it fails before the request.',
        'label.logsAtTeardown':
          'Collected while the run was being torn down: these are the lines the service had written when it failed, not everything it might have printed later.',
        'label.logsReused':
          'The service was already running when this case started, so this run used it instead of launching a second copy — and a process this run did not start has no log of its own to show here.',
        'label.logsEmpty':
          'The service was followed, but its log was empty at the moment it was read: nothing had been written yet.',
        'label.logsUnscoped':
          'No log line carried this run’s trace id, so these are every line since the request started — they may include unrelated traffic.',
        'label.logsNotAsserted':
          'Kept for evidence, not asserted on: this case does not check the console, so a green run says the service answered, not that it printed nothing alarming.',
        'label.noSnapshots': 'This run read no database rows.',
        'label.noDatabaseAsserts':
          'A database was connected for this run, but the case asserts on none of it — the "读取数据库" panel only fills in when the YAML has an expect.database block, and this generated skeleton has none yet. Add one to see the rows this endpoint read or wrote.',
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

        'label.verdictStrict': 'Strict verdict',
        'label.permanentRef': 'Permanent ref',
        'label.runId': 'Run id',
        'label.fatalBoundary': 'Fatal boundary',
        'label.none': 'none',
        'label.expected': 'expected',
        'label.actual': 'actual',
        'label.wireTrace': 'Request and wire trace',
        'label.logTail': 'Console tail',
        'label.evidenceFiles': 'Evidence files',
        'label.reportMd': 'Report',
        'label.rawLog': 'Server log',
        'label.noEvidence': 'This run left no files behind.',
        'label.noRequest': 'This run never got a request out, so there is no wire trace to show.',
        'label.payload': 'Payload',
        'label.bodyResponse': 'Body response',
        'label.keyLogLines': 'Showing {shown} key line(s) — framework startup and pool chatter are hidden',
        'label.logTailCaption': '{shown} key lines of {total}',
        'label.lines': 'lines',
        'label.teardown': 'Teardown',
        'label.errors': 'error(s)',
        'label.cleanTeardown': 'clean',

        'action.editTestPlan': 'Edit test plan',
        'action.foldGroup': 'Fold this group',
        'action.expandGroup': 'Expand this group',
        'action.collapseAll': 'Collapse all',
        'action.expandAll': 'Expand all',
        'action.done': 'Done',
        'action.saveChanges': 'Save changes',
        'action.addTest': 'Add test',

        'plan.title': 'Edit test plan',
        'plan.hint': 'This page reads the case files as one plan. Saving writes back only the fields shown here — a test stays the file it always was.',
        'plan.subtitle': 'Add use cases and tests, or change any test’s priority, title, goal and steps. Nothing is saved until you press Save changes.',
        'plan.saved': 'Saved {count} case(s).',
        'plan.priority': 'Priority',
        'plan.editThis': 'Edit this test’s name, priority and goal',

        'status.all': 'All',
        'status.planned': 'Planned',
        'status.generated': 'Generated',
        'status.running': 'Running',
        'status.passed': 'Passed',
        'status.failed': 'Failed',
        'status.blocked': 'Blocked',

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
        'label.origin': 'ORIGIN',
        // The two halves of one case. They belong to the case, not to the
        // project, so they are a switch inside it rather than tabs beside
        // "cases" — a project has one page, and every case has these two.
        'label.caseView.evidence': 'Evidence',
        'label.caseView.plan': 'Test plan',
        'action.runSelected': 'Run selected',
        'action.runFullRegression': 'Run full regression',
        'action.createProject': 'Create project',
        'action.editProjects': 'Edit',
        'action.doneEditing': 'Done',
        'action.deleteSelected': 'Delete selected ({count})',
        'action.create': 'Create',
        'action.creating': 'Creating…',
        'notice.projectCreated': 'Project {name} created. Base URL {baseUrl} was read from the project; cases live in {dir}.',
        'field.projectPath': 'Project path (required — the Base URL is read from its application.yml)',
        'field.projectPort': 'Port (read from application.yml, or type it)',
        'action.browse': 'Browse…',
        'notice.pickerUnavailable': 'This window has no system file manager, so type the project path instead.',
        'notice.projectsDeleted': '{count} project(s) deleted.',
        'notice.projectsPartlyDeleted': '{done} deleted, {failed} failed: {errors}',
        'label.pickProjects': 'Pick this project',
        'label.diagnostic': 'Diagnostics',
        'label.actions': 'Actions',
        'label.selectCase': 'Select this case',
        'label.selectAll': 'Select every case in this group',
        'label.selectedCases': '{count}/{total} selected',
        'label.passRate': 'Pass rate',
        'label.lastInspected': 'Last activity',
        'diag.passed': '{checks} checks · {duration} ms',
        'diag.failed': '{checks} checks · {failed} failed · {duration} ms',
        'diag.ranNoSummary': 'Ran · see evidence for the result',
        'diag.planned': 'Awaiting its first run · {steps} steps',
        'diag.blocked': 'Refused before dialing',
        'diag.generated': 'Ready to run · {steps} steps',
        'diag.notRun': 'No run on record',
        'action.replay': 'Run just this case',
        'label.deterministic': '100% deterministic assertion',
        'label.assertionConfidence': 'Assertion confidence',
        'label.wireRounds': 'Wire rounds',
        'label.stateMachine': 'Runner state',
        'label.stateSynced': 'SYNCED',
        'action.runAgain': 'Run again',
        'action.exportReport': 'Export report',
        'action.runHistory': 'Run history ({count})',
        'label.aiAttribution': 'AI triage',
        'label.aiDisclaimer': 'Reference only · never overrides the deterministic verdict',
      },
      zh: {
        'panel.title': '端到端测试',

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
        'action.deleteConfirm': '确认删除',
        'action.explain': '为什么失败？',
        'action.explaining': '正在询问模型…',
        'action.generate': '根据描述生成',
        'action.generating': '生成中…',
        'action.scan': '扫描项目里的接口',
        'action.scanning': '扫描中…',
        'action.importPicked': '导入 {count} 个',
        'action.importing': '导入中…',
        'action.selectAll': '全选',
        'action.clearSelection': '清空',
        'action.close': '关闭',
        'action.retry': '重试',
        'action.reopen': '打开',
        'action.loading': '加载中…',
        'label.editor': '用例文件',
        'label.run': '运行',
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
        'label.allowWritesOn': '已允许写入：这次运行的 setup/teardown SQL 可以改数据。',
        'action.settings': '设置',
        'label.settings': '设置',
        'label.settingsHint': '这台机器上有什么，由注册表指向它们。数据库来自 dsh-db-mcp，运行配置来自 IDE MCP。',
        'label.settingsDatabase': '数据库',
        'label.settingsDatabaseEntry': '注册表条目',
        'label.settingsSource': 'dsh-db-mcp 数据源',
        'label.settingsSourceNone': '保留它自己的连接',
        'label.settingsNotPostgres': '不是 PostgreSQL 协议，用不了',
        'label.settingsIde': 'IDE 运行配置',
        'label.settingsTarget': '目标',
        'label.settingsPort': '端口',
        'label.settingsPortHint':
          '服务监听的端口。项目的 application.yml 里写了就从那里读；没写的项目这里留空，需要手工填进去。',
        'label.settingsConfiguration': '配置',
        'label.settingsConfigurationNone': '未设置',
        'empty.noDatabases': '注册表里没有数据库。先在注册表文件里加一个，再回来选。',
        'empty.noTargets': '注册表里没有目标，没有东西可以指向 IDE 运行配置。',
        'empty.noConfigurations': 'IDE 没有为这个项目列出任何运行配置。',
        'notice.settingsSaved': '设置已保存。',
        'label.keepRunning': '运行结束后保留服务',
        'label.generateFor': '描述这个用例要证明的行为',
        'label.generatePlaceholder': '例如：用已存在的用户名注册返回 409，且不写入第二行',
        'label.unsaved': '未保存的修改',
        'label.scan': '项目里的接口',
        'label.scanHint': '从源码里的 Spring 注解读出来。勾选值得写成用例的接口，每个接口都会生成一个用例文件，再往里填内容。',
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
        'empty.noChecks': '这次运行没有记录断言。',
        'empty.noEndpoints': '这次扫描没有在这个项目里找到接口。检查一下项目路径，或者确认它是 Spring 项目。',

        'notice.saved': '已保存 {file}。',
        'notice.savedAssigned': '已保存 {file}，用例编号 {caseId}。',
        'notice.deleted': '已删除 {file}。',
        'notice.casesDeleted': '已删除 {count} 条用例。',
        'notice.casesPartlyDeleted': '已删除 {done} 条，{failed} 条失败：{errors}',
        'notice.validated': '用例可以加载，护栏也会放行。',
        'notice.generated': '由 {model} 生成。运行前请先读一遍。',
        'notice.runStarted': '已开始运行 —— 服务正在启动。',
        'notice.imported': '已导入 {count} 个用例。',
        'notice.importedPartly': '已导入 {count} 个用例；{skipped} 个没有动。',
        'notice.nothingToDelete': '这里既没有 target 也没有用例目录，所以没有可删除的东西。',

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
        'label.notRun': '未运行',
        'label.type.unknown': '未知',
        'action.openProject': '打开',
        'action.home': '返回首页',
        'empty.noProjects': '还没有项目。用例引用了 target，或者某个用例目录里有用例，项目就会出现在这里。',
        'time.justNow': '刚刚',
        'time.minutesAgo': '{count} 分钟前',
        'time.hoursAgo': '{count} 小时前',
        'time.daysAgo': '{count} 天前',
        'label.searchCases': '搜索用例',
        'label.latestStatus': '最新状态',
        'label.testName': '用例名称',
        'label.tests': '{count} 个用例',
        'label.steps': '{count} 步',
        'label.stepCount': '用例步骤',
        'label.group': '分组',
        'label.noChanges': '还没有改动',
        'label.mode.form': '表单',
        'label.mode.yaml': 'YAML',
        'label.mode.code': '代码',
        'label.testCase': '用例',
        'label.properties': '属性',        'label.status': '状态',
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
        'label.noLogs': '这次运行没有控制台可看：它没有启动服务，所以没有谁打印过一行。启动服务的运行即使早早失败，也会把输出留下来。',
        'label.logsAtTeardown':
          '这是在收尾时读到的：服务失败那一刻已经写下的行，不是它之后再打印的全部内容。',
        'label.logsReused':
          '这条用例开始时服务已经在跑了，所以这次是直接用，没有再起第二个副本——不是这次起的进程，也就没有这次运行的日志可以给它看。',
        'label.logsEmpty': '服务是一直跟着的，但读的时候日志还是空的：那时候它什么都还没写。',
        'label.logsUnscoped': '没有日志行带这次运行的 trace id，所以这里是请求开始之后的全部日志，可能混入无关流量。',
        'label.logsNotAsserted':
          '这份日志只是证据，没有被断言：这条用例不检查控制台，所以绿只说明服务答复了，不说明它没有打印过难看的异常。',
        'label.noSnapshots': '这次运行没有读取数据库行。',
        'label.noDatabaseAsserts':
          '这次运行连上了数据库，但用例没有对它做任何断言——「读取数据库」只会在 YAML 里写了 expect.database 时才有内容，而生成的骨架里还没有。补一个 expect.database 就能看到这个接口读了或写了哪些行。',
        'label.afterOnly': '只有请求之后',
        'label.readAfterRequest': '请求之后读到的',
        'label.snapshotGap': '没有前后对比：查询两次都失败了，或者这条用例没有数据库断言。',
        'label.lastRun': '最近运行',
        'label.neverRun': '从未运行',
        'label.thisRun': '本次运行',
        'label.runAt': '{when} 运行',
        'label.noHistory': '这个用例还没有运行记录。',
        'label.formOnly': '初始化 SQL、变量捕获、清理和 mock 只在 YAML 里改：给它们做表单只会得到一个更难用的文本编辑器。',

        'label.verdictStrict': '严格判定',
        'label.permanentRef': '永久编号',
        'label.runId': '运行 ID',
        'label.fatalBoundary': '致命边界',
        'label.none': '无',
        'label.expected': '期望',
        'label.actual': '实际',
        'label.wireTrace': '请求与线网探测',
        'label.logTail': '控制台尾部',
        'label.evidenceFiles': '证据文件',
        'label.reportMd': '报告',
        'label.rawLog': '服务日志',
        'label.noEvidence': '这次运行没有留下文件。',
        'label.noRequest': '这次运行没有发出请求，所以没有线网探测可看。',
        'label.payload': '请求体',
        'label.bodyResponse': '响应体',
        'label.keyLogLines': '只展示 {shown} 行关键日志 —— 框架启动和连接池的噪音已隐藏',
        'label.logTailCaption': '共 {total} 行，显示 {shown} 行关键日志',
        'label.lines': '行',
        'label.teardown': '清理',
        'label.errors': '处错误',
        'label.cleanTeardown': '干净',

        'action.editTestPlan': '编辑测试计划',
        'action.foldGroup': '收起这一组',
        'action.expandGroup': '展开这一组',
        'action.collapseAll': '全部折叠',
        'action.expandAll': '全部展开',
        'action.done': '完成',
        'action.saveChanges': '保存改动',
        'action.addTest': '添加用例',

        'plan.title': '编辑测试计划',
        'plan.hint': '这一页把用例文件读成一份计划。保存只会写回这里显示的字段——每个用例还是它原来的那个文件。',
        'plan.subtitle': '可以添加用例，也可以改任意用例的优先级、名称、目标与步骤。按下「保存改动」之前什么都不会写。',
        'plan.saved': '已保存 {count} 个用例。',
        'plan.priority': '优先级',
        'plan.editThis': '修改这个用例的名称、优先级与目标',

        'status.all': '全部',
        'status.planned': '待编写',
        'status.generated': '已生成',
        'status.running': '运行中',
        'status.passed': '通过',
        'status.failed': '失败',
        'status.blocked': '被拦下',

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
        'label.origin': 'ORIGIN',
        // 同一个用例的两半。它们属于用例，不属于项目，所以是用例里的一个切换，
        // 而不是和“项目与用例清单”并排的 tab——项目只有一页，每个用例各有这两半。
        'label.caseView.evidence': '证据',
        'label.caseView.plan': '测试计划',
        'action.runSelected': '运行选中用例',
        'action.runFullRegression': '执行全量回归',
        'action.createProject': '创建项目',
        'action.editProjects': '编辑',
        'action.doneEditing': '完成',
        'action.deleteSelected': '删除所选（{count}）',
        'action.create': '创建',
        'action.creating': '创建中…',
        'notice.projectCreated': '项目 {name} 已创建。Base URL（{baseUrl}）是从项目里读出来的；用例放在 {dir}。',
        'field.projectPath': '项目路径（必填 — Base URL 会从它的 application.yml 读取）',
        'field.projectPort': '端口（从 application.yml 读到，或手工填）',
        'action.browse': '浏览…',
        'notice.pickerUnavailable': '这个窗口没有系统文件管理器，请直接输入项目路径。',
        'notice.projectsDeleted': '已删除 {count} 个项目。',
        'notice.projectsPartlyDeleted': '已删除 {done} 个，{failed} 个失败：{errors}',
        'label.pickProjects': '选中这个项目',
        'label.diagnostic': '诊断与异常',
        'label.actions': '操作',
        'label.selectCase': '选中这条用例',
        'label.selectAll': '选中这一组的全部用例',
        'label.selectedCases': '已选用例: {count}/{total}',
        'label.passRate': '通过率',
        'label.lastInspected': '最近活动',
        'diag.passed': '{checks} 项检查 · {duration} ms',
        'diag.failed': '{checks} 项检查 · {failed} 项失败 · {duration} ms',
        'diag.ranNoSummary': '已运行 · 结果见证据',
        'diag.planned': '待运行 · {steps} 步',
        'diag.blocked': '拨号之前被护栏拒绝',
        'diag.generated': '可以运行 · {steps} 步',
        'diag.notRun': '尚无运行记录',
        'action.replay': '只运行这一条',
        'label.deterministic': '100% 确定性断言',
        'label.assertionConfidence': '断言置信度',
        'label.wireRounds': '网络往返',
        'label.stateMachine': '运行状态',
        'label.stateSynced': '已同步',
        'action.runAgain': '再次运行',
        'action.exportReport': '导出报告',
        'action.runHistory': '执行历史 ({count})',
        'label.aiAttribution': 'AI 归因排查辅助解析',
        'label.aiDisclaimer': '仅供排查参考 · 永不干预确定性裁决',
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

    /**
     * What identifies one scanned row.
     *
     * Not the route: two controllers in one project can both declare `GET /`,
     * and a key that collapses them means ticking one ticks the other, React
     * warns about duplicate keys, and the import cannot tell which endpoint the
     * reader meant. The source coordinates are the endpoint's identity; the route
     * is only what a person reads off the row.
     */
    function scanKey(endpoint) {
      const where = endpoint.file ? `${endpoint.file}:${endpoint.line || 0}` : endpoint.controller || ''
      return `${endpoint.httpMethod} ${endpoint.path} ${where}`
    }

    /**
     * The Desktop window hands the page a bridge to the OS folder dialog:
     * `__DSH_DIRECTORY_PICKER__.pick()` resolves to the chosen folder, or null
     * when the dialog was dismissed. It is the same mechanism the Harness's own
     * workspace picker uses, so the create form opens the real file manager
     * instead of a second browser written by hand.
     *
     * Absent when the panel is open in an ordinary browser tab (the bridge is
     * only exposed on the dsh-app:// document): there the field stays typeable.
     */
    function systemPicker() {
      const bridge = globalThis.__DSH_DIRECTORY_PICKER__
      return bridge && typeof bridge.pick === 'function' ? bridge : null
    }

    /**
     * What a scan should look at, expressed as the project the toolbar belongs to.
     *
     * Both halves matter and both used to be guessed by the Host: the checkout to
     * read endpoints out of, and the target a written case names. Guessing the
     * first scans somebody else's source; guessing the second stamps every new
     * case with the wrong `env.target`, so the cases land in another project's
     * list. This is the same object shape for the first scan and every re-scan,
     * which is why it is built from the project rather than from the dialog.
     */
    function scanScope(project) {
      if (!project) return {}
      const target = Array.isArray(project.targets) && project.targets.length > 0 ? project.targets[0] : ''
      return {
        ...(project.projectPath ? { projectPath: project.projectPath } : {}),
        ...(target ? { target } : {}),
      }
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
     * The landing page: one card per project, after the Stitch design.
     *
     * The old table answered "what is in the suite" with six columns; the design
     * answers it with a headline number and a segmented bar, which is what a
     * reader actually scans. Everything shown still comes from `/projects` —
     * the percentages are derived from counts the Host already computed, so the
     * page and the agent can never disagree about them.
     */
    function ProjectTable({ t, projects, onOpen, creator, editing, picked, onPick }) {
      if (!projects || projects.length === 0) {
        return h('div', { className: 'e2e-empty-box' }, t('empty.noProjects'))
      }
      return h(
        'div',
        { className: 'e2e-project-grid' },
        projects.map((project) => {
          const counts = project.counts || { total: 0, passed: 0, failed: 0, notRun: 0, blocked: 0 }
          const total = counts.total || 0
          const pct = (value) => (total > 0 ? `${Math.round((value / total) * 1000) / 10}%` : '0%')
          const rate = total > 0 ? pct(counts.passed) : '—'
          const allPassed = total > 0 && counts.passed === total
          // The card is a button; in edit mode it picks instead of opens, and
          // the checkbox beside it carries the state for keyboard and touch.
          return h(
            'div',
            { key: project.key, className: `e2e-project-cell${editing && picked.has(project.key) ? ' is-picked' : ''}` },
            editing
              ? h('input', {
                  type: 'checkbox',
                  className: 'e2e-project-pick',
                  'aria-label': `${t('label.pickProjects')}: ${project.name}`,
                  checked: picked.has(project.key),
                  onChange: () => onPick(project.key),
                })
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'e2e-project-card',
                onClick: () => (editing ? onPick(project.key) : onOpen(project)),
                title: `${t('action.openProject')} — ${project.projectPath || project.baseUrl || project.key}`,
              },
              h(
                'div',
                { className: 'e2e-project-head' },
                h(
                  'div',
                  { className: 'e2e-project-title' },
                  h('span', { className: `e2e-project-dot${allPassed ? '' : ' is-pulse'}` }),
                  h('strong', null, project.name),
                  h('span', { className: 'e2e-project-badge' }, (project.type || '').toUpperCase() || t('label.type.unknown')),
                ),
                h(
                  'div',
                  { className: 'e2e-project-rate' },
                  h('span', { className: 'e2e-project-rate-label' }, t('label.passRate')),
                  h('span', { className: 'e2e-project-rate-value' }, rate),
                ),
              ),
              h(
                'div',
                { className: 'e2e-project-stack' },
                h('span', null, project.projectPath || project.baseUrl || project.key),
                h('span', { className: 'e2e-project-stack-target' }, project.targets && project.targets.length ? project.targets.join(', ') : ''),
              ),
              total > 0
                ? h(
                    'div',
                    { className: 'e2e-project-track' },
                    h('div', { className: 'e2e-project-seg is-pass', style: { flexGrow: Math.max(counts.passed, 0.001) }, title: `${counts.passed} ${t('status.passed')}` }),
                    h('div', { className: 'e2e-project-seg is-fail', style: { flexGrow: Math.max(counts.failed, 0.001) }, title: `${counts.failed} ${t('status.failed')}` }),
                    h('div', { className: 'e2e-project-seg is-blocked', style: { flexGrow: Math.max(counts.blocked || 0, 0.001) }, title: `${counts.blocked || 0} ${t('status.blocked')}` }),
                    h('div', { className: 'e2e-project-seg is-planned', style: { flexGrow: Math.max(counts.notRun, 0.001) }, title: `${counts.notRun} ${t('label.notRun')}` }),
                  )
                : h('div', { className: 'e2e-project-track e2e-project-track-empty' }),
              h(
                'div',
                { className: 'e2e-project-legend' },
                h('span', { className: 'e2e-project-legend-item is-pass' }, `${counts.passed} ${t('status.passed')}`),
                h('span', { className: 'e2e-project-legend-item is-fail' }, `${counts.failed} ${t('status.failed')}`),
                h('span', { className: 'e2e-project-legend-item is-blocked' }, `${counts.blocked || 0} ${t('status.blocked')}`),
                h('span', { className: 'e2e-project-legend-item is-planned' }, `${counts.notRun} ${t('label.notRun')}`),
                h('div', { className: 'e2e-spacer' }),
                h(
                  'span',
                  { className: 'e2e-project-when', title: absoluteTime(project.lastActivityAt) },
                  `${t('label.lastInspected')}: ${relativeTime(t, project.lastActivityAt)}`,
                ),
              ),
            ),
          )
        }),
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
     * The test-case matrix for one project, after the Stitch design: status
     * tabs, a search box, and rows grouped by use case, each row carrying a
     * checkbox, a diagnosis cell and inline actions.
     *
     * The diagnosis cell is the one column that did not exist before: a reader
     * scanning a failed suite asks "why" before "what", and the last error is
     * the honest short answer. It comes from the run the Host already matched.
     *
     * Grouped by use case rather than by endpoint because that is the unit a
     * reader thinks in; the endpoint is still on the row, so the grouping never
     * hides the route.
     */
    function CaseTable({ t, project, filter, onFilter, query, onQuery, onOpen, onScan, onEditPlan, onRunAll, running, checked, onToggleChecked, onRunSelected, onDeleteSelected, confirmDeleteSelected, deleting }) {
      const counts = project.statusCounts || { all: 0 }
      const tabs = ['all', 'planned', 'generated', 'running', 'passed', 'failed', 'blocked']
      const [folded, setFolded] = React.useState({})
      const toggle = (name) => setFolded((state) => ({ ...state, [name]: !state[name] }))
      const allFolded = (project.groups || []).length > 0 && (project.groups || []).every((bucket) => folded[bucket.name])
      const toggleAll = () => setFolded((state) => {
        const next = {}
        ;(project.groups || []).forEach((bucket) => { next[bucket.name] = !allFolded })
        return next
      })
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
      const selectedCount = (project.cases || []).filter((entry) => checked[entry.file]).length

      const groupEndpoint = (bucket) => (bucket.endpoint ? [bucket.endpoint] : [])
      // The Host flattens the last report onto each case (verdict, durationMs,
      // checks, failed, lastRunAt); only a history fixture wraps it in `run`.
      // Read both, and never leave a run row's diagnosis blank — an empty cell
      // next to a green chip reads as "nothing to say", which is worse than a
      // short "ran, see evidence".
      const diagnose = (entry) => {
        if (entry.status === 'planned') return { text: t('diag.planned', { steps: (entry.steps || []).length }), tone: 'idle' }
        if (entry.status === 'generated') return { text: t('diag.generated', { steps: (entry.steps || []).length }), tone: 'idle' }
        if (entry.status === 'blocked') return { text: entry.blockedReason || t('diag.blocked'), tone: 'warn' }
        const summary = entry.run && entry.run.summary ? entry.run.summary : entry.lastRunAt ? entry : null
        if (summary) {
          const checks = summary.checks ?? 0
          const duration = summary.durationMs ?? 0
          if (entry.status === 'failed' || entry.verdict === 'failed' || entry.verdict === 'refused') {
            return { text: t('diag.failed', { checks, failed: summary.failed ?? 0, duration }), tone: 'fail' }
          }
          if (entry.status === 'passed' || entry.verdict === 'passed') {
            return { text: t('diag.passed', { checks, duration }), tone: 'pass' }
          }
          return { text: t('diag.ranNoSummary', { checks, duration }), tone: 'idle' }
        }
        return { text: t('diag.notRun'), tone: 'idle' }
      }

      return h(
        'div',
        { className: 'e2e-cases' },
        h(
          'div',
          { className: 'e2e-cases-bar' },
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
          h('div', { className: 'e2e-spacer' }),
          // Reading the endpoints out of the source is the one action here that
          // is about the project rather than about the list, so it sits at the
          // head of the toolbar's actions — the place a reader looks for "do
          // something with all of this". "New case" is not repeated here: the
          // project line above already carries it, and two buttons that do the
          // same thing 30px apart only make the reader choose.
          h(Btn, { small: true, onClick: onScan }, t('action.scan')),
          // The plan is the same collection read the other way round: one row per
          // use case instead of one row per file. It sits beside the scan button
          // because both answer "what is this project testing" — scanning writes
          // cases from the code, the plan edits the cases already written.
          h(Btn, { small: true, onClick: onEditPlan }, t('action.editTestPlan')),
          // One click folds or unfolds every group: the list can be long, and a
          // reader may want only the group heads (one glance at the whole plan)
          // or all the rows at once (a sweep over the cases). Both labels are
          // literal t() calls so the unused-key guard can see them.
          groups.length > 0
            ? allFolded
              ? h(Btn, { small: true, onClick: toggleAll }, t('action.expandAll'))
              : h(Btn, { small: true, onClick: toggleAll }, t('action.collapseAll'))
            : null,
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
        // The rows live in their own scroller. The page around this table is a
        // column of panels, and a table that grows with its content pushes the
        // run controls off the bottom of the window — so the list scrolls and
        // the panels below stay where they are.
        h(
          'div',
          { className: 'e2e-cases-body' },
          h(
            'div',
            { className: 'e2e-cases-head' },
            h('span', { className: 'e2e-col-check' }),
            h('span', { className: 'e2e-col-id' }, 'ID'),
            h('span', { className: 'e2e-col-name' }, t('label.testName')),
            h('span', { className: 'e2e-col-status' }, t('label.latestStatus')),
            h('span', { className: 'e2e-col-diagnostic' }, t('label.diagnostic')),
            h('span', { className: 'e2e-col-actions' }, t('label.actions')),
          ),
          total === 0
          ? h('div', { className: 'e2e-empty-box' }, needle ? t('empty.noSearchResults', { query }) : t('empty.noCases'))
          : groups.map((bucket) => {
              const isFolded = Boolean(folded[bucket.name])
              const groupAllChecked = bucket.cases.every((entry) => checked[entry.file])
              return h(
                'div',
                { key: bucket.name, className: `e2e-plan-group${isFolded ? ' is-folded' : ''}` },
                h(
                  'div',
                  { className: 'e2e-plan-group-head' },
                  h('input', {
                    type: 'checkbox',
                    className: 'e2e-case-check',
                    title: t('label.selectAll'),
                    checked: groupAllChecked,
                    onChange: () =>
                      bucket.cases.forEach((entry) => {
                        if (groupAllChecked === Boolean(checked[entry.file])) onToggleChecked(entry.file)
                      }),
                  }),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'e2e-chevron e2e-group-fold',
                      title: isFolded ? t('action.expandGroup') : t('action.foldGroup'),
                      'aria-expanded': isFolded ? 'false' : 'true',
                      onClick: () => toggle(bucket.name),
                    },
                    isFolded ? '▸' : '▾',
                  ),
                  h('span', { className: 'e2e-plan-group-name', title: t('label.group') }, bucket.name),
                  groupEndpoint(bucket).map((endpoint) => h('code', { key: endpoint, className: 'e2e-endpoint-tag' }, endpoint)),
                  h('span', { className: 'e2e-muted' }, `[${t('label.tests', { count: bucket.summary.counts.total })}]`),
                  h('div', { className: 'e2e-spacer' }),
                  h(
                    'span',
                    { className: 'e2e-group-balance' },
                    h('span', { className: 'e2e-group-balance-pass' }, `${bucket.summary.counts.passed} ${t('status.passed')}`),
                    bucket.summary.counts.failed > 0
                      ? h('span', { className: 'e2e-group-balance-fail' }, ` / ${bucket.summary.counts.failed} ${t('status.failed')}`)
                      : null,
                    bucket.summary.counts.error > 0
                      ? h('span', { className: 'e2e-group-balance-error', title: t('label.errorScenarios') }, ` · ${bucket.summary.counts.error}✗`)
                      : null,
                  ),
                ),
                isFolded
                  ? null
                  : bucket.cases.map((entry) => {
                      const diagnosis = diagnose(entry)
                      return h(
                        'div',
                        { key: entry.file, className: 'e2e-case-row' },
                        h('input', {
                          type: 'checkbox',
                          className: 'e2e-case-check',
                          title: t('label.selectCase'),
                          checked: Boolean(checked[entry.file]),
                          onChange: () => onToggleChecked(entry.file),
                        }),
                        h(
                          'button',
                          { type: 'button', className: 'e2e-case-open', onClick: () => onOpen(entry.file), title: entry.file },
                          h(
                            'span',
                            { className: 'e2e-col-id' },
                            h(
                              'span',
                              { className: `e2e-case-id ${entry.status === 'failed' ? 'is-failed' : entry.status === 'planned' ? 'is-planned' : ''}` },
                              entry.caseId || entry.id,
                            ),
                          ),
                          h(
                            'span',
                            { className: 'e2e-col-name' },
                            h('span', { className: 'e2e-test-name' }, entry.title || entry.id),
                            entry.endpoint ? h('code', { className: 'e2e-endpoint-tag' }, entry.endpoint) : null,
                          ),
                          h('span', { className: 'e2e-col-status' }, h(StatusChip, { t, status: entry.status })),
                          h(
                            'span',
                            { className: `e2e-col-diagnostic is-${diagnosis.tone}` },
                            diagnosis.text,
                          ),
                        ),
                        h(
                          'span',
                          { className: 'e2e-col-actions' },
                          // One icon, one job: run this case alone. Opening its
                          // evidence is what clicking anywhere on the row already
                          // does, so a second button for it only made the column
                          // look like two buttons nobody needed.
                          h(
                            'button',
                            { type: 'button', className: 'e2e-icon-btn e2e-run-one', title: t('action.replay'), onClick: () => onRunSelected([entry.file]) },
                            '▶',
                          ),
                        ),
                      )
                    }),
              )
            }),
        ),
        total > 0
          ? h(
              'div',
              { className: 'e2e-serial-bar' },
              h('span', { className: 'e2e-serial-count' }, t('label.selectedCases', { count: selectedCount, total: counts.all })),
              h('div', { className: 'e2e-spacer' }),
              // Running lives in the top bar next to "back" and "settings":
              // one place to start a run, whether selected or full regression.
              // This footer is only about what is ticked — delete asks twice,
              // because these are case files and there is no undo.
              h(
                Btn,
                {
                  small: true,
                  variant: confirmDeleteSelected ? 'danger' : 'default',
                  disabled: deleting || running || selectedCount === 0,
                  onClick: () => onDeleteSelected && onDeleteSelected(),
                },
                confirmDeleteSelected ? t('action.deleteConfirm') : t('action.deleteSelected', { count: selectedCount }),
              ),
            )
          : null,
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
     * The whole project read as one plan.
     *
     * A case file answers "what does this test say". This page answers the
     * other question — "what are we testing at all" — by listing every use case
     * and every test under it, with the only three things the plan is about:
     * name, priority, and what the case is for.
     *
     * It is a view over the case files, not a second copy of them: saving goes
     * back through the same field patch the case form uses, so a rename here is
     * a rename there. The document it edits is exactly what the Host derives,
     * which is why the YAML view shows the same numbers the form does.
     */
    function TestPlanPage(props) {
      const { t, project, plan, loading, error, onSave, onDone, onAddTest, onOpenCase, busy } = props
      const [mode, setMode] = React.useState('form')
      const [document, setDocument] = React.useState(plan ? plan.document : null)
      const [filter, setFilter] = React.useState('')
      const [folded, setFolded] = React.useState({})
      const [editing, setEditing] = React.useState(null)
      const [text, setText] = React.useState(plan ? plan.yaml : '')

      // The Host's answer is the truth. When it changes — first load, or a save
      // that came back with the re-derived plan — the page starts from it again.
      React.useEffect(() => {
        setDocument(plan ? plan.document : null)
        setText(plan ? plan.yaml : '')
      }, [plan])

      const base = plan ? JSON.stringify(plan.document) : 'null'
      const dirty = mode === 'yaml' ? text !== (plan ? plan.yaml : '') : JSON.stringify(document) !== base

      const useCases = (document && document.useCases) || []
      const needle = String(filter || '').trim().toLowerCase()
      const visible = useCases
        .map((useCase) => ({
          ...useCase,
          testCases: (useCase.testCases || []).filter(
            (testCase) =>
              needle === '' ||
              String(testCase.id || '').toLowerCase().includes(needle) ||
              String(testCase.name || '').toLowerCase().includes(needle),
          ),
        }))
        .filter((useCase) => useCase.testCases.length > 0)

      const totalTests = useCases.reduce((sum, useCase) => sum + (useCase.testCases || []).length, 0)

      const patchTestCase = (id, fields) => {
        setDocument((current) => {
          if (!current) return current
          return {
            ...current,
            useCases: (current.useCases || []).map((useCase) => ({
              ...useCase,
              testCases: (useCase.testCases || []).map((testCase) =>
                String(testCase.id) === String(id) ? { ...testCase, ...fields } : testCase,
              ),
            })),
          }
        })
      }

      const toggle = (name) => setFolded((state) => ({ ...state, [name]: !state[name] }))

      // YAML is the same document by another route: the text is sent to the Host
      // as it stands, so a tab in the wrong place is reported against the line it
      // is on instead of being guessed at here.
      const save = () => {
        if (mode === 'yaml') onSave(null, text)
        else onSave(document, null)
      }

      const saveable = Boolean(dirty) && !Boolean(busy)

      const lineCount = text.split('\n').length

      return h(
        'div',
        { className: 'e2e-main e2e-testplan' },
        h(
          'div',
          { className: 'e2e-testplan-head' },
          h(
            'div',
            { className: 'e2e-testplan-title-row' },
            h('h2', { className: 'e2e-testplan-title' }, t('plan.title')),
            h('span', { className: 'e2e-testplan-info', title: t('plan.hint'), 'aria-label': t('plan.hint') }, 'ⓘ'),
            project ? h('span', { className: 'e2e-muted' }, project.name) : null,
          ),
          h('div', { className: 'e2e-testplan-subtitle' }, t('plan.subtitle')),
        ),
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
                  onClick: () => setMode(name),
                },
                t(`label.mode.${name}`),
              ),
            ),
          ),
          h('span', { className: 'e2e-testplan-total' }, t('label.tests', { count: totalTests })),
          h('div', { className: 'e2e-spacer' }),
          h('span', { className: 'e2e-muted' }, dirty ? t('label.unsaved') : t('label.noChanges')),
          h(Btn, { small: true, onClick: onDone }, t('action.done')),
          h(
            Btn,
            {
              small: true,
              variant: 'primary',
              disabled: !saveable,
              onClick: save,
            },
            busy ? t('action.saving') : t('action.saveChanges'),
          ),
        ),
        loading ? h('div', { className: 'e2e-empty-box' }, t('state.loading')) : null,
        error
          ? h('div', { className: 'e2e-error-box' }, h('div', null, error))
          : mode === 'yaml'
            ? h(
                'div',
                { className: 'e2e-yaml-wrap' },
                h(
                  'div',
                  { className: 'e2e-yaml-gutter', 'aria-hidden': 'true' },
                  Array.from({ length: lineCount }, (unused, index) => h('div', { key: index }, String(index + 1))),
                ),
                h('textarea', {
                  className: 'e2e-yaml-editor',
                  spellCheck: false,
                  value: text,
                  onChange: (event) => setText(event.target.value),
                }),
              )
            : h(
                'div',
                { className: 'e2e-testplan-body' },
                h('input', {
                  className: 'e2e-input e2e-testplan-search',
                  placeholder: t('label.searchCases'),
                  value: filter,
                  onChange: (event) => setFilter(event.target.value),
                }),
                visible.length === 0
                  ? h('div', { className: 'e2e-empty-box' }, t('empty.noCases'))
                  : visible.map((useCase) =>
                      h(
                        'div',
                        { key: useCase.slug || useCase.useCase, className: 'e2e-plan-card' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'e2e-plan-group-head e2e-testplan-group',
                            onClick: () => toggle(useCase.useCase),
                            'aria-expanded': folded[useCase.useCase] ? 'false' : 'true',
                          },
                          h('span', { className: `e2e-chevron${folded[useCase.useCase] ? ' is-folded' : ''}` }, folded[useCase.useCase] ? '▸' : '▾'),
                          h('span', { className: 'e2e-plan-group-name' }, useCase.useCase),
                          h('span', { className: 'e2e-muted' }, t('label.tests', { count: (useCase.testCases || []).length })),
                        ),
                        folded[useCase.useCase]
                          ? null
                          : (useCase.testCases || []).map((testCase) =>
                              editing === testCase.id
                                ? h(
                                    'div',
                                    { key: testCase.id, className: 'e2e-testplan-edit' },
                                    h('input', {
                                      className: 'e2e-input',
                                      value: testCase.name || '',
                                      autoFocus: true,
                                      onChange: (event) => patchTestCase(testCase.id, { name: event.target.value }),
                                    }),
                                    h(
                                      'select',
                                      {
                                        className: 'e2e-input',
                                        value: testCase.priority || 'Medium',
                                        onChange: (event) => patchTestCase(testCase.id, { priority: event.target.value }),
                                      },
                                      ['High', 'Medium', 'Low'].map((word) => h('option', { key: word, value: word }, word)),
                                    ),
                                    h('input', {
                                      className: 'e2e-input',
                                      placeholder: t('field.description'),
                                      value: testCase.description || '',
                                      onChange: (event) => patchTestCase(testCase.id, { description: event.target.value }),
                                    }),
                                    h(Btn, { small: true, onClick: () => setEditing(null) }, t('action.done')),
                                  )
                                : h(
                                    'div',
                                    { key: testCase.id, className: 'e2e-testplan-row' },
                                    h('span', { className: 'e2e-col-id' }, testCase.id),
                                    h(
                                      'span',
                                      {
                                        className: `e2e-testplan-priority is-${String(testCase.priority || 'Medium').toLowerCase()}`,
                                        title: t('plan.priority'),
                                      },
                                      h('span', { className: 'e2e-testplan-dot' }),
                                      String(testCase.priority || 'Medium'),
                                    ),
                                    h(
                                      'button',
                                      {
                                        type: 'button',
                                        className: 'e2e-testplan-name',
                                        title: t('plan.editThis'),
                                        onClick: () => setEditing(testCase.id),
                                      },
                                      testCase.name || testCase.id,
                                    ),
                                    h(Btn, { small: true, onClick: () => onOpenCase && onOpenCase(testCase.id) }, t('label.caseView.evidence')),
                                  ),
                            ),
                        h(
                          'button',
                          { type: 'button', className: 'e2e-add-test', onClick: () => onAddTest && onAddTest(useCase) },
                          t('action.addTest'),
                        ),
                      ),
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
    /* ---------- the case detail page ---------- */

    /**
     * One number with a word under it.
     *
     * "Passed" and "7 of 7 checks" are the same fact at two resolutions, and a
     * reader deciding whether to trust a green run wants both. Numbers buried in a
     * sentence get skimmed; numbers in a column get read.
     */
    function Metric(props) {
      return h(
        'div',
        { className: 'e2e-metric' },
        h('div', { className: 'e2e-metric-label' }, props.label),
        h(
          'div',
          { className: 'e2e-metric-value', style: props.tone ? { color: props.tone } : undefined },
          props.value,
        ),
        props.note ? h('div', { className: 'e2e-metric-note' }, props.note) : null,
      )
    }

    /** `priority: high` — one fact, the key in small caps, the value in mono. */
    function SpecTag(props) {
      return h(
        'span',
        { className: 'e2e-spec', title: props.title || undefined },
        h('span', { className: 'e2e-spec-key' }, props.name),
        h('span', { className: 'e2e-spec-value' }, props.value),
      )
    }

    /** A 500 is red, a 404 amber, a 200 green: the colour is the first read. */
    function responseTone(status) {
      const code = Number(status)
      if (code >= 500) return TONES.fail
      if (code >= 400) return TONES.warn
      if (code >= 200 && code < 300) return TONES.pass
      return TONES.idle
    }

    /** `is-warn` / `is-error` for the log tail, from the level word in the line. */
    function levelClass(line) {
      const match = /\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b/.exec(String(line))
      return match ? ` is-${match[1].toLowerCase()}` : ''
    }

    // A request's console window is mostly container chatter: Spring mapping
    // tables, Hikari pools starting, the same trace marker printed on every
    // line. The useful part — the mapper's SQL, the repository's own messages,
    // every WARN/ERROR — is a few lines among hundreds. Show those, once each.
    const LOG_NOISE =
      /\bo\.s\.|\bcom\.zaxxer\.|\bo\.a\.c\.c\.|\borg\.mybatis\.spring\.|DispatcherServlet|HikariConfig|HikariPool|PoolBase|DataSourceTransactionManager|InitializingBean|Finished Spring|Started \S+Application|Tomcat started|^\s*$/
    function keyLogLines(lines) {
      const kept = []
      const seen = new Set()
      for (const raw of lines || []) {
        const line = String(raw).replace(/\s+$/, '')
        if (!line || LOG_NOISE.test(line)) continue
        const level = /\b(WARN|ERROR|FATAL)\b/.exec(line)
        const app = /\bc\.h\.a\.|com\.huawei\.|\bPLAIN:/.test(line)
        if (!level && !app && !/\bINFO\b/.test(line)) continue
        // Normalise the volatile bits — leading timestamp and long hex ids — so
        // the same marker printed on every line collapses into one entry.
        const fingerprint = line
          .replace(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d[.,]\d+/, '')
          .replace(/\b[0-9a-fA-F]{16,}\b/g, '#')
        if (seen.has(fingerprint)) continue
        seen.add(fingerprint)
        kept.push(line)
        if (kept.length >= 60) break
      }
      return kept
    }

    /**
     * What went out and what came back, always on the page.
     *
     * This is a rail section rather than a tab because the wire is what every
     * reader looks at before choosing a tab: a 500 with a 44-byte body explains
     * more about a failing checkpoint than the checkpoint does.
     */
    function WireTrace(props) {
      const { t, evidence } = props
      const request = evidence && evidence.request
      const response = evidence && evidence.response
      if (!request && !response) return h('div', { className: 'e2e-muted' }, t('label.noRequest'))
      const entriesOf = (map) => Object.entries(map || {}).slice(0, 6)
      return h(
        'div',
        { className: 'e2e-wire' },
        request
          ? h(
              'div',
              { className: 'e2e-wire-part' },
              h(
                'div',
                { className: 'e2e-wire-line' },
                h('span', { className: 'e2e-method-badge' }, String(request.method || 'GET')),
                h('span', { className: 'e2e-url', title: request.url }, String(request.url || '')),
              ),
              entriesOf(request.headers).length > 0
                ? h(
                    'div',
                    { className: 'e2e-kv' },
                    entriesOf(request.headers).map(([key, value], index) =>
                      h(
                        'div',
                        { key: index, className: 'e2e-kv-row' },
                        h('span', { className: 'e2e-kv-key' }, key),
                        h('span', { className: 'e2e-kv-value', title: String(value) }, String(value)),
                      ),
                    ),
                  )
                : null,
              request.body === null || request.body === undefined
                ? null
                : h(
                    'div',
                    null,
                    h('div', { className: 'e2e-wire-caption' }, t('label.payload')),
                    h('pre', { className: 'e2e-pre' }, formatBody(request.body, 1200)),
                  ),
            )
          : null,
        response
          ? h(
              'div',
              { className: 'e2e-wire-part' },
              h(
                'div',
                { className: 'e2e-wire-line' },
                h('span', { className: 'e2e-status-badge', style: { color: responseTone(response.status) } }, String(response.status)),
                h('span', { className: 'e2e-wire-caption' }, t('label.status')),
                h('span', { className: 'e2e-spacer' }),
                h('span', { className: 'e2e-wire-caption' }, `${response.durationMs || 0} ms`),
              ),
              h(
                'div',
                null,
                h('div', { className: 'e2e-wire-caption' }, t('label.bodyResponse')),
                h('pre', { className: 'e2e-pre' }, formatBody(response.body, 1600)),
              ),
            )
          : null,
      )
    }

    /**
     * A short tail of the console, in the rail, where a failing run is read.
     *
     * The Console tab is the full dump; this is a handful of key lines, each
     * clipped to one row, so an SQL statement cannot grow into a wall of text.
     */
    function LogTail(props) {
      const { t, logs } = props
      if (!logs) return h('div', { className: 'e2e-muted' }, t('label.noLogs'))
      const lines = keyLogLines(logs.lines).slice(-6)
      return h(
        'div',
        null,
        h('div', { className: 'e2e-wire-caption' }, t('label.logTailCaption', { shown: lines.length, total: logs.totalLines })),
        lines.length > 0
          ? h(
              'div',
              { className: 'e2e-logtail' },
              lines.map((line, index) => h('div', { key: index, className: `e2e-logline${levelClass(line)}`, title: String(line) }, String(line))),
            )
          : h('div', { className: 'e2e-muted' }, t('label.noLogs')),
      )
    }

    /** The files this run left behind. A report you cannot open is a rumour. */
    function EvidenceFiles(props) {
      const { t, run, evidence, shots, onOpenReport } = props
      const nameOf = (path) => String(path || '').split(/[\\/]/).pop()
      const items = []
      if (run && run.path) {
        items.push({
          key: 'report',
          label: t('label.reportMd'),
          value: nameOf(run.path).replace(/\.json$/i, '.md'),
          onClick: () => onOpenReport && onOpenReport(run.path),
        })
      }
      if (evidence && evidence.logs && evidence.logs.path) {
        items.push({ key: 'log', label: t('label.rawLog'), value: nameOf(evidence.logs.path) })
      }
      if (shots > 0) items.push({ key: 'shots', label: t('label.mode.shots'), value: String(shots) })
      if (items.length === 0) return h('div', { className: 'e2e-muted' }, t('label.noEvidence'))
      return h(
        'div',
        { className: 'e2e-links' },
        items.map((item) =>
          h(
            'button',
            {
              key: item.key,
              type: 'button',
              className: 'e2e-link',
              disabled: !item.onClick,
              onClick: item.onClick,
              title: item.value,
            },
            h('span', { className: 'e2e-link-label' }, item.label),
            h('span', { className: 'e2e-link-value' }, item.value),
          ),
        ),
      )
    }

    function CaseDetail(props) {
      const { t, selected, history, historyRun, onOpenRun, historyLoading, onEdit, onRun, running, onDone, onOpenReport } =
        props
      const [tab, setTab] = React.useState('checks')
      const definition = selected ? selected.definition : null
      const latest = (history && history[0]) || null
      // The run the reader is looking at. Opening a case loads its newest report,
      // so this is almost always set — the page would otherwise be empty on a case
      // that has run twelve times, which is a lie it cannot afford.
      const shown = historyRun || null
      const report = (shown && shown.report) || null
      const evidence = (report && report.evidence) || null
      const keyLogs = evidence && evidence.logs ? keyLogLines(evidence.logs.lines) : []
      const checks = (report && report.checks) || []
      const steps = (report && report.steps) || []
      const verdict = (report && report.verdict) || (latest ? latest.verdict : null)
      const caseId = (definition && definition.caseId) || (report && report.caseId) || (selected && selected.file) || ''
      const title = (definition && definition.title) || (report && report.title) || (selected && selected.file) || ''
      const passed = checks.filter((check) => check.ok).length
      const durationMs = report ? report.durationMs : latest ? latest.durationMs : null
      const fatal = report ? report.fatal : null
      const teardown = report ? report.teardown : null
      const teardownErrors = (teardown && teardown.errors) || []
      const environment = (report && report.environment) || {}
      const statusKey = !verdict ? 'planned' : verdict === 'refused' ? 'blocked' : verdict
      const statusWord = t(`status.${statusKey}`)
      const shots = (evidence && evidence.browser && evidence.browser.screenshots) || []
      /**
       * One tab per question a failing run makes you ask, in the order you ask
       * them: what did it check, what did the service print, what does the
       * database look like now. Code and history are for afterwards.
       *
       * Tabs rather than one long page because the answers are long and mostly
       * irrelevant to each other: a console dump between you and the checkpoint
       * that failed is a wall, not evidence.
       */
      const tabs = [
        { name: 'checks', label: t('label.mode.checks'), count: checks.length },
        {
          name: 'logs',
          label: t('label.mode.logs'),
          count: (evidence && evidence.logs && evidence.logs.lines && evidence.logs.lines.length) || 0,
        },
        // Before/after pairs when the report has them, and the after-state on its
        // own when it does not: a report written before snapshots existed still
        // read the rows, and hiding them because the pair is missing throws away
        // the answer to keep the shape of the question.
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
          ? [{ name: 'shots', label: t('label.mode.shots'), count: shots.length }]
          : []),
        { name: 'code', label: t('label.mode.code'), count: 0 },
        { name: 'history', label: t('label.mode.history'), count: (history || []).length },
      ]
      return h(
        'div',
        { className: 'e2e-detail' },
        // ---- the action bar: what a reader does, before what a reader reads ----
        h(
          'div',
          { className: 'e2e-detail-head' },
          h(
            'div',
            { className: 'e2e-detail-crumbs' },
            `${t('label.testCase')} · `,
            h('span', { className: 'e2e-detail-crumb is-ref' }, caseId),
            h('span', { className: 'e2e-crumb-sep' }, '/'),
            h('span', { className: 'e2e-detail-crumb' }, environment.configurationName || environment.target || '—'),
            definition && definition.group ? h('span', { className: 'e2e-crumb-sep' }, '/') : null,
            definition && definition.group ? h('span', { className: 'e2e-detail-crumb' }, definition.group) : null,
            definition && definition.endpoint
              ? h('span', { className: 'e2e-detail-env' }, definition.endpoint)
              : null,
          ),
          h('div', { className: 'e2e-spacer' }),
          h(Btn, { small: true, primary: true, onClick: onRun, disabled: running }, running ? t('action.running') : t('action.runAgain')),
          h(Btn, { small: true, onClick: onEdit }, t('action.editTestPlan')),
          shown && shown.path
            ? h(Btn, { small: true, onClick: () => onOpenReport(shown.path) }, t('action.exportReport'))
            : null,
          h(
            Btn,
            {
              small: true,
              onClick: () => {
                const last = history && history[0]
                if (last && onOpenRun) onOpenRun(last.path)
                setTab('history')
              },
            },
            t('action.runHistory', { count: (history || []).length }),
          ),
        ),
        // ---- the verdict banner: one glance answers "is this green, and why" ----
        h(
          'div',
          { className: 'e2e-hero' },
          h(
            'div',
            { className: 'e2e-hero-main' },
            h(
              'div',
              { className: 'e2e-hero-id' },
              h(
                'span',
                { className: 'e2e-verdict-badge', style: { color: TONES[verdictTone(statusKey === 'blocked' ? 'refused' : statusKey)] } },
                `${t('label.verdictStrict')}: ${String(statusWord).toUpperCase()}`,
              ),
              h('span', { className: 'e2e-hero-deterministic' }, t('label.deterministic')),
            ),
            h('h3', { className: 'e2e-hero-title' }, `${caseId} · ${title}`),
            definition && definition.description ? h('p', { className: 'e2e-hero-desc' }, definition.description) : null,
            h(
              'div',
              { className: 'e2e-hero-meta' },
              h('span', { className: 'e2e-hero-ref' }, `${t('label.permanentRef')}: ${caseId}`),
              report && report.runId ? h('span', { className: 'e2e-hero-run' }, `${t('label.runId')}: ${report.runId}`) : null,
              h(
                'span',
                { className: checks.length > 0 && passed === checks.length ? 'e2e-hero-count is-pass' : 'e2e-hero-count' },
                `${passed}/${checks.length}`,
              ),
              h('span', { className: 'e2e-hero-meta-item' }, durationMs === null || durationMs === undefined ? '—' : `${durationMs} ms`),
              h(
                'span',
                { className: `e2e-hero-meta-item${fatal ? ' is-fail' : ' is-pass'}` },
                `${t('label.fatalBoundary')}: ${fatal ? String(fatal.name || fatal.message || 'fatal') : t('label.none')}`,
              ),
              report
                ? h(
                    'span',
                    { className: `e2e-hero-meta-item${teardownErrors.length > 0 ? ' is-fail' : ' is-pass'}` },
                    `${t('label.teardown')}: ${teardownErrors.length > 0 ? `${teardownErrors.length} ${t('label.errors')}` : t('label.cleanTeardown')}`,
                  )
                : null,
            ),
            h(
              'div',
              { className: 'e2e-specs' },
              definition && definition.endpoint ? h(SpecTag, { name: t('field.endpoint'), value: definition.endpoint }) : null,
              definition && definition.scenario ? h(SpecTag, { name: t('field.scenario'), value: t(`label.scenario.${definition.scenario}`) }) : null,
              definition && definition.priority ? h(SpecTag, { name: t('field.priority'), value: t(`label.priority.${definition.priority}`) }) : null,
              definition && definition.group ? h(SpecTag, { name: t('field.group'), value: definition.group }) : null,
              environment.target ? h(SpecTag, { name: 'target', value: environment.target }) : null,
              environment.baseUrl ? h(SpecTag, { name: 'baseUrl', value: environment.baseUrl }) : null,
            ),
          ),
          h(
            'div',
            { className: 'e2e-metrics' },
            h(Metric, {
              label: t('label.assertionConfidence'),
              value: checks.length > 0 ? `${Math.round((passed / checks.length) * 1000) / 10}%` : '—',
              note: verdict ? statusWord : t('label.neverRun'),
              tone: checks.length > 0 && passed === checks.length ? TONES.pass : checks.length > 0 ? TONES.fail : undefined,
            }),
            h(Metric, {
              label: t('label.wireRounds'),
              value: `${steps.filter((step) => step.kind && step.kind.indexOf('setup.http') === 0).length + 1}`,
              note: durationMs === null || durationMs === undefined ? '' : `${durationMs} ms`,
            }),
            h(Metric, {
              label: t('label.stateMachine'),
              value: t('label.stateSynced'),
              note: verdict ? statusWord : '',
            }),
          ),
        ),
        // ---- the AI strip: an opinion, clearly fenced off from the verdict ----
        h(
          'div',
          { className: 'e2e-ai' },
          h('span', { className: 'e2e-ai-icon', 'aria-hidden': 'true' }, '◎'),
          h('span', { className: 'e2e-ai-title' }, t('label.aiAttribution')),
          h('span', { className: 'e2e-ai-disclaimer' }, t('label.aiDisclaimer')),
        ),
        // ---- which question are we reading the answer to ----
        h(
          'div',
          { className: 'e2e-tabstrip' },
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
          h('span', { className: 'e2e-spacer' }),
        ),
        // ---- the answer, next to the wire it answers about ----
        h(
          'div',
          { className: 'e2e-inspect' },
          h(
            'div',
            { className: 'e2e-inspect-main' },
            tab === 'checks'
              ? checks.length > 0
                ? h(
                    'div',
                    { className: 'e2e-checks' },
                    checks.map((check, index) => h(CheckRow, { key: index, check, index, t })),
                  )
                : h('div', { className: 'e2e-muted' }, t('label.noChecks'))
              : null,
            tab === 'logs'
              ? evidence && evidence.logs
                ? h(
                    'div',
                    { className: 'e2e-stack' },
                    h(
                      'div',
                      { className: 'e2e-wire-caption' },
                      `${evidence.logs.traceId} · ${evidence.logs.scopedLines}/${evidence.logs.totalLines} ${t('label.lines')}`,
                    ),
                    // Kept, but not checked: saying so is the difference between
                    // "the run verified its logs" and "here is what the service
                    // printed".
                    evidence.logs.asserted === false ? h('div', { className: 'e2e-muted' }, t('label.logsNotAsserted')) : null,
                    evidence.logs.collected === 'at-teardown'
                      ? h('div', { className: 'e2e-muted' }, t('label.logsAtTeardown'))
                      : null,
                    evidence.logs.traceIdPresent ? null : h('div', { className: 'e2e-warning' }, t('label.logsUnscoped')),
                    keyLogs.length > 0
                      ? h(
                          'div',
                          null,
                          h('div', { className: 'e2e-muted' }, t('label.keyLogLines', { shown: keyLogs.length })),
                          h('pre', { className: 'e2e-pre is-tall' }, formatBody(keyLogs.join('\n'))),
                        )
                      : h('div', { className: 'e2e-muted' }, t('label.logsEmpty')),
                  )
                : h(
                    'div',
                    { className: 'e2e-muted' },
                    t('label.noLogs'),
                    evidence && evidence.serviceReused
                      ? h('span', null, ' ', t('label.logsReused'))
                      : null,
                  )
              : null,
            tab === 'database'
              ? evidence && evidence.snapshots && evidence.snapshots.length > 0
                ? h(
                    'div',
                    { className: 'e2e-stack' },
                    evidence.snapshots.map((snapshot, index) => h(DatabaseDiff, { key: index, t, snapshot })),
                  )
                : evidence && evidence.database && evidence.database.length > 0
                  ? h(
                      'div',
                      { className: 'e2e-stack' },
                      evidence.database.map((entry, index) => h(DatabaseRows, { key: index, t, entry })),
                    )
                  : steps.some((item) => item.name === 'database.connected')
                    ? h('div', { className: 'e2e-muted' }, t('label.noDatabaseAsserts'))
                    : h('div', { className: 'e2e-muted' }, t('label.noSnapshots'))
              : null,
            tab === 'code' ? h('pre', { className: 'e2e-pre is-plan' }, (selected && selected.yaml) || '') : null,
            tab === 'shots' ? h(ShotsPane, { t, browser: evidence && evidence.browser }) : null,
            tab === 'history' ? h(HistoryPanel, { t, history, run: historyRun, onOpenRun, loading: historyLoading }) : null,
          ),
          // The rail answers the questions that are the same whatever tab you are
          // on: what is this, what went over the wire, what did it print, where are
          // the files.
          h(
            'aside',
            { className: 'e2e-rail' },
            h(
              'div',
              { className: 'e2e-rail-section' },
              h('div', { className: 'e2e-rail-head' }, t('label.properties')),
              h(
                'div',
                { className: 'e2e-rail-body' },
                h(
                  'div',
                  { className: 'e2e-kv-row' },
                  h('span', { className: 'e2e-kv-key' }, t('label.caseId')),
                  h('span', { className: 'e2e-kv-value' }, caseId || '—'),
                ),
                definition && definition.endpoint
                  ? h(
                      'div',
                      { className: 'e2e-kv-row' },
                      h('span', { className: 'e2e-kv-key' }, t('field.endpoint')),
                      h('span', { className: 'e2e-kv-value', title: definition.endpoint }, definition.endpoint),
                    )
                  : null,
                h(
                  'div',
                  { className: 'e2e-kv-row' },
                  h('span', { className: 'e2e-kv-key' }, t('label.lastRun')),
                  h('span', { className: 'e2e-kv-value' }, latest ? relativeTime(t, latest.startedAt) : t('label.neverRun')),
                ),
                steps.length > 0
                  ? h(
                      'div',
                      { className: 'e2e-kv-row' },
                      h('span', { className: 'e2e-kv-key' }, t('label.stepCount')),
                      h('span', { className: 'e2e-kv-value' }, String(steps.length)),
                    )
                  : null,
              ),
            ),
            h(
              'div',
              { className: 'e2e-rail-section' },
              h('div', { className: 'e2e-rail-head' }, t('label.wireTrace')),
              h('div', { className: 'e2e-rail-body' }, h(WireTrace, { t, evidence })),
            ),
            h(
              'div',
              { className: 'e2e-rail-section' },
              h('div', { className: 'e2e-rail-head' }, t('label.logTail')),
              h('div', { className: 'e2e-rail-body' }, h(LogTail, { t, logs: evidence && evidence.logs })),
            ),
            h(
              'div',
              { className: 'e2e-rail-section' },
              h('div', { className: 'e2e-rail-head' }, t('label.evidenceFiles')),
              h('div', { className: 'e2e-rail-body' }, h(EvidenceFiles, { t, run: shown, evidence, shots: shots.length, onOpenReport })),
            ),
          ),
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

    /**
     * One checkpoint, as a row you can point at in a bug report.
     *
     * The number matters as much as the verdict: "check 4 is the one that failed"
     * is a sentence people say to each other. The right-hand word is the same
     * vocabulary in every run, so a reader scanning the column sees `PASSED` and
     * `FAILED` line up rather than two shapes of sentence.
     */
    function CheckRow(props) {
      const { check, index, t } = props
      const tone = check.ok ? TONES.pass : TONES.fail
      const number = typeof index === 'number' ? `${index + 1}. ` : ''
      return h(
        'div',
        { className: `e2e-check${check.ok ? '' : ' is-failed'}` },
        h('span', { className: 'e2e-check-mark', style: { color: tone } }, check.ok ? '✓' : '✗'),
        h(
          'div',
          { className: 'e2e-check-body' },
          h('div', { className: 'e2e-check-label' }, `${number}${check.label || ''}`),
          check.ok
            ? null
            : h(
                'div',
                { className: 'e2e-check-diff' },
                h('span', null, `${t ? t('label.expected') : 'expected'} ${formatValue(check.expected)}`),
                h('span', { className: 'e2e-muted' }, ' · '),
                h('span', null, `${t ? t('label.actual') : 'actual'} ${formatValue(check.actual)}`),
              ),
          check.ok || !check.detail ? null : h('div', { className: 'e2e-check-detail' }, String(check.detail)),
        ),
        h('span', { className: 'e2e-check-word', style: { color: tone } }, check.ok ? 'PASSED' : 'FAILED'),
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
                h('pre', { className: 'e2e-pre is-tall' }, formatBody(keyLogLines(evidence.logs.lines).join('\n'))),
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
          : h(
              'div',
              { className: 'e2e-checks' },
              checks.map((check, index) => h(CheckRow, { key: index, check, index, t })),
            ),
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

    /* ---------- the scan dialog ---------- */

    /**
     * The endpoints this project already serves, as a list you tick.
     *
     * Reading the source is a whole-project question, so the scan runs once and
     * the answer is a list; the reader's job is to choose which of those
     * endpoints deserves a case. Ticking several and importing them together is
     * the point — one dialog, one write, instead of twenty round trips through
     * the editor.
     *
     * The scan itself, the ticked rows and the import all belong to the panel:
     * this is a modal, and a modal that owned the answer it is showing would lose
     * it the moment it re-rendered. It takes what it shows and what to do, the
     * same way every other list in this panel does.
     */
    function ScanDialog(props) {
      const { t, scan, picked, importing, importError, onTogglePicked, onPickAll, onImport, onRescan, onClose } = props

      const list = (scan.data && scan.data.endpoints) || []
      const keyOf = scanKey
      const allPicked = list.length > 0 && picked.size === list.length

      return h(
        'div',
        {
          className: 'e2e-scan-backdrop',
          onClick: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'div',
          { className: 'e2e-scan' },
          h(
            'div',
            { className: 'e2e-scan-head' },
            h('strong', null, t('label.scan')),
            h('div', { className: 'e2e-spacer' }),
            h(Btn, { small: true, onClick: onClose }, t('action.close')),
          ),
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
          scan.error ? h('div', { className: 'e2e-error' }, scan.error) : null,
          importError ? h('div', { className: 'e2e-error' }, importError) : null,
          scan.status === 'scanning'
            ? h('div', { className: 'e2e-hint' }, t('action.scanning'))
            : null,
          scan.status === 'ready' && list.length === 0
            ? h('div', { className: 'e2e-empty-box' }, t('empty.noEndpoints'))
            : null,
          scan.status === 'ready' && list.length > 0
            ? h(
                'div',
                { className: 'e2e-scan-list' },
                list.map((endpoint) => {
                  const key = keyOf(endpoint)
                  const on = picked.has(key)
                  return h(
                    'label',
                    { key, className: `e2e-scan-row${on ? ' is-picked' : ''}` },
                    h('input', {
                      type: 'checkbox',
                      checked: on,
                      onChange: () => onTogglePicked(endpoint),
                    }),
                    h('span', { className: 'e2e-method' }, endpoint.httpMethod),
                    h('code', { className: 'e2e-endpoint-path' }, endpoint.path),
                    h(
                      'span',
                      { className: 'e2e-muted' },
                      endpoint.requestBody
                        ? `${t('label.endpointBody')} ${endpoint.requestBody.type}`
                        : t('label.endpointNoBody'),
                    ),
                  )
                }),
              )
            : null,
          h(
            'div',
            { className: 'e2e-scan-actions' },
            list.length > 0
              ? h(
                  Btn,
                  { small: true, onClick: onPickAll },
                  allPicked ? t('action.clearSelection') : t('action.selectAll'),
                )
              : null,
            h(
              Btn,
              { small: true, disabled: scan.status === 'scanning', onClick: onRescan },
              scan.status === 'scanning' ? t('action.scanning') : t('action.scan'),
            ),
            h('div', { className: 'e2e-spacer' }),
            h(
              Btn,
              {
                small: true,
                variant: 'primary',
                disabled: importing || picked.size === 0,
                onClick: onImport,
              },
              importing
                ? t('action.importing')
                : t('action.importPicked', { count: picked.size }),
            ),
          ),
        ),
      )
    }

    /* ---------- the settings sheet ---------- */

    /**
     * Where the registry is pointed at things, in one place.
     *
     * The two catalogs a reader needs — the databases dsh-db-mcp can open, and
     * the run configurations the IDE knows — are answers to the same question
     * ("what does this machine have?"), so they are asked on one sheet. Each
     * picker says what it could not reach instead of going silently empty: an
     * IDE that is not running is the usual reason a list has no rows, and that
     * is information, not an empty state.
     *
     * Like the scan dialog, it owns nothing: what it shows and what to do with
     * a pick both arrive from the panel.
     */
    function SettingsDialog(props) {
      const {
        t,
        settings,
        target,
        port,
        database,
        source,
        config,
        allowWrites,
        busy,
        error,
        onClose,
        onTarget,
        onPort,
        onDatabase,
        onSource,
        onConfig,
        onAllowWrites,
        onSave,
      } = props

      const data = settings.data || {}
      const sources = (data.dbSources && data.dbSources.sources) || []
      const ide = data.ide || {}
      const configurations = ide.configurations || []

      const field = (label, control) =>
        h('label', { className: 'e2e-settings-field' }, h('span', { className: 'e2e-settings-label' }, label), control)

      return h(
        'div',
        {
          className: 'e2e-scan-backdrop',
          onClick: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'div',
          { className: 'e2e-scan e2e-settings' },
          h(
            'div',
            { className: 'e2e-scan-head' },
            h('strong', null, t('label.settings')),
            h('div', { className: 'e2e-spacer' }),
            h(Btn, { small: true, onClick: onClose }, t('action.close')),
          ),
          h('div', { className: 'e2e-hint' }, t('label.settingsHint')),
          data.file ? h('code', { className: 'e2e-file' }, data.file) : null,
          data.registryError ? h('div', { className: 'e2e-error' }, data.registryError) : null,
          settings.error ? h('div', { className: 'e2e-error' }, settings.error) : null,
          error ? h('div', { className: 'e2e-error' }, error) : null,
          settings.status === 'loading'
            ? h('div', { className: 'e2e-hint' }, t('state.loading'))
            : null,
          // The database: which entry, and which dsh-db-mcp source it should
          // import. Picking a source is what makes the password live in one
          // place instead of two.
          h(
            'div',
            { className: 'e2e-settings-block' },
            h('div', { className: 'e2e-settings-title' }, t('label.settingsDatabase')),
            (data.databases || []).length === 0
              ? h('div', { className: 'e2e-muted' }, t('empty.noDatabases'))
              : field(
                  t('label.settingsDatabaseEntry'),
                  h(
                    'select',
                    { className: 'e2e-input', value: database, onChange: (event) => onDatabase(event.target.value) },
                    (data.databases || []).map((entry) =>
                      h('option', { key: entry.name, value: entry.name }, entry.name),
                    ),
                  ),
                ),
            field(
              t('label.settingsSource'),
              h(
                'select',
                { className: 'e2e-input', value: source, onChange: (event) => onSource(event.target.value) },
                h('option', { value: '' }, t('label.settingsSourceNone')),
                sources.map((entry) =>
                  h(
                    'option',
                    { key: entry.id, value: entry.id, disabled: !entry.usable },
                    entry.usable
                      ? `${entry.id} — ${entry.kind} ${entry.host || ''}:${entry.port || ''}/${entry.database || ''}`
                      : `${entry.id} — ${entry.kind} (${t('label.settingsNotPostgres')})`,
                  ),
                ),
              ),
            ),
            data.dbSources && data.dbSources.ok === false
              ? h('div', { className: 'e2e-muted' }, data.dbSources.error)
              : null,
          ),
          h(
            'div',
            { className: 'e2e-settings-block' },
            h('div', { className: 'e2e-settings-title' }, t('label.settingsIde')),
            (data.targets || []).length === 0
              ? h('div', { className: 'e2e-muted' }, t('empty.noTargets'))
              : field(
                  t('label.settingsTarget'),
                  h(
                    'select',
                    { className: 'e2e-input', value: target, onChange: (event) => onTarget(event.target.value) },
                    (data.targets || []).map((entry) => h('option', { key: entry.name, value: entry.name }, entry.name)),
                  ),
                ),
            (data.targets || []).length === 0
              ? null
              : field(
                  t('label.settingsPort'),
                  h('input', {
                    className: 'e2e-input e2e-settings-port',
                    inputMode: 'numeric',
                    placeholder: t('field.projectPort'),
                    value: port,
                    onChange: (event) => onPort(event.target.value),
                  }),
                ),
            (data.targets || []).length === 0 ? null : h('div', { className: 'e2e-hint' }, t('label.settingsPortHint')),
            ide.error
              ? h('div', { className: 'e2e-muted' }, ide.error)
              : configurations.length === 0
                ? h('div', { className: 'e2e-muted' }, t('empty.noConfigurations'))
                : field(
                    t('label.settingsConfiguration'),
                    h(
                      'select',
                      { className: 'e2e-input', value: config, onChange: (event) => onConfig(event.target.value) },
                      h('option', { value: '' }, t('label.settingsConfigurationNone')),
                      configurations.map((entry) =>
                        h(
                          'option',
                          { key: entry.name, value: entry.name },
                          entry.description ? `${entry.name} — ${entry.description}` : entry.name,
                        ),
                      ),
                    ),
                  ),
          ),
          // Whether a case's setup/teardown SQL may change rows. It sits here as
          // well as beside the run button because it is a decision about the
          // database, and this is the sheet about the database.
          h(
            'div',
            { className: 'e2e-settings-block' },
            h(
              'label',
              { className: 'e2e-check-row' },
              h('input', {
                type: 'checkbox',
                checked: allowWrites,
                onChange: (event) => onAllowWrites(event.target.checked),
              }),
              h('span', null, t('label.allowWrites')),
            ),
            h('div', { className: 'e2e-hint' }, t('label.allowWritesHint')),
          ),
          h(
            'div',
            { className: 'e2e-scan-actions' },
            h('div', { className: 'e2e-spacer' }),
            h(Btn, { small: true, onClick: onClose }, t('action.cancel')),
            h(
              Btn,
              { small: true, variant: 'primary', disabled: busy, onClick: onSave },
              busy ? t('action.saving') : t('action.save'),
            ),
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
      const [creating, setCreating] = React.useState(null) // 'project' on the landing page, a draft file name inside one
      // The create-project form's draft. Reset whenever the form closes. The
      // path names the project — the folder's name is the project's name — and
      // the port is read from the project's own configuration the moment a
      // folder is chosen. It stays empty when that configuration names none,
      // and then it is the reader's to type.
      const [projectDraft, setProjectDraft] = React.useState({ projectPath: '', port: '' })
      // True while the system folder dialog is open, so a second click on the
      // path cannot stack a second dialog on top of the first.
      const [pickingFolder, setPickingFolder] = React.useState(false)
      // True while the scan dialog is open. Reading the project's endpoints is a
      // dialog rather than a panel because it is a question about the whole
      // project ("what does this service serve?") and the answer is a list you
      // tick — that belongs on top of the case list, not inside a form.
      const [scanning, setScanning] = React.useState(false)
      // The scan's own state lives here rather than inside the dialog: the
      // dialog is a view of the answer, and the answer outlives a re-render that
      // a nested component's state would not cause. Re-opening the dialog is a
      // fresh scan, so `openScan` starts one every time.
      const [scanState, setScanState] = React.useState({ status: 'idle', data: null, error: null })
      // Which scanned endpoints are ticked, keyed the same way the dialog keys its
      // rows. A re-scan drops the ticks: they were answers to the previous list.
      const [scanPicked, setScanPicked] = React.useState(() => new Set())
      const [scanImporting, setScanImporting] = React.useState(false)
      const [scanImportError, setScanImportError] = React.useState(null)
      // The settings sheet: which database a case may name, what the IDE calls the
      // run configuration, and whether SQL writes are allowed. One sheet, because
      // those three answers all describe the machine the cases run on.
      const [settingsOpen, setSettingsOpen] = React.useState(false)
      const [settingsState, setSettingsState] = React.useState({ status: 'idle', data: null, error: null })
      const [settingsBusy, setSettingsBusy] = React.useState(false)
      const [settingsTarget, setSettingsTarget] = React.useState('')
      // The port the chosen target's service listens on. It arrives from the
      // registry (which got it from the project's yaml, or from the reader on
      // the create form) and it is editable here because a project can move
      // before anyone re-creates it.
      const [settingsPort, setSettingsPort] = React.useState('')
      const [settingsDatabase, setSettingsDatabase] = React.useState('')
      const [settingsSource, setSettingsSource] = React.useState('')
      const [settingsConfig, setSettingsConfig] = React.useState('')
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
      // The whole project read as one plan. It is fetched when the page opens
      // rather than with every refresh: a plan is a question the reader asks on
      // purpose, and the case list is the page they leave open.
      const [planState, setPlanState] = React.useState({ status: 'idle', data: null, error: null })
      const [planBusy, setPlanBusy] = React.useState(false)
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
      // The checkboxes in the case matrix. Keys are case files, so a refresh that
      // brings new cases simply leaves the unknown ones unchecked — selection is
      // a statement about files the reader saw, not about the project.
      const [checked, setChecked] = React.useState({})
      const toggleChecked = (file) => setChecked((state) => ({ ...state, [file]: !state[file] }))
      const clearChecked = () => setChecked({})

      const refresh = React.useCallback(async () => {
        setBoot((current) => ({ ...current, status: current.data ? current.status : 'loading' }))
        try {
          // Both in parallel: the table and the case list are the same page load,
          // and a second round trip would only make the slower one visible.
          const [data, projectData] = await Promise.all([apiGet('/bootstrap'), apiGet('/projects')])
          // The write switch is a durable panel preference, not page state. The
          // Host answers it in bootstrap — restoring here means a reload, an HMR
          // swap, or a return from the case detail cannot silently turn writes
          // back off.
          if (data && typeof data.allowWrites === 'boolean') setAllowWrites(data.allowWrites)
          setBoot({ status: 'ready', data, projects: projectData, error: null })
        } catch (error) {
          setBoot({ status: 'error', data: null, projects: null, error: error.message })
        }
      }, [])

      React.useEffect(() => {
        refresh()
      }, [refresh])

      // Flipping the write switch takes effect at once — the run buttons read
      // this same state — and is written straight to the Host. The next reload
      // then restores it from bootstrap, so the switch can never quietly revert.
      const changeAllowWrites = async (next) => {
        setAllowWrites(Boolean(next))
        try {
          await apiPost('/settings', { allowWrites: Boolean(next) })
        } catch (error) {
          setNotice({ message: error.message })
        }
      }

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

      // The case list has its own selection — a case is a file someone wrote,
      // and deleting several at once needs the same two-press guard as a single
      // file. The confirm lives here so it survives a re-render of the table.
      const [confirmDeleteChecked, setConfirmDeleteChecked] = React.useState(false)
      React.useEffect(() => {
        if (!confirmDeleteChecked) return undefined
        const timer = setTimeout(() => setConfirmDeleteChecked(false), 4000)
        return () => clearTimeout(timer)
      }, [confirmDeleteChecked])
      const armDeleteChecked = () => {
        if (!selectedFiles.length || busy !== null) return
        if (confirmDeleteChecked) {
          setConfirmDeleteChecked(false)
          removeChecked()
        } else setConfirmDeleteChecked(true)
      }
      const removeChecked = async () => {
        const files = selectedFiles
        if (!files.length) return
        setBusy('delete-cases')
        const errors = []
        let done = 0
        for (const file of files) {
          try {
            await apiDelete(`/case?file=${q(file)}`)
            done += 1
          } catch (error) {
            errors.push(`${file}: ${error.message}`)
          }
        }
        setBusy(null)
        setConfirmDeleteChecked(false)
        if (errors.length === 0) setNotice({ message: t('notice.casesDeleted', { count: done }) })
        else setNotice({ isError: true, message: t('notice.casesPartlyDeleted', { done, failed: errors.length, errors: errors.join('; ') }) })
        clearChecked()
        await refresh()
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
       * Opens the scan dialog and starts the scan.
       *
       * The dialog asks the project one question, and the answer is a list. It runs
       * here rather than inside the dialog so that the answer is the panel's, not a
       * component's: closing mid-scan and re-opening asks again from scratch, which
       * is what a reader pressing "open" expects.
       */
      const openScan = async () => {
        setScanning(true)
        setScanState({ status: 'scanning', data: null, error: null })
        setScanPicked(() => new Set())
        setScanImportError(null)
        try {
          // The project that is open, not whatever target the Host would pick on
          // its own: the dialog is opened from a project's toolbar, and a scan of
          // a different checkout lists endpoints the reader never asked about.
          const data = await apiPost('/scan', scanScope(project))
          setScanState({ status: 'ready', data, error: null })
        } catch (error) {
          setScanState({ status: 'error', data: null, error: error.message })
        }
      }

      const openPlan = async () => {
        setView('testplan')
        setPlanState({ status: 'loading', data: planState.data, error: null })
        try {
          const data = await apiGet(`/plan?project=${q(project.key)}`)
          setPlanState({ status: 'ready', data, error: null })
        } catch (error) {
          setPlanState({ status: 'error', data: null, error: error.message })
        }
      }

      /**
       * The plan's save: the form sends the document, the YAML view sends the
       * text. Either way the Host re-derives the plan and answers with it, so
       * whatever the page shows next is what the files now say — not what the
       * page hoped they would say.
       */
      const savePlanDocument = async (document, yaml) => {
        setPlanBusy(true)
        try {
          const body = { project: project.key }
          if (typeof yaml === 'string') body.yaml = yaml
          else body.document = document
          const data = await apiPost('/plan', body)
          setPlanState({ status: 'ready', data: data.plan, error: null })
          setNotice({ message: t('plan.saved', { count: data.changed }) })
          await refresh()
        } catch (error) {
          setNotice({ isError: true, message: error.message })
          setPlanState((current) => ({ ...current, error: error.message }))
        } finally {
          setPlanBusy(false)
        }
      }

      const toggleScanPick = (endpoint) =>
        setScanPicked((current) => {
          const next = new Set(current)
          const key = scanKey(endpoint)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })

      const pickAllScanRows = () =>
        setScanPicked((current) => {
          const list = (scanState.data && scanState.data.endpoints) || []
          const keys = list.map((endpoint) => scanKey(endpoint))
          return current.size === keys.length ? new Set() : new Set(keys)
        })

      /**
       * The scan dialog's write half: the ticked endpoints become case files.
       *
       * The Host does the writing and reports what it skipped — a file that is
       * already there is never overwritten — so the notice counts both sides.
       * The first case written opens in the editor: the whole point of importing
       * a skeleton is to fill in its TODOs, and that is where they are.
       */
      const importedEndpoints = async (result) => {
        const written = (result && result.written) || []
        const skipped = (result && result.skipped) || []
        setScanning(false)
        setNotice(
          skipped.length === 0
            ? { message: t('notice.imported', { count: written.length }) }
            : {
                isError: false,
                message: t('notice.importedPartly', {
                  count: written.length,
                  skipped: skipped.length,
                }),
              },
        )
        await refresh()
        if (written.length > 0) {
          await openCase(written[0].file)
          setPlanMode('yaml')
          setView('plan')
        }
      }

      /** Ticking rows is a request; importing them is one POST for the whole batch. */
      const importPickedScan = async () => {
        const list = (scanState.data && scanState.data.endpoints) || []
        // Each pick carries the endpoint's own source coordinates. A route alone
        // is ambiguous — two controllers can both declare `GET /` — and the Host
        // needs the difference to write both cases instead of one plus a
        // "already there".
        const endpoints = list
          .filter((endpoint) => scanPicked.has(scanKey(endpoint)))
          .map((endpoint) => ({
            method: endpoint.httpMethod,
            path: endpoint.path,
            controller: endpoint.controller,
            javaMethod: endpoint.javaMethod,
            file: endpoint.file,
            line: endpoint.line,
          }))
        if (endpoints.length === 0) return
        const database = (registry.databases || []).length === 1 ? registry.databases[0].name : undefined
        setScanImporting(true)
        setScanImportError(null)
        try {
          const result = await apiPost('/import-endpoints', { endpoints, database, ...scanScope(project) })
          await importedEndpoints(result)
        } catch (error) {
          setScanImportError(error.message)
        } finally {
          setScanImporting(false)
        }
      }

      /**
       * Opens the settings sheet and asks the Host what it currently holds.
       *
       * The IDE is asked about the open project, because a run configuration
       * belongs to a checkout: a list for some other project names configurations
       * that this one does not have.
       */
      const openSettings = async () => {
        setSettingsOpen(true)
        setSettingsState({ status: 'loading', data: null, error: null })
        try {
          const query = project && project.projectPath ? `?projectPath=${q(project.projectPath)}` : ''
          const data = await apiGet(`/settings${query}`)
          // The sheet and the run buttons must agree on the same durable answer.
          // Settings is a second source for it (bootstrap is the first), so a
          // reader who opens the sheet sees the value that was restored at load.
          if (data && typeof data.allowWrites === 'boolean') setAllowWrites(data.allowWrites)
          const targets = data.targets || []
          const databases = data.databases || []
          // The sheet opens on the project the reader is standing in. A
          // registry can describe several, and editing the first one's run
          // configuration while looking at the second would be a quiet lie.
          const wanted = project && Array.isArray(project.targets) && project.targets.length > 0 ? project.targets[0] : ''
          const firstTarget = targets.find((entry) => entry.name === wanted) || (targets.length > 0 ? targets[0] : null)
          setSettingsTarget(firstTarget ? firstTarget.name : '')
          setSettingsConfig(firstTarget && firstTarget.configurationName ? firstTarget.configurationName : '')
          // An empty port is a real answer here: the project's yaml named none
          // and the reader has not typed one yet, so the field is empty rather
          // than showing 8080 or the port of some other project.
          setSettingsPort(firstTarget && firstTarget.port ? String(firstTarget.port) : '')
          setSettingsDatabase(databases.length > 0 ? databases[0].name : '')
          const firstDatabase = databases.length > 0 ? databases[0] : null
          setSettingsSource(firstDatabase && firstDatabase.from === 'db-mcp' ? firstDatabase.id : '')
          setSettingsState({ status: 'ready', data, error: null })
        } catch (error) {
          setSettingsState({ status: 'error', data: null, error: error.message })
        }
      }

      const pickSettingsTarget = (name) => {
        setSettingsTarget(name)
        const targets = (settingsState.data && settingsState.data.targets) || []
        const found = targets.find((entry) => entry.name === name)
        setSettingsConfig(found && found.configurationName ? found.configurationName : '')
        setSettingsPort(found && found.port ? String(found.port) : '')
      }

      const pickSettingsDatabase = (name) => {
        setSettingsDatabase(name)
        const databases = (settingsState.data && settingsState.data.databases) || []
        const found = databases.find((entry) => entry.name === name)
        setSettingsSource(found && found.from === 'db-mcp' ? found.id : '')
      }

      /**
       * Turns a target's current address plus the typed port into the address
       * the sheet should write.
       *
       * Only the port is editable, so the scheme and host are kept: changing
       * them is a different decision than "the service moved to this port", and
       * a sheet that silently rewrote them would be doing more than it said.
       * With no address at all, the default local shape is the only honest
       * guess — this tool tests a service on this machine.
       */
      const addressWithPort = (entry, typed) => {
        const port = String(typed || '').trim()
        if (port === '') return ''
        const current = entry && entry.baseUrl ? String(entry.baseUrl) : ''
        try {
          const parsed = new URL(current)
          parsed.port = port
          return parsed.href.replace(/\/$/, '')
        } catch {
          return `http://127.0.0.1:${port}`
        }
      }

      /**
       * Writes what the sheet changed and re-reads it.
       *
       * Three kinds of edit go out together: the target's address (its port),
       * the target's IDE run configuration, and the database's dsh-db-mcp
       * source. The answer carries the fresh settings, so the sheet stays open
       * showing what the registry now says instead of a stale copy of what was
       * just typed.
       */
      const saveSettingsSheet = async () => {
        setSettingsBusy(true)
        try {
          const payload = { projectPath: project && project.projectPath ? project.projectPath : '', allowWrites }
          if (settingsTarget) {
            const targets = (settingsState.data && settingsState.data.targets) || []
            const current = targets.find((entry) => entry.name === settingsTarget) || null
            const address = addressWithPort(current, settingsPort)
            const target = { name: settingsTarget, configurationName: settingsConfig }
            // Only send the address when the reader actually set a port: an
            // empty field means "the yaml named none and nobody typed one",
            // which must not overwrite the address already in the registry.
            if (address !== '') target.baseUrl = address
            payload.target = target
          }
          if (settingsDatabase) {
            payload.database = settingsSource
              ? { name: settingsDatabase, from: 'db-mcp', id: settingsSource }
              : { name: settingsDatabase, from: '' }
          }
          const result = await apiPost('/settings', payload)
          // The sheet closes on success: it exists to answer a question, and the
          // answer is now in the registry. The notice says so, and the page below
          // is already showing the new state.
          setSettingsOpen(false)
          setSettingsState({ status: 'ready', data: result.settings, error: null })
          setNotice({ message: t('notice.settingsSaved') })
          await refresh()
        } catch (error) {
          setSettingsState((current) => ({ ...current, error: error.message }))
        } finally {
          setSettingsBusy(false)
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

      /**
       * Opens the system folder dialog and writes what it returned into the
       * form. Cancel (null) leaves the field exactly as it was — a dismissed
       * dialog is not a mistake to report.
       *
       * The bridge is only there in the Desktop window. In a plain browser tab
       * the message says so once, rather than a button that silently does
       * nothing; the field still takes a typed path.
       */
      const browseFolder = async () => {
        const picker = systemPicker()
        if (!picker) {
          setNotice({ isError: true, message: t('notice.pickerUnavailable') })
          return
        }
        if (pickingFolder) return
        setPickingFolder(true)
        try {
          const chosen = await picker.pick()
          if (typeof chosen === 'string' && chosen.trim() !== '') {
            setProjectDraft((draft) => ({ ...draft, projectPath: chosen }))
            await readPort(chosen)
          }
        } catch (error) {
          setNotice({ isError: true, message: String((error && error.message) || error) })
        } finally {
          setPickingFolder(false)
        }
      }

      /**
       * Reads the port the project declares, and leaves the field empty when it
       * declares none.
       *
       * The field is not filled with a default: Spring's 8080 belongs to a
       * framework, not to this checkout, and a project born on an assumed port
       * fails every case with a connection error that says nothing about the
       * project. An answer of `port: null` is the normal answer here — it means
       * "type the number", which the Host then insists on.
       */
      const readPort = async (projectPath) => {
        const trimmed = String(projectPath || '').trim()
        if (trimmed === '') return
        try {
          const config = await apiGet(`/project-config?projectPath=${q(trimmed)}`)
          setProjectDraft((draft) => ({
            ...draft,
            port: config && config.port ? String(config.port) : '',
          }))
        } catch {
          // A folder that cannot be read yet is not an error to shout about:
          // the reader may still be typing the path, and create is what reports
          // it properly.
        }
      }

      // Creating a project writes the registry and makes a case directory on the
      // Host; the panel then refreshes so the new card is on the table. The write
      // side names the target after the folder, and echoes that name back — it is
      // the name cases write in `env.target`, so the notice shows it.
      const createProject = async () => {
        setBusy('create')
        try {
          const result = await apiPost('/project', projectDraft)
          setNotice({ message: t('notice.projectCreated', { name: result.name, baseUrl: result.baseUrl, dir: result.caseDir }) })
          setCreating(null)
          setProjectDraft({ projectPath: '', port: '' })
          await refresh()
        } catch (error) {
          setNotice({ isError: true, message: error.message })
        } finally {
          setBusy(null)
        }
      }

      // Edit mode turns the landing page into a picker: cards select instead of
      // open, and the header offers one delete for everything picked. The
      // checkboxes are the confirmation — a card that was explicitly ticked does
      // not need a second "are you sure" on top — but the exit is always one
      // click away, and leaving edit mode drops the selection.
      const [editingProjects, setEditingProjects] = React.useState(false)
      const [pickedProjects, setPickedProjects] = React.useState(() => new Set())
      const togglePicked = (key) =>
        setPickedProjects((current) => {
          const next = new Set(current)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      const leaveEditMode = () => {
        setEditingProjects(false)
        setPickedProjects(new Set())
      }
      const deletePicked = async () => {
        // The registry knows targets, not display names: a card called "Record"
        // may stand for one target or several, so every registry name behind
        // each picked card is deleted in turn, and the card disappears when its
        // last target goes. A card can also stand for nothing but a directory —
        // cases that name no target, keyed `dir:` — and that is the shape that
        // used to make this button do visibly nothing at all: it collected zero
        // names and returned before it had sent a request.
        const picks = []
        for (const project of projects.filter((item) => pickedProjects.has(item.key))) {
          const targets = project.targets || []
          if (targets.length === 0) picks.push({ kind: 'directory', name: project.key })
          else for (const name of targets) picks.push({ name })
        }
        if (picks.length === 0) {
          setNotice({ isError: true, message: t('notice.nothingToDelete') })
          return
        }
        setBusy('delete-picked')
        const errors = []
        let done = 0
        for (const pick of picks) {
          try {
            const query =
              pick.kind === 'directory'
                ? `kind=directory&name=${q(pick.name)}`
                : `name=${q(pick.name)}`
            await apiDelete(`/project?${query}`)
            done += 1
          } catch (error) {
            errors.push(`${pick.name}: ${error.message}`)
          }
        }
        setBusy(null)
        if (errors.length === 0) setNotice({ message: t('notice.projectsDeleted', { count: done }) })
        else setNotice({ isError: true, message: t('notice.projectsPartlyDeleted', { done, failed: errors.length, errors: errors.join('; ') }) })
        leaveEditMode()
        await refresh()
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
      const projectData = boot.projects || { projects: [], creator: null, warnings: [] }
      const projects = projectData.projects || []
      // Re-read the open project from the fresh list on every render. Holding the
      // object captured at click time means a case created or deleted a moment ago
      // stays invisible until the user navigates away and back.
      const project = openProject ? projects.find((item) => item.key === openProject.key) || openProject : null
      // The checkbox selection, expressed as files. A file that disappeared in a
      // refresh is simply not in this list any more — running it would be running
      // something the reader cannot see. It lives up here because the top
      // navigation's "run selected" button needs it too.
      const projectCases = project ? project.cases || [] : []
      const selectedFiles = projectCases.filter((entry) => checked[entry.file]).map((entry) => entry.file)

      // ---- top navigation, after the Stitch design -----------------------
      // One row of identity and actions, then the project line. The three tabs
      // that used to sit under it were not three places: "cases" was the project
      // and the other two were halves of a case you had to open first, so two of
      // the three did nothing until you had picked something they could show. A
      // project is one page; a case is the thing with two halves, and its switch
      // lives on the case (see the breadcrumb below).
      const firstTarget = (registry.targets && registry.targets[0]) || null
      const originLabel = project
        ? project.baseUrl || (firstTarget && firstTarget.baseUrl) || ''
        : (firstTarget && firstTarget.baseUrl) || ''
      // The case the project line is about, if any. The plan editor can be open
      // without a case having a file yet (a generated draft), so the id falls
      // back through definition, then file, then empty — an empty label is not
      // printed, because "project / " tells the reader nothing.
      const caseLabel =
        view === 'cases'
          ? ''
          : (selected && selected.definition && selected.definition.caseId) || (selected && selected.file) || ''
      const caseCount = project ? (project.cases || []).length : projects.reduce((sum, item) => sum + (item.counts ? item.counts.total : 0), 0)
      const header = h(
        'header',
        { className: 'e2e-topnav' },
        h(
          'div',
          { className: 'e2e-topnav-bar' },
          h('span', { className: 'e2e-topnav-logo', 'aria-hidden': 'true' }, '◆'),
          h('strong', { className: 'e2e-topnav-name' }, 'dsh-e2e'),
          h('span', { className: 'e2e-topnav-title' }, t('panel.title')),
          h('div', { className: 'e2e-spacer' }),
          // The way out of a project sits where every other page-level action
          // sits, in the bar at the top, rather than in a breadcrumb a reader has
          // to notice. A project is a place you can be lost in; leaving it should
          // not need hunting. It goes home, and says so: "all projects" named a
          // list that is not on the page, while home is where the reader lands.
          project
            ? h(Btn, { key: 'back', small: true, onClick: () => setOpenProject(null) }, t('action.home'))
            : null,
          h(Btn, { small: true, onClick: refresh }, t('action.refresh')),
          // The settings are the open project's settings: which database entry
          // it names, which IDE run configuration starts it. On the landing page
          // there is no project, so there is nothing for the sheet to point at —
          // an entry point there would open on some other project's answers.
          project ? h(Btn, { small: true, onClick: openSettings }, t('action.settings')) : null,
          !project
            ? h(
                Btn,
                {
                  key: 'edit',
                  small: true,
                  variant: editingProjects ? 'danger' : 'default',
                  onClick: () => (editingProjects ? leaveEditMode() : setEditingProjects(true)),
                },
                editingProjects ? t('action.doneEditing') : t('action.editProjects'),
              )
            : null,
          // Run controls belong to the list, not to a single case: on the
          // detail page "run selected" would run a selection this page cannot
          // see, so the two buttons exist only while the project list is open.
          project && view === 'cases'
            ? [
                h(
                  Btn,
                  {
                    key: 'selected',
                    small: true,
                    disabled: busy === 'run-all' || selectedFiles.length === 0,
                    title: selectedFiles.length === 0 ? t('label.selectCase') : '',
                    onClick: () => runAll(selectedFiles),
                  },
                  t('action.runSelected'),
                ),
                h(
                  Btn,
                  {
                    key: 'regression',
                    small: true,
                    primary: true,
                    disabled: busy === 'run-all' || caseCount === 0,
                    onClick: () => runAll(projectCases.map((entry) => entry.file)),
                  },
                  t('action.runFullRegression'),
                ),
              ]
            : null,
          !project
            ? [
                editingProjects
                  ? h(
                      Btn,
                      {
                        key: 'delete-picked',
                        small: true,
                        variant: 'danger',
                        disabled: busy !== null || pickedProjects.size === 0,
                        onClick: deletePicked,
                      },
                      t('action.deleteSelected', { count: pickedProjects.size }),
                    )
                  : null,
                h(
                  Btn,
                  {
                    key: 'create',
                    small: true,
                    primary: true,
                    onClick: () => setCreating((current) => (current === 'project' ? '' : 'project')),
                  },
                  t('action.createProject'),
                ),
              ]
            : null,
        ),
        // The project line: where in the project you are, the two halves of the
        // open case, and the way to make another one. The project name is the way
        // back to its list. A case adds its id and the Evidence / Test-plan
        // switch — and the switch appears only once a case is open, which is the
        // honest order: there is nothing to show before that.
        project
          ? h(
              'div',
              { className: 'e2e-crumbs' },
              view === 'cases'
                ? h('span', { className: 'e2e-crumb-current' }, project.name)
                : h(
                    'button',
                    { type: 'button', className: 'e2e-crumb', onClick: () => setView('cases') },
                    project.name,
                  ),
              caseLabel
                ? [
                    h('span', { key: 'sep', className: 'e2e-crumb-sep' }, '/'),
                    h('span', { key: 'case', className: 'e2e-crumb-current' }, caseLabel),
                  ]
                : null,
              view !== 'cases' && selected
                ? h(
                    'div',
                    { className: 'e2e-case-switch' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: `e2e-case-switch-btn${view === 'detail' ? ' is-active' : ''}`,
                        onClick: () => setView('detail'),
                      },
                      t('label.caseView.evidence'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: `e2e-case-switch-btn${view === 'plan' ? ' is-active' : ''}`,
                        onClick: () => setView('plan'),
                      },
                      t('label.caseView.plan'),
                    ),
                  )
                : null,
              h('div', { className: 'e2e-spacer' }),
              // The origin is what every case in this project will be sent to,
              // so it belongs next to the action that makes another case — the
              // reader checks where it points while writing one, not in the
              // identity row at the top, where it was only decoration.
              originLabel
                ? h('span', { className: 'e2e-topnav-chip', title: originLabel }, t('label.origin'), ': ', originLabel)
                : null,
              h(
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
              ),
            )
          : null,
        // On the landing page the subtitle line is the create-project form. It
        // occupies the strip the reader just asked to be quieter: the same
        // height, now earning it. No Base URL field: the Host reads it from the
        // project's application.yml, so the path and (when the yaml is silent)
        // the port are the only things to type.
        !project && creating === 'project'
          ? h(
              'div',
              { className: 'e2e-crumbs e2e-project-create' },
              // The path names the project: a project's name is the name of the
              // folder it lives in, and asking for it again would be asking the
              // reader to name the same thing twice.
              h('input', {
                className: 'e2e-input e2e-project-field is-wide',
                placeholder: t('field.projectPath'),
                value: projectDraft.projectPath,
                onClick: browseFolder,
                onChange: (event) => setProjectDraft({ ...projectDraft, projectPath: event.target.value }),
              }),
              // The port is filled in from the project's own configuration as
              // soon as a folder is chosen, and left blank when that file names
              // none — there is no default to fall back on, and a project born
              // on an assumed port fails every case for a reason that has
              // nothing to do with the project.
              h('input', {
                className: 'e2e-input e2e-project-port',
                placeholder: t('field.projectPort'),
                value: projectDraft.port,
                onChange: (event) => setProjectDraft({ ...projectDraft, port: event.target.value }),
              }),
              h(Btn, { small: true, disabled: pickingFolder, onClick: browseFolder }, t('action.browse')),
              h('div', { className: 'e2e-spacer' }),
              h(Btn, { small: true, onClick: () => setCreating('') }, t('action.cancel')),
              h(
                Btn,
                {
                  small: true,
                  primary: true,
                  disabled: busy === 'create' || !projectDraft.projectPath.trim(),
                  onClick: createProject,
                },
                busy === 'create' ? t('action.creating') : t('action.create'),
              ),
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
            checked: keepRunning,
            onChange: (event) => setKeepRunning(event.target.checked),
          }),
          h('span', null, t('label.keepRunning')),
        ),
        // Whether setup/teardown SQL may write is a setting, not a run button:
        // it belongs in the settings sheet next to the database it writes to,
        // and a checkbox in two places is the same decision asked twice. But a
        // run that is allowed to write has to say so where the run is started —
        // otherwise the reader finds out from the report.
        allowWrites ? h('div', { className: 'e2e-hint' }, t('label.allowWritesOn')) : null,
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

      // The run history used to live here as a standing list of every report on
      // disk. It grew into the loudest thing on a page about cases, and the case
      // page already carries each case's own history. What is left is the reader
      // for a report someone asked to see — a run surface or a case rail opens
      // one, and this is where it lands.
      const reportViewer = reportText
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
        : null

      // The two pages inside a project. The case list answers "what is red"; the
      // plan editor answers "what should this test say". They are separate pages
      // because a page that answers both answers neither well — and because the
      // list has to stay scannable while the editor has to stay wide.
      // The case page is the one page that splits: the list gets the room that is
      // left, and the run/database panels keep a fixed place at the bottom. A
      // page-wide scroller here is what let the table's rows paint over them.
      const casesPage = h(
        'div',
        { className: 'e2e-main is-split' },
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
          onScan: openScan,
          onEditPlan: openPlan,
          onRunAll: () => runAll(projectCases.map((entry) => entry.file)),
          running: busy === 'run-all' || Boolean(batch && batch.status === 'running'),
          checked,
          onToggleChecked: toggleChecked,
          onRunSelected: (files) => runAll(files && files.length ? files : selectedFiles),
          onDeleteSelected: armDeleteChecked,
          confirmDeleteSelected: confirmDeleteChecked,
          deleting: busy === 'delete-cases',
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
        reportViewer,
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
          onOpenReport: openReport,
        }),
        run ? h(RunSurface, { t, run, onExplain: explain, explaining: busy === 'explain', onOpenReport: openReport }) : null,
        reportViewer,
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

      // The plan page is the project read as a document rather than as a table:
      // one card per use case, one row per test, and the whole thing as YAML for
      // the edits the form deliberately does not offer.
      const testPlanPage = h(TestPlanPage, {
        t,
        project,
        plan: planState.data,
        loading: planState.status === 'loading',
        error: planState.error,
        busy: planBusy,
        onSave: savePlanDocument,
        onDone: () => setView('cases'),
        // "Add test" from a use case card opens the create form with that group
        // filled in, exactly as the per-case plan editor does.
        onAddTest: (useCase) => {
          setView('cases')
          setAdding(true)
          setPendingGroup((useCase && useCase.useCase) || '')
        },
        onOpenCase: (caseId) => {
          const entry = (project.cases || []).find((row) => String(row.caseId || row.id) === String(caseId))
          if (!entry) return
          openCase(entry.file)
          setView('detail')
        },
      })

      // The settings sheet is reachable from both views: the landing page is where
      // a reader arrives before a project is open, and the sheet is about the
      // machine, not about the project. One element, rendered by both returns.
      const settingsSheet = settingsOpen
        ? h(SettingsDialog, {
            t,
            settings: settingsState,
            target: settingsTarget,
            port: settingsPort,
            database: settingsDatabase,
            source: settingsSource,
            config: settingsConfig,
            allowWrites,
            busy: settingsBusy,
            error: settingsState.error,
            onClose: () => setSettingsOpen(false),
            onTarget: pickSettingsTarget,
            onPort: setSettingsPort,
            onDatabase: pickSettingsDatabase,
            onSource: setSettingsSource,
            onConfig: setSettingsConfig,
            onAllowWrites: changeAllowWrites,
            onSave: saveSettingsSheet,
          })
        : null

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
              editing: editingProjects,
              picked: pickedProjects,
              onPick: togglePicked,
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
          settingsSheet,
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
        view === 'testplan'
          ? testPlanPage
          : view === 'plan'
            ? planPage
            : view === 'detail'
              ? detailPage
              : casesPage,
        // The scan dialog sits above whatever page is showing: it is a question
        // about the project as a whole, and closing it should put the reader back
        // exactly where they were.
        scanning
          ? h(ScanDialog, {
              t,
              scan: scanState,
              picked: scanPicked,
              importing: scanImporting,
              importError: scanImportError,
              onTogglePicked: toggleScanPick,
              onPickAll: pickAllScanRows,
              onImport: importPickedScan,
              onRescan: openScan,
              onClose: () => setScanning(false),
            })
          : null,
        settingsSheet,
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
/* ---- top navigation, after the Stitch design ---------------------------- */
/* One bar of identity + live chips + run actions, then the project line. There
   is no tab strip: the project is one page, and a case carries its own Evidence
   / Test-plan switch in the line below. 1px borders instead of shadows, per the
   design system. */
.e2e-topnav { display: flex; flex-direction: column; gap: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; /* The header keeps its height: a long page below must squeeze the page's own scroll area, not the navigation the reader needs to leave it. */ flex: 0 0 auto; }
.e2e-topnav-bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; }
.e2e-topnav-logo { color: var(--dsw-alias-brand-primary); font-size: 15px; }
.e2e-topnav-name { font-size: 13px; font-weight: 600; letter-spacing: 0.01em; }
.e2e-topnav-title { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.e2e-topnav-chip {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  letter-spacing: 0.02em;
  color: var(--dsw-alias-state-success-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent);
  border-radius: 5px;
  padding: 2px 8px;
  white-space: nowrap;
}
.e2e-case-switch {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 6px;
  padding: 1px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base);
}
.e2e-case-switch-btn {
  appearance: none;
  border: 0;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11.5px;
  padding: 2px 9px;
  border-radius: 5px;
  cursor: pointer;
}
.e2e-case-switch-btn:hover { color: var(--dsw-alias-label-primary); }
.e2e-case-switch-btn.is-active {
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  font-weight: 600;
}
.e2e-crumbs { display: flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 6px 12px 8px; flex: 0 0 auto; }
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

/* The project cards: the landing surface after the Stitch design — headline
   pass rate, a segmented track, and a legend. The card is a button because
   opening a project is its whole job; the delete control therefore cannot be
   one of its children, so each card sits in a positioned cell and the delete
   button floats in its corner. */
.e2e-project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 12px;
}
.e2e-project-cell { position: relative; }
/* Edit mode: the checkbox replaces the hover-only × so a touch or a keyboard
   can pick a card too, and the picked cell says so with the danger tint. */
.e2e-project-pick {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
  width: 16px;
  height: 16px;
  accent-color: var(--dsw-alias-state-error-primary);
  cursor: pointer;
}
.e2e-project-cell.is-picked .e2e-project-card {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);
}
.e2e-project-card {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: border-color 110ms ease, background 110ms ease;
}
.e2e-project-card:hover { border-color: var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-2); }
.e2e-project-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.e2e-project-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.e2e-project-title strong { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e2e-project-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); flex: 0 0 auto; }
.e2e-project-dot.is-pulse { animation: e2e-pulse 1.6s ease-in-out infinite; background: var(--dsw-alias-state-warn-primary); }
@keyframes e2e-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.e2e-project-badge {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
  border-radius: 4px;
  padding: 2px 6px;
  white-space: nowrap;
}
.e2e-project-rate { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
.e2e-project-rate-label { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
.e2e-project-rate-value { font-size: 17px; font-weight: 700; color: var(--dsw-alias-brand-primary); font-variant-numeric: tabular-nums; }
.e2e-project-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
}
.e2e-project-stack span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.e2e-project-stack-target { color: var(--dsw-alias-state-success-primary); }
.e2e-project-track { display: flex; height: 7px; border-radius: 999px; overflow: hidden; background: var(--dsw-alias-bg-base); }
.e2e-project-track-empty { background: var(--dsw-alias-bg-layer-2); }
.e2e-project-seg { min-width: 0; }
.e2e-project-seg.is-pass { background: var(--dsw-alias-state-success-primary); }
.e2e-project-seg.is-fail { background: var(--dsw-alias-state-error-primary); }
.e2e-project-seg.is-blocked { background: var(--dsw-alias-state-warn-primary); }
.e2e-project-seg.is-planned { background: var(--dsw-alias-label-tertiary); }
.e2e-project-legend { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.e2e-project-legend-item { display: inline-flex; align-items: center; gap: 5px; }
.e2e-project-legend-item::before { content: ''; width: 6px; height: 6px; border-radius: 50%; }
.e2e-project-legend-item.is-pass::before { background: var(--dsw-alias-state-success-primary); }
.e2e-project-legend-item.is-fail::before { background: var(--dsw-alias-state-error-primary); }
.e2e-project-legend-item.is-blocked::before { background: var(--dsw-alias-state-warn-primary); }
.e2e-project-legend-item.is-planned::before { background: var(--dsw-alias-label-tertiary); }
.e2e-project-when { color: var(--dsw-alias-label-tertiary); font-size: 11px; }

/* The case list: search + tabs + grouped rows. The rows live in their own
   scroller (.e2e-cases-body) so the panels under the table — run, databases —
   keep their place in the window instead of being pushed out of it. Without a
   bounded, clipping box the rows painted straight over those panels. */
.e2e-cases { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.e2e-cases-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: auto; padding-right: 2px; }
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
  /* The checkbox column is wide because the per-case rows sit one level below
     the group head: their checkboxes are indented into it, so the group-level
     checkbox (outer, at the very left) and the case-level checkboxes are
     visually two layers, not one column of identical boxes. */
  grid-template-columns: 54px 110px minmax(200px, 1.6fr) 110px minmax(160px, 1.2fr) 74px;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  text-align: left;
  min-width: 0;
  box-sizing: border-box;
}
.e2e-cases-head {
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  padding-bottom: 6px;
}
/* The row itself is a div (it contains a checkbox and buttons); the whole
   open area is one button so "read this case" stays one click. A 1px CSS
   dashed border renders as near-invisible dots at this size, so the
   separator is drawn instead: a row of real dashes (8px on, 6px off) in the
   darker border-l2 colour along the bottom edge. */
.e2e-case-row {
  border-bottom: none;
  border-radius: 6px;
  background-image: repeating-linear-gradient(
    to right,
    var(--dsw-alias-border-l2) 0 8px,
    transparent 8px 14px
  );
  background-repeat: no-repeat;
  background-position: bottom left;
  background-size: 100% 1.5px;
}
.e2e-case-row:hover { background-color: var(--dsw-alias-bg-layer-1); }
.e2e-case-open {
  /* The row is a 6-column grid; this button owns columns 2–5 (id, name,
     status, diagnosis). Left in a single 110px cell, its four inner columns
     were crammed into one header's width and the status/diagnosis cells read
     as empty. Spanning the tracks and repeating their widths aligns every
     cell under its own header. */
  grid-column: 2 / 6;
  display: grid;
  grid-template-columns: minmax(0, 110px) minmax(200px, 1.6fr) minmax(0, 110px) minmax(160px, 1.2fr);
  align-items: center;
  gap: 10px;
  appearance: none;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  padding: 0;
  min-width: 0;
  box-sizing: border-box;
}
.e2e-case-open > span { min-width: 0; }
.e2e-case-check { width: 14px; height: 14px; cursor: pointer; accent-color: var(--dsw-alias-brand-primary); }
/* The case rows sit one level below their group head, so their checkboxes are
   indented — roughly two tab stops — instead of lining up with the group-level
   checkbox at the outer edge. The indent is inside the row's first grid column,
   which is wide enough (54px) to take 28px of margin plus the 14px box. */
.e2e-case-row .e2e-case-check { margin-left: 28px; }
.e2e-case-id { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.e2e-case-id.is-failed { color: var(--dsw-alias-state-error-primary); }
.e2e-case-id.is-planned { color: var(--dsw-alias-label-tertiary); font-weight: 500; }
.e2e-col-diagnostic {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.e2e-col-diagnostic.is-pass { color: var(--dsw-alias-label-secondary); }
.e2e-col-diagnostic.is-warn { color: var(--dsw-alias-state-warn-primary); }
.e2e-col-actions { display: flex; align-items: center; justify-content: flex-end; gap: 2px; }
.e2e-icon-btn {
  appearance: none;
  border: 0;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.e2e-icon-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.e2e-group-balance { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; flex: 0 0 auto; white-space: nowrap; }
.e2e-group-balance-pass { color: var(--dsw-alias-state-success-primary); }
.e2e-group-balance-fail { color: var(--dsw-alias-state-error-primary); }
.e2e-group-balance-error { color: var(--dsw-alias-state-warn-primary); }
.e2e-group-fold { cursor: pointer; }
/* The selection footer sits under the scroller. It used to be position:sticky,
   but inside the split flex column that never pinned it to the viewport — it
   just floated between the list and the run panel with a heavy border. Runs
   live in the top bar now, so this is a quiet one-line count + delete. */
.e2e-serial-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: none;
}
.e2e-serial-count { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.e2e-run-one:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-brand-primary); }
.e2e-col-id { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
/* The title column is the widest, so left-aligned text ends up glued to the
   id column with the rest of the cell empty. Centering the cell places the
   title in the middle of the row — between the id and the latest status. */
.e2e-col-name { display: flex; flex-direction: column; align-items: center; text-align: center; min-width: 0; }
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
  min-width: 0;
  box-sizing: border-box;
  font-family: inherit;
  cursor: pointer;
}
.e2e-plan-group-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e2e-endpoint-tag { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button.e2e-plan-group-head:hover { background: var(--dsw-alias-bg-layer-2); }
/* The group head (fold row) is a section break above its case rows, so it gets
   a solid rule; the case rows below it are siblings, so they get a quieter
   dashed rule. Solid vs dashed makes the group boundary read first. */
.e2e-cases-body .e2e-plan-group-head { border-bottom: 1.5px solid var(--dsw-alias-border-l2); margin-bottom: 2px; }
.e2e-chevron {
  width: 24px;
  flex: 0 0 24px;
  color: var(--dsw-alias-label-secondary);
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.e2e-chevron:hover { color: var(--dsw-alias-label-primary); }
.e2e-plan-group-name { font-weight: 600; color: var(--dsw-alias-label-primary); }

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
/* ---- the test plan page ------------------------------------------------
   The project as one document: a use case card per group, one row per test
   carrying the three things the plan is about (id, priority, name), and the
   same document as YAML in the other mode. It is a reading page, so it takes
   the whole width and scrolls itself rather than sharing a split. */
.e2e-testplan { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
.e2e-testplan-head { display: flex; flex-direction: column; gap: 4px; flex: 0 0 auto; }
.e2e-testplan-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.e2e-testplan-title { margin: 0; font-size: 17px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.e2e-testplan-info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  line-height: 1;
  cursor: help;
}
.e2e-testplan-subtitle { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.e2e-testplan-total {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.e2e-testplan-body { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 2px; }
.e2e-testplan-search { flex: 0 0 auto; max-width: 280px; }
.e2e-testplan-group { width: 100%; appearance: none; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; text-align: left; }
.e2e-testplan-row {
  display: grid;
  grid-template-columns: minmax(0, 96px) minmax(0, 96px) minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 5px 7px;
  border-radius: 6px;
}
.e2e-testplan-row:hover { background: var(--dsw-alias-bg-layer-2); }
.e2e-testplan-priority { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.e2e-testplan-priority.is-high { color: var(--dsw-alias-label-primary); }
.e2e-testplan-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid var(--dsw-alias-label-tertiary);
  background: transparent;
  flex: 0 0 8px;
}
.e2e-testplan-priority.is-high .e2e-testplan-dot { background: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-primary); }
.e2e-testplan-priority.is-medium .e2e-testplan-dot {
  background: linear-gradient(90deg, var(--dsw-alias-label-secondary) 0%, var(--dsw-alias-label-secondary) 50%, transparent 50%);
}
.e2e-testplan-priority.is-low .e2e-testplan-dot { background: transparent; }
.e2e-testplan-name {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-weight: 600;
  font-size: 12.5px;
  text-align: left;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
  padding: 0;
}
.e2e-testplan-name:hover { text-decoration: underline; }
.e2e-testplan-edit { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 110px) minmax(0, 1.4fr) auto; gap: 6px; align-items: center; padding: 5px 7px; }
/* The YAML view: a gutter of numbers that scrolls with the text, because the
   one thing a text editor must not do is disagree with itself about lines. */
.e2e-yaml-wrap {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  overflow: auto;
  background: var(--dsw-alias-bg-layer-1);
}
.e2e-yaml-gutter {
  flex: 0 0 auto;
  padding: 10px 6px 10px 10px;
  text-align: right;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-tertiary);
  user-select: none;
  border-right: 1px solid var(--dsw-alias-border-l1);
}
.e2e-yaml-editor {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 100%;
  border: 0;
  outline: none;
  resize: none;
  padding: 10px 12px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  line-height: 1.55;
  tab-size: 2;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
}
/* ---- the case detail page ----------------------------------------------
   Layout is a verdict card, a tab strip, then a two-column inspection area:
   the tab you asked about on the left, the wire and the log tail on the
   right. The rail stays put while tabs change, because "what did the
   service answer" is the question you keep asking under every tab.
   Depth is a 1px border, never a shadow: a shadow on a dark surface reads
   as a smudge, and two nested cards are indistinguishable. */
.e2e-detail { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow: auto; }
.e2e-detail-pane { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; }

/* The verdict card. Reading order is verdict, identity, title, evidence
   counts — the same order in which a person decides whether to keep
   reading. */
.e2e-hero {
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* The card keeps its height: it is the page's verdict, and a card squeezed to
     two lines because the panel below wanted the room is unreadable. */
  flex: 0 0 auto;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--dsw-alias-bg-layer-1);
}
.e2e-hero-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.e2e-hero-id { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.e2e-hero-deterministic {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--dsw-alias-state-success-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);
  border-radius: 4px;
  padding: 2px 6px;
}
.e2e-hero-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; color: var(--dsw-alias-label-secondary); }
.e2e-hero-count { color: var(--dsw-alias-label-primary); font-weight: 700; }
.e2e-hero-count.is-pass { color: var(--dsw-alias-state-success-primary); }
.e2e-hero-meta-item.is-fail { color: var(--dsw-alias-state-error-primary); }
.e2e-hero-meta-item.is-pass { color: var(--dsw-alias-state-success-primary); }
/* The AI strip: an opinion, fenced off so it can never be mistaken for the verdict. */
.e2e-ai {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  border: 1px solid var(--dsw-alias-border-l1);
  border-left: 2px solid var(--dsw-alias-brand-primary);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  padding: 8px 12px;
  font-size: 12px;
}
.e2e-ai-icon { color: var(--dsw-alias-brand-primary); }
.e2e-ai-title { color: var(--dsw-alias-brand-primary); font-weight: 600; }
.e2e-ai-disclaimer { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
/* The action bar above the verdict: run / edit / export / history. */
.e2e-detail-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.e2e-detail-crumbs { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); min-width: 0; }
.e2e-detail-crumb.is-ref { color: var(--dsw-alias-brand-primary); font-weight: 600; font-family: var(--dsw-font-mono, ui-monospace, monospace); }
.e2e-detail-env { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 10.5px; color: var(--dsw-alias-label-tertiary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; padding: 1px 6px; }
.e2e-verdict-badge {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid currentColor;
  background: color-mix(in srgb, currentColor 12%, transparent);
}
.e2e-hero-ref,
.e2e-hero-run {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
}
.e2e-hero-ref { color: var(--dsw-alias-label-primary); }
.e2e-hero-main { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.e2e-hero-text { flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.e2e-detail-kicker { font-size: 11.5px; color: var(--dsw-alias-label-secondary); letter-spacing: 0.02em; }
.e2e-hero-title { margin: 0; font-size: 17px; font-weight: 600; color: var(--dsw-alias-label-primary); line-height: 1.35; }
.e2e-hero-desc {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  max-width: 68ch;
}

/* Specs and metrics: the two places a value has to line up between rows to be
   comparable, so both are grids with a fixed key column. */
.e2e-specs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.e2e-spec {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
  max-width: 100%;
}
.e2e-spec-key { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--dsw-alias-label-tertiary); }
.e2e-spec-value {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 34ch;
}
.e2e-metrics { display: flex; gap: 10px; flex: 0 0 auto; flex-wrap: wrap; }
.e2e-metric {
  min-width: 116px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
}
.e2e-metric-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--dsw-alias-label-tertiary); }
.e2e-metric-value {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  color: var(--dsw-alias-label-primary);
}
.e2e-metric-note { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 22ch; }

/* Tabs are 36px tall with a 2px underline on the active one: the underline is
   the whole affordance, so it has to be visible against a dark surface. */
.e2e-tabstrip {
  display: flex;
  align-items: stretch;
  gap: 2px;
  /* Height is the tab's, not the flex container's: without this the strip was
     squeezed to nine pixels between the hero and the inspect pane, and the
     labels were sliced in half. */
  flex: 0 0 auto;
  min-height: 34px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  overflow-x: auto;
  scrollbar-width: thin;
}
.e2e-tabstrip .e2e-mode-btn {
  height: 34px;
  padding: 0 11px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.e2e-tabstrip .e2e-mode-btn:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.e2e-tabstrip .e2e-mode-btn.is-active {
  color: var(--dsw-alias-brand-primary);
  border-bottom-color: var(--dsw-alias-brand-primary);
}

/* Two columns: whatever the tab shows, and the wire it is about. */
.e2e-inspect { display: flex; gap: 12px; align-items: flex-start; min-height: 0; flex: 1 1 auto; }
.e2e-inspect-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.e2e-rail {
  flex: 0 0 320px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.e2e-rail-section {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1);
}
.e2e-rail-head {
  padding: 7px 11px;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--dsw-alias-label-tertiary);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
}
.e2e-rail-body { padding: 9px 11px; display: flex; flex-direction: column; gap: 7px; min-width: 0; }

/* Key/value rows: the key column is fixed so values line up between rows,
   which is the only reason to put them in rows at all. */
.e2e-kv { display: flex; flex-direction: column; gap: 3px; }
.e2e-kv-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11.5px;
  min-width: 0;
}
.e2e-rail-body > .e2e-kv-row { display: flex; }
.e2e-kv-key {
  flex: 0 0 82px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.e2e-kv-value {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The wire: method badge, URL, headers, then the two bodies. */
.e2e-wire { display: flex; flex-direction: column; gap: 10px; }
.e2e-wire-part { display: flex; flex-direction: column; gap: 5px; }
.e2e-wire-line { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; min-width: 0; }
.e2e-wire-caption {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--dsw-alias-label-tertiary);
}
.e2e-method-badge {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--dsw-alias-brand-primary);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
.e2e-url {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.e2e-status-badge {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

/* The log tail: mono, 26px rows, level-coloured. Colour is the only way a
   reader finds the ERROR line in fourteen lines of noise. */
.e2e-logtail {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-alias-bg-base);
  overflow: hidden;
}
.e2e-logline {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 1.65;
  padding: 1px 8px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.e2e-logline.is-warn { color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); }
.e2e-logline.is-error,
.e2e-logline.is-fatal { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
.e2e-logline.is-debug { color: var(--dsw-alias-label-tertiary); }

/* Evidence files: one button per artefact, name on the left, what it is on
   the right. Disabled when there is nothing to open — a link that does
   nothing is worse than a line that says so. */
.e2e-links { display: flex; flex-direction: column; gap: 3px; }
.e2e-link {
  appearance: none;
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  font: inherit;
  font-size: 11.5px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  min-width: 0;
}
.e2e-link:not(:disabled):hover { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l1); }
.e2e-link:disabled { cursor: default; opacity: 0.75; }
.e2e-link-label { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; }
.e2e-link-value {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* A failed checkpoint gets a tinted row: on a page of greens, the one red line
   has to find the reader, not the other way round. */
.e2e-checks { display: flex; flex-direction: column; gap: 2px; }
.e2e-check { display: flex; gap: 8px; align-items: flex-start; padding: 5px 8px; border-radius: 6px; }
.e2e-check.is-failed { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent); }
.e2e-check-mark { width: 13px; flex: 0 0 13px; font-weight: 700; }
.e2e-check-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.e2e-check-label { font-size: 12.5px; color: var(--dsw-alias-label-primary); }
.e2e-check-diff {
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  word-break: break-word;
}
.e2e-check-detail { font-size: 11.5px; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-word; }
.e2e-check-word {
  flex: 0 0 auto;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding-top: 1px;
}

.e2e-stack { display: flex; flex-direction: column; gap: 10px; }
.e2e-db-diff {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  padding: 10px;
  background: var(--dsw-alias-bg-layer-1);
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
/* The case page: nothing here scrolls as a whole. The table owns the scroll and
   the panels below it are pinned, so the window never hides the run controls. */
.e2e-main.is-split { overflow: hidden; }
.e2e-main.is-split > .e2e-section,
.e2e-main.is-split > .e2e-batch,
.e2e-main.is-split > .e2e-warning,
.e2e-main.is-split > .e2e-report-view { flex: 0 0 auto; }
.e2e-main.is-split > .e2e-add { flex: 0 0 auto; max-height: 40%; overflow: auto; }
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
.e2e-scan-backdrop { position: fixed; inset: 0; z-index: 40; background: color-mix(in srgb, var(--dsw-alias-bg-base) 72%, transparent); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; padding: 24px; }
.e2e-scan { width: min(720px, 100%); max-height: min(78vh, 720px); overflow: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 18px 48px color-mix(in srgb, var(--dsw-alias-bg-base) 70%, transparent); padding: 14px; display: flex; flex-direction: column; gap: 9px; }
.e2e-scan-head { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.e2e-scan-list { display: flex; flex-direction: column; gap: 3px; max-height: 320px; overflow: auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 4px; background: var(--dsw-alias-bg-base); }
.e2e-scan-row { display: flex; align-items: center; gap: 8px; border: 1px solid transparent; border-radius: 6px; padding: 5px 7px; cursor: pointer; font-size: 12px; }
.e2e-scan-row:hover { background: var(--dsw-alias-bg-layer-2); }
.e2e-scan-row.is-picked { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.e2e-scan-actions { display: flex; align-items: center; gap: 6px; }
.e2e-settings { width: min(560px, 100%); }
.e2e-settings-block { display: flex; flex-direction: column; gap: 6px; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); }
.e2e-settings-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.e2e-settings-field { display: flex; align-items: center; gap: 8px; }
.e2e-settings-label { flex: 0 0 128px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.e2e-settings-field .e2e-input { flex: 1 1 auto; min-width: 0; }
.e2e-method { flex: 0 0 46px; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 10.5px; letter-spacing: 0.04em; color: var(--dsw-alias-brand-primary); }
.e2e-endpoint-path { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e2e-create { display: flex; flex-direction: column; gap: 6px; padding: 4px 2px 8px; }
.e2e-project-field.is-wide { cursor: pointer; }
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
