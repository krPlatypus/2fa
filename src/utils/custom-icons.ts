// Icons the user chose: an uploaded picture for an account, a lucide name for
// a group.
//
// Its own store rather than a field on the account, for one reason. The
// account records go to chrome.storage.sync, which allows 8 KB per key and
// about 100 KB in total, and the accounts already spend up to 84 KB of that
// (see the chunking in storage.ts). A 32x32 PNG is 1-2 KB as a data URL, so a
// couple of dozen of them would take the rest and stop sync working — for a
// picture. Keeping them out here also means the account merge, which is the
// most load-bearing code in the project, does not have to learn a new field it
// must never drop.
//
// The consequence is that icons are local to one browser. A backup file does
// not carry them yet either, so restoring on a second machine brings the
// accounts and not their pictures. That is the price of the paragraph above,
// and the place to change it is the backup format rather than sync.
//
// Encrypted under the vault. This is not a formality: the vault's promise is
// that a stolen profile says nothing about which services the user holds, and
// a Google logo sitting in the clear in local storage says it plainly. Usage
// history and the active group filter are wiped for exactly this reason
// (storage.ts), but wiping is wrong here — the pictures are work the user did.
// So they are sealed with the same data key the accounts use, and the seal is
// applied and lifted where the vault is switched on and off.

import { decryptJson, encryptJson, type EncryptedPayload } from './crypto';
import { getMasterKeyBytes, deriveKeys, isVaultEnabled } from './vault';

const STORAGE_KEY = 'customIcons';

/** Edge of the square every upload is redrawn into. */
export const ICON_PX = 32;

/** The largest file worth opening. Anything real is far under this. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * The largest a stored icon may be, as a data URL.
 *
 * A 32x32 PNG lands around 1-2 KB. 16 KB is loose enough that no honest
 * picture hits it and tight enough that a pathological one cannot fill the
 * profile. Photographic sources are re-encoded, not passed through, so this is
 * a guard rather than a limit anyone meets.
 */
const MAX_ICON_BYTES = 16 * 1024;

export interface IconStore {
  /** Account id to a 32x32 PNG data URL. */
  accounts: Record<string, string>;
  /** Group name to a lucide icon name. */
  groups: Record<string, string>;
}

/**
 * A fresh empty store, never a shared constant.
 *
 * It was a shared constant, and `update` below mutates whatever it is handed
 * before writing it — so the first icon ever set wrote itself into that
 * constant, and every later "there is nothing here" answer came back holding
 * it. Which meant a locked vault handed out the icons it had just sealed.
 */
function empty(): IconStore {
  return { accounts: {}, groups: {} };
}

/** What sits under the key: the store, or the store sealed. */
type Stored = IconStore | { enc: EncryptedPayload };

function isSealed(value: unknown): value is { enc: EncryptedPayload } {
  return !!value && typeof (value as { enc?: unknown }).enc === 'string';
}

/** A stored value read back as a store, copied rather than aliased. */
function shape(value: unknown): IconStore {
  const store = (value ?? {}) as Partial<IconStore>;
  return {
    accounts: store.accounts && typeof store.accounts === 'object' ? { ...store.accounts } : {},
    groups: store.groups && typeof store.groups === 'object' ? { ...store.groups } : {},
  };
}

async function dataKey(): Promise<CryptoKey | null> {
  const masterKeyBytes = await getMasterKeyBytes();
  if (!masterKeyBytes) return null;
  return (await deriveKeys(masterKeyBytes)).dataKey;
}

