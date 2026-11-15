/**
 * dsh-e2e 鈥?reads a Java/Spring project and lists the endpoints it exposes.
 *
 * This exists because the hard part of writing a case is not the YAML syntax 鈥?the
 * validator already reports the line and column of a bad indent. The hard part is
 * knowing what to send and what to assert. A project that already declares
 *
 *     @PostMapping("/register") String register(@Valid @RequestBody UserDto dto)
 *     class UserDto { @NotBlank String username; @Pattern(...) String password; ... }
 *
 * has answered most of that question in its own source. Reading it beats guessing.
 *
 * Scope, stated plainly: this understands the annotation style, not Java. It
 * handles `@RestController` + `@RequestMapping` + the five shorthand mappings,
 * `@RequestBody` DTOs, and Bean-Validation annotations on their fields. It does
 * not evaluate expressions, follow interfaces, or resolve generics. When it cannot
 * read something it records a warning instead of inventing an answer.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'

export class ScanError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'ScanError'
    this.details = details
  }
}

const DEFAULT_MAX_FILES = 4000
const DEFAULT_MAX_BYTES = 512 * 1024

const MAPPING_ANNOTATIONS = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
}

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'target',
  'build',
  'out',
  'dist',
  '.git',
  '.gradle',
  '.idea',
  'bin',
])

/**
 * Removes comments while leaving string and char literals intact.
 *
 * Needed before any annotation parsing: a commented-out `@PostMapping` is not an
 * endpoint, and `// @RequestMapping("/x")` in a doc comment is not either. Strings
 * are preserved because annotation values live in them.
 */
function stripComments(source) {
  let out = ''
  let index = 0
  const length = source.length
  while (index < length) {
    const char = source[index]
    const next = source[index + 1]
    if (char === '/' && next === '/') {
      while (index < length && source[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      // Keep the newlines so reported line numbers stay correct.
      while (index < length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') out += '\n'
        index += 1
      }
      index += 2
      continue
    }
    if (char === '"' || char === "'") {
      const quote = char
      out += char
      index += 1
      while (index < length) {
        const current = source[index]
        if (current === '\\') {
          out += current + (source[index + 1] || '')
          index += 2
          continue
        }
        out += current
        index += 1
        if (current === quote) break
      }
      continue
    }
    out += char
    index += 1
  }
  return out
}

function lineOf(source, offset) {
  let line = 1
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === '\n') line += 1
  }
  return line
}

/** Returns the text inside the balanced parentheses starting at `openIndex`. */
function readParens(source, openIndex) {
  if (source[openIndex] !== '(') return { text: '', end: openIndex }
  let depth = 0
  let index = openIndex
  for (; index < source.length; index += 1) {
    const char = source[index]
    if (char === '"' || char === "'") {
      const quote = char
      index += 1
      while (index < source.length) {
        if (source[index] === '\\') index += 2
        else if (source[index] === quote) break
        else index += 1
      }
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return { text: source.slice(openIndex + 1, index), end: index + 1 }
    }
  }
  return { text: source.slice(openIndex + 1), end: source.length }
}

/** Reads a string literal value out of an annotation argument list. */
function annotationStrings(args) {
  const values = []
  const pattern = /"((?:[^"\\]|\\.)*)"/g
  let match
  while ((match = pattern.exec(args)) !== null) {
    values.push(match[1].replace(/\\(.)/g, '$1'))
  }
  return values
}

function namedArg(args, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(\\{[^}]*\\}|"(?:[^"\\\\]|\\\\.)*"|[^,)]+)`, 'i')
  const match = pattern.exec(args)
  return match ? match[1].trim() : null
}

/** `"/auth"` or `{"/auth", "/v1"}` or `value = "/auth"`. */
function pathsFromAnnotation(args) {
  if (!args) return []
  const valueArg = namedArg(args, 'value') || namedArg(args, 'path')
  const source = valueArg !== null ? valueArg : args
  const strings = annotationStrings(source)
  return strings.filter((item) => item.startsWith('/'))
}

function joinPaths(...parts) {
  const cleaned = parts
    .filter((part) => part !== null && part !== undefined && part !== '')
    .map((part) => String(part).trim())
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
  return `/${cleaned.join('/')}`
}

// --- DTO field reading ------------------------------------------------------

