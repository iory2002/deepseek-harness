/**
 * Host half of the qq-mail bundle: a `send_mail` tool backed by a self-contained
 * SMTP client for QQ Mail.
 *
 * Only `node:*` builtins are imported. A profile-installed bundle resolves no
 * Harness package, so a bare `@deepseek-ai/...` specifier fails at activation
 * and a schemastery `Config` export is impossible. Deployment knobs therefore
 * come from the row's `config` object, and the account secret from a JSON file
 * under the Harness home so it never reaches a bundle patch in source control.
 * Attachment bytes are read through the optional `fs` service so the Harness
 * file policy applies instead of the raw `node:fs` API.
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { connect as netConnect } from 'node:net'
import { homedir, hostname } from 'node:os'
import { basename, join, resolve as resolvePath } from 'node:path'
import { connect as tlsConnect } from 'node:tls'

/** QQ Mail's SMTP endpoint. Port 465 is implicit TLS; 587 upgrades with STARTTLS. */
const DEFAULT_SMTP_HOST = 'smtp.qq.com'
const DEFAULT_SMTP_PORT = 465
const DEFAULT_TIMEOUT_MS = 20_000

/** Attachment bounds. QQ Mail rejects oversized messages, so the cap stays below it. */
const DEFAULT_MAX_ATTACHMENTS = 20
const DEFAULT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** Credentials document read from the Harness home when `credentialsPath` is unset. */
const CREDENTIALS_FILENAME = 'qq-mail.json'

/** Hard recipient ceiling for one message. A bound, not a deployment choice. */
const MAX_RECIPIENTS = 50

/** File extensions whose media type is sent as declared instead of guessed. */
const MIME_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/plain',
  yml: 'application/yaml',
  yaml: 'application/yaml',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  eml: 'message/rfc822',
  ics: 'text/calendar',
}

/** Stable Loader identity. */
export const name = 'qq-mail'

/** The tool registry is required; the plugin stays inactive without it. */
export const inject = ['tools']

/**
 * Expand a leading `~` to the user's home directory.
 * @param {string} path - a path that may start with `~`, `~/`, or `~\`.
 * @returns {string} the expanded path.
 */
