// Whether the right-click entry point is offered at all.
//
// Its own preference rather than a corner of the suggestion setting: that one
// is a privacy choice about a history being kept, this one is about an item
// appearing in a menu the browser and every other extension also write into.

import { ageOf } from './clock';
import { createT, loadLanguage, type Language, type TranslationKey } from './i18n';

const ENABLED_KEY = 'quickFillEnabled';
const STRINGS_KEY = 'quickFillStrings';
const PROMPT_KEY = 'quickFillAsked';

/** Watched by the service worker so the menu follows the toggle immediately. */
export const QUICK_FILL_ENABLED_KEY = ENABLED_KEY;
/** Watched for the same reason: new strings mean the menu item has to be redrawn. */
export const QUICK_FILL_STRINGS_KEY = STRINGS_KEY;

// --- the four strings the service worker needs ------------------------------
//
// The worker cannot read the translation tables. They arrive by dynamic
// import, which a service worker does not allow outside its first evaluation —
// the import rejected, and Vite's preload helper then threw
// "window is not defined" out of its own error handler, which is what the
// console was actually showing. i18n.ts had a comment predicting a soft
// failure here; it was soft, but it also meant the right-click menu was in
// English for everyone, in all twenty languages.
//
// Importing the tables statically instead would work and costs half a megabyte
// of parsing every time the worker wakes, for four strings — the exact thing
// the dynamic import exists to avoid. So the popup, which has the table open
// already, writes the four down and the worker reads them.
//
// The gap is a fresh install before the popup has ever been opened: the menu
// item is drawn in English once, and corrected the first time the app is
// opened. That is where it already was.

const WORKER_KEYS = [
  'quickFill.menu',
  'quickFill.copied',
  'quickFill.manual',
  'quickFill.openApp',
] as const satisfies readonly TranslationKey[];

export type QuickFillStrings = Partial<Record<(typeof WORKER_KEYS)[number], string>>;

/**
 * Write the four in the language the app is showing. Called by the popup.
 *
 * Loads the table first rather than trusting the caller to have done it.
 * `createT` reads whichever table is active — the language it is handed is only
 * there so components re-render — so publishing without this wrote English
 * under a Korean label and nothing said so. loadLanguage is cached, so on the
 * path that has already loaded it this costs nothing.
 */
export async function publishQuickFillStrings(language: Language): Promise<void> {
  await loadLanguage(language);
  const t = createT(language);
  const strings: QuickFillStrings = {};
  // The raw template, `{0}` and all: the worker substitutes, because only the
  // worker knows the code.
  for (const key of WORKER_KEYS) strings[key] = t(key);
  await chrome.storage.local.set({ [STRINGS_KEY]: strings }).catch(() => {});
}

/** Read them back, or nothing at all before the popup has ever run. */
export async function readQuickFillStrings(): Promise<QuickFillStrings> {
  try {
    const stored = (await chrome.storage.local.get(STRINGS_KEY))[STRINGS_KEY];
    return stored && typeof stored === 'object' ? (stored as QuickFillStrings) : {};
  } catch {
    return {};
  }
}

/** On by default — an entry point nobody discovers is not worth shipping. */
export async function isQuickFillEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(ENABLED_KEY);
    return result[ENABLED_KEY] !== false;
  } catch {
    return true;
  }
}

export async function setQuickFillEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [ENABLED_KEY]: enabled });
}

// --- "which account for this site?" -----------------------------------------
//
// When quick fill cannot tell which account a site wants, it opens the popup
// and the user picks one. That pick is the best evidence there is about the
// site — far better than an ordinary copy, which carries the hostname of
// whatever tab was open and frequently means nothing by it. The two are
// indistinguishable inside the popup, so the question has to be left where the
// answer can find it.
//
// Session storage, never local: this is a hostname, which is exactly the
// metadata the vault promises a stolen profile will not give up. It is also
// short-lived by nature, and a marker that outlived the browser would credit
// an unrelated copy days later.

interface PickPrompt {
  hostname: string;
  at: number;
}

/**
 * How long an unanswered question stays open.
 *
 * Long enough to unlock a vault and find the account, short enough that the
 * popup opened for one site cannot lend its weight to a copy made for another
 * once the user has moved on.
 */
const PROMPT_MAX_AGE_MS = 2 * 60 * 1000;

function hasSessionStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.session;
}

/** Record that the popup is being opened to ask about this site. */
export async function notePickPrompt(hostname: string): Promise<void> {
  if (!hostname || !hasSessionStorage()) return;
  await chrome.storage.session
    .set({ [PROMPT_KEY]: { hostname, at: Date.now() } satisfies PickPrompt })
    .catch(() => {});
}

async function storedPrompt(): Promise<PickPrompt | null> {
  if (!hasSessionStorage()) return null;
  try {
    const stored = (await chrome.storage.session.get(PROMPT_KEY))[PROMPT_KEY] as PickPrompt | undefined;
    return stored ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether the question is still open.
 *
 * An unusable stamp — a clock wound back between the two — fails closed: an
 * unearned boost is exactly what this whole mechanism exists to avoid.
 */
function isOpen(prompt: PickPrompt): boolean {
  const age = ageOf(prompt.at);
  return age !== null && age <= PROMPT_MAX_AGE_MS;
}

/**
 * The site an open question is about, for the popup to name above the list.
 *
 * Read without consuming. Naming the site is not an answer to the question —
 * the answer is whichever account the user goes on to pick, and that is what
 * takePickPrompt below spends the question on.
 */
export async function peekPickPrompt(): Promise<string | null> {
  const stored = await storedPrompt();
  return stored && isOpen(stored) ? stored.hostname : null;
}

/**
 * Was the account about to be copied an answer to that question?
 *
 * Consumed on read: one question earns one answer. A second copy in the same
 * popup is the user helping themselves to another code, not telling us
 * anything more about the site.
 */
export async function takePickPrompt(hostname: string): Promise<boolean> {
  if (!hostname) return false;
  const stored = await storedPrompt();
  if (!stored) return false;

  await chrome.storage.session.remove(PROMPT_KEY).catch(() => {});
  return stored.hostname === hostname && isOpen(stored);
}