const SIMPLE_TYPES = new Set([
  'String',
  'Integer',
  'int',
  'Long',
  'long',
  'Boolean',
  'boolean',
  'Double',
  'double',
  'Float',
  'float',
  'BigDecimal',
  'LocalDate',
  'LocalDateTime',
  'Date',
  'Instant',
  'UUID',
])

/** Reads the Bean-Validation annotations that sit immediately above a field. */
function readFieldAnnotations(block) {
  const info = { required: false, minLength: null, maxLength: null, pattern: null, email: false, note: null }
  const text = block || ''
  if (/@NotBlank|@NotNull|@NotEmpty/.test(text)) info.required = true
  if (/@Email/.test(text)) info.email = true
  const length = /@(?:Length|Size)\s*\(([^)]*)\)/.exec(text)
  if (length) {
    const min = /min\s*=\s*(\d+)/.exec(length[1])
    const max = /max\s*=\s*(\d+)/.exec(length[1])
    if (min) info.minLength = Number(min[1])
    if (max) info.maxLength = Number(max[1])
  }
  const patternMatch = /@Pattern\s*\(([\s\S]*?)\)\s*(?:@|\n|private|public|protected)/.exec(text)
  if (patternMatch) {
    const regexp = /regexp\s*=\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)/.exec(patternMatch[1])
    if (regexp) info.pattern = annotationStrings(regexp[1]).join('')
  }
  return info
}

/**
 * Reads one DTO class: field name, Java type, and the validation constraints on it.
 *
 * Only `private <Type> <name>;` declarations are considered. A DTO built with
 * getters/setters or records is reported as having no readable fields, which is
 * honest: the caller can then fill the body in by hand.
 */
function readDtoClass(source, className) {
  const fields = []
  const stripped = stripComments(source)
  const fieldPattern = /((?:@[A-Za-z_][\w.]*(?:\s*\([\s\S]*?\))?\s*)+)?(?:private|protected|public)\s+([A-Za-z_][\w.<>,\[\]\s]*?)\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;/g
  let match
  while ((match = fieldPattern.exec(stripped)) !== null) {
    const annotations = match[1] || ''
    const type = match[2].trim()
    const name = match[3]
    if (name === 'serialVersionUID') continue
    if (/static|final/.test(annotations)) continue
    const info = readFieldAnnotations(annotations)
    fields.push({
      name,
      type,
      required: info.required,
      minLength: info.minLength,
      maxLength: info.maxLength,
      pattern: info.pattern,
      email: info.email,
    })
  }
  return { name: className, fields }
}

/**
 * Picks a value that satisfies the field's constraints, or explains why it cannot.
 *
 * Values use the case DSL's generators (`${random.hex}`) where uniqueness matters,
 * because a fixed username makes the second run of a register case fail on a
 * duplicate key 鈥?and a case that only passes once is worse than no case.
 */
function sampleFor(field) {
  const name = field.name.toLowerCase()
  const type = String(field.type || '').toLowerCase()
  const max = field.maxLength

  if (/^(int|integer|long|short|byte)$/.test(type)) return { value: 1, note: null }
  if (/^(double|float|bigdecimal)$/.test(type)) return { value: 1.0, note: null }
  if (/^(boolean)$/.test(type)) return { value: true, note: null }
  if (/list|set|array|\[\]|map/.test(type)) {
    return { value: null, note: `field "${field.name}" is a collection; fill it in by hand` }
  }
  if (!/^(string|charsequence)$/.test(type) && !SIMPLE_TYPES.has(field.type)) {
    return { value: null, note: `field "${field.name}" has type ${field.type}; fill it in by hand` }
  }

  if (field.email || /email|mail/.test(name)) return { value: 'e2e@example.com', note: null }

  if (field.pattern) {
    const pattern = field.pattern
    const needsUpper = /\[A-Z\]|A-Z/.test(pattern)
    const needsLower = /\[a-z\]|a-z/.test(pattern)
    const needsDigit = /\\d|0-9/.test(pattern)
    const needsSpecial = /\[@\$!%\*\/]|@\$!%/.test(pattern) || /[@$!%*?&]/.test(pattern)
    if (needsUpper && needsLower && needsDigit && needsSpecial) {
      return { value: 'E2e@1234', note: null }
    }
    if (needsDigit && field.minLength === 6 && field.maxLength === 6) {
      return { value: '${random.int}', note: null }
    }
    return {
      value: null,
      note: `field "${field.name}" has a pattern the scanner cannot satisfy (${pattern.slice(0, 60)}); fill it in by hand`,
    }
  }

  if (/code|captcha|otp|pin/.test(name)) {
    if (max !== null && max !== undefined && max >= 6 && (field.minLength === undefined || field.minLength <= 6)) {
      return { value: '${random.int}', note: null }
    }
  }

  if (/username|user_?name|login|account/.test(name)) {
    if (max === null || max === undefined || max >= 19) return { value: 'e2e${random.hex}', note: null }
    if (max >= 9) return { value: 'e2e${random.int}', note: null }
    return { value: 'e2e', note: `field "${field.name}" is short (max ${max}); a fixed value may collide across runs` }
  }

  if (/password|passwd|pwd/.test(name)) {
    return { value: 'E2e@1234', note: null }
  }

  if (/phone|mobile|tel/.test(name)) {
    return { value: '${random.int}', note: 'phone number: confirm the expected format' }
  }

  if (field.required) return { value: `e2e${'${random.hex}'}`, note: null }
  return { value: null, note: `field "${field.name}" is optional; left null` }
}

