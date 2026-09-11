import { useRef, useState } from 'react';
import { Eye, EyeOff, ImagePlus, RotateCcw } from 'lucide-react';
import type { Account } from '@/types';
import { ModalHeader } from './ModalHeader';
import { GroupInput } from './GroupInput';
import { AccountIcon } from './AccountIcon';
import { accountLabel } from '@/utils/account-label';
import { fileToIcon, ICON_PX } from '@/utils/custom-icons';
import { createT, type Language } from '@/utils/i18n';

interface EditAccountModalProps {
  account: Account;
  onClose: () => void;
  onSave: (id: string, updates: Partial<Account>) => Promise<void>;
  language: Language;
  /** Existing group names, offered as suggestions — the field stays free text. */
  groups?: string[];
  /** The picture already chosen for this account, if any. */
  iconUrl?: string | null;
  /** Applied immediately rather than on save; null clears it. */
  onIconChange: (dataUrl: string | null) => Promise<void>;
}

export function EditAccountModal({
  account,
  onClose,
  onSave,
  language,
  groups = [],
  iconUrl = null,
  onIconChange,
}: EditAccountModalProps) {
  const t = createT(language);
  const [name, setName] = useState(account.name);
  const [issuer, setIssuer] = useState(account.issuer);
  const [group, setGroup] = useState(account.group ?? '');
  const [label, setLabel] = useState(account.label ?? '');
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(iconUrl);
  const [iconError, setIconError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * The picture is applied as soon as it is picked, not on save.
   *
   * It lives in its own store rather than on the account (see
   * utils/custom-icons.ts), so there is no pending-changes object for it to
   * join, and holding it back would mean inventing one. Picking an image and
   * seeing the row change is also the whole feedback this control has.
   */
  const chooseIcon = async (file: File | undefined) => {
    if (!file) return;
    setIconError(null);
    try {
      const dataUrl = await fileToIcon(file);
      setIcon(dataUrl);
      await onIconChange(dataUrl);
    } catch {
      setIconError(t('edit.iconFailed'));
    }
  };

  const clearIcon = async () => {
    setIconError(null);
    setIcon(null);
    await onIconChange(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // The add form has always required a name; this one did not, so the field
    // could be emptied and saved. Beyond leaving a row with nothing to identify
    // it, a nameless account used to make the whole backup file it ended up in
    // unimportable — the import rejected the file on the first entry missing a
    // name, taking every good account with it.
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t('edit.nameRequired'));
      return;
    }

    const updates: Partial<Account> = {};
    if (trimmedName !== account.name) updates.name = trimmedName;
    if (issuer !== account.issuer) updates.issuer = issuer;

    // Blank clears the group rather than storing an empty string, so an account
    // the user emptied out counts as ungrouped everywhere without a second case
    // to check. updateAccount drops the key on `undefined`.
    const nextGroup = group.trim();
    if (nextGroup !== (account.group?.trim() ?? '')) {
      updates.group = nextGroup || undefined;
    }

    // Same shape as the group above: blank clears it rather than storing an
    // empty string, so "no label" is one state and not two.
    const nextLabel = label.trim();
    if (nextLabel !== (account.label?.trim() ?? '')) {
      updates.label = nextLabel || undefined;
    }

    if (Object.keys(updates).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      await onSave(account.id, updates);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const maskedSecret = account.secret.replace(/./g, '\u2022');

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gray-50 dark:bg-dark-800"
      role="dialog"
      aria-modal="true"
      aria-label={t('edit.title')}
    >
      <ModalHeader title={t('edit.title')} back={t('common.back')} onBack={onClose} />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* First, because it is the one field that shows you its own result:
                the preview beside the buttons is the row as it will look. */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t('edit.icon')}
              </label>
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg border border-gray-300 bg-white dark:border-dark-600 dark:bg-dark-900">
                  <AccountIcon account={{ ...account, issuer }} size={24} iconUrl={icon} />
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-dark-600 dark:bg-dark-900 dark:text-gray-200 dark:hover:bg-dark-700"
                  >
                    <ImagePlus size={14} />
                    {t('edit.iconChoose')}
                  </button>
                  {icon && (
                    <button
                      type="button"
                      onClick={clearIcon}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-dark-700"
                    >
                      <RotateCcw size={14} />
                      {t('edit.iconClear')}
                    </button>
                  )}
                </div>
              </div>
              {/* Raster formats only. Everything is redrawn to a PNG on the way
                  in, so an SVG would work too, but one with no intrinsic size
                  draws as an empty square and the failure is invisible. */}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  void chooseIcon(e.target.files?.[0]);
                  // Cleared so that picking the same file twice fires again —
                  // the value is what change is measured against.
                  e.target.value = '';
                }}
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t('edit.iconHint', `${ICON_PX}×${ICON_PX}`)}
              </p>
              {iconError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{iconError}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t('addAccount.accountName')}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                aria-invalid={error ? true : undefined}
                className={`w-full bg-white dark:bg-dark-900 text-gray-900 dark:text-gray-100 text-sm rounded-lg px-3 py-2 border focus:ring-2 focus:ring-[#4285F4]/20 outline-none transition-all placeholder-gray-400 dark:placeholder-gray-500 ${
                  error
                    ? 'border-red-400 dark:border-red-500 focus:border-red-500'
                    : 'border-gray-300 dark:border-dark-600 focus:border-[#4285F4]'
                }`}
              />
              {error && (
                <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t('addAccount.issuer')}
              </label>
              <input
                type="text"
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                className="w-full bg-white dark:bg-dark-900 text-gray-900 dark:text-gray-100 text-sm rounded-lg px-3 py-2 border border-gray-300 dark:border-dark-600 focus:border-[#4285F4] focus:ring-2 focus:ring-[#4285F4]/20 outline-none transition-all placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>

            {/* After the two fields it replaces, so it reads as "or call it
                this" rather than as a third thing to fill in. */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t('edit.label')}
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={64}
                placeholder={accountLabel({ ...account, issuer, name, label: '' })}
                className="w-full bg-white dark:bg-dark-900 text-gray-900 dark:text-gray-100 text-sm rounded-lg px-3 py-2 border border-gray-300 dark:border-dark-600 focus:border-[#4285F4] focus:ring-2 focus:ring-[#4285F4]/20 outline-none transition-all placeholder-gray-400 dark:placeholder-gray-500"
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{t('edit.labelHint')}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t('addAccount.secretKey')}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={showSecret ? account.secret : maskedSecret}
                  readOnly
                  className="w-full bg-gray-50 dark:bg-dark-900/50 text-gray-900 dark:text-gray-100 text-sm font-mono rounded-lg px-3 py-2 pe-10 border border-gray-300 dark:border-dark-600 outline-none cursor-default"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors p-1"
                >
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Last, because it is the only optional field here — an empty box
                above the ones that must be filled reads as another required
                step. */}
            <GroupInput
              inputId="edit-account-group"
              value={group}
              onChange={setGroup}
              groups={groups}
              language={language}
            />

            {/* One full-width button, as on the add screen. Cancel sat here
                back when this was a dialog with a cross in the corner; beside
                a header that is nothing but a back arrow it was a second name
                for the same door. */}
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-[#4285F4] py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#3367D6] disabled:opacity-50"
            >
              {t('edit.save')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
