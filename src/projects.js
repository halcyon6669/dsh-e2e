/**
 * dsh-e2e — projects: the view above a case.
 *
 * A case answers "does this endpoint behave". A *project* answers the question
 * asked before that one: "which of my services are covered, and is anything
 * red right now". The panel's landing page is therefore a list of projects,
 * not a list of files.
 *
 * A project is not a stored thing — nothing on disk declares one. It is derived:
 *
 *   - one project per `projectPath` that a registry target points at (so
 *     `record-local` and `record-running`, two ways to reach one service,
 *     collapse into one row);
 *   - plus one project per case directory, for cases that name no target at
 *     all — those still need somewhere to appear.
 *
 * Everything here is read-only and computed on demand. The counts come from the
 * newest report of each case, because "is it green" means the last thing that
 * happened, not the average of everything that ever happened.
 */
import { readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { userInfo } from 'node:os'
import { loadRegistry, resolveTarget } from './registry.js'
import { caseRoots, listCasesIn, listReports } from './store.js'
import { caseStatus, summariseStatuses } from './plan.js'

/** Build markers that tell a backend from a frontend without opening any file. */
const JVM_MARKERS = ['pom.xml', 'build.gradle', 'build.gradle.kts']

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * What kind of project this is, read from its build files.
 *
 * Returns null rather than a guess when the path is not there: a row that says
 * "backend" because someone typed a path that does not exist is worse than a
 * row that says nothing.
 */
async function detectType(projectPath) {
  if (!projectPath) return null
  let jvm = false
  for (const marker of JVM_MARKERS) {
    if (await exists(join(projectPath, marker))) {
      jvm = true
      break
    }
  }
  const web = await exists(join(projectPath, 'package.json'))
  if (jvm && web) return 'fullstack'
  if (jvm) return 'backend'
  if (web) return 'frontend'
  return null
}

/**
 * A stable identity for a project.
 *
 * The row answers "which service is this", so the *service* is the key, not the
 * way you reach it: `record-local` (starts the JVM) and `record-running` (hits a
 * service someone already started) point at the same `https://127.0.0.1:8443`,
 * and two rows for one service would make every count on the page wrong.
 *
 * Windows answers `true` to `E:\x` and `e:\x` being the same directory, so the
 * key is lower-cased; the displayed path never is.
 */
function originKey(baseUrl) {
  if (!baseUrl) return null
  try {
    const url = new URL(baseUrl)
    return `${url.protocol}//${url.host}`.toLowerCase()
  } catch {
    return String(baseUrl).trim().toLowerCase() || null
  }
}

function projectKey(projectPath) {
  const normalized = resolve(projectPath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** The name a row shows: the checkout's folder when known, else the host. */
function displayName({ projectPath, baseUrl, fallback }) {
  if (projectPath) {
    const folder = basename(resolve(projectPath))
    if (folder) return folder
  }
  if (baseUrl) {
    try {
      return new URL(baseUrl).host
    } catch {
      /* fall through to the target name */
    }
  }
  return fallback
}

function newProject(seed) {
  return {
    key: seed.key,
    name: seed.name,
    projectPath: seed.projectPath || null,
    baseUrl: seed.baseUrl || null,
    targets: [],
    caseDirs: [],
    cases: [],
    counts: { total: 0, passed: 0, failed: 0, notRun: 0, normal: 0, error: 0 },
    lastActivityAt: null,
    firstSeenAt: null,
    lastVerdict: null,
    type: null,
    source: seed.source || 'local',
    warnings: [],
  }
}

/**
 * The newest report per case, which is what "latest results" means.
 *
 * Reports arrive newest first, so the first one seen for a case wins. A case
 * that has never run is absent from this map — that is the "not run" bucket,
 * and it is deliberately not the same as "skipped".
 *
 * Each report is indexed under both its `caseId` and its `id`. Reports written
 * before `caseId` existed stored the file's id in that field, so a case renamed
 * to `REG-001` would otherwise look like it had never run — the report is still
 * the last thing that happened to it, and losing that history on an upgrade is
 * exactly the kind of thing that makes a dashboard untrustworthy.
 */
async function latestByCase(options) {
  const latest = new Map()
  let history
  try {
    history = await listReports(options)
  } catch (error) {
    return { latest, error: error.message, dir: null }
  }
  for (const item of history.reports) {
    const summary = item.summary
    if (!summary) continue
    const keys = [summary.caseId, summary.id].filter((value) => value !== undefined && value !== null && value !== '')
    if (keys.length === 0) continue
    const entry = {
      verdict: summary.verdict || null,
      startedAt: summary.startedAt || item.modifiedAt || null,
      durationMs: summary.durationMs || null,
      checks: summary.checks || 0,
      failed: summary.failed || 0,
      reportPath: item.path,
      markdownPath: item.markdownPath || item.path,
    }
    for (const key of keys) {
      const id = String(key)
      if (latest.has(id)) continue
      latest.set(id, entry)
    }
  }
  return { latest, error: null, dir: history.dir }
}

/** The run for one case, looking under the id it used to be known by too. */
function runFor(latest, entry) {
  return latest.get(String(entry.caseId)) || latest.get(String(entry.id)) || null
}

/**
 * Builds the project list.
 *
 * Read-only and side-effect free: it stats files and reads reports, and never
 * creates a directory. The panel's landing page must not change what it is
 * describing.
 */
export async function listProjects(options = {}) {
  const { config = {}, state = {}, env = process.env } = options
  const dirs = caseRoots({ config, state })
  const warnings = []
  const projects = new Map()

  // --- 1. Registry targets become projects, so a service with no cases yet still
  // appears (as "not run") instead of being invisible until someone writes one.
  let registry = null
  try {
    registry = await loadRegistry({ config, caseDir: dirs[0] || null, env })
  } catch (error) {
    warnings.push(`the registry could not be read: ${error.message}`)
  }

  const targetToKey = new Map()
  if (registry) {
    // Two passes. A target that names a checkout is that checkout's project —
    // two folders on one port are two projects, which is what a local machine
    // full of half-started services actually looks like. A target that names no
    // checkout is a second way into a service someone else's folder describes,
    // so it joins the project that already claimed that origin.
    const byOrigin = new Map()
    const pending = []
    for (const name of Object.keys(registry.targets || {})) {
      let target
      try {
        target = resolveTarget(registry, name)
      } catch (error) {
        warnings.push(`target "${name}" was skipped: ${error.message}`)
        continue
      }
      if (!target.projectPath) {
        pending.push([name, target])
        continue
      }
      const key = projectKey(target.projectPath)
      if (!projects.has(key)) {
        projects.set(
          key,
          newProject({
            key,
            name: displayName({ projectPath: target.projectPath, baseUrl: target.baseUrl, fallback: name }),
            projectPath: target.projectPath,
            baseUrl: target.baseUrl || null,
            source: 'registry',
          }),
        )
      }
      const project = projects.get(key)
      project.targets.push(name)
      if (!project.baseUrl && target.baseUrl) project.baseUrl = target.baseUrl
      targetToKey.set(name, key)
      const origin = originKey(target.baseUrl)
      if (origin) {
        if (!byOrigin.has(origin)) byOrigin.set(origin, new Set())
        byOrigin.get(origin).add(key)
      }
    }
    for (const [name, target] of pending) {
      const origin = originKey(target.baseUrl)
      // Fold only when exactly one checkout claims that origin. Two checkouts on
      // one port leave no way to say which of them this target means, and a guess
      // would attach a case to the wrong folder; it keeps a row of its own, named
      // by the address it does reach.
      const claimants = (origin && byOrigin.get(origin)) || new Set()
      const key = claimants.size === 1 ? [...claimants][0] : origin || `target:${name}`
      if (!projects.has(key)) {
        projects.set(
          key,
          newProject({
            key,
            name: displayName({ projectPath: null, baseUrl: target.baseUrl, fallback: name }),
            projectPath: null,
            baseUrl: target.baseUrl || null,
            source: 'registry',
          }),
        )
      }
      projects.get(key).targets.push(name)
      targetToKey.set(name, key)
    }
  }

  // --- 2. Cases land in the project their target names, or in a per-directory
  // project when they name no target at all.
  const caseFiles = []
  for (const dir of dirs) {
    let listing
    try {
      listing = await listCasesIn(dir)
    } catch (error) {
      warnings.push(`${dir} could not be listed: ${error.message}`)
      continue
    }
    for (const failure of listing.failures || []) {
      warnings.push(`${failure.file || 'a case file'} does not load: ${failure.error}`)
    }
    const dirKey = `dir:${projectKey(dir)}`
    for (const entry of listing.cases) {
      let key = entry.target ? targetToKey.get(entry.target) : undefined
      if (!key && entry.target && registry && registry.targets && registry.targets[entry.target]) {
        // A target the registry knows but that failed to resolve above.
        key = projects.has(projectKey(entry.target)) ? projectKey(entry.target) : undefined
      }
      if (!key) {
        if (!projects.has(dirKey)) {
          projects.set(
            dirKey,
            newProject({ key: dirKey, name: basename(dir) || dir, projectPath: null, source: 'local' }),
          )
        }
        key = dirKey
      }
      const project = projects.get(key)
      if (!project.caseDirs.includes(dir)) project.caseDirs.push(dir)
      project.cases.push(entry)
      caseFiles.push(entry.file)
    }
  }

  // --- 3. Latest results, then the per-project rollup.
  const { latest, error: reportError } = await latestByCase({ ...options, config, state })
  if (reportError) warnings.push(`reports could not be read: ${reportError}`)

  const now = Date.now()
  const rows = []
  for (const project of projects.values()) {
    let firstSeen = null
    let lastActivity = null

    for (const entry of project.cases) {
      let info = null
      try {
        info = await stat(entry.file)
      } catch {
        /* the file vanished between listing and stat */
      }
      if (info) {
        if (!firstSeen || info.mtimeMs < firstSeen) firstSeen = info.mtimeMs
        if (!lastActivity || info.mtimeMs > lastActivity) lastActivity = info.mtimeMs
      }

      const run = runFor(latest, entry)
      const verdict = run ? run.verdict : null
      entry.verdict = verdict
      entry.lastRunAt = run ? run.startedAt : null
      entry.reportPath = run ? run.markdownPath : null
      entry.durationMs = run ? run.durationMs : null
      // One word for the row's status chip, decided here rather than in the
      // browser: "blocked" and "failed" are different problems, and a page that
      // derives that distinction a second time will eventually derive it
      // differently.
      entry.status = caseStatus(entry, run)

      project.counts.total += 1
      if (entry.scenario === 'error') project.counts.error += 1
      else project.counts.normal += 1
      if (verdict === 'passed') project.counts.passed += 1
      else if (verdict === 'failed' || verdict === 'refused') project.counts.failed += 1
      else project.counts.notRun += 1

      if (run && run.startedAt) {
        const at = Date.parse(run.startedAt)
        if (Number.isFinite(at) && (!lastActivity || at > lastActivity)) lastActivity = at
      }
    }

    // A project with no cases yet still has a "when": when its registry entry
    // appeared. Without this the column would be empty for exactly the projects
    // someone just added.
    if (!firstSeen && registry && registry.file) {
      try {
        const info = await stat(registry.file)
        firstSeen = info.mtimeMs
        if (!lastActivity) lastActivity = info.mtimeMs
      } catch {
        /* the registry is optional */
      }
    }

    project.counts.notRun = project.counts.total - project.counts.passed - project.counts.failed
    project.firstSeenAt = firstSeen ? new Date(firstSeen).toISOString() : null
    project.lastActivityAt = lastActivity ? new Date(lastActivity).toISOString() : null
    project.type = await detectType(project.projectPath)

    // One word for the row's status chip: a project is only "green" when every
    // case has run and passed. Anything else is a shade of unfinished.
    if (project.counts.total === 0) project.lastVerdict = null
    else if (project.counts.failed > 0) project.lastVerdict = 'failed'
    else if (project.counts.notRun > 0) project.lastVerdict = 'partial'
    else project.lastVerdict = 'passed'

    // The status tabs above the case list are counted here, from the same
    // per-case statuses the rows show, so a tab can never claim a number the
    // rows below it disagree with.
    project.statusCounts = { all: project.cases.length, planned: 0, generated: 0, running: 0, passed: 0, failed: 0, blocked: 0 }
    for (const entry of project.cases) {
      if (project.statusCounts[entry.status] !== undefined) project.statusCounts[entry.status] += 1
    }

    // The case list is grouped by use case, and the group header says "6 tests ·
    // all passed" in one line. That sentence is computed here for the same reason
    // the statuses are: two places deriving "all passed" will disagree one day,
    // and the page is then lying in exactly the place people trust it.
    const buckets = new Map()
    for (const entry of project.cases) {
      const key = entry.group || entry.endpoint || `(no group) ${entry.caseId}`
      if (!buckets.has(key)) buckets.set(key, { name: key, group: entry.group || null, endpoint: entry.group ? null : entry.endpoint || null, cases: [] })
      buckets.get(key).cases.push(entry)
    }
    project.groups = [...buckets.values()]
      .sort((left, right) => String(left.name).localeCompare(String(right.name)))
      .map((bucket) => {
        const weight = { high: 0, medium: 1, low: 2 }
        bucket.cases.sort((left, right) => {
          const byPriority = (weight[left.priority] ?? 1) - (weight[right.priority] ?? 1)
          return byPriority !== 0 ? byPriority : String(left.caseId).localeCompare(String(right.caseId))
        })
        return { ...bucket, summary: summariseStatuses(bucket.cases.map((entry) => entry.status)) }
      })

    project.cases.sort((left, right) => String(left.caseId).localeCompare(String(right.caseId)))
    rows.push(project)
  }

  // Newest first, like the page that inspired this one. A project with nothing
  // dated yet sorts last rather than first.
  rows.sort((left, right) => {
    const at = left.lastActivityAt ? Date.parse(left.lastActivityAt) : 0
    const bt = right.lastActivityAt ? Date.parse(right.lastActivityAt) : 0
    if (bt !== at) return bt - at
    return String(left.name).localeCompare(String(right.name))
  })

  let creator = null
  try {
    creator = userInfo().username || null
  } catch {
    /* a container without a user table is not a reason to fail the page */
  }

  return {
    ok: true,
    dirs,
    registryFile: registry ? registry.file : null,
    creator,
    generatedAt: new Date(now).toISOString(),
    projects: rows,
    warnings,
  }
}