function expandHome(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the Harness home. Mirrors `@deepseek-ai/dsh-home-paths` `resolveDshHome`:
 * an explicit path wins, then a non-blank `$DSH_HOME`, then `~/.dsh`.
 * @param {string} [configured] - explicit override with the highest precedence.
 * @returns {string} the normalized absolute Harness home.
 */
function resolveDshHome(configured) {
  const fromEnv = process.env.DSH_HOME
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh'))
  return resolvePath(expandHome(selected))
}

/**
 * Read one non-blank string, or undefined when the value is absent or blank.
 * @param {unknown} value - candidate row value.
 * @returns {string | undefined} the trimmed value.
 */
function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Read an SMTP authorization code. QQ Mail displays the 16 characters in
 * groups of four, so a pasted code keeps its spaces while the transport needs
 * the bare characters.
 * @param {unknown} value - candidate row value.
 * @returns {string | undefined} the code without whitespace.
 */
function authCodeValue(value) {
  const text = nonBlank(value)
  return text === undefined ? undefined : text.replace(/\s+/g, '')
}

/** One parsed mailbox: a bare address and an optional display name. */
/** @typedef {{ address: string, name: string }} Mailbox */
/** @typedef {{ name: string, mimeType: string, bytes: Buffer }} LoadedAttachment */

/**
 * Parse one `Name <addr>` or bare-address mailbox.
 * @param {string} raw - one mailbox expression.
 * @returns {Mailbox} the parsed mailbox.
 * @throws When the expression cannot be reduced to one plain address.
 */
function parseMailbox(raw) {
  const text = raw.replace(/[\r\n]+/g, ' ').trim()
  const angled = /^(.*?)\s*<([^<>]+)>\s*$/.exec(text)
  const name = angled === null ? '' : angled[1].replace(/^"|"$/g, '').trim()
  const address = (angled === null ? text : angled[2]).trim()
  if (!/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+$/.test(address)) {
    throw new Error(`"${raw}" is not a usable email address: pass a bare address such as name@example.com`)
  }
  return { address, name }
}

/**
 * Split a comma- or semicolon-separated recipient list without breaking quoted
 * display names or angle-bracketed addresses.
 * @param {string} text - one list expression.
 * @returns {string[]} the separated expressions, untrimmed and possibly blank.
 */
function splitRecipients(text) {
  const parts = []
  let quoted = false
  let angled = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') quoted = !quoted
    else if (!quoted && character === '<') angled += 1
    else if (!quoted && character === '>' && angled > 0) angled -= 1
    else if (!quoted && angled === 0 && (character === ',' || character === ';')) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/**
 * Normalize one model-supplied recipient field into mailboxes.
 * @param {unknown} value - a string, an array of strings, or absent.
 * @param {string} field - tool argument name, used in diagnostics.
 * @returns {Mailbox[]} the parsed mailboxes, in written order.
 */
function readRecipients(value, field) {
  if (value === undefined || value === null) return []
  const entries = Array.isArray(value) ? value : [value]
  const mailboxes = []
  for (const entry of entries) {
    if (typeof entry !== 'string') throw new Error(`"${field}" must contain email address strings`)
    for (const part of splitRecipients(entry)) {
      const text = part.trim()
      if (text.length > 0) mailboxes.push(parseMailbox(text))
    }
  }
  return mailboxes
}

/**
 * Encode UTF-8 text as RFC 2047 base64 words, folded so no encoded word exceeds
 * the 75-character limit. Byte chunks are cut on character boundaries.
 * @param {string} text - text that may be non-ASCII.
 * @returns {string} a header value, folded with CRLF + space.
 */
function encodeWords(text) {
  const chunks = []
  let current = Buffer.alloc(0)
  for (const character of text) {
    const bytes = Buffer.from(character, 'utf8')
    if (current.length > 0 && current.length + bytes.length > 30) {
      chunks.push(current)
      current = Buffer.alloc(0)
    }
    current = Buffer.concat([current, bytes])
  }
  if (current.length > 0) chunks.push(current)
  return chunks.map(chunk => `=?UTF-8?B?${chunk.toString('base64')}?=`).join('\r\n ')
}

/**
 * Render one mailbox for a message header. ASCII display names are quoted;
 * anything else becomes an encoded word.
 * @param {Mailbox} mailbox - the parsed mailbox.
 * @returns {string} the header value for one mailbox.
 */
function formatMailbox(mailbox) {
  if (mailbox.name.length === 0) return mailbox.address
  if (/^[\x20-\x7E]*$/.test(mailbox.name)) {
    return `"${mailbox.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" <${mailbox.address}>`
  }
  return `${encodeWords(mailbox.name)} <${mailbox.address}>`
}

/**
 * Build the Subject header value: CRLF is stripped so a model-supplied subject
 * cannot inject headers.
 * @param {string} subject - the requested subject.
 * @returns {string} the header value.
 */
function formatSubject(subject) {
  const flat = subject.replace(/[\r\n]+/g, ' ').trim()
  return /^[\x20-\x7E]*$/.test(flat) ? flat : encodeWords(flat)
}

/**
 * Format one instant as an RFC 5322 date with a numeric zone offset.
 * @param {Date} date - the instant to format.
 * @returns {string} the Date header value.
 */
function rfc5322Date(date) {
  const pad = value => String(value).padStart(2, '0')
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const magnitude = Math.abs(offset)
  return `${days[date.getDay()]}, ${pad(date.getDate())} ${months[date.getMonth()]} ${date.getFullYear()}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + ` ${sign}${pad(Math.floor(magnitude / 60))}${pad(magnitude % 60)}`
}

/**
 * Base64-encode bytes and wrap the result at 76 columns.
 * @param {Buffer} bytes - raw content.
 * @returns {string} the transfer-encoded body.
 */
function wrapBase64(bytes) {
  const encoded = bytes.toString('base64')
  const lines = []
  for (let index = 0; index < encoded.length; index += 76) lines.push(encoded.slice(index, index + 76))
  return lines.join('\r\n')
}

/**
 * Percent-encode one filename for an RFC 2231 `filename*` parameter.
 * @param {string} text - the filename.
 * @returns {string} the encoded parameter value.
 */
function encodeRfc2231(text) {
  return Array.from(Buffer.from(text, 'utf8'), byte => {
    const character = String.fromCharCode(byte)
    return /[A-Za-z0-9!#$&+\-.^_`|~]/.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }).join('')
}

/**
 * Reduce a filename to the ASCII subset older clients read from `filename=`.
 * @param {string} name - the real filename.
 * @returns {string} an ASCII-only filename keeping the extension.
 */
function asciiFileName(name) {
  return name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
}

/**
 * Render one `key="..."` filename parameter, adding the RFC 2231 form when the
 * name is not ASCII.
 * @param {string} key - `name` or `filename`.
 * @param {string} name - the filename.
 * @returns {string} the parameter text.
 */
