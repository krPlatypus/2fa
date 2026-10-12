// One writer at a time, across every context the extension runs in.
//
// The account list and the vault metadata are each a single chrome.storage
// value, rewritten whole by whoever changes them. Since 1.13.0 the floating
// window, the side panel, the scanner tab, the passkey page and the service
// worker all do that, side by side, and chrome.storage offers no
// compare-and-swap. A revision stamp checked before a slow save was not enough:
// the check and the write were separated by encryption, a shrink-guard read and
// a revision read, and the other context's write landed in between. Measured
// with real latency, a delete racing an add brought the deleted account back
// 48 times in 50 and lost the added one 10 times; two adds lost one 9 times.
//
// Web Locks are shared by every same-origin context, service worker included,
// are released by the browser if the holder dies, and grant in request order —
// exactly the mutex this needs. Where they are missing (an old Chrome, a test
// runner without them) this falls back to a queue inside the current context,
// which is what the code relied on before and never worse than that.
//
// Not re-entrant, like the Web Locks it wraps: code already holding a lock must
// not ask for the same one again, or it waits for itself forever. storage.ts
// keeps an unlocked variant of every read it needs inside a locked section.

/** Account records, the revision stamp, and the vault metadata. */
export const ACCOUNTS_LOCK = 'authenticator-accounts';
/** The unlocked key in session storage: reading it refreshes it, locking removes it. */
export const SESSION_LOCK = 'authenticator-vault-session';

const fallbackQueues = new Map<string, Promise<unknown>>();

function lockManager(): LockManager | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

export function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = lockManager();
  if (locks) return locks.request(name, () => fn()) as Promise<T>;

  // Chained whether or not the previous holder succeeded — a failed write must
  // not wedge every later one for the rest of the session.
  const previous = fallbackQueues.get(name) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  fallbackQueues.set(name, next.catch(() => {}));
  return next;
}

export function withAccountsLock<T>(fn: () => Promise<T>): Promise<T> {
  return withLock(ACCOUNTS_LOCK, fn);
}