async function readRaw(): Promise<Stored | undefined> {
  try {
    return (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as Stored | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every icon the user has set, or nothing.
 *
 * Fails soft on a locked vault and on anything unreadable. These are pictures:
 * a list drawn with initials is a worse list, where a list that refuses to draw
 * is a broken app.
 */
export async function getCustomIcons(): Promise<IconStore> {
  const raw = await readRaw();
  if (!raw) return empty();
  if (!isSealed(raw)) return shape(raw);

  const key = await dataKey();
  if (!key) return empty();
  try {
    return shape(await decryptJson<IconStore>(raw.enc, key));
  } catch {
    return empty();
  }
}

async function writeStore(store: IconStore): Promise<void> {
  const sealed = await isVaultEnabled();
  if (!sealed) {
    await chrome.storage.local.set({ [STORAGE_KEY]: store });
    return;
  }

  const key = await dataKey();
  // Locked, and there is no key to seal with. Dropping the write is the only
  // safe answer: writing it in the clear would undo the whole point of sealing.
  if (!key) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: { enc: await encryptJson(store, key) } });
}

/** Read, change, write. There is one key, so the whole store is rewritten. */
async function update(change: (store: IconStore) => void): Promise<void> {
  const store = await getCustomIcons();
  change(store);
  await writeStore(store);
}

export class IconTooLargeError extends Error {
  constructor() {
    super('That icon is too large to store');
    this.name = 'IconTooLargeError';
  }
}

/** Set or clear the picture for one account. */
export async function setAccountIcon(accountId: string, dataUrl: string | null): Promise<void> {
  if (dataUrl && dataUrl.length > MAX_ICON_BYTES) throw new IconTooLargeError();
  await update(store => {
    if (dataUrl) store.accounts[accountId] = dataUrl;
    else delete store.accounts[accountId];
  });
}

/** Set or clear the lucide icon for one group. */
export async function setGroupIcon(group: string, iconName: string | null): Promise<void> {
  const name = group.trim();
  if (!name) return;
  await update(store => {
    if (iconName) store.groups[name] = iconName;
    else delete store.groups[name];
  });
}

/**
 * Forget the pictures of accounts that no longer exist.
 *
 * Called after a delete rather than instead of one: an orphaned data URL is
 * only wasted space, and losing a picture because a write raced a delete would
 * be worse than keeping one too long.
 */
export async function forgetAccountIcons(keepIds: string[]): Promise<void> {
  const keep = new Set(keepIds);
  const store = await getCustomIcons();
  const stale = Object.keys(store.accounts).filter(id => !keep.has(id));
  if (stale.length === 0) return;
  for (const id of stale) delete store.accounts[id];
  await writeStore(store);
}

/**
 * Seal what is there in the clear. Called where the vault is switched on.
 *
 * Takes the key it is given rather than reading the session, because at that
 * moment the vault is mid-commit and the key it is being built with is the one
 * that has to be used.
 */
export async function sealCustomIcons(key: CryptoKey): Promise<void> {
  const raw = await readRaw();
  if (!raw || isSealed(raw)) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: { enc: await encryptJson(shape(raw), key) } });
}

/** Lift the seal. Called where the vault is switched off. */
export async function unsealCustomIcons(key: CryptoKey): Promise<void> {
  const raw = await readRaw();
  if (!isSealed(raw)) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: shape(await decryptJson<IconStore>(raw.enc, key)) });
  } catch {
    // Sealed by a vault whose key this is not. Leaving it sealed keeps it
    // unreadable; removing it would throw away pictures that the right key
    // still opens.
  }
}

/**
 * A picture file redrawn as a 32x32 PNG data URL.
 *
 * Redrawn, never stored as it arrived. That fixes the size, which is what
 * makes the budget above predictable, and it means an SVG never reaches
 * storage or the DOM as an SVG — the raster is the sanitiser.
 *
 * Fitted rather than filled: a wide logo keeps its shape and gains transparent
 * margins instead of having its ends cropped off.
 */
export async function fileToIcon(file: Blob): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new IconTooLargeError();

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('That file could not be read as an image'));
      element.src = url;
    });

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    // An SVG with no width, height or viewBox has no intrinsic size, and
    // drawing it would produce an empty square rather than an error.
    if (!width || !height) throw new Error('That image has no size to draw');

    const canvas = document.createElement('canvas');
    canvas.width = ICON_PX;
    canvas.height = ICON_PX;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser would not give a canvas');

    const scale = Math.min(ICON_PX / width, ICON_PX / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    context.drawImage(
      image,
      (ICON_PX - drawWidth) / 2,
      (ICON_PX - drawHeight) / 2,
      drawWidth,
      drawHeight
    );

    const dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > MAX_ICON_BYTES) throw new IconTooLargeError();
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}
