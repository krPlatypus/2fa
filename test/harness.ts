// Minimal test harness: in-memory chrome.storage and IndexedDB so the storage
// and vault modules can run under Node exactly as they do in the browser.
//
// Install the mocks BEFORE importing anything from src/ — those modules read
// `chrome` at call time but the import graph is easier to reason about if the
// globals are already in place.

type Store = Record<string, any>;

export const areas = { local: {} as Store, sync: {} as Store, session: {} as Store };
export let backupRows: any[] = [];

/**
 * Fault injection.
 *
 * The failures that matter here are the ones the browser produces and we never
 * see in development: IndexedDB refusing to open on a profile with site data
 * blocked, a storage write rejected by quota. Both have already cost users their
 * accounts, so both need to be reachable from a test.
 */
export const faults = {
  /** `indexedDB.open` fires onerror instead of onsuccess. */
  indexedDB: false,
  /** `chrome.storage.local.set` rejects for any write touching this key. */
  failLocalSetFor: null as string | null,
  /** `chrome.storage.local.get` rejects when this key is requested. */
  failLocalGetFor: null as string | null,
  /** `chrome.storage.sync.set` rejects, as it does when a value is over quota. */
  failSyncSet: false,
};

export function resetFaults(): void {
  faults.indexedDB = false;
  faults.failLocalSetFor = null;
  faults.failLocalGetFor = null;
  faults.failSyncSet = false;
}

// chrome.storage accepts either a callback or returns a promise, and the source
// uses both styles depending on the module. A mock that only honours one of
// them leaves the other caller awaiting forever.
/**
 * Listeners registered through chrome.storage.onChanged.
 *
 * Real Chrome fires these on every write, and the popup now depends on them: a
 * passkey ceremony runs in another context, so the only way a live popup learns
 * it was unlocked is a change event. Without emission here that wiring would be
 * untestable, which is how it shipped broken the first time.
 */
type ChangeListener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void;
const changeListeners: ChangeListener[] = [];

function emitChanges(
  name: 'local' | 'sync' | 'session',
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>
): void {
  if (Object.keys(changes).length === 0) return;
  for (const listener of [...changeListeners]) {
    setTimeout(() => listener(changes, name), 0);
  }
}

function makeArea(store: Store, name: 'local' | 'sync' | 'session') {
  const settle = <T>(value: T, callback?: (value: T) => void): Promise<T> => {
    if (callback) {
      setTimeout(() => callback(value), 0);
    }
    return Promise.resolve(value);
  };

  const rejectionFor = (obj: Store): Error | null => {
    if (name === 'local' && faults.failLocalSetFor && faults.failLocalSetFor in obj) {
      return new Error(`Simulated failure writing ${faults.failLocalSetFor}`);
    }
    if (name === 'sync' && faults.failSyncSet) {
      return new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
    }
    return null;
  };

  return {
    get(keys: string | string[] | null | undefined, callback?: (items: Store) => void) {
      if (
        name === 'local' &&
        faults.failLocalGetFor &&
        (Array.isArray(keys) ? keys : [keys]).includes(faults.failLocalGetFor)
      ) {
        return Promise.reject(new Error(`Simulated failure reading ${faults.failLocalGetFor}`));
      }
      // null/undefined means "everything", which is how the source enumerates
      // the sync chunks. Treating it as a key name made every chunked read and
      // every cleanup silently return nothing.
      if (keys === null || keys === undefined) {
        return settle({ ...store }, callback);
      }
      const wanted = Array.isArray(keys) ? keys : [keys];
      const items: Store = {};
      for (const key of wanted) {
        if (key in store) items[key] = store[key];
      }
      return settle(items, callback);
    },
    set(obj: Store, callback?: () => void) {
      const rejection = rejectionFor(obj);
      if (rejection) return Promise.reject(rejection);
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const key of Object.keys(obj)) {
        changes[key] = { oldValue: store[key], newValue: obj[key] };
      }
      Object.assign(store, obj);
      emitChanges(name, changes);
      return settle(undefined as void, callback);
    },
    remove(keys: string | string[], callback?: () => void) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (key in store) changes[key] = { oldValue: store[key], newValue: undefined };
        delete store[key];
      }
      emitChanges(name, changes);
      return settle(undefined as void, callback);
    },
  };
}

