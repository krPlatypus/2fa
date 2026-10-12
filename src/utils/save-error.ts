// What to tell the user when a write to the account list fails.
//
// Never the error's own text. Storage and vault errors are written for the
// console — "Refusing to save 12 accounts over 22 already stored" reached a
// user's screen verbatim, in English, in the middle of a Chinese interface, and
// told them nothing they could act on.

import type { createT, TranslationKey } from './i18n';
import { VaultLockedError } from './vault';

/**
 * The key rather than the sentence, for callers that keep the message in state:
 * a sentence is frozen in whatever language was active when it was written,
 * and the scanner can fail before its locale has even loaded.
 */
export function saveErrorKey(error: unknown): TranslationKey {
  return error instanceof VaultLockedError ? 'restore.locked' : 'addAccount.errorSaveFailed';
}

export function saveErrorMessage(error: unknown, t: ReturnType<typeof createT>): string {
  return t(saveErrorKey(error));
}