function fileNameParameter(key, name) {
  if (/^[\x20-\x7E]*$/.test(name)) {
    return `${key}="${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return `${key}="${asciiFileName(name)}"; ${key}*=UTF-8''${encodeRfc2231(name)}`
}

/**
 * Guess the media type from a filename extension.
 * @param {string} name - the filename.
 * @returns {string} the media type, `application/octet-stream` when unknown.
 */
function guessMimeType(name) {
  const dot = name.lastIndexOf('.')
  const extension = dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
  return MIME_TYPES[extension] ?? 'application/octet-stream'
}

/**
 * Render one single-part body section.
 * @param {string} mediaType - `text/plain` or `text/html`.
 * @param {string} text - the decoded body.
 * @returns {string[]} the section header and encoded body lines.
 */
function singleBodySection(mediaType, text) {
  return [
    `Content-Type: ${mediaType}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(text, 'utf8')),
  ]
}

/**
 * Render a `multipart/alternative` section holding the plain and HTML bodies.
 * @param {string} text - the plain body.
 * @param {string} html - the HTML body.
 * @returns {string[]} the section lines, including its own boundaries.
 */
function alternativeBodySection(text, html) {
  const boundary = `=_dsh_alt_${randomUUID()}`
  return [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    ...singleBodySection('text/plain', text),
    `--${boundary}`,
    ...singleBodySection('text/html', html),
    `--${boundary}--`,
  ]
}

/**
 * Render one attachment section.
 * @param {LoadedAttachment} attachment - the file to attach.
 * @returns {string[]} the section header and encoded body lines.
 */
function attachmentSection(attachment) {
  return [
    `Content-Type: ${attachment.mimeType}; ${fileNameParameter('name', attachment.name)}`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; ${fileNameParameter('filename', attachment.name)}`,
    '',
    wrapBase64(attachment.bytes),
  ]
}

/**
 * Compose the RFC 5322 message. Bodies are `multipart/alternative` when both
 * forms are present; attachments promote the message to `multipart/mixed`.
 * @param {{ user: string, fromName?: string }} settings - resolved identity.
 * @param {{ to: Mailbox[], cc: Mailbox[], bcc: Mailbox[], subject: string, text?: string, html?: string, replyTo?: Mailbox, attachments: LoadedAttachment[] }} envelope - message envelope.
 * @param {Date} now - the send instant.
 * @returns {{ messageId: string, content: string }} the Message-ID and the message.
 */
function buildMessage(settings, envelope, now) {
  const domain = settings.user.split('@')[1] ?? 'qq.com'
  const messageId = `<${randomUUID()}.${now.getTime()}@${domain}>`
  const attachments = envelope.attachments
  const mixedBoundary = attachments.length > 0 ? `=_dsh_mixed_${randomUUID()}` : undefined
  const headers = [
    `From: ${formatMailbox({ address: settings.user, name: settings.fromName ?? '' })}`,
    `To: ${envelope.to.map(formatMailbox).join(', ')}`,
  ]
  if (envelope.cc.length > 0) headers.push(`Cc: ${envelope.cc.map(formatMailbox).join(', ')}`)
  if (envelope.replyTo !== undefined) headers.push(`Reply-To: ${formatMailbox(envelope.replyTo)}`)
  headers.push(`Subject: ${formatSubject(envelope.subject)}`)
  headers.push(`Date: ${rfc5322Date(now)}`)
  headers.push(`Message-ID: ${messageId}`)
  headers.push('MIME-Version: 1.0')
  headers.push('X-Mailer: dsh-qq-mail')
  if (mixedBoundary !== undefined) headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`)

  const body = envelope.text !== undefined && envelope.html !== undefined
    ? alternativeBodySection(envelope.text, envelope.html)
    : singleBodySection(
      envelope.html === undefined ? 'text/plain' : 'text/html',
      envelope.html ?? envelope.text ?? '',
    )
  const sections = mixedBoundary === undefined
    ? body
    : [
      `--${mixedBoundary}`,
      ...body,
      ...attachments.flatMap(attachment => [`--${mixedBoundary}`, ...attachmentSection(attachment)]),
      `--${mixedBoundary}--`,
    ]

  return { messageId, content: [...headers, '', ...sections, ''].join('\r\n') }
}

/**
 * One connected SMTP conversation: CRLF line framing, multi-line reply
 * reassembly, and single-owner failure state.
 */
