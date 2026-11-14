/**
 * dsh-e2e — minimal PostgreSQL / openGauss / GaussDB wire client.
 *
 * Why hand-rolled: an E2E case must assert the database terminal state from
 * inside the DSH host process, and the host has no `pg` (nor any JDBC bridge)
 * available. This speaks just enough of the frontend/backend protocol to run a
 * SELECT: startup, MD5 / SCRAM-SHA-256 / cleartext authentication, and the
 * simple-query flow.
 *
 * It is intentionally not a general driver: no extended query protocol, no
 * parameters, no COPY, no TLS negotiation. Callers should send SELECT only.
 */
import net from 'node:net'
import crypto from 'node:crypto'

const PROTOCOL_VERSION = 196608 // 3.0

const OID = {
  BOOL: 16,
  INT8: 20,
  INT2: 21,
  INT4: 23,
  OID: 26,
  FLOAT4: 700,
  FLOAT8: 701,
  NUMERIC: 1700,
}

function md5Hex(value) {
  return crypto.createHash('md5').update(value).digest('hex')
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest()
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest()
}

function readCString(buffer, offset) {
  const end = buffer.indexOf(0, offset)
  if (end === -1) return { value: buffer.subarray(offset).toString('utf8'), next: buffer.length }
  return { value: buffer.subarray(offset, end).toString('utf8'), next: end + 1 }
}

function int32(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeInt32BE(value, 0)
  return buffer
}

/**
 * Turns the socket byte stream into a queue of protocol messages. Every message
 * after the startup packet is `[type:1][length:4][payload:length-4]`.
 */
class MessageReader {
  constructor(socket) {
    this.buffer = Buffer.alloc(0)
    this.queue = []
    this.waiter = null
    this.failure = null
    this.closed = false
    socket.on('data', (chunk) => {
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
      this.#drain()
      this.#wake()
    })
    socket.on('error', (error) => {
      this.failure = error
      this.#wake()
    })
    socket.on('close', () => {
      this.closed = true
      this.#wake()
    })
  }

  #drain() {
    for (;;) {
      if (this.buffer.length < 5) return
      const length = this.buffer.readInt32BE(1)
      if (length < 4) {
        this.failure = new Error(`protocol error: message length ${length}`)
        this.buffer = Buffer.alloc(0)
        return
      }
      if (this.buffer.length < 1 + length) return
      const type = String.fromCharCode(this.buffer[0])
      const payload = this.buffer.subarray(5, 1 + length)
      this.buffer = this.buffer.subarray(1 + length)
      this.queue.push({ type, payload })
    }
  }

  #wake() {
    if (!this.waiter) return
    const waiter = this.waiter
    this.waiter = null
    waiter()
  }

  /** Resolves with the next message, rejecting on timeout or socket failure. */
  next(timeoutMs) {
    const deliver = (resolve, reject) => {
      if (this.queue.length > 0) {
        resolve(this.queue.shift())
        return
      }
      if (this.failure) {
        reject(this.failure)
        return
      }
      if (this.closed) {
        reject(new Error('connection closed by server'))
        return
      }
      let timer = null
      const check = () => {
        if (this.queue.length > 0) {
          if (timer) clearTimeout(timer)
          resolve(this.queue.shift())
          return
        }
        if (this.failure) {
          if (timer) clearTimeout(timer)
          reject(this.failure)
          return
        }
        if (this.closed) {
          if (timer) clearTimeout(timer)
          reject(new Error('connection closed by server'))
          return
        }
        this.waiter = check
      }
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (this.waiter === check) this.waiter = null
          reject(new Error(`timed out after ${timeoutMs}ms waiting for the database to answer`))
        }, timeoutMs)
      }
      this.waiter = check
    }
    return new Promise(deliver)
  }
}

function parseErrorResponse(payload) {
  const fields = {}
  let offset = 0
  while (offset < payload.length) {
    const code = payload[offset]
    if (code === 0) break
    const read = readCString(payload, offset + 1)
    fields[String.fromCharCode(code)] = read.value
    offset = read.next
  }
  const error = new Error(fields.M || 'database error')
  error.code = fields.C
  error.detail = fields.D
  error.hint = fields.H
  error.severity = fields.S
  return error
}

function parseRowDescription(payload) {
  const count = payload.readInt16BE(0)
  const fields = []
  let offset = 2
  for (let index = 0; index < count; index += 1) {
    const name = readCString(payload, offset)
    offset = name.next
    const typeOid = payload.readInt32BE(offset + 6)
    offset += 18
    fields.push({ name: name.value, typeOid })
  }
  return fields
}