// --- project walking --------------------------------------------------------

async function walkJavaFiles(root, options) {
  const files = []
  const warnings = []
  const maxFiles = options.maxFiles || DEFAULT_MAX_FILES
  const queue = [root]
  while (queue.length > 0 && files.length < maxFiles) {
    const dir = queue.shift()
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      warnings.push(`cannot read ${dir}: ${error.message}`)
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name.toLowerCase())) continue
        queue.push(full)
      } else if (entry.isFile() && entry.name.endsWith('.java')) {
        files.push(full)
        if (files.length >= maxFiles) break
      }
    }
  }
  if (files.length >= maxFiles) {
    warnings.push(`stopped after ${maxFiles} Java files; raise maxFiles to scan the whole project`)
  }
  return { files, warnings }
}

/** Reads a controller file into endpoints, or returns null if it is not one. */
function readController(source, file, root) {
  const stripped = stripComments(source)
  if (!/@RestController|@Controller\b/.test(stripped)) return null

  const classMatch = /(?:^|\n)\s*(?:public\s+)?(?:final\s+|abstract\s+)?class\s+([A-Za-z_]\w*)/.exec(stripped)
  const className = classMatch ? classMatch[1] : basename(file, '.java')

  // The class-level @RequestMapping is the one before the class declaration.
  const header = classMatch ? stripped.slice(0, classMatch.index) : stripped
  const classMapping = /@RequestMapping\s*\(/g
  let classBase = ''
  let match
  while ((match = classMapping.exec(header)) !== null) {
    const { text } = readParens(header, match.index + match[0].length - 1)
    const paths = pathsFromAnnotation(text)
    if (paths.length > 0) classBase = paths[0]
  }

  const endpoints = []
  // A class-level @RequestMapping is not an endpoint 鈥?it is the prefix every
  // method below it inherits. Skipping it is the difference between reporting
  // `POST /auth/register` and also reporting a phantom `GET /auth/auth`.
  const classMappingIndex = classMatch
    ? header.search(/@RequestMapping\s*\(/)
    : -1
  const mappingPattern = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\b\s*(?=\()/g
  while ((match = mappingPattern.exec(stripped)) !== null) {
    if (match.index === classMappingIndex) continue
    const annotation = match[1]
    const openIndex = stripped.indexOf('(', match.index + match[0].length)
    const { text: args, end } = readParens(stripped, openIndex)

    let method = MAPPING_ANNOTATIONS[annotation] || null
    if (!method) {
      const requestMethod = namedArg(args, 'method')
      const found = requestMethod ? /RequestMethod\.([A-Z]+)/.exec(requestMethod) : null
      method = found ? found[1] : 'GET'
    }

    const paths = pathsFromAnnotation(args)
    const path = paths.length > 0 ? paths[0] : ''

    // The method signature follows the annotation: skip modifiers and annotations.
    const signature = stripped.slice(end, end + 1200)
    const signatureMatch = /^\s*((?:@[A-Za-z_][\w.]*(?:\s*\([\s\S]*?\))?\s*)*)(?:public|protected|private)?\s*(?:static\s+)?(?:final\s+)?[\w.<>\[\],\s]+?\s+([A-Za-z_]\w*)\s*\(([\s\S]*?)\)\s*(?:throws[^{;]*)?[{;]/.exec(
      signature,
    )

    const methodName = signatureMatch ? signatureMatch[2] : null
    const params = signatureMatch ? signatureMatch[3] : ''

    const bodyMatch = /@RequestBody\s+(?:@[A-Za-z_][\w.]*(?:\([^)]*\))?\s+)*([A-Za-z_][\w.<>]*)\s+([A-Za-z_]\w*)/.exec(params)
    const pathVariableNames = []
    const pathVarPattern = /@PathVariable(?:\s*\([^)]*\))?\s+[\w.<>]+\s+([A-Za-z_]\w*)/g
    let pathVar
    while ((pathVar = pathVarPattern.exec(params)) !== null) pathVariableNames.push(pathVar[1])

    endpoints.push({
      controller: className,
      file: relative(root, file).split(sep).join('/'),
      line: lineOf(stripped, match.index),
      javaMethod: methodName,
      httpMethod: method,
      path: joinPaths(classBase, path),
      pathVariables: pathVariableNames,
      requestBody: bodyMatch ? { type: bodyMatch[1], parameter: bodyMatch[2] } : null,
    })
  }
  return { name: className, file: relative(root, file).split(sep).join('/'), base: classBase, endpoints }
}

/** Reads MyBatis-Plus entities so the scaffold can suggest which table to assert. */
function readEntity(source, file, root) {
  const stripped = stripComments(source)
  const table = /@TableName\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/.exec(stripped)
  if (!table) return null
  const columns = []
  const fieldPattern = /@(TableId|TableField)\s*\(([^)]*)\)/g
  let match
  while ((match = fieldPattern.exec(stripped)) !== null) {
    const column = /(?:value\s*=\s*)?"([^"]+)"/.exec(match[2])
    if (column) columns.push(column[1])
  }
  const classMatch = /class\s+([A-Za-z_]\w*)/.exec(stripped)
  return {
    name: classMatch ? classMatch[1] : basename(file, '.java'),
    file: relative(root, file).split(sep).join('/'),
    table: table[1],
    columns,
  }
}

