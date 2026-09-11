/**
 * How an account is named to the user, in one place.
 *
 * "Issuer: name" is right when the two say different things — "GitHub:
 * ada@work.com". It is wrong when they say the same thing, which is common:
 * an account added by hand with one word in both fields renders as "vpn: vpn",
 * and the delete confirmation asked "Delete lenagjeka: lenagjeka?".
 *
 * A `label` on the account replaces the whole thing — that is what it is for.
 *
 * Typed defensively for the same reason `group` is: these fields arrive from
 * imported files as well as from our own form, and a number here used to reach
 * `.trim()` and take the popup down with it.
 */
export function accountLabel(account: { issuer?: unknown; name?: unknown; label?: unknown }): string {
  // A name the user typed for this row wins outright. It exists because issuer
  // and name are load-bearing elsewhere — matching, brand marks, the exported
  // URI — so the only safe way to rename a row is to not rename those.
  const label = typeof account.label === 'string' ? account.label.trim() : '';
  if (label) return label;

  const issuer = typeof account.issuer === 'string' ? account.issuer.trim() : '';
  const name = typeof account.name === 'string' ? account.name.trim() : '';
  if (!issuer) return name;
  if (!name) return issuer;
  // Case-insensitive: "Vpn" and "vpn" are the same word to a reader.
  if (issuer.toLowerCase() === name.toLowerCase()) return issuer;
  return `${issuer}: ${name}`;
}