function coerce(value, typeOid) {
  if (value === null) return null
  switch (typeOid) {
    case OID.BOOL:
      return value === 't' || value === 'true'
    case OID.INT2:
    case OID.INT4:
    case OID.INT8:
    case OID.OID: {
      const parsed = Number(value)
      return Number.isSafeInteger(parsed) ? parsed : value
    }
    case OID.FLOAT4:
    case OID.FLOAT8: {
      const parsed = Number(value)
      return Number.isNaN(parsed) ? value : parsed
    }
    case OID.NUMERIC: {
      const parsed = Number(value)
      return Number.isNaN(parsed) ? value : parsed
    }
    default:
      return value
  }
}

function parseDataRow(payload, fields) {
  const count = payload.readInt16BE(0)
  const row = {}
  let offset = 2
  for (let index = 0; index < count; index += 1) {
    const length = payload.readInt32BE(offset)
    offset += 4
    if (length === -1) {
      row[fields[index] ? fields[index].name : `column${index}`] = null
      continue
    }
    const raw = payload.subarray(offset, offset + length).toString('utf8')
    offset += length
    row[fields[index] ? fields[index].name : `column${index}`] = coerce(raw, fields[index] ? fields[index].typeOid : 0)
  }
  return row
}

export class PgClient {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1'
    this.port = Number(options.port || 5432)
    this.database = options.database || 'postgres'
    this.user = options.user || 'postgres'
    this.password = options.password || ''
    this.schema = options.schema || ''
    this.connectTimeoutMs = Number(options.connectTimeoutMs || 10000)
    this.statementTimeoutMs = Number(options.statementTimeoutMs || 30000)
    this.applicationName = options.applicationName || 'dsh-e2e'
    this.socket = null
    this.reader = null
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.host, port: this.port })
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error(`timed out connecting to ${this.host}:${this.port}`))
      }, this.connectTimeoutMs)
      socket.once('connect', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      this.socket = socket
    })
    this.socket.setNoDelay(true)
    this.reader = new MessageReader(this.socket)
    await this.#startup()
    if (this.schema) await this.query(`SET search_path TO ${quoteIdent(this.schema)}`)
    return this
  }

  #send(type, payload) {
    const header = Buffer.alloc(5)
    header.write(type, 0, 'latin1')
    header.writeInt32BE(payload.length + 4, 1)
    this.socket.write(Buffer.concat([header, payload]))
  }

  async #startup() {
    const parts = [
      Buffer.from('user\0', 'utf8'),
      Buffer.from(`${this.user}\0`, 'utf8'),
      Buffer.from('database\0', 'utf8'),
      Buffer.from(`${this.database}\0`, 'utf8'),
      Buffer.from('client_encoding\0UTF8\0', 'utf8'),
      Buffer.from(`application_name\0${this.applicationName}\0`, 'utf8'),
      Buffer.from('DateStyle\0ISO, MDY\0', 'utf8'),
      Buffer.from([0]),
    ]
    const body = Buffer.concat([int32(PROTOCOL_VERSION), ...parts])
    this.socket.write(Buffer.concat([int32(body.length + 4), body]))
    await this.#authenticate()
    for (;;) {
      const message = await this.reader.next(this.connectTimeoutMs)
      if (message.type === 'E') throw parseErrorResponse(message.payload)
      if (message.type === 'Z') return
      // ParameterStatus / BackendKeyData / NoticeResponse: nothing to do.
    }
  }

  async #authenticate() {
    let scram = null
    for (;;) {
      const message = await this.reader.next(this.connectTimeoutMs)
      if (message.type === 'E') throw parseErrorResponse(message.payload)
      if (message.type !== 'R') {
        throw new Error(`protocol error: expected an authentication request, received '${message.type}'`)
      }
      const code = message.payload.readInt32BE(0)
      if (code === 0) return // AuthenticationOk
      if (code === 3) {
        this.#send('p', Buffer.from(`${this.password}\0`, 'utf8'))
        continue
      }
      if (code === 5) {
        const salt = message.payload.subarray(4, 8)
        const inner = md5Hex(`${this.password}${this.user}`)
        this.#send('p', Buffer.from(`md5${md5Hex(Buffer.concat([Buffer.from(inner, 'utf8'), salt]))}\0`, 'utf8'))
        continue
      }
      if (code === 10) {
        const mechanisms = []
        let offset = 4
        for (;;) {
          const read = readCString(message.payload, offset)
          if (read.value === '') break
          mechanisms.push(read.value)
          offset = read.next
        }
        if (!mechanisms.includes('SCRAM-SHA-256')) {
          throw new Error(`unsupported SASL mechanisms: ${mechanisms.join(', ') || '(none)'}`)
        }
        scram = beginScram(this.password)
        const payload = Buffer.concat([
          Buffer.from('SCRAM-SHA-256\0', 'utf8'),
          int32(Buffer.byteLength(scram.clientFirst, 'utf8')),
          Buffer.from(scram.clientFirst, 'utf8'),
        ])
        this.#send('p', payload)
        continue
      }
      if (code === 11) {
        if (!scram) throw new Error('protocol error: SASL continue without a SCRAM exchange')
        const serverFirst = message.payload.subarray(4).toString('utf8')
        this.#send('p', Buffer.from(scram.continue(serverFirst), 'utf8'))
        continue
      }
      if (code === 12) {
        if (!scram) throw new Error('protocol error: SASL final without a SCRAM exchange')
        scram.finish(message.payload.subarray(4).toString('utf8'))
        continue
      }
      throw new Error(`unsupported authentication request code ${code}`)
    }
  }

  /** Runs one statement through the simple-query flow and returns its rows. */
  async query(sql) {
    if (!this.socket) throw new Error('not connected')
    this.#send('Q', Buffer.from(`${sql}\0`, 'utf8'))
    let fields = null
    const rows = []
    let failure = null
    for (;;) {
      const message = await this.reader.next(this.statementTimeoutMs)
      if (message.type === 'T') {
        fields = parseRowDescription(message.payload)
      } else if (message.type === 'D') {
        rows.push(parseDataRow(message.payload, fields || []))
      } else if (message.type === 'E') {
        failure = parseErrorResponse(message.payload)
      } else if (message.type === 'Z') {
        break
      }
      // 'C' CommandComplete / 'I' EmptyQueryResponse / 'N' NoticeResponse / 'S' ParameterStatus
    }
    if (failure) throw failure
    return rows
  }

  /** First row of the statement, or undefined when it returned nothing. */
  async queryOne(sql) {
    const rows = await this.query(sql)
    return rows.length > 0 ? rows[0] : undefined
  }

  close() {
    if (!this.socket) return
    try {
      this.#send('X', Buffer.alloc(0))
    } catch {
      /* the socket may already be gone */
    }
    try {
      this.socket.end()
    } catch {
      /* ignore */
    }
    this.socket = null
  }
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

