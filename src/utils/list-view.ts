// What the account list area shows, and which accounts a search keeps.
//
// Pulled out of the popup so the order of the cases can be tested: it is the
// order that went wrong, not any one case.

import type { Account } from '@/types';

export type ListView =
  /** Still reading. */
  | 'loading'
  /** Rows to show. */
  | 'list'
  /** Accounts exist, but the search or group filter hides all of them. */
  | 'noResults'
  /** Nothing readable, but this is not a new user — records are held, or the read failed. */
  | 'unavailable'
  /** Nothing at all: the first-run guide. */
  | 'empty';

export interface ListViewInput {
  loading: boolean;
  /** Every account that was read. */
  total: number;
  /** What survives the search and the group filter. */
  shown: number;
  /** The read failed — including when the list on screen came from a backup. */
  failed: boolean;
  /** Records on disk this device cannot decrypt. */
  held: number;
}

/**
 * Accounts on screen outrank every explanation of why there might not be any.
 *
 * The "cannot be read" panel used to be checked first, on `error || heldCount`,
 * and both of those can be true while a perfectly good list is loaded: a device
 * holding one record from another vault, or a list recovered from the automatic
 * backup. A search that matched nothing then told the user they needed a
 * different password and offered Retry and Restore — for a typo — and the one
 * button that would have helped, Clear filters, was not on screen.
 */
export function chooseListView({ loading, total, shown, failed, held }: ListViewInput): ListView {
  if (loading) return 'loading';
  if (shown > 0) return 'list';
  // `shown` can only be below `total` because a filter removed rows.
  if (total > 0) return 'noResults';
  if (failed || held > 0) return 'unavailable';
  return 'empty';
}

/**
 * Whether an account matches what was typed in the search box.
 *
 * Read defensively: a record written by an older build or another exporter can
 * carry `issuer: null`, and `null.toLowerCase()` inside the render threw the
 * popup onto the crash screen at the first keystroke.
 *
 * The label is searched alongside the two fields, not instead of them: it
 * hides the issuer from the row, and someone who remembers the issuer should
 * still find the account by it.
 */
export function matchesSearch(account: Pick<Account, 'name' | 'issuer' | 'label'>, query: string): boolean {
  const needle = query.toLowerCase();
  if (!needle) return true;
  return (
    String(account.name ?? '').toLowerCase().includes(needle) ||
    String(account.issuer ?? '').toLowerCase().includes(needle) ||
    String(account.label ?? '').toLowerCase().includes(needle)
  );
}