// --- public API -------------------------------------------------------------

/**
 * Scans a project directory and returns what a case author needs to know.
 *
 * Returns endpoints, the DTOs they accept, and the entities/tables the project
 * maps 鈥?never a guess about which database those tables live in, because that is
 * a deployment fact the source code does not contain.
 */
export async function scanProject(input = {}) {
  const projectPath = input.projectPath ? String(input.projectPath) : ''
  if (!projectPath) throw new ScanError('scanProject needs a projectPath')
  let root
  try {
    const info = await stat(projectPath)
    if (!info.isDirectory()) throw new ScanError(`${projectPath} is not a directory`)
    root = projectPath
  } catch (error) {
    if (error instanceof ScanError) throw error
    throw new ScanError(`cannot read ${projectPath}: ${error.message}`)
  }

  const { files, warnings } = await walkJavaFiles(root, input)
  const controllers = []
  const entities = []
  const dtoSources = new Map()
  const sources = new Map()

  for (const file of files) {
    let source
    try {
      const info = await stat(file)
      if (info.size > (input.maxBytes || DEFAULT_MAX_BYTES)) {
        warnings.push(`${relative(root, file)} is too large to scan; skipped`)
        continue
      }
      source = await readFile(file, 'utf8')
    } catch (error) {
      warnings.push(`cannot read ${relative(root, file)}: ${error.message}`)
      continue
    }
    sources.set(file, source)

    const controller = readController(source, file, root)
    if (controller) controllers.push(controller)

    const entity = readEntity(source, file, root)
    if (entity) entities.push(entity)

    const classMatch = /class\s+([A-Za-z_]\w*)/.exec(stripComments(source))
    if (classMatch) dtoSources.set(classMatch[1], { file, source })
  }

  // Resolve every @RequestBody type to its fields. A type the scanner cannot find
  // stays unresolved rather than becoming an empty object, because an empty body
  // would look like "the endpoint takes no input" 鈥?a different claim.
  const dtos = []
  const endpoints = []
  for (const controller of controllers) {
    for (const endpoint of controller.endpoints) {
      const resolved = { ...endpoint }
      if (endpoint.requestBody) {
        const entry = dtoSources.get(endpoint.requestBody.type)
        if (entry) {
          const dto = readDtoClass(entry.source, endpoint.requestBody.type)
          dto.file = relative(root, entry.file).split(sep).join('/')
          if (!dtos.some((existing) => existing.name === dto.name)) dtos.push(dto)
          resolved.requestBody = { ...endpoint.requestBody, fields: dto.fields }
        } else {
          resolved.requestBody = { ...endpoint.requestBody, fields: null }
          warnings.push(
            `${controller.name}.${endpoint.javaMethod || '?'}: cannot find a source file for @RequestBody ${endpoint.requestBody.type}`,
          )
        }
      }
      endpoints.push(resolved)
    }
  }

  endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.httpMethod.localeCompare(b.httpMethod))

  return {
    root,
    scannedFiles: files.length,
    controllers: controllers.map((controller) => ({
      name: controller.name,
      file: controller.file,
      base: controller.base,
      endpoints: controller.endpoints.length,
    })),
    endpoints,
    dtos,
    entities,
    warnings,
  }
}

