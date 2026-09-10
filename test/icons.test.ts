// The icons the user chose, and the one thing that must not leak.
//
// Nothing here touches fileToIcon: that needs a canvas, and what it does — fit
// a picture into a 32x32 PNG — is the browser's arithmetic rather than ours.
// What is ours is where the result is kept, and the vault's promise that a
// stolen profile says nothing about which services are held.

import { areas, check, resetState, scenario } from './harness';

const PASSWORD = 'a reasonable vault password';
const PNG = 'data:image/png;base64,' + 'A'.repeat(600);

export async function run(): Promise<void> {
  const icons = await import('@/utils/custom-icons');
  const storage = await import('@/utils/storage');
  const vault = await import('@/utils/vault');

  await resetState();
  scenario('Choosing an icon');

  check('nothing is set to begin with', Object.keys((await icons.getCustomIcons()).accounts).length === 0);

  await icons.setAccountIcon('a1', PNG);
  await icons.setGroupIcon('Work', 'briefcase');
  const stored = await icons.getCustomIcons();
  check('an account picture comes back', stored.accounts.a1 === PNG);
  check('a group icon comes back', stored.groups.Work?.icon === 'briefcase');

  await icons.setAccountIcon('a1', null);
  check('and clearing removes it', (await icons.getCustomIcons()).accounts.a1 === undefined);
  check('without touching the group', (await icons.getCustomIcons()).groups.Work?.icon === 'briefcase');

  // A group name is typed by hand, so the blank and the padded case both reach
  // this.
  await icons.setGroupIcon('  ', 'star');
  check('a blank group name sets nothing', Object.keys((await icons.getCustomIcons()).groups).length === 1);
  await icons.setGroupIcon('  Work  ', 'star');
  check('a padded one is the same group', (await icons.getCustomIcons()).groups.Work?.icon === 'star');

  // Colour and icon are two halves of one entry, and clearing one must not take
  // the other with it.
  await icons.setGroupColor('Work', '#10b981');
  check('a colour joins the icon', (await icons.getCustomIcons()).groups.Work?.color === '#10b981');
  await icons.setGroupIcon('Work', null);
  const half = (await icons.getCustomIcons()).groups.Work;
  check('clearing the icon leaves the colour', half?.color === '#10b981' && half?.icon === undefined);
  await icons.setGroupColor('Work', null);
  check('and clearing both drops the entry', (await icons.getCustomIcons()).groups.Work === undefined);

  // Written by the build that shipped before a group entry had a colour.
  areas.local.customIcons = { accounts: {}, groups: { Old: 'shield' } };
  check('an icon name written on its own still reads', (await icons.getCustomIcons()).groups.Old?.icon === 'shield');

  scenario('What will not fit');
  await resetState();
  check(
    'an oversized icon is refused rather than stored',
    await (async () => {
      try {
        await icons.setAccountIcon('a1', 'data:image/png;base64,' + 'A'.repeat(20000));
        return false;
      } catch (error) {
        return (error as Error).name === 'IconTooLargeError';
      }
    })()
  );
  check('and nothing was written', (await icons.getCustomIcons()).accounts.a1 === undefined);

  scenario('Sweeping icons of accounts that are gone');
  await resetState();
  await icons.setAccountIcon('a1', PNG);
  await icons.setAccountIcon('a2', PNG);
  await icons.forgetAccountIcons(['a1']);
  const swept = await icons.getCustomIcons();
  check('the surviving account keeps its picture', swept.accounts.a1 === PNG);
  check('the deleted one loses it', swept.accounts.a2 === undefined);

  scenario('A vault seals the icons');
  await resetState();
  await icons.setAccountIcon('a1', PNG);
  await icons.setGroupIcon('Work', 'briefcase');
  check('they are readable in the clear first', JSON.stringify(areas.local.customIcons).includes(PNG));

  await (await storage.prepareVault(PASSWORD)).commit();

  // The whole point. A Google logo on disk names the service as plainly as a
  // usage record does, and the vault promises a stolen profile does neither.
  const sealed = JSON.stringify(areas.local.customIcons);
  check('after enabling, the picture is not on disk in the clear', !sealed.includes(PNG));
  check('nor is the group name', !sealed.includes('Work'));
  check('what is left is a sealed payload', sealed.includes('"enc"'));

  check('but they still read back while unlocked', (await icons.getCustomIcons()).accounts.a1 === PNG);
  check('group icon too', (await icons.getCustomIcons()).groups.Work?.icon === 'briefcase');

  await vault.lock();
  // Locked, there is no key. Failing soft is deliberate: a list drawn with
  // initials is a worse list, where a list that refuses to draw is a broken app
  // — and the accounts are unreadable at this point anyway.
  check('locked, nothing is returned', Object.keys((await icons.getCustomIcons()).accounts).length === 0);

  // And a write while locked must not fall back to writing in the clear.
  await icons.setAccountIcon('a2', PNG);
  check('a write while locked does not land in the clear', !JSON.stringify(areas.local.customIcons).includes(PNG));

  await vault.unlockWithPassword(PASSWORD);
  check('unlocking brings them back', (await icons.getCustomIcons()).accounts.a1 === PNG);

  scenario('Icons through a backup file');
  await resetState();
  const backupFile = await import('@/utils/backup-file');
  await icons.setAccountIcon('a1', PNG);
  await icons.setGroupIcon('Work', 'briefcase');
  await icons.setGroupColor('Work', '#10b981');
  const carried = await icons.getCustomIcons();

  const plain = backupFile.buildPlainBackupFile([], carried);
  check('a plain export carries them', backupFile.iconsFromPlainBackup(plain)?.accounts.a1 === PNG);

  const sealedFile = await backupFile.buildEncryptedBackupFile([], 'file password', carried);
  const opened = await backupFile.readEncryptedBackupFile(sealedFile, 'file password');
  check('and so does an encrypted one', opened.icons?.groups.Work?.color === '#10b981');

  // A file written before icons existed, and one from another authenticator.
  check('a file with none reads as none', backupFile.iconsFromPlainBackup(backupFile.buildPlainBackupFile([])) === undefined);
  check('and so does something that is not JSON at all', backupFile.iconsFromPlainBackup('otpauth://totp/x') === undefined);

  await resetState();
  await icons.mergeCustomIcons(opened.icons);
  const restored = await icons.getCustomIcons();
  check('restoring puts them back', restored.accounts.a1 === PNG && restored.groups.Work?.icon === 'briefcase');

  // The file is untrusted input.
  await icons.mergeCustomIcons({
    accounts: { evil: 'javascript:alert(1)', huge: 'data:image/png;base64,' + 'A'.repeat(40000) },
    groups: { Bad: { color: 'red; background:url(x)' } as any },
  });
  const guarded = await icons.getCustomIcons();
  check('a non-image URL is dropped', guarded.accounts.evil === undefined);
  check('an oversized one is dropped', guarded.accounts.huge === undefined);
  check('a colour that is not six hex digits is dropped', guarded.groups.Bad === undefined);

  scenario('Turning the vault off again');
  await resetState();
  await icons.setAccountIcon('a1', PNG);
  await (await storage.prepareVault(PASSWORD)).commit();
  await storage.disableVault(PASSWORD);
  check('the icons survive it', (await icons.getCustomIcons()).accounts.a1 === PNG);
  check('and are in the clear again, as the accounts now are', JSON.stringify(areas.local.customIcons).includes(PNG));
}