const later = (fn: () => void) => setTimeout(fn, 0);

/**
 * navigator.locks, as every extension context shares it.
 *
 * Exclusive, granted in request order, released when the callback settles —
 * the subset of the Web Locks API storage uses. It lives on globalThis, so the
 * separate module instances a test loads to stand for separate contexts (a
 * popup and the scanner tab, say) all contend for the same locks, as they do in
 * Chrome. Without it every multi-context scenario would be exercising the
 * in-context fallback instead of the mutex the extension actually runs on.
 */
function makeLockManager() {
  const tails = new Map<string, Promise<void>>();
  const busy = new Map<string, number>();
  return {
    request(name: string, optionsOrCallback: unknown, maybeCallback?: unknown) {
      const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as (
        lock: { name: string; mode: string } | null
      ) => unknown;
      const options = (typeof optionsOrCallback === 'object' ? optionsOrCallback : {}) as { ifAvailable?: boolean };
      // ifAvailable: granted only when nobody holds or waits for the lock;
      // otherwise the callback runs at once with null, as in Chrome.
      if (options?.ifAvailable && busy.get(name)) return Promise.resolve().then(() => callback(null));
      busy.set(name, (busy.get(name) ?? 0) + 1);
      const previous = tails.get(name) ?? Promise.resolve();
      let release!: () => void;
      const held = new Promise<void>(resolve => (release = resolve));
      tails.set(name, previous.then(() => held));
      return previous.then(async () => {
        try {
          return await callback({ name, mode: 'exclusive' });
        } finally {
          busy.set(name, (busy.get(name) ?? 1) - 1);
          release();
        }
      });
    },
  };
}

/** Take navigator.locks away, to exercise the in-context fallback; true puts it back. */
export function setWebLocks(available: boolean): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: available ? { locks: makeLockManager() } : {},
    configurable: true,
    writable: true,
  });
}

