// Credential Exchange Format — the FIDO Alliance interchange format that
// Apple, Google, 1Password, Bitwarden and Dashlane are converging on.
//
// Why we speak it at all: CXF covers TOTP secrets, not just passkeys, so it is
// the first format in this product's lifetime that lets someone move their 2FA
// accounts between vendors without a vendor-specific parser on either side.
// "You are not held hostage here" is the whole positioning, and an export the
// rest of the industry can read is the strongest possible version of it.
//
// What we deliberately do NOT implement: CXP, the *protocol* half. That one
// negotiates a direct provider-to-provider transfer through the platform and
// needs OS integration we cannot have from an extension. The format is a JSON
// file, which is exactly what our export and import already move around.
//
// Shape notes, since the spec is still a working draft:
// - the document root is an Account holding `items`; each Item carries a list
//   of `credentials` discriminated by `type`.
// - a TOTP credential is `{type: 'totp', secret, period, digits, algorithm,
//   username, issuer}` with the secret in RFC 4648 Base32 — the same encoding
//   we already store, so no re-encoding step can corrupt it.
// - real files put a TOTP credential next to a `basic-auth` one inside a single
//   login item. Import therefore walks every credential of every item rather
//   than assuming one credential per item, or it would silently drop the 2FA
//   half of every password-manager export.

import type { Account } from '@/types';
import { cleanSecret, isUsableSecret } from './totp';
import { normalizeAlgorithm, normalizeDigits, normalizePeriod } from './import-formats';

const CXF_VERSION = 1;
const EXPORTER = 'authenticator.sh';

type CxfAlgorithm = 'sha1' | 'sha256' | 'sha512';

interface CxfTotpCredential {
  type: 'totp';
  secret: string;
  period: number;
  digits: number;
  algorithm: CxfAlgorithm;
  username?: string;
  issuer?: string;
}

interface CxfItem {
  id: string;
  creationAt: number;
  modifiedAt: number;
  type: 'login';
  title: string;
  subtitle?: string;
  credentials: CxfTotpCredential[];
}

interface CxfDocument {
  version: number;
  exporter: string;
  timestamp: number;
  id: string;
  userName: string;
  email: string;
  collections: unknown[];
  items: CxfItem[];
}

/** Base64url without padding, which is how CXF spells every identifier. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function newId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

/** Unix seconds. CXF timestamps are seconds, ours are milliseconds. */
function toSeconds(milliseconds: number): number {
  const seconds = Math.floor(milliseconds / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : Math.floor(Date.now() / 1000);
}

export function buildCxfFile(accounts: Account[]): string {
  const now = Math.floor(Date.now() / 1000);

  const document: CxfDocument = {
    version: CXF_VERSION,
    exporter: EXPORTER,
    timestamp: now,
    id: newId(),
    // The spec wants the exporting user's account identity here. We have never
    // asked for one and are not about to start for the sake of a header field,
    // so both stay empty rather than carrying something invented.
    userName: '',
    email: '',
    collections: [],
    items: accounts.map((account) => ({
      id: newId(),
      creationAt: toSeconds(account.createdAt),
      modifiedAt: now,
      type: 'login' as const,
      title: account.issuer || account.name || 'Unknown',
      subtitle: account.name || undefined,
      credentials: [
        {
          type: 'totp' as const,
          secret: cleanSecret(account.secret),
          // Repaired the way generation repairs them, not copied. A record
          // imported from a file without these fields has none, and
          // `undefined.toLowerCase()` turned "export" into "Export failed" for
          // every account in the list, not just that one. What goes out must be
          // what this app computes codes with, or the other side gets
          // different codes from the same secret.
          period: normalizePeriod(account.period),
          digits: normalizeDigits(account.digits),
          algorithm: normalizeAlgorithm(account.algorithm).toLowerCase() as CxfAlgorithm,
          username: account.name || undefined,
          issuer: account.issuer || undefined,
        },
      ],
    })),
  };

  return JSON.stringify(document, null, 2);
}

export function isCxfFile(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) return false;
    // `items` alone is too weak a signal — our own plain backup could grow one.
    // A CXF document always carries a version and an exporter alongside it.
    return typeof parsed.version === 'number' && typeof parsed.exporter === 'string';
  } catch {
    return false;
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Pull every TOTP credential out of a CXF document, and count the ones that
 * could not be used.
 *
 * Tolerant on purpose, in both directions:
 * - one malformed item never costs the file. A person importing this has
 *   already left their old provider; rejecting 200 accounts over one bad row is
 *   how a migration becomes a data-loss event.
 * - only `secret` is irreplaceable. A missing title, username or issuer is
 *   filled in, never a reason to drop the row.
 *
 * Counted, not just dropped: a file whose every TOTP secret was unusable used
 * to come back as an empty list, which the importer took for an empty file and
 * reported as "Import successful!" with nothing added.
 */
export function readCxf(text: string): { accounts: Account[]; unreadable: number } {
  const parsed = JSON.parse(text) as Partial<CxfDocument>;
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const accounts: Account[] = [];
  let unreadable = 0;

  items.forEach((item, itemIndex) => {
    if (!item || typeof item !== 'object') return;
    const credentials = Array.isArray(item.credentials) ? item.credentials : [];

    credentials.forEach((credential, credentialIndex) => {
      if (!credential || typeof credential !== 'object') return;
      // Passwords, passkeys, notes: other credentials of the same login, not
      // accounts we failed to read.
      if (asText((credential as CxfTotpCredential).type).toLowerCase() !== 'totp') return;

      const raw = credential as Partial<CxfTotpCredential>;
      const secret = cleanSecret(asText(raw.secret));
      // Not a judgement call: without a usable secret there is no account, and
      // storing one would render a permanently wrong code instead of failing.
      if (!isUsableSecret(secret)) {
        unreadable++;
        return;
      }

      const title = asText(item.title);
      const name = asText(raw.username) || asText(item.subtitle);
      // The title is the service name in other vendors' files, so it stands in
      // for a missing issuer — but not when it merely repeats the account name.
      // Our own export writes the name there when there is no issuer, because
      // CXF wants a title on every item, and reading it back as the issuer
      // turned "bob" with no issuer into "bob: bob".
      const issuer = asText(raw.issuer) || (title !== name ? title : '');

      accounts.push({
        id: `cxf-${Date.now()}-${itemIndex}-${credentialIndex}-${Math.random().toString(36).slice(2, 8)}`,
        name: name || issuer || 'Unknown',
        issuer,
        secret,
        algorithm: normalizeAlgorithm(raw.algorithm),
        digits: normalizeDigits(raw.digits),
        period: normalizePeriod(raw.period),
        createdAt:
          typeof item.creationAt === 'number' && item.creationAt > 0
            ? item.creationAt * 1000
            : Date.now(),
      });
    });
  });

  return { accounts, unreadable };
}

/** The usable accounts only. */
export function readCxfFile(text: string): Account[] {
  return readCxf(text).accounts;
}

export function cxfFileName(): string {
  return `authenticator-cxf-${new Date().toISOString().slice(0, 10)}.json`;
}