export { sampleFor, readDtoClass, stripComments }

// --- baseUrl derivation -----------------------------------------------------

/**
 * Reads a Spring project's own configuration to answer "where does this run".
 *
 * The create-project form no longer asks for a Base URL: a Spring Boot project
 * declares its port and context path itself, in `application.yml` /
 * `application.properties`. Reading that beats asking for it 鈥?a hand-typed URL
 * is one more thing to get wrong, and the source file is the truth the service
 * will actually bind to.
 *
 * Only the conventional locations are read 鈥?`src/main/resources/application.*`
 * and its `application-<profile>` siblings 鈥?because those are what a local run
 * uses. `application-<profile>` files are consulted when the default file has
 * no port of its own, in file order; a port set only under a profile is still
 * a port the developer's run configuration will pick up when that profile is
 * active, and "mostly right, clearly labelled" beats refusing the form.
 *
 * Returns `{ baseUrl, port, contextPath, source }`, or `{ baseUrl: null, ... }`
 * with warnings when nothing can be derived 鈥?the caller decides whether that
 * is fatal. The scheme is `https` when a keystore is configured, `http`
 * otherwise. There is no default port: when the project declares none, this
 * returns `baseUrl: null` and `port: null` so the form can leave the field
 * empty and ask. Spring's 8080 is a convention about a framework, not a fact
 * about this checkout, and a silently assumed one points the cases at whatever
 * else on the machine happens to hold it.
 */
const RESOURCE_DIR = join('src', 'main', 'resources')
const CONFIG_FILES = ['application.yml', 'application.yaml', 'application.properties']

