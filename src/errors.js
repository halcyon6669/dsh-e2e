/**
 * dsh-e2e — turning a thrown thing into a sentence a reader can act on.
 *
 * Node hands back failures that say nothing on their own: an `AggregateError`
 * from a dual-stack connect has an always-empty `message` and keeps the real
 * reasons in `errors`, and a socket error often carries only a `code`. A report
 * that prints `{name: "AggregateError", message: ""}` has recorded that something
 * failed without recording what, which is the one thing a failure entry must
 * never do.
 */

/** The best sentence available for `error`, never the empty string. */
export function describeError(error) {
  if (!error) return ''
  const own = typeof error.message === 'string' ? error.message.trim() : ''
  if (own) return own
  if (Array.isArray(error.errors) && error.errors.length > 0) {
    const parts = error.errors.map((item) => describeError(item) || (item && item.code) || '').filter(Boolean)
    if (parts.length > 0) return parts.join('; ')
    return `${error.name || 'Error'} with ${error.errors.length} failure(s)`
  }
  if (error.code) return `${error.name || 'Error'} (${error.code})`
  return `${error.name || 'Error'} was thrown without a message`
}