class SmtpLink {
  /**
   * @param {import('node:net').Socket} socket - the connected (or TLS-wrapped) socket.
   * @param {number} timeoutMs - idle budget for one reply.
   */
  constructor(socket, timeoutMs) {
    this.socket = socket
    this.timeoutMs = timeoutMs
    this.buffer = ''
    /** @type {{ resolve: (line: string) => void, reject: (error: Error) => void }[]} */
    this.waiters = []
    /** @type {Error | undefined} */
    this.failure = undefined
    this.onData = chunk => {
      this.buffer += chunk.toString('utf8')
      this.flush()
    }
    this.onError = error => this.fail(error instanceof Error ? error : new Error(String(error)))
    this.onClose = () => this.fail(new Error('the SMTP server closed the connection'))
    this.onTimeout = () => {
      this.fail(new Error(`the SMTP server did not answer within ${this.timeoutMs} ms`))
      this.socket.destroy()
    }
    socket.on('data', this.onData)
    socket.on('error', this.onError)
    socket.on('close', this.onClose)
    socket.setTimeout(this.timeoutMs, this.onTimeout)
  }

  /**
   * Reject every waiting read with one failure and stop accepting new ones.
   * @param {Error} error - the failure that ended this conversation.
   */
  fail(error) {
    if (this.failure !== undefined) return
    this.failure = error
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }

  /** Hand each complete buffered line to the oldest waiter. */
  flush() {
    while (this.waiters.length > 0) {
      const boundary = this.buffer.indexOf('\r\n')
      if (boundary < 0) return
      const line = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + 2)
      const waiter = this.waiters.shift()
      if (waiter !== undefined) waiter.resolve(line)
    }
  }

  /**
   * Read one CRLF-terminated line.
   * @returns {Promise<string>} the line without its terminator.
   */
  readLine() {
    if (this.failure !== undefined) return Promise.reject(this.failure)
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject })
      this.flush()
    })
  }

  /**
   * Read one complete SMTP reply, following `250-` continuation lines.
   * @returns {Promise<{ code: number, text: string, lines: string[] }>} the reply.
   */
  async readReply() {
    /** @type {string[]} */
    const lines = []
    for (;;) {
      const line = await this.readLine()
      if (line.length < 4 || !/^\d{3}[ -]/.test(line)) {
        throw new Error(`the SMTP server sent a malformed reply: ${JSON.stringify(line)}`)
      }
      lines.push(line)
      if (line[3] === ' ') break
    }
    return {
      code: Number(lines[0].slice(0, 3)),
      text: lines.map(line => line.slice(4)).join('\n'),
      lines,
    }
  }

  /**
   * Write one protocol line.
   * @param {string} line - the command or payload, without a terminator.
   */
  write(line) {
    this.socket.write(`${line}\r\n`)
  }

  /** Stop reading this socket without closing the underlying stream. */
  detach() {
    this.socket.removeListener('data', this.onData)
    this.socket.removeListener('error', this.onError)
    this.socket.removeListener('close', this.onClose)
    this.socket.removeListener('timeout', this.onTimeout)
    this.socket.setTimeout(0)
    this.fail(new Error('the SMTP conversation moved to the upgraded TLS connection'))
  }

  /** Detach and close the socket. */
  destroy() {
    this.detach()
    this.socket.destroy()
  }
}

/**
 * Connect to the SMTP endpoint and wait for the transport to be usable.
 * @param {{ host: string, port: number, secure: boolean, timeoutMs: number }} settings - endpoint knobs.
 * @returns {Promise<import('node:net').Socket>} the connected socket.
 */
function openSocket(settings) {
  return new Promise((resolve, reject) => {
    const socket = settings.secure
      ? tlsConnect({ host: settings.host, port: settings.port, servername: settings.host })
      : netConnect({ host: settings.host, port: settings.port })
    const timer = setTimeout(() => {
      socket.destroy(new Error(`connecting to ${settings.host}:${settings.port} timed out after ${settings.timeoutMs} ms`))
    }, settings.timeoutMs)
    const onError = error => settle(error instanceof Error ? error : new Error(String(error)))
    const settle = error => {
      clearTimeout(timer)
      socket.removeListener('error', onError)
      if (error === undefined) resolve(socket)
      else reject(error)
    }
    socket.once('error', onError)
    socket.once(settings.secure ? 'secureConnect' : 'connect', () => settle(undefined))
  })
}

/**
 * Wrap an established plaintext socket in TLS after a `STARTTLS` acceptance.
 * @param {import('node:net').Socket} socket - the plaintext socket.
 * @param {{ host: string, timeoutMs: number }} settings - endpoint knobs.
 * @returns {Promise<import('node:tls').TLSSocket>} the upgraded socket.
 */
function upgradeToTls(socket, settings) {
  return new Promise((resolve, reject) => {
    const secure = tlsConnect({ socket, servername: settings.host })
    const timer = setTimeout(() => {
      secure.destroy(new Error(`the TLS handshake with ${settings.host} timed out after ${settings.timeoutMs} ms`))
    }, settings.timeoutMs)
    const onError = error => settle(error instanceof Error ? error : new Error(String(error)))
    const settle = error => {
      clearTimeout(timer)
      secure.removeListener('error', onError)
      if (error === undefined) resolve(secure)
      else reject(error)
    }
    secure.once('error', onError)
    secure.once('secureConnect', () => settle(undefined))
  })
}

