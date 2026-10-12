// Reading backup files written by other authenticators, and our own, into
// records that are safe to store.
//
// Why this is its own module: the JSON importer used to treat ANY array of
// objects with a `secret` string as our own backup and spread every field of it
// into storage. That quietly accepted andOTP and Raivo exports and got them
// wrong — the HOTP entries became 30-second TOTP accounts, a Raivo `timer` of 60
// was dropped for 30, andOTP's `label` was ignored so every account was named
// after its issuer — and it accepted files that were not backups at all. A
// user restoring an Alibaba Cloud app backup got several cards reading
// "Unknown", each with a secret no generator can use, and an "Import
// successful!" on top.
//
// So every entry now goes through one gate, whatever file it came from:
// - an entry that is not TOTP is refused and COUNTED as unsupported. A counter
//   or a Steam token stored as TOTP shows a healthy code that never works.
// - an entry whose secret cannot produce a code is refused and counted as
//   unreadable. Never stored: a broken card is worse than a missing one,
//   because it looks like the account is still there.
// - what IS stored is built field by field. Unknown keys (thumbnails, tags,
//   icon blobs, usage counters) used to ride along into storage and sync, where
//   they cost quota on every device and were never read.

import type { Account } from '@/types';
import { parseQRCode, UnsupportedOTPTypeError } from './qr-parser';
import { cleanSecret, isUsableSecret } from './totp';

/** What one import did, in the terms the user needs to hear it. */
export interface ImportReport {
  /** Records actually written. */
  added: number;
  /** Usable entries the list already held (or the file held twice). */
  alreadyHere: number;
  /** Entries with no secret a code can be generated from. */
  unreadable: number;
  /** Entries understood and refused: counter-based, Steam, and the like. */
  unsupported: number;
}

export type ImportRejection =
  /** Not a file we know, and nothing in it could be used. */
  | 'unknown-format'
  /** A format we know, but not one entry in it could be read. */
  | 'nothing-readable'
  /** Every entry is a kind of code this app does not generate. */
  | 'only-unsupported'
  /** Another app's backup, encrypted with that app's own password. */
  | 'encrypted';

/**
 * The file was read and refused as a whole. Carries the reason so the message
 * can say what to do next, instead of "please check the file format" — which
 * sends someone holding an encrypted Aegis backup off to check a file that is
 * perfectly fine.
 */
export class ImportRejectedError extends Error {
  constructor(
    readonly reason: ImportRejection,
    /** For `encrypted`: the app that wrote the file, as its users know it. */
    readonly app?: string
  ) {
    super(`Import rejected: ${reason}`);
    this.name = 'ImportRejectedError';
  }
}

/** Entries pulled out of a file, before any of them is judged. */
export interface ImportFile {
  entries: unknown[];
  /** Refused while reading the file, before the entries were even built. */
  unreadable: number;
  unsupported: number;
  /**
   * Whether the file is a format we know. Decides which message a file with
   * nothing usable in it gets: "none of these could be read" for a damaged
   * backup, "this isn't a format we can read" for the encrypted proprietary
   * ones that look like JSON but are not ours.
   */
  recognised: boolean;
}

// ---- parameter repair ------------------------------------------------------
//
// The same ranges generation applies (safePeriod / safeDigits / safeAlgorithm
// in totp.ts). Storing a value generation would then repair means the record
// and the code disagree about the account, and the next export writes the
// unrepaired one out for another app to trust.

export function normalizeAlgorithm(value: unknown): Account['algorithm'] {
  const text = typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  if (text === 'SHA256') return 'SHA256';
  if (text === 'SHA512') return 'SHA512';
  // Anything else, including the absent field, is SHA-1: it is the default in
  // RFC 6238 and what every issuer that does not say otherwise means. Guessing
  // differently produces codes that are confidently wrong rather than absent.
  return 'SHA1';
}

export function normalizeDigits(value: unknown): number {
  // Raivo writes every number as a string ("6"), so a typeof check would throw
  // its digits away.
  const digits = typeof value === 'string' && value.trim() ? Number(value) : value;
  // 7 is issued in the wild; the range mirrors types/index.ts, which
  // deliberately does not narrow this to 6 | 8.
  return typeof digits === 'number' && Number.isInteger(digits) && digits >= 6 && digits <= 10 ? digits : 6;
}

