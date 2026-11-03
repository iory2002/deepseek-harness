# QQ Mail Sender

Adds a `send_mail` tool to the Harness that sends email through your QQ Mail
account over SMTP (`smtp.qq.com`). Port 465 uses implicit TLS; port 587 upgrades
with STARTTLS. Nothing else is required: the plugin uses only Node builtins, so
installing the bundle installs no npm dependency.

## Credentials

QQ Mail does not accept the QQ account password over SMTP. Generate an
authorization code first:

1. Open <https://mail.qq.com>, then Settings → Account.
2. Enable **POP3/SMTP service** (or **IMAP/SMTP service**).
3. Generate an authorization code — the 16-character string, not the password.

Store it outside the bundle, in the Harness home:

`~/.dsh/qq-mail.json`

```json
{
  "user": "123456789@qq.com",
  "authCode": "abcdefghijklmnop"
}
```

The file is read on every send, so rotating the code needs no restart. Keep it
out of source control. `credentialsPath` overrides the location.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `smtpHost` | `smtp.qq.com` | SMTP endpoint. |
| `smtpPort` | `465` | 465 selects implicit TLS; any other port uses STARTTLS. |
| `secure` | `port === 465` | Explicit transport override. |
| `fromName` | — | Display name on the From header. |
| `credentialsPath` | `<DSH_HOME>/qq-mail.json` | Credentials document. |
| `user` | — | Address override; wins over the credentials file. |
| `authCode` | — | Authorization-code override; wins over the credentials file. Prefer the file. |
| `timeoutMs` | `20000` | Idle budget for one SMTP reply. |
| `maxAttachments` | `20` | Maximum attachments in one message. |
| `maxAttachmentBytes` | `26214400` (25 MiB) | Combined size of all attachments in one message. |
| `dshHome` | `$DSH_HOME`, then `~/.dsh` | Base directory for `credentialsPath`. |

## The tool

`send_mail` takes `to` (required), `subject` (required), and a body — `text`,
`html`, or both (sent as `multipart/alternative`). `cc`, `bcc`, `replyTo`, and
`attachments` are optional. Recipients accept `name@example.com` or
`Name <name@example.com>`.

`attachments` is an array of `{ path, name?, mimeType? }`. Paths resolve against
the Session working directory and are read through the Harness filesystem
service, so its path policy applies. Each file becomes one `multipart/mixed`
part with base64 content transfer encoding; `name` overrides the filename shown
to the recipient and `mimeType` overrides the media type guessed from the
extension. Non-ASCII filenames are emitted in both the quoted and the RFC 2231
`filename*` form, so older clients still show an ASCII approximation.

The result carries the `Message-ID`, the accepted addresses, and the server's
queue acknowledgement.

## Known Limitations and Deferred Work

- No inline images: an image is always an attachment, never a `cid:` body part.
- No retry: a transient SMTP failure surfaces as a tool error, and the model may
  call the tool again.
- Cancellation is checked before the conversation and before `DATA`; an abort
  during `DATA` closes the socket and leaves the server's acceptance unknown.
- Attachments are buffered in memory as base64, so the configured size cap also
  bounds the Host's memory use for one send.