/**
 * Send one command and require an expected reply code.
 * @param {SmtpLink} link - the live conversation.
 * @param {string} line - the command line.
 * @param {number[]} allowed - accepted reply codes.
 * @param {string} label - the phase name used in the failure report.
 * @returns {Promise<{ code: number, text: string, lines: string[] }>} the accepted reply.
 */
async function command(link, line, allowed, label) {
  link.write(line)
  const reply = await link.readReply()
  if (!allowed.includes(reply.code)) {
    throw new Error(`${label} failed: the SMTP server answered ${reply.code} ${reply.text}`)
  }
  return reply
}

/**
 * Greet the server and return its advertised capabilities.
 * @param {SmtpLink} link - the live conversation.
 * @returns {Promise<string[]>} one capability per EHLO line.
 */
async function hello(link) {
  const clientName = hostname().replace(/[^\x21-\x7E]/g, '') || '[127.0.0.1]'
  const reply = await command(link, `EHLO ${clientName}`, [250], 'EHLO')
  return reply.lines.map(line => line.slice(4).trim())
}

/**
 * Read the AUTH mechanisms out of the EHLO capability lines.
 * @param {string[]} capabilities - advertised capability lines.
 * @returns {string[]} upper-cased mechanism names.
 */
function authMechanisms(capabilities) {
  const line = capabilities.find(entry => entry.toUpperCase().startsWith('AUTH '))
  return line === undefined ? [] : line.split(/\s+/).slice(1).map(entry => entry.toUpperCase())
}

/**
 * Authenticate with AUTH LOGIN. QQ Mail requires the SMTP authorization code,
 * not the account password.
 * @param {SmtpLink} link - the live conversation.
 * @param {string[]} capabilities - advertised capability lines.
 * @param {{ user: string, authCode: string, host: string }} settings - resolved credentials.
 * @returns {Promise<void>} resolves once the server accepted the credentials.
 */
async function authenticate(link, capabilities, settings) {
  const mechanisms = authMechanisms(capabilities)
  if (!mechanisms.includes('LOGIN')) {
    throw new Error(`${settings.host} did not offer AUTH LOGIN (offered: ${mechanisms.join(', ') || 'none'})`
      + '; QQ Mail offers AUTH LOGIN when SMTP service is enabled on the account')
  }
  await command(link, 'AUTH LOGIN', [334], 'AUTH LOGIN')
  await command(link, Buffer.from(settings.user, 'utf8').toString('base64'), [334], 'AUTH username')
  link.write(Buffer.from(settings.authCode, 'utf8').toString('base64'))
  const reply = await link.readReply()
  if (reply.code === 235) return
  if (reply.code === 535) {
    throw new Error(`QQ Mail rejected the credentials for ${settings.user} (${reply.text}). `
      + 'Use the SMTP authorization code generated in QQ Mail settings; the QQ account password will not work.')
  }
  throw new Error(`AUTH failed: the SMTP server answered ${reply.code} ${reply.text}`)
}

/**
 * Deliver one composed message through a fresh SMTP conversation.
 * @param {{ host: string, port: number, secure: boolean, timeoutMs: number, user: string, authCode: string }} settings - resolved connection and account knobs.
 * @param {{ recipients: Mailbox[], content: string }} message - envelope recipients and the composed RFC 5322 message.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<string>} the server's acceptance text for the queued message.
 */
async function deliver(settings, message, signal) {
  signal?.throwIfAborted()
  let socket = await openSocket(settings)
  let link = new SmtpLink(socket, settings.timeoutMs)
  const onAbort = () => {
    socket.destroy(new Error('send_mail was cancelled'))
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const greeting = await link.readReply()
    if (greeting.code !== 220) {
      throw new Error(`${settings.host} refused the connection: ${greeting.code} ${greeting.text}`)
    }
    let capabilities = await hello(link)
    if (!settings.secure) {
      if (!capabilities.some(entry => entry.toUpperCase().startsWith('STARTTLS'))) {
        throw new Error(`${settings.host}:${settings.port} does not offer STARTTLS; use port 465 for implicit TLS`)
      }
      await command(link, 'STARTTLS', [220], 'STARTTLS')
      link.detach()
      socket = await upgradeToTls(socket, settings)
      link = new SmtpLink(socket, settings.timeoutMs)
      capabilities = await hello(link)
    }
    await authenticate(link, capabilities, settings)
    await command(link, `MAIL FROM:<${settings.user}>`, [250], 'MAIL FROM')
    for (const recipient of message.recipients) {
      await command(link, `RCPT TO:<${recipient.address}>`, [250, 251], `RCPT TO ${recipient.address}`)
    }
    await command(link, 'DATA', [354], 'DATA')
    link.socket.write(`${message.content}.\r\n`)
    const queued = await link.readReply()
    if (queued.code !== 250) {
      throw new Error(`the message was refused after DATA: the SMTP server answered ${queued.code} ${queued.text}`)
    }
    return queued.text
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await closeQuietly(link)
  }
}