export function installMocks(): void {
  setWebLocks(true);

  (globalThis as any).chrome = {
    storage: {
      local: makeArea(areas.local, 'local'),
      sync: makeArea(areas.sync, 'sync'),
      session: makeArea(areas.session, 'session'),
      onChanged: {
        addListener(listener: ChangeListener) {
          changeListeners.push(listener);
        },
        removeListener(listener: ChangeListener) {
          const at = changeListeners.indexOf(listener);
          if (at >= 0) changeListeners.splice(at, 1);
        },
      },
    },
    runtime: { getManifest: () => ({ version: 'test' }) },
  };

  (globalThis as any).indexedDB = {
    open() {
      const request: any = {};
      if (faults.indexedDB) {
        later(() => {
          request.error = new Error('Simulated IndexedDB failure');
          request.onerror?.();
        });
        return request;
      }
      later(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => ({ createIndex: () => {} }),
          close() {},
          transaction() {
            const tx: any = {};
            const store = {
              add(value: any) {
                const r: any = {};
                backupRows.push(value);
                later(() => {
                  r.onsuccess?.();
                  tx.oncomplete?.();
                });
                return r;
              },
              getAll() {
                const r: any = { result: [...backupRows] };
                later(() => r.onsuccess?.());
                return r;
              },
              get(id: string) {
                const r: any = { result: backupRows.find(x => x.id === id) };
                later(() => r.onsuccess?.());
                return r;
              },
              delete(id: string) {
                backupRows = backupRows.filter(x => x.id !== id);
              },
              clear() {
                backupRows = [];
              },
            };
            tx.objectStore = () => store;
            later(() => tx.oncomplete?.());
            return tx;
          },
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
}

/**
 * Let fire-and-forget work settle. Writes to chrome.storage.sync are
 * deliberately not awaited by saveAccounts — a quota rejection must not fail
 * the local save — so assertions about sync need to yield first.
 */
export async function flush(): Promise<void> {
  // A sync push is several awaits deep (enabled check, chunk write, stale-key
  // cleanup), so one turn of the loop is not enough to see it land.
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

/**
 * Make chrome.storage take real time: `ms` before every get, set and remove.
 *
 * The mocks otherwise resolve as microtasks, so two writers never actually
 * interleave and every race between contexts passes by accident. Returns the
 * function that puts the instant versions back.
 */
export function withLatency(ms: number): () => void {
  const originals: Array<() => void> = [];
  for (const name of ['local', 'sync'] as const) {
    const area: any = chrome.storage[name];
    for (const method of ['get', 'set', 'remove']) {
      const original = area[method];
      area[method] = async (...args: unknown[]) => {
        await new Promise(resolve => setTimeout(resolve, ms));
        return original.apply(area, args);
      };
      originals.push(() => { area[method] = original; });
    }
  }
  return () => originals.forEach(undo => undo());
}

/** A second copy of storage.ts, standing for another extension page. */
export async function storageContext(tag: string): Promise<typeof import('@/utils/storage')> {
  return import(new URL(`../src/utils/storage.ts?ctx=${tag}`, import.meta.url).href);
}

/** Every sync key currently holding accounts, chunked or legacy. */
export function syncAccountKeys(): string[] {
  return Object.keys(areas.sync).filter(key => key.startsWith('authenticator_accounts'));
}

/**
 * Present this profile as one that has already seen chrome.storage.sync work.
 *
 * Storage holds pushes back while the sync area is empty AND has never been
 * observed to hold anything, because on a real profile that state is
 * indistinguishable from "the download has not arrived yet" — and writing into
 * it replaces the cloud copy. Scenarios about an existing install would
 * otherwise all be testing the first-run hold instead of what they are about.
 *
 * Scenarios that DO want the fresh-profile behaviour skip this (see
 * `resetStateFreshProfile`).
 */
export function markSyncEstablished(): void {
  areas.local.syncObserved = true;
}

/** Wipe all persisted state between scenarios so they cannot leak into each other. */
export async function resetState(): Promise<void> {
  await resetStateFreshProfile();
  markSyncEstablished();
}

/** As `resetState`, but leaves the profile looking newly installed. */
export async function resetStateFreshProfile(): Promise<void> {
  // A save's sync push is not awaited, and it now queues behind the accounts
  // lock. Left running, the previous scenario's push lands after the wipe below
  // and hands this scenario a sync area full of someone else's accounts. The
  // lock is FIFO, so taking it once waits out everything already queued.
  const locks = (globalThis as any).navigator?.locks;
  if (locks) await locks.request('authenticator-accounts', async () => {});
  await flush();

  for (const store of Object.values(areas)) {
    for (const key of Object.keys(store)) delete store[key];
  }
  backupRows = [];
  resetFaults();
  const { clearKeyCache } = await import('@/utils/vault');
  clearKeyCache();
  const { resetQuarantine } = await import('@/utils/storage');
  resetQuarantine();
}

export function setBackupRows(rows: any[]): void {
  backupRows = rows;
}

// --- assertions -----------------------------------------------------------

let failures = 0;
let currentScenario = '';

export function scenario(name: string): void {
  currentScenario = name;
  console.log(`\n${name}`);
}

export function check(description: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok   ${description}`);
  } else {
    failures++;
    console.log(`  FAIL ${description}${detail ? ` — ${detail}` : ''}`);
  }
}

export async function throwsNamed(name: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (error: any) {
    return error?.name === name;
  }
}

export function failureCount(): number {
  return failures;
}

export function currentScenarioName(): string {
  return currentScenario;
}
