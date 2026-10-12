// The clock check, exercised through the paths that actually broke.
//
// Every scenario below is a bug that shipped in 1.11.0: one dead time source
// took the whole feature down silently, a reading we could not take was cached
// as "clock is fine" for six hours, a clock rolled backwards made that cache
// immortal, and a correction measured once was reapplied forever — so a user
// who followed our own warning and fixed their clock got wrong codes with no
// way to notice or clear it.
//
// Reading the code found none of these. Only the failure paths do.

import { areas, check, resetState, scenario } from './harness';

/** A fetch that answers only the hosts named here, and records what was asked. */
function stubFetch(handlers: Record<string, () => Promise<Response>>) {
  const original = (globalThis as any).fetch;
  const calls: string[] = [];
  (globalThis as any).fetch = async (input: any) => {
    const url = String(input);
    calls.push(url);
    for (const [host, handler] of Object.entries(handlers)) {
      if (url.includes(host)) return handler();
    }
    throw new Error(`unreachable host: ${url}`);
  };
  return {
    calls,
    restore: () => {
      (globalThis as any).fetch = original;
    },
  };
}

// The three sources answer in three different shapes, and two of them stamp
// whole seconds — the truncation the parser compensates for.
const akamaiSays = (ms: number) => async () =>
  new Response(new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z'));

const cloudflareSays = (ms: number) => async () =>
  new Response(`fl=1a2b\nh=cloudflare.com\nts=${Math.floor(ms / 1000).toFixed(3)}\nvisit_scheme=https\n`);

const timeApiSays = (ms: number) => async () => {
  const d = new Date(ms);
  return new Response(
    JSON.stringify({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      seconds: d.getUTCSeconds(),
      milliSeconds: d.getUTCMilliseconds(),
    })
  );
};

const dead = async () => {
  throw new Error('ENOTFOUND');
};

/** All three sources telling the truth. */
const honest = (trueMs: number) => ({
  'time.akamai.com': akamaiSays(trueMs),
  'timeapi.io': timeApiSays(trueMs),
  'cloudflare.com': cloudflareSays(trueMs),
});

const TRUE_MS = Date.UTC(2026, 7, 18, 12, 0, 0);

export async function run(): Promise<void> {
  const timeSync = await import('@/utils/time-sync');
  const totp = await import('@/utils/totp');

  /** Run `fn` with the device clock pinned to `deviceMs`. */
  const at = async <T>(deviceMs: number, fn: () => Promise<T>): Promise<T> => {
    const real = Date.now;
    (Date as any).now = () => deviceMs;
    try {
      return await fn();
    } finally {
      (Date as any).now = real;
    }
  };

  const fresh = async () => {
    await resetState();
    totp.setTimeOffsetMs(0);
  };

  /**
   * The correction code generation would apply at device time `deviceMs`.
   *
   * Read under the pinned clock, never the real one: a correction checks its
   * own age on every read now, and the real clock is weeks away from these
   * fixtures — read there, every correction would look long expired.
   */
  const offsetAt = (deviceMs: number) => at(deviceMs, async () => totp.getTimeOffsetMs());

  /** Let a renewal that a read set off run to the end, under the same clock. */
  const settle = (deviceMs: number) =>
    at(deviceMs, () => new Promise<void>((resolve) => setTimeout(resolve, 30)));

  scenario('Agreeing sources on a skewed clock warn and correct');
  await fresh();
  {
    const stub = stubFetch(honest(TRUE_MS));
    const notice = await at(TRUE_MS - 300_000, () => timeSync.getTimeSyncNotice());
    stub.restore();
    check('a notice is raised', notice !== null, String(notice));
    check('and it reads as five minutes', Math.abs((notice ?? 0) - 300) <= 2, String(notice));
    const applied = await offsetAt(TRUE_MS - 300_000);
    check('code generation is corrected', Math.abs(applied - 300_000) < 2_000, String(applied));
  }

  // The outage that started all of this: worldtimeapi.org stopped answering,
  // the pair could never agree again, and the feature went silent for months.
  scenario('One dead source no longer takes the feature down');
  await fresh();
  {
    const stub = stubFetch({ ...honest(TRUE_MS), 'time.akamai.com': dead });
    const result = await at(TRUE_MS - 300_000, () => timeSync.checkTimeSync());
    stub.restore();
    check('the two survivors still make a verdict', result.confident === true);
    check('the drift is reported', result.synced === false, String(result.offsetSeconds));
    check('and the correction is applied', Math.abs((await offsetAt(TRUE_MS - 300_000)) - 300_000) < 2_000);
  }

  scenario('A lone source is not evidence');
  await fresh();
  {
    const stub = stubFetch({ ...honest(TRUE_MS), 'time.akamai.com': dead, 'cloudflare.com': dead });
    const result = await at(TRUE_MS - 300_000, () => timeSync.checkTimeSync());
    stub.restore();
    check('not confident', result.confident === false);
    check('no alarm is raised on a guess', result.synced === true);
    check('and code generation is left alone', (await offsetAt(TRUE_MS - 300_000)) === 0);
  }

  scenario('An unverifiable reading is retried in minutes, not hours');
  await fresh();
  {
    // The device is five minutes slow throughout; only the network changes.
    const offline = stubFetch({});
    await at(TRUE_MS - 300_000, () => timeSync.checkTimeSync());
    offline.restore();
    check('the failed reading was cached', areas.local.timeSyncCache !== undefined);

    // Six minutes later the network is back. Under the old TTL this returned
    // the cached "fine" for six hours without touching the network at all.
    const laterTrueMs = TRUE_MS + 6 * 60_000;
    const stub = stubFetch(honest(laterTrueMs));
    const result = await at(laterTrueMs - 300_000, () => timeSync.checkTimeSync());
    stub.restore();
    check('the sources were asked again', stub.calls.length > 0, `${stub.calls.length} calls`);
    check('and the drift is finally seen', result.confident === true && result.synced === false);
  }

  scenario('A clock rolled backwards does not freeze the check forever');
  await fresh();
  {
    const first = stubFetch(honest(TRUE_MS));
    const before = await at(TRUE_MS, () => timeSync.checkTimeSync());
    first.restore();
    check('a healthy clock is cached', before.confident === true && before.synced === true);

    // The battery dies and the clock falls an hour behind: `Date.now()` is now
    // BEFORE the cache was written, which used to read as infinitely fresh.
    const stub = stubFetch(honest(TRUE_MS));
    const notice = await at(TRUE_MS - 3_600_000, () => timeSync.getTimeSyncNotice());
    stub.restore();
    check('the stale cache is not trusted', stub.calls.length > 0, `${stub.calls.length} calls`);
    check('and the hour of drift is reported', Math.abs((notice ?? 0) - 3600) <= 2, String(notice));
  }

  scenario('A correction expires instead of being reapplied forever');
  await fresh();
  {
    await at(TRUE_MS, () => totp.persistTimeOffset(300_000));

    // It lives as long as the measurement behind it and no longer: this was
    // 48 hours, which is how a clock the OS had since fixed kept getting
    // "corrected" by five minutes for two days.
    totp.setTimeOffsetMs(0);
    await at(TRUE_MS + 3 * 60_000, () => totp.loadTimeOffset());
    check('minutes later it still applies', (await offsetAt(TRUE_MS + 3 * 60_000)) === 300_000);

    totp.setTimeOffsetMs(0);
    await at(TRUE_MS + 10 * 60_000, () => totp.loadTimeOffset());
    check('ten minutes later it does not', (await offsetAt(TRUE_MS + 10 * 60_000)) === 0);
    check('and it is off the disk, not just ignored', areas.local.timeOffsetMs === undefined);
  }

  scenario('A correction from an older version is not trusted');
  await fresh();
  {
    // 1.11.0 and earlier stored a bare number with no timestamp, so its age is
    // unknowable — and users who fixed their clock have been carrying a wrong
    // one ever since.
    areas.local.timeOffsetMs = 300_000;
    await at(TRUE_MS, () => totp.loadTimeOffset());
    check('the undated correction is dropped', (await offsetAt(TRUE_MS)) === 0);
    check('and removed so it cannot come back', areas.local.timeOffsetMs === undefined);
  }

  scenario('The three outcomes are told apart, and a dismissal expires');
  await fresh();
  {
    const stub = stubFetch(honest(TRUE_MS));
    const ok = await at(TRUE_MS, () => timeSync.getClockStatus());
    stub.restore();
    check('a measured healthy clock reads ok', ok.state === 'ok' && ok.corrected === false, ok.state);

    // A dismissal from an earlier warning must not outlive the problem: left
    // behind, it silently suppresses the next warning of a similar size.
    await timeSync.dismissTimeNotice(300);
    const again = stubFetch(honest(TRUE_MS));
    await at(TRUE_MS, () => timeSync.recheckClock());
    again.restore();
    check('and clears a stale dismissal', areas.local.timeNoticeDismissedOffset === undefined);

    await fresh();
    const drifted = stubFetch(honest(TRUE_MS));
    const off = await at(TRUE_MS - 300_000, () => timeSync.getClockStatus());
    drifted.restore();
    check('a drifting clock reads off, and says it was corrected', off.state === 'off' && off.corrected);

    await fresh();
    const blocked = stubFetch({});
    const unknown = await at(TRUE_MS, () => timeSync.getClockStatus());
    blocked.restore();
    check('an unreachable pool reads unknown, not ok', unknown.state === 'unknown', unknown.state);
    check('and claims no correction', unknown.corrected === false);

    // Past the 12h cap the offset is deliberately NOT applied, so the UI must
    // not tell the user their codes were fixed.
    await fresh();
    const wild = stubFetch(honest(TRUE_MS));
    const capped = await at(TRUE_MS - 20 * 60 * 60_000, () => timeSync.getClockStatus());
    wild.restore();
    check('a wildly wrong clock is off but uncorrected', capped.state === 'off' && !capped.corrected);
    check('and code generation is left alone', totp.getTimeOffsetMs() === 0);
  }

  scenario('Check now measures again, even mid-flight');
  await fresh();
  {
    const warm = stubFetch(honest(TRUE_MS));
    await at(TRUE_MS, () => timeSync.getClockStatus());
    warm.restore();

    // A measurement is already under way when the button is pressed: its answer
    // came from the cache we are about to clear, so it is not an answer.
    //
    // Both under one pinned clock: two overlapping `at` calls unpin each other
    // in the wrong order, and the recheck then finished on the real clock.
    const fresh1 = stubFetch(honest(TRUE_MS));
    const rechecked = await at(TRUE_MS - 300_000, async () => {
      const pending = timeSync.getClockStatus();
      const answer = await timeSync.recheckClock();
      await pending;
      return answer;
    });
    fresh1.restore();

    check('the sources were actually asked', fresh1.calls.length > 0, `${fresh1.calls.length} calls`);
    check('and the new drift is what comes back', rechecked.state === 'off', rechecked.state);
  }

  scenario('A source that lies alone cannot move the clock');
  await fresh();
  {
    // One source eight seconds out, two honest: the pair wins, and the liar is
    // not the estimate even though nothing about it looks broken.
    const stub = stubFetch({ ...honest(TRUE_MS), 'timeapi.io': timeApiSays(TRUE_MS + 8_000) });
    const result = await at(TRUE_MS, () => timeSync.checkTimeSync());
    stub.restore();
    check('the majority is believed', result.confident === true);
    check('a healthy clock stays healthy', result.synced === true, String(result.offsetSeconds));
    check('and nothing is applied to code generation', totp.getTimeOffsetMs() === 0);
  }
  // The rest are the correction outliving the clock it was measured against.
  // The user sees our warning, fixes their clock (or the OS does), and codes
  // go on being shifted by the drift that is no longer there — the same size
  // error as before, pointed the other way.
  const ACCOUNT: any = { id: 'x', name: 'n', issuer: 'i', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 };
  const SLOW = 300_000; // the device clock, five minutes behind

  scenario('A correction does not outlive the clock being fixed');
  await fresh();
  {
    const measured = stubFetch(honest(TRUE_MS));
    await at(TRUE_MS - SLOW, () => timeSync.checkTimeSync());
    measured.restore();
    check('the drift is corrected while it lasts', Math.abs((await offsetAt(TRUE_MS - SLOW)) - SLOW) < 2_000);

    // A minute later the OS syncs and the device reads true time. Quick fill
    // and every new popup start from the stored record alone.
    const fixedAt = TRUE_MS + 60_000;
    totp.setTimeOffsetMs(0);
    await at(fixedAt, () => totp.loadTimeOffset());
    const shown = await at(fixedAt, async () => totp.generateTOTP(ACCOUNT).code);
    check('the old correction is not applied', (await offsetAt(fixedAt)) === 0, String(await offsetAt(fixedAt)));
    check('so the code is the one for the real time', shown === totp.generateCodeAt(ACCOUNT, fixedAt), shown);

    // Offline, nothing can re-measure: what Settings says has to be what codes do.
    const offline = stubFetch({});
    const status = await at(fixedAt, () => timeSync.getClockStatus());
    offline.restore();
    check('offline, the clock reads unknown', status.state === 'unknown', status.state);
    check('and "corrected" matches what codes use', status.corrected === ((await offsetAt(fixedAt)) !== 0));
  }

  scenario('A check that fails clears the correction instead of vouching for it');
  await fresh();
  {
    const measured = stubFetch(honest(TRUE_MS));
    await at(TRUE_MS - SLOW, () => timeSync.checkTimeSync());
    measured.restore();

    // One minute on, "check now" with the network gone. The old code left the
    // correction applied and reported { unknown, corrected: false } over it.
    const offline = stubFetch({});
    const status = await at(TRUE_MS - SLOW + 60_000, () => timeSync.recheckClock());
    offline.restore();
    const left = await offsetAt(TRUE_MS - SLOW + 60_000);
    check('nothing is applied on a reading we could not take', left === 0, String(left));
    check('and Settings does not say otherwise', status.state === 'unknown' && status.corrected === (left !== 0));
    check('and it is off the disk', areas.local.timeOffsetMs === undefined);
  }

  scenario('A small correction is not revived from a six-hour cache');
  await fresh();
  {
    // 45 seconds fast: "synced" (below the warning), and still corrected. That
    // combination used to earn the six-hour cache, and every cache hit put the
    // correction back — long after the clock under it had been fixed.
    const measured = stubFetch(honest(TRUE_MS));
    await at(TRUE_MS + 45_000, () => timeSync.checkTimeSync());
    measured.restore();
    check('it is corrected at first', Math.abs((await offsetAt(TRUE_MS + 45_000)) + 45_000) < 2_000);

    const hourLater = TRUE_MS + 45_000 + 60 * 60_000;
    totp.setTimeOffsetMs(0);
    await at(hourLater, () => totp.loadTimeOffset());
    const offline = stubFetch({});
    const status = await at(hourLater, () => timeSync.getClockStatus());
    offline.restore();
    const applied = await offsetAt(hourLater);
    check('an hour later it is not applied', applied === 0, String(applied));
    check('and the check was actually retried', offline.calls.length > 0, `${offline.calls.length} calls`);
    check('and nothing claims it is', !status.corrected);
  }

  scenario('A page left open notices the clock being stepped under it');
  await fresh();
  {
    // Sixty seconds slow: small enough that the OS stepping it forward keeps
    // the measurement inside every age limit. Only the monotonic clock, which
    // did not step, can tell that the wall clock moved.
    const measured = stubFetch(honest(TRUE_MS));
    await at(TRUE_MS - 60_000, () => timeSync.checkTimeSync());
    measured.restore();
    check('the drift is corrected', Math.abs((await offsetAt(TRUE_MS - 60_000)) - 60_000) < 2_000);

    const renewed = stubFetch(honest(TRUE_MS));
    const afterJump = await offsetAt(TRUE_MS);
    await settle(TRUE_MS);
    renewed.restore();
    check('the step drops the correction at once', afterJump === 0, String(afterJump));
    check('and sets off a new measurement', renewed.calls.length > 0, `${renewed.calls.length} calls`);
    check('which finds nothing left to correct', (await offsetAt(TRUE_MS)) === 0);
  }

  scenario('A page left open renews its correction, and drops it when it cannot');
  await fresh();
  {
    const start = TRUE_MS - SLOW;
    const measured = stubFetch(honest(TRUE_MS));
    await at(start, () => timeSync.checkTimeSync());
    measured.restore();

    // The side panel is open for days. Near the end of a correction's life it
    // asks for a new measurement, so a healthy one never lapses. The clock is
    // simply read later here — no jump — while the monotonic clock stands
    // still, so the renewal is set off by age alone.
    const nearEnd = 4.5 * 60_000;
    const renewal = stubFetch(honest(TRUE_MS + nearEnd));
    const stillApplied = await at(start + nearEnd, async () => {
      totp.setTimeOffsetMs(SLOW, nearEnd);
      return totp.getTimeOffsetMs();
    });
    await settle(start + nearEnd);
    renewal.restore();
    check('it still applies near the end', stillApplied === SLOW, String(stillApplied));
    check('and a renewal was asked for', renewal.calls.length > 0, `${renewal.calls.length} calls`);
    check('and written down as new', (areas.local.timeOffsetMs as any)?.at === start + nearEnd);

    // Past its life with nothing to renew it — offline — it goes, rather than
    // being applied for as long as the page stays open.
    const offline = stubFetch({});
    const expired = await at(start + nearEnd, async () => {
      totp.setTimeOffsetMs(SLOW, 6 * 60_000);
      return totp.getTimeOffsetMs();
    });
    await settle(start + nearEnd);
    offline.restore();
    check('a correction past its life is dropped', expired === 0, String(expired));
    check('and the failed renewal leaves it dropped', (await offsetAt(start + nearEnd)) === 0);
  }
}