/**
 * Send QUIT and close the conversation, ignoring any failure: the caller is
 * either returning the real outcome or already unwinding from one.
 * @param {SmtpLink} link - the conversation to close.
 * @returns {Promise<void>} resolves after the socket is closed.
 */
async function closeQuietly(link) {
  if (link.failure === undefined) {
    try {
      link.write('QUIT')
      await link.readReply()
    } catch {
      // A refused QUIT only means the server already dropped the conversation.
    }
  }
  link.destroy()
}

/**
 * Read the credentials document.
 * @param {string} path - absolute credentials path.
 * @returns {Promise<{ user?: string, authCode?: string }>} the stored fields, empty when the file does not exist.
 * @throws When the file exists but is not a JSON object.
 */
async function readCredentials(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw new Error(`send_mail cannot read ${path}: ${error?.message ?? String(error)}`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object with "user" and "authCode"`)
  }
  return {
    user: nonBlank(parsed.user),
    authCode: authCodeValue(parsed.authCode),
  }
}

/**
 * Resolve the credentials path for one row.
 * @param {Record<string, unknown>} row - the Loader row's `config`.
 * @returns {string} the absolute credentials path.
 */
function credentialsPath(row) {
  const configured = nonBlank(row.credentialsPath)
  return configured === undefined
    ? join(resolveDshHome(nonBlank(row.dshHome)), CREDENTIALS_FILENAME)
    : resolvePath(expandHome(configured))
}

/**
 * Resolve the SMTP endpoint, identity, and account secret for one call. The
 * secret is read per call so rotating it needs no restart.
 * @param {Record<string, unknown>} row - the Loader row's `config`.
 * @returns {Promise<{ host: string, port: number, secure: boolean, timeoutMs: number, user: string, authCode: string, fromName?: string }>} the resolved settings.
 * @throws When no usable credentials are configured.
 */
async function resolveSettings(row) {
  const path = credentialsPath(row)
  const stored = await readCredentials(path)
  const user = nonBlank(row.user) ?? stored.user
  const authCode = authCodeValue(row.authCode) ?? stored.authCode
  if (user === undefined || authCode === undefined) {
    throw new Error(`send_mail has no QQ Mail credentials. Create ${path} containing `
      + '{"user": "<your QQ email>", "authCode": "<SMTP authorization code>"}. '
      + 'Enable the SMTP service in QQ Mail settings to generate the authorization code.')
  }
  const port = Number.isInteger(row.smtpPort) && row.smtpPort > 0 && row.smtpPort < 65_536
    ? row.smtpPort
    : DEFAULT_SMTP_PORT
  return {
    host: nonBlank(row.smtpHost) ?? DEFAULT_SMTP_HOST,
    port,
    secure: typeof row.secure === 'boolean' ? row.secure : port === 465,
    timeoutMs: Number.isFinite(row.timeoutMs) && row.timeoutMs > 0 ? row.timeoutMs : DEFAULT_TIMEOUT_MS,
    user: parseMailbox(user).address,
    authCode,
    fromName: nonBlank(row.fromName),
  }
}

/**
 * Normalize one model-supplied attachment list.
 * @param {unknown} value - array of `{ path, name?, mimeType? }`, or absent.
 * @param {number} maximum - allowed attachment count.
 * @returns {{ path: string, name?: string, mimeType?: string }[]} the requested attachments.
 * @throws When an entry is malformed or the list exceeds the configured bound.
 */
function readAttachmentRequests(value, maximum) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('"attachments" must be an array of { path, name?, mimeType? }')
  if (value.length > maximum) throw new Error(`send_mail accepts at most ${maximum} attachments per message`)
  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('each attachment must be an object with a "path"')
    }
    const path = nonBlank(entry.path)
    if (path === undefined) throw new Error('each attachment needs a non-empty "path"')
    const name = nonBlank(entry.name)
    const mimeType = nonBlank(entry.mimeType)
    if (mimeType !== undefined && !/^[\w.+-]+\/[\w.+-]+$/.test(mimeType)) {
      throw new Error(`"${mimeType}" is not a valid media type`)
    }
    return { path, name, mimeType }
  })
}

/**
 * Read tool arguments into one envelope.
 * @param {unknown} args - model-supplied tool arguments.
 * @param {{ maxAttachments: number }} limits - configured attachment bound.
 * @returns {{ to: Mailbox[], cc: Mailbox[], bcc: Mailbox[], recipients: Mailbox[], subject: string, text?: string, html?: string, replyTo?: Mailbox, attachmentRequests: { path: string, name?: string, mimeType?: string }[] }} the validated envelope.
 * @throws When a required field is missing or a body is empty.
 */
function readEnvelope(args, limits) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('send_mail arguments must be an object')
  }
  const to = readRecipients(args.to, 'to')
  const cc = readRecipients(args.cc, 'cc')
  const bcc = readRecipients(args.bcc, 'bcc')
  if (to.length === 0) throw new Error('send_mail needs at least one "to" address')
  const recipients = []
  const seen = new Set()
  for (const mailbox of [...to, ...cc, ...bcc]) {
    const key = mailbox.address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    recipients.push(mailbox)
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new Error(`send_mail accepts at most ${MAX_RECIPIENTS} recipients in one message`)
  }
  const subject = typeof args.subject === 'string' ? args.subject.trim() : ''
  if (subject.length === 0) throw new Error('send_mail needs a non-empty "subject"')
  const text = typeof args.text === 'string' && args.text.length > 0 ? args.text : undefined
  const html = typeof args.html === 'string' && args.html.length > 0 ? args.html : undefined
  if (text === undefined && html === undefined) {
    throw new Error('send_mail needs a message body: pass "text", "html", or both')
  }
  const replyTo = typeof args.replyTo === 'string' && args.replyTo.trim().length > 0
    ? parseMailbox(args.replyTo)
    : undefined
  return {
    to, cc, bcc, recipients, subject, text, html, replyTo,
    attachmentRequests: readAttachmentRequests(args.attachments, limits.maxAttachments),
  }
}

/**
 * Read the requested attachment files through the Harness filesystem service so
 * its path policy applies.
 * @param {object} ctx - Host context carrying the optional `fs` and `workingDirectory` services.
 * @param {{ path: string, name?: string, mimeType?: string }[]} requests - requested attachments.
 * @param {number} maxBytes - inclusive total byte budget.
 * @param {object} exec - the tool execution, for the caller identity and cancellation.
 * @returns {Promise<LoadedAttachment[]>} the loaded attachments.
 * @throws When the filesystem service is absent, a file is missing, or the budget is exceeded.
 */
async function loadAttachments(ctx, requests, maxBytes, exec) {
  if (requests.length === 0) return []
  const fs = ctx.get('fs')
  if (fs === undefined) {
    throw new Error('send_mail cannot read attachments because the process has no filesystem service')
  }
  const workingDirectory = ctx.get('workingDirectory')
  const cwd = workingDirectory === undefined
    ? process.cwd()
    : exec.agent === undefined
      ? workingDirectory.defaultDirectory
      : await workingDirectory.ensure(exec.agent, exec.signal)
  const loaded = []
  let total = 0
  for (const request of requests) {
    const target = await fs.resolve(request.path, { cwd, signal: exec.signal })
    const info = await fs.stat(target, exec.signal)
    if (info === undefined) throw new Error(`attachment "${request.path}" does not exist (resolved against ${cwd})`)
    if (info.type !== 'file') throw new Error(`attachment "${request.path}" is not a regular file`)
    const remaining = maxBytes - total
    if (remaining <= 0) throw new Error(`attachments exceed the ${maxBytes}-byte budget`)
    if (info.size !== undefined && info.size > remaining) {
      throw new Error(`attachment "${request.path}" is ${info.size} bytes, over the ${maxBytes}-byte attachment budget`)
    }
    const bytes = Buffer.from(await fs.readBytes(target, exec.signal, remaining))
    total += bytes.byteLength
    loaded.push({
      name: request.name ?? basename(fs.processPath(target)),
      mimeType: request.mimeType ?? guessMimeType(request.name ?? fs.processPath(target)),
      bytes,
    })
  }
  return loaded
}

/** The `send_mail` tool definition registered by this plugin. */
const SEND_MAIL_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    to: {
      type: 'array',
      items: { type: 'string' },
      description: 'One or more recipients, such as "name@example.com" or "Name <name@example.com>".',
    },
    subject: { type: 'string', description: 'Subject line of the message.' },
    text: { type: 'string', description: 'Plain-text body. Provide this, "html", or both.' },
    html: { type: 'string', description: 'HTML body. When "text" is also present the message is sent as multipart/alternative.' },
    cc: { type: 'array', items: { type: 'string' }, description: 'Optional carbon-copy recipients.' },
    bcc: { type: 'array', items: { type: 'string' }, description: 'Optional blind carbon-copy recipients.' },
    replyTo: { type: 'string', description: 'Optional Reply-To address.' },
    attachments: {
      type: 'array',
      description: 'Files to attach. Paths are resolved against the session working directory; absolute paths work too.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Path of an existing regular file.' },
          name: { type: 'string', description: 'Filename shown to the recipient; defaults to the file name.' },
          mimeType: { type: 'string', description: 'Media type; guessed from the extension when omitted.' },
        },
        required: ['path'],
      },
    },
  },
  required: ['to', 'subject'],
}

/** Canonical result of one accepted message. */
const SEND_MAIL_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string' },
    from: { type: 'string' },
    subject: { type: 'string' },
    accepted: { type: 'array', items: { type: 'string' } },
    attachments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          mimeType: { type: 'string' },
          bytes: { type: 'integer' },
        },
        required: ['name', 'mimeType', 'bytes'],
      },
    },
    serverResponse: { type: 'string' },
  },
  required: ['messageId', 'from', 'subject', 'accepted', 'attachments', 'serverResponse'],
}

/**
 * Register the `send_mail` tool for this profile.
 * @param {object} ctx - Host context carrying the tool registry and optional filesystem services.
 * @param {Record<string, unknown>} [config] - the Loader row's `config`.
 */
export function apply(ctx, config) {
  const row = config ?? {}
  const timeoutMs = Number.isFinite(row.timeoutMs) && row.timeoutMs > 0 ? row.timeoutMs : DEFAULT_TIMEOUT_MS
  const maxAttachments = Number.isInteger(row.maxAttachments) && row.maxAttachments > 0
    ? row.maxAttachments
    : DEFAULT_MAX_ATTACHMENTS
  const maxAttachmentBytes = Number.isInteger(row.maxAttachmentBytes) && row.maxAttachmentBytes > 0
    ? row.maxAttachmentBytes
    : DEFAULT_MAX_ATTACHMENT_BYTES
  ctx.effect(() => ctx.tools.register({
    name: 'send_mail',
    description: 'Send an email through the user\'s QQ Mail account over SMTP. '
      + 'Use it when the user asks to send, mail, or email something to a recipient. '
      + 'Provide "to", "subject", and a body ("text", "html", or both); '
      + 'add "attachments" with a file "path" per file to attach local files.',
    parameters: SEND_MAIL_PARAMETERS,
    output: {
      schema: SEND_MAIL_OUTPUT,
      render: (_args, value) => [{
        type: 'text',
        text: `Sent to ${value.accepted.join(', ')}`
          + `\nSubject: ${value.subject}`
          + (value.attachments.length === 0
            ? ''
            : `\nAttachments: ${value.attachments.map(file => `${file.name} (${file.bytes} bytes, ${file.mimeType})`).join(', ')}`)
          + `\nMessage-ID: ${value.messageId}`,
      }],
    },
    timeoutMs: Math.max(timeoutMs * 4, 60_000),
    presentCall(args) {
      const subject = typeof args === 'object' && args !== null && typeof args.subject === 'string'
        ? args.subject.trim()
        : ''
      return { card: 'generic', kind: 'other', title: subject.length > 0 ? `Send mail: ${subject}` : 'Send mail' }
    },
    async execute(args, exec) {
      const envelope = readEnvelope(args, { maxAttachments })
      const settings = await resolveSettings(row)
      const attachments = await loadAttachments(ctx, envelope.attachmentRequests, maxAttachmentBytes, exec)
      const built = buildMessage(settings, { ...envelope, attachments }, new Date())
      const serverResponse = await deliver(settings, { recipients: envelope.recipients, content: built.content }, exec.signal)
      return {
        messageId: built.messageId,
        from: settings.user,
        subject: envelope.subject,
        accepted: envelope.recipients.map(mailbox => mailbox.address),
        attachments: attachments.map(file => ({ name: file.name, mimeType: file.mimeType, bytes: file.bytes.byteLength })),
        serverResponse,
      }
    },
  }))

  const path = credentialsPath(row)
  readCredentials(path).then((stored) => {
    if (stored.user === undefined || stored.authCode === undefined) {
      ctx.logger?.warn?.('qq-mail: no credentials at %s; send_mail will report the missing file until it exists', path)
    }
  }, (error) => {
    ctx.logger?.warn?.('qq-mail: credentials unavailable: %s', error instanceof Error ? error.message : String(error))
  })
}