export async function guessBaseUrl(projectPath) {
  const warnings = []
  let root
  try {
    const info = await stat(projectPath)
    if (!info.isDirectory()) {
      return {
        baseUrl: null,
        port: null,
        contextPath: '',
        scheme: 'http',
        source: null,
        warnings: [`${projectPath} is not a directory`],
      }
    }
    root = projectPath
  } catch (error) {
    return {
      baseUrl: null,
      port: null,
      contextPath: '',
      scheme: 'http',
      source: null,
      warnings: [`cannot read ${projectPath}: ${error.message}`],
    }
  }

  // Resource paths are reported with forward slashes so the value is stable
  // across platforms 鈥?this string lands in the registry and the UI.
  const resourceDirName = 'src/main/resources'
  const resourceDir = join(root, RESOURCE_DIR)
  let entries
  try {
    entries = await readdir(resourceDir)
  } catch {
    return {
      baseUrl: null,
      port: null,
      contextPath: '',
      scheme: 'http',
      source: null,
      warnings: [`no ${resourceDirName} under ${projectPath}, so the port cannot be read from the project`],
    }
  }

  // Default file first, then profile-specific ones in name order 鈥?that order
  // is also the order Spring itself would let a profile override the default.
  const names = CONFIG_FILES.filter((name) => entries.includes(name))
  const profiled = entries
    .filter((name) => /^application-.+\.(yml|yaml|properties)$/.test(name))
    .sort()
  const candidates = [...names, ...profiled]

  let port = null
  let contextPath = ''
  let ssl = false
  let source = null

  for (const name of candidates) {
    const file = join(resourceDir, name)
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      warnings.push(`cannot read ${resourceDirName}/${name}: ${error.message}`)
      continue
    }
    const clean = stripPropertiesComments(text)

    if (port === null) {
      const found = name.endsWith('.properties')
        ? propertyValue(clean, ['server', 'port'])
        : await yamlValue(text, ['server', 'port'], file)
      if (found !== undefined && found !== null && String(found).trim() !== '') {
        const parsed = Number(String(found).trim())
        if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
          port = parsed
          source = `${resourceDirName}/${name}`
        } else {
          warnings.push(`${resourceDirName}/${name}: server.port "${found}" is not a usable port; ignored`)
        }
      }
    }
    if (!contextPath) {
      const keys = [
        ['server', 'servlet', 'context-path'],
        ['server', 'servlet', 'contextPath'],
        ['server', 'context-path'],
      ]
      for (const key of keys) {
        const found = name.endsWith('.properties')
          ? propertyValue(clean, key)
          : await yamlValue(text, key, file)
        if (found !== undefined && found !== null && String(found).trim() !== '') {
          contextPath = String(found).trim()
          if (!source) source = `${resourceDirName}/${name}`
          break
        }
      }
    }
    if (!ssl) {
      const keystore = name.endsWith('.properties')
        ? propertyValue(clean, ['server', 'ssl', 'key-store'])
        : await yamlValue(text, ['server', 'ssl', 'key-store'], file)
      ssl = Boolean(keystore && String(keystore).trim())
      if (ssl && !source) source = `${resourceDirName}/${name}`
    }
    // A port from the default file wins outright; profile files only fill in
    // what the default file left unset.
    if (port !== null && contextPath && ssl) break
  }

  const scheme = ssl ? 'https' : 'http'
  if (port === null) {
    // No 8080 fallback: the default belongs to Spring, not to this project, and
    // a project that inherits it silently is a project whose cases talk to
    // whatever else happens to hold that port. The reader types the number.
    warnings.push(`no server.port found under ${resourceDirName}; the port is not filled in and has to be typed`)
    return { baseUrl: null, port: null, contextPath: contextPath || '', scheme, source, warnings }
  }

  const path = contextPath.replace(/^\/*/, '').replace(/\/*$/, '')
  const baseUrl = `${scheme}://127.0.0.1:${port}${path ? `/${path}` : ''}`
  return { baseUrl, port, contextPath: contextPath || '', scheme, source, warnings }
}

/** Strips `#` and `!` comments from a .properties body, keeping line structure. */
function stripPropertiesComments(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[#!].*$/, ''))
    .join('\n')
}

/**
 * One property from a .properties body: `server.port=8080` and its
 * `server.port : 8080` / `server\!.port` relatives. Only dotted literal keys are
 * matched 鈥?a key built by property expansion is not an answer this guesses.
 */
function propertyValue(clean, keys) {
  const pattern = new RegExp(
    `^[ \\t]*${keys.map((part) => part.replace(/[.]/g, '\\.').replace(/!/g, '\\!')).join('\\.')}[ \\t]*[:=][ \\t]*(.+?)[ \\t]*$`,
    'm',
  )
  const match = pattern.exec(clean)
  return match ? match[1] : undefined
}

/**
 * One nested value from a YAML document: the `port:` under a `server:` mapping.
 * The vendored parser is deliberately not used here 鈥?the file may be half
 * invalid for reasons that do not concern the port (tabs elsewhere, a broken
 * list at the bottom), and refusing to derive a URL because of that would make
 * the form fail on projects Spring itself still runs. A small indent-walk is
 * the right tool for reading two scalars; full parsing is not the goal.
 */
async function yamlValue(text, keys, file) {
  const lines = text.split('\n')
  let index = 0

  const walk = (depth, remaining) => {
    if (remaining.length === 0) return undefined
    const key = remaining[0]
    const prefix = '  '.repeat(depth)
    const pattern = new RegExp(`^${prefix}([A-Za-z0-9_.-]+):(?:[ \\t]+(.*))?$`)
    while (index < lines.length) {
      const line = lines[index]
      index += 1
      if (line.trim() === '' || /^\s*#/.test(line)) continue
      if (!line.startsWith(prefix)) {
        // A line less indented than this mapping ends the search at this depth.
        if (line.trimStart().length !== line.length) continue
        return undefined
      }
      const match = pattern.exec(line)
      if (!match || match[1] !== key) continue
      if (match[2] !== undefined && match[2].trim() !== '') return match[2].trim().replace(/^["']|["']$/g, '')
      // The value lives below, more indented 鈥?but only its own children.
      return walk(depth + 1, remaining.slice(1))
    }
    return undefined
  }

  try {
    return walk(0, keys)
  } catch (error) {
    // yamlValue walks a finite list, so a throw here is a defect in the walk,
    // not in the file; say where rather than fail the whole derivation.
    throw new ScanError(`cannot read ${keys.join('.')} from ${file}: ${error.message}`)
  }
}
