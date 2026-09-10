import { useState } from 'react';
import { Ban } from 'lucide-react';
import { createT, type Language } from '@/utils/i18n';
import { GROUP_COLORS, GROUP_ICONS, groupColor, groupIcon, tint } from './group-icons';
import type { GroupStyle } from '@/utils/custom-icons';

interface GroupIconSettingsProps {
  /** Group names as they exist on the accounts, in filter-strip order. */
  groups: string[];
  styles: Record<string, GroupStyle>;
  onIcon: (group: string, iconName: string | null) => void;
  onColor: (group: string, color: string | null) => void;
  language: Language;
}

/**
 * Which icon each group carries in the filter strip.
 *
 * Its home is settings rather than the chips themselves. A chip is 60px wide in
 * a 320px popup with no room for a second control, and a long-press or a
 * right-click there would be a feature nobody finds. Settings is also where the
 * groups can be seen as a list, which is what choosing between them wants.
 *
 * One group's grid is open at a time. Twenty-four icons for each of four groups
 * is a hundred targets in a panel this narrow, and all of them at once is a
 * wall rather than a choice.
 *
 * Groups are derived from the accounts, so this list is whatever the accounts
 * say it is — there is no group to create here, and none to delete.
 */
export function GroupIconSettings({ groups, styles, onIcon, onColor, language }: GroupIconSettingsProps) {
  const t = createT(language);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="mt-4">
      <span className="text-sm text-gray-700 dark:text-gray-300">{t('settings.groupIcons')}</span>
      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{t('settings.groupIconsHint')}</p>

      {groups.length === 0 ? (
        <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">{t('settings.groupIconsEmpty')}</p>
      ) : (
        <div className="mt-2 space-y-1">
          {groups.map(group => {
            const style = styles[group];
            const Current = groupIcon(style?.icon);
            const colour = groupColor(group, style);
            const isOpen = open === group;
            return (
              <div key={group} className="rounded-lg bg-white dark:bg-dark-800">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : group)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-gray-100 dark:hover:bg-dark-700"
                >
                  <span
                    className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full"
                    style={{ backgroundColor: tint(colour, 0.18), color: colour }}
                  >
                    {Current ? <Current size={14} aria-hidden /> : <Ban size={12} className="opacity-40" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-gray-200">{group}</span>
                </button>

                {isOpen && (
                  <>
                    {/* Colour first: it is the half every group already has,
                        derived from its own name, so this is a change rather
                        than a choice from nothing. */}
                    <div className="grid grid-cols-8 gap-1 px-2 pb-1">
                      {GROUP_COLORS.map(swatch => {
                        const chosen = colour.toLowerCase() === swatch.toLowerCase();
                        return (
                          <button
                            key={swatch}
                            type="button"
                            title={swatch}
                            aria-label={swatch}
                            aria-pressed={chosen}
                            onClick={() => onColor(group, swatch)}
                            className="grid aspect-square place-items-center rounded-md"
                          >
                            <span
                              className={`block h-4 w-4 rounded-full transition-transform ${chosen ? 'scale-110 ring-2 ring-offset-1 ring-gray-400 dark:ring-offset-dark-800' : ''}`}
                              style={{ backgroundColor: swatch }}
                            />
                          </button>
                        );
                      })}
                    </div>
                  <div className="grid grid-cols-8 gap-1 px-2 pb-2">
                    {/* Clearing sits in the grid rather than beside it: taking
                        the icon off is the same kind of act as choosing one. */}
                    <button
                      type="button"
                      title={t('settings.groupIconNone')}
                      aria-label={t('settings.groupIconNone')}
                      onClick={() => {
                        onIcon(group, null);
                        setOpen(null);
                      }}
                      className={`grid aspect-square place-items-center rounded-md transition-colors ${
                        style?.icon
                          ? 'text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-700'
                          : 'bg-[#4285F4] text-white'
                      }`}
                    >
                      <Ban size={13} aria-hidden />
                    </button>
                    {GROUP_ICONS.map(({ name, Icon }) => {
                      const chosen = style?.icon === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          title={name}
                          aria-label={name}
                          aria-pressed={chosen}
                          onClick={() => {
                            onIcon(group, name);
                            setOpen(null);
                          }}
                          className={`grid aspect-square place-items-center rounded-md transition-colors ${
                            chosen
                              ? 'bg-[#4285F4] text-white'
                              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-dark-700'
                          }`}
                        >
                          <Icon size={13} aria-hidden />
                        </button>
                      );
                    })}
                  </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
