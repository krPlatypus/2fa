import { areas, check, resetState, scenario } from './harness';

const ACCOUNTS: any[] = [
  { id: 'a1', name: 'alice@example.com', issuer: 'GitHub', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30, createdAt: 1 },
  { id: 'a2', name: 'bob@example.com', issuer: 'Amazon Web Services', secret: 'KRSXG5CTMVRXEZLU', algorithm: 'SHA1', digits: 6, period: 30, createdAt: 2 },
];

export async function run(): Promise<void> {
  const s = await import('@/utils/suggestions');

  await resetState();
  scenario('Account suggestions');

  check('base domain strips subdomains', s.getBaseDomain('accounts.google.com') === 'google.com');
  check('base domain keeps co.uk-style suffixes', s.getBaseDomain('shop.example.co.uk') === 'example.co.uk');

  check('are on by default', await s.areSuggestionsEnabled());
  check('match a site by issuer name', (await s.getSuggestedAccountId('github.com', ACCOUNTS)) === 'a1');
  check('do not match an unrelated site', (await s.getSuggestedAccountId('unrelated-domain.com', ACCOUNTS)) === null);

  scenario('Suggestions learn from use');
  await s.recordAccountUsage('example.com', 'a2');
  check('a recorded account wins on that site', (await s.getSuggestedAccountId('example.com', ACCOUNTS)) === 'a2');
  check('usage is stored per site', 'accountUsageByDomain' in areas.local);

  scenario('Turning suggestions off');
  await s.setSuggestionsEnabled(false);
  check('no suggestion is returned', (await s.getSuggestedAccountId('github.com', ACCOUNTS)) === null);
  // Switching this off is a privacy choice, not a display preference — the
  // history it collected has to go too.
  check('the collected history is erased', !('accountUsageByDomain' in areas.local));
  await s.recordAccountUsage('example.com', 'a2');
  check('no new history is recorded while off', !('accountUsageByDomain' in areas.local));

  await s.setSuggestionsEnabled(true);
  check('re-enabling works', await s.areSuggestionsEnabled());
  // The learned preference for a2 on example.com is gone for good. What comes
  // back is the text heuristic, which matches a1 because its account name is an
  // address at that domain — a fresh guess, not the erased history.
  check('the learned preference does not come back', (await s.getSuggestedAccountId('example.com', ACCOUNTS)) === 'a1');

  scenario('Filling a page is stricter than suggesting one');
  await resetState();

  // Nothing learned yet: the name is all there is, and it is enough. This is
  // the first sign-in, which has to keep working.
  check(
    'a name match fills a site nothing is known about',
    (await s.getFillCandidate('github.com', ACCOUNTS))?.source === 'text'
  );

  // A copy is not evidence about a page: it carries the hostname of whatever
  // tab was open. An account known only by copies has no home domain yet, so
  // there is nothing for another domain to be the odd one out from.
  await s.recordAccountUsage('unrelated-domain.com', 'a1', 'copy');
  check(
    'a copy elsewhere does not stop a name match filling',
    (await s.getFillCandidate('github.com', ACCOUNTS))?.source === 'text'
  );

  await s.recordAccountUsage('github.com', 'a1', 'site');
  check(
    'the site it was used on still fills, now from history',
    (await s.getFillCandidate('github.com', ACCOUNTS))?.source === 'history'
  );
  check('a subdomain of it counts as the same site', (await s.getFillCandidate('gist.github.com', ACCOUNTS)) !== null);

  // The lookalike. `github` is a substring of both, so the name match fires on
  // this domain exactly as it fires on the real one — and it is the only thing
  // that stands between the code and the page.
  check('a lookalike domain is asked about, not filled', (await s.getFillCandidate('github-login.com', ACCOUNTS)) === null);
  check(
    'the popup still names the account there — asking is not refusing',
    (await s.getSuggestedAccountId('github-login.com', ACCOUNTS)) === 'a1'
  );

}