/**
 * SCRAM-SHA-256 as PostgreSQL and openGauss both implement it: PBKDF2-HMAC-SHA256
 * over the password, a client proof over the two nonce exchanges, and a server
 * signature the client must verify.
 */
function beginScram(password) {
  const clientNonce = crypto.randomBytes(18).toString('base64')
  const clientFirstBare = `n=,r=${clientNonce}`
  const clientFirst = `n,,${clientFirstBare}`
  let serverFirst = ''
  let expectedServerSignature = null

  return {
    clientFirst,
    continue(data) {
      serverFirst = data
      const attributes = {}
      for (const part of data.split(',')) {
        const index = part.indexOf('=')
        if (index > 0) attributes[part.slice(0, index)] = part.slice(index + 1)
      }
      if (!attributes.r || !attributes.s || !attributes.i) {
        throw new Error(`malformed SCRAM server-first message: ${data}`)
      }
      if (!attributes.r.startsWith(clientNonce)) {
        throw new Error('SCRAM server nonce does not extend the client nonce')
      }
      const salt = Buffer.from(attributes.s, 'base64')
      const iterations = Number(attributes.i)
      const saltedPassword = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256')
      const clientKey = hmacSha256(saltedPassword, 'Client Key')
      const storedKey = sha256(clientKey)
      const clientFinalWithoutProof = `c=biws,r=${attributes.r}`
      const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`
      const clientSignature = hmacSha256(storedKey, authMessage)
      const proof = Buffer.alloc(clientKey.length)
      for (let index = 0; index < clientKey.length; index += 1) {
        proof[index] = clientKey[index] ^ clientSignature[index]
      }
      const serverKey = hmacSha256(saltedPassword, 'Server Key')
      expectedServerSignature = hmacSha256(serverKey, authMessage).toString('base64')
      return `${clientFinalWithoutProof},p=${proof.toString('base64')}`
    },
    finish(data) {
      const attributes = {}
      for (const part of data.split(',')) {
        const index = part.indexOf('=')
        if (index > 0) attributes[part.slice(0, index)] = part.slice(index + 1)
      }
      if (attributes.e) throw new Error(`SCRAM authentication failed: ${attributes.e}`)
      if (expectedServerSignature && attributes.v && attributes.v !== expectedServerSignature) {
        throw new Error('SCRAM server signature mismatch — the server does not know the password')
      }
    },
  }
}