export function normalizePeriod(value: unknown): number {
  const period = typeof value === 'string' && value.trim() ? Number(value) : value;
  // The ceiling matches safePeriod (3600). It used to be 300 in the CXF reader,
  // so a 600-second account written by our own export came back at 30 and
  // produced a confidently wrong code.
  return typeof period === 'number' && Number.isFinite(period) && period >= 1 && period <= 3600
    ? Math.floor(period)
    : 30;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Longest group name we will store. Display truncates anyway; this keeps a
 *  pathological name out of the sync chunk budget and off every record. */
const MAX_GROUP_LENGTH = 64;
/** Long enough for any row title, short enough that a file cannot bloat one. */
const MAX_LABEL_LENGTH = 64;

const COLOR = /^#[0-9a-f]{6}$/i;

/**
 * The kind of code an entry declares, lowercased, or '' when it does not say.
 *
 * Each app spells the field differently: we never wrote one, andOTP writes
 * `type: "HOTP"`, Raivo `kind`, 2FAS `tokenType` and Aegis `type: "steam"`.
 * Not saying is TOTP — every file of ours ever written, and most others.
 */
function declaredKind(entry: Record<string, unknown>): string {
  return (text(entry.type) || text(entry.kind) || text(entry.tokenType)).toLowerCase();
}

export type NormalizedEntry =
  | { account: Account }
  | { skipped: 'unreadable' | 'unsupported' };

/**
 * One entry from any file, as a record we can store — or the reason it cannot
 * be one.
 *
 * Only the secret is irreplaceable. A missing id or name is filled in, and
 * rejecting a file over either is how one bad row used to cost someone every
 * other row in their only backup.
 *
 * Types are checked, not assumed: these values come from a file, and until 1.11
 * a `group` that was a number sailed through and threw on `.trim()` during the
 * next render — a permanently blank popup with the data still on disk.
 */
export function normalizeEntry(entry: unknown, index: number): NormalizedEntry {
  const raw = record(entry);
  if (!raw) return { skipped: 'unreadable' };

  const kind = declaredKind(raw);
  if (kind && kind !== 'totp') return { skipped: 'unsupported' };

  // Authy dumps and Bitwarden logins carry the whole account as a link. Read
  // through the same parser a scanned QR goes through, so a link means the
  // same thing whichever door it came in by.
  let fromLink: { name: string; issuer: string; secret: string; algorithm: string; digits: number; period: number } | null = null;
  const link = text(raw.uri) || text(raw.url) || text(raw.otpauth);
  if (/^otpauth:\/\//i.test(link)) {
    try {
      const parsed = parseQRCode(link);
      if (parsed && parsed.accounts.length > 0) fromLink = parsed.accounts[0];
    } catch (error) {
      if (error instanceof UnsupportedOTPTypeError) return { skipped: 'unsupported' };
    }
    if (!fromLink && typeof raw.secret !== 'string') return { skipped: 'unreadable' };
  }

  const secret = cleanSecret(fromLink ? fromLink.secret : typeof raw.secret === 'string' ? raw.secret : '');
  // Checked with the generator's own test, not "a non-empty string". A hex or
  // Base64 secret — what several apps' proprietary backups hold — used to be
  // uppercased and stored, which turned it into a card that can never show a
  // code. Unreadable is the honest answer: a guess at the encoding that is
  // wrong produces a code that looks right and is not.
  if (!isUsableSecret(secret)) return { skipped: 'unreadable' };

  const issuer = (fromLink?.issuer || text(raw.issuer)).trim();
  // `label` is andOTP's name for the account, `account` Raivo's, `username`
  // Bitwarden's. Ignoring them named every andOTP account after its issuer.
  const name =
    fromLink?.name ||
    text(raw.name) ||
    text(raw.label) ||
    text(raw.account) ||
    text(raw.username) ||
    issuer ||
    'Unknown';

  const account: Account = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `imported-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    issuer,
    // Normalised on the way in, like every parser does, so the stored spelling
    // is the one the duplicate check and the sync merge compare against.
    secret,
    algorithm: normalizeAlgorithm(fromLink ? fromLink.algorithm : raw.algorithm ?? raw.algo),
    digits: fromLink ? fromLink.digits : normalizeDigits(raw.digits),
    // Raivo calls the period `timer`. Ignoring it read a 60-second account at
    // 30, which is a code that is right half the time.
    period: fromLink ? fromLink.period : normalizePeriod(raw.period ?? raw.timer),
    createdAt:
      typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) && raw.createdAt > 0
        ? raw.createdAt
        : Date.now() + index,
  };

  if (typeof raw.color === 'string' && COLOR.test(raw.color)) account.color = raw.color;

  // andOTP writes tags; the first one is the nearest thing to our one group.
  const groupSource =
    typeof raw.group === 'string'
      ? raw.group
      : Array.isArray(raw.tags) && typeof raw.tags[0] === 'string'
        ? raw.tags[0]
        : '';
  const group = groupSource.slice(0, MAX_GROUP_LENGTH);
  if (group.trim()) account.group = group;

  // Our display name. Same treatment as `group`: it is shown rather than
  // matched on, so a long one is cut instead of rejected. Only read beside a
  // `name` — andOTP's `label` is the account name itself, read above.
  if (text(raw.name) && typeof raw.label === 'string' && raw.label.trim()) {
    account.label = raw.label.slice(0, MAX_LABEL_LENGTH);
  }

  return { account };
}

/** An entry that could only have been written by us, andOTP or Raivo. */
function looksLikeKnownEntry(entry: unknown): boolean {
  const raw = record(entry);
  if (!raw) return false;
  const ours = typeof raw.id === 'string' && typeof raw.createdAt === 'number';
  const andOtp = typeof raw.label === 'string' && typeof raw.type === 'string';
  const raivo = typeof raw.kind === 'string' && raw.timer !== undefined;
  const authy = typeof raw.uri === 'string';
  return ours || andOtp || raivo || authy;
}

// ---- other apps' files ------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 Base32, unpadded — how we store every secret. */
function toBase32(bytes: number[]): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | (byte & 0xff);
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/**
 * FreeOTP+ writes the secret as Java's signed bytes: `[72, -34, …]`. A byte
 * outside -128…255 means the array is not a secret, and encoding it anyway
 * would produce a well-formed key for an account that does not exist.
 */
function signedBytesToBase32(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  if (!value.every(b => typeof b === 'number' && Number.isInteger(b) && b >= -128 && b <= 255)) return '';
  return toBase32(value as number[]);
}

function groupNames(list: unknown, idKey: string): Map<string, string> {
  const names = new Map<string, string>();
  if (!Array.isArray(list)) return names;
  for (const item of list) {
    const raw = record(item);
    if (raw && typeof raw[idKey] === 'string' && typeof raw.name === 'string') {
      names.set(raw[idKey] as string, raw.name);
    }
  }
  return names;
}

/** Aegis: `{version, header, db: {entries: [{type, name, issuer, info}]}}`. */
function readAegis(file: Record<string, unknown>): ImportFile {
  // With encryption on, Aegis writes `db` as one Base64 string sealed with a
  // key derived by scrypt from the user's password. We do not open it: that
  // would mean asking for the password of another app's vault, in ours.
  if (typeof file.db === 'string') throw new ImportRejectedError('encrypted', 'Aegis');
  const db = record(file.db);
  const groups = groupNames(db?.groups, 'uuid');
  const entries = (Array.isArray(db?.entries) ? db.entries : []).map(item => {
    const raw = record(item);
    if (!raw) return item;
    const info = record(raw.info) ?? {};
    const groupIds = Array.isArray(raw.groups) ? raw.groups : [];
    return {
      type: raw.type,
      name: raw.name,
      issuer: raw.issuer,
      secret: info.secret,
      algorithm: info.algo,
      digits: info.digits,
      period: info.period,
      // Aegis 2.x and earlier kept one group name on the entry itself.
      group: typeof raw.group === 'string' ? raw.group : groups.get(groupIds[0] as string),
    };
  });
  return { entries, unreadable: 0, unsupported: 0, recognised: true };
}

/** 2FAS: `{services: [{name, secret, otp: {account, issuer, tokenType, …}}], schemaVersion}`. */
function readTwoFas(file: Record<string, unknown>): ImportFile {
  const services = Array.isArray(file.services) ? file.services : [];
  // A password-protected 2FAS backup leaves `services` empty and puts all of
  // it, AES-GCM sealed, in `servicesEncrypted`.
  if (services.length === 0 && text(file.servicesEncrypted)) {
    throw new ImportRejectedError('encrypted', '2FAS');
  }
  const groups = groupNames(file.groups, 'id');
  const entries = services.map(item => {
    const raw = record(item);
    if (!raw) return item;
    const otp = record(raw.otp) ?? {};
    return {
      type: otp.tokenType,
      // `name` is the service ("GitHub"); the account is in `otp.account`.
      name: text(otp.account) || text(raw.name),
      issuer: text(otp.issuer) || text(raw.name),
      secret: raw.secret,
      algorithm: otp.algorithm,
      digits: otp.digits,
      period: otp.period,
      group: typeof raw.groupId === 'string' ? groups.get(raw.groupId) : undefined,
    };
  });
  return { entries, unreadable: 0, unsupported: 0, recognised: true };
}

/**
 * Bitwarden's JSON export: a password manager's vault, where 2FA is one field
 * (`login.totp`) of some login items. Items without it are passwords, not
 * accounts we lost, so they are neither imported nor counted.
 */
function readBitwarden(file: Record<string, unknown>): ImportFile {
  if (file.encrypted === true) throw new ImportRejectedError('encrypted', 'Bitwarden');
  const entries: unknown[] = [];
  let unsupported = 0;
  for (const item of Array.isArray(file.items) ? file.items : []) {
    const raw = record(item);
    const login = record(raw?.login);
    const totp = text(login?.totp);
    if (!raw || !login || !totp) continue;
    // Bitwarden's own spelling of a Steam Guard code.
    if (/^steam:\/\//i.test(totp)) {
      unsupported++;
      continue;
    }
    const isLink = /^otpauth:\/\//i.test(totp);
    entries.push({
      uri: isLink ? totp : undefined,
      secret: isLink ? undefined : totp,
      name: text(login.username) || text(raw.name),
      issuer: text(raw.name),
    });
  }
  return { entries, unreadable: 0, unsupported, recognised: true };
}

/** FreeOTP+: `{tokens: [{secret: [signed bytes], issuerExt, label, algo, digits, period, type}]}`. */
function readFreeOtp(file: Record<string, unknown>): ImportFile {
  const entries = (file.tokens as unknown[]).map(item => {
    const raw = record(item);
    if (!raw) return item;
    return {
      type: raw.type,
      name: raw.label,
      issuer: text(raw.issuerExt) || text(raw.issuerInt),
      secret: signedBytesToBase32(raw.secret),
      algorithm: raw.algo,
      digits: raw.digits,
      period: raw.period,
    };
  });
  return { entries, unreadable: 0, unsupported: 0, recognised: true };
}

/**
 * Find the entries in a parsed JSON backup, whichever app wrote it.
 *
 * Arrays go through as they are: our own files from before 1.2 were a bare
 * array, and andOTP, Raivo and the Authy dump tools all write one too. The
 * entry normaliser tells their fields apart.
 *
 * Throws ImportRejectedError for a file that is recognisably encrypted by
 * another app, and for a document that holds no list we know how to read.
 */
export function readImportFile(parsed: unknown): ImportFile {
  if (Array.isArray(parsed)) {
    return {
      entries: parsed,
      unreadable: 0,
      unsupported: 0,
      recognised: parsed.some(looksLikeKnownEntry),
    };
  }

  const file = record(parsed);
  if (!file) throw new ImportRejectedError('unknown-format');

  if ('db' in file && 'header' in file) return readAegis(file);
  if (Array.isArray(file.services) || 'servicesEncrypted' in file) return readTwoFas(file);
  if (Array.isArray(file.tokens)) return readFreeOtp(file);
  // A password-protected Bitwarden export has no `items` at all, only `data`.
  if (typeof file.encrypted === 'boolean' && (Array.isArray(file.items) || file.encrypted)) {
    return readBitwarden(file);
  }

  if (Array.isArray(file.accounts)) {
    // Our own export says what it is. A file that merely has an `accounts`
    // list is not necessarily a backup of ours — and one of those whose entries
    // are all unreadable is far more likely another app's sealed format than
    // our own file gone bad.
    const ours = typeof file.version === 'string' && 'exportDate' in file;
    return {
      entries: file.accounts,
      unreadable: 0,
      unsupported: 0,
      recognised: ours || file.accounts.some(looksLikeKnownEntry),
    };
  }

  throw new ImportRejectedError('unknown-format');
}

/**
 * Sort a file's entries into records to store and counts of what was refused.
 * Throws when the file holds entries and not one of them can be stored: a
 * report of "0 accounts restored" reads as success to someone in a hurry.
 */
export function planImport(
  file: ImportFile
): { usable: Account[]; unreadable: number; unsupported: number } {
  const usable: Account[] = [];
  let unreadable = file.unreadable;
  let unsupported = file.unsupported;

  file.entries.forEach((entry, index) => {
    const result = normalizeEntry(entry, index);
    if ('account' in result) usable.push(result.account);
    else if (result.skipped === 'unsupported') unsupported++;
    else unreadable++;
  });

  if (usable.length === 0 && unreadable + unsupported > 0) {
    if (unreadable === 0) throw new ImportRejectedError('only-unsupported');
    throw new ImportRejectedError(file.recognised ? 'nothing-readable' : 'unknown-format');
  }

  return { usable, unreadable, unsupported };
}
