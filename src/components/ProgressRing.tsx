import { useMemo } from 'react';
import { codeUrgency, getTimeOffsetMs } from '@/utils/totp';

interface ProgressRingProps {
  remaining: number;
  period: number;
  /** Outer diameter in px. The compact row needs a smaller ring than the card. */
  size?: number;
  /**
   * Fade the countdown out, for something taking its place in the middle.
   *
   * The copy tick used to sit on a translucent disc over the top, which left
   * the seconds faintly legible underneath it — two numbers' worth of ink for
   * one piece of information. Fading this out instead makes it a crossfade: one
   * thing is in the ring at a time, and the ring itself never stops.
   */
  muted?: boolean;
}

export function ProgressRing({ remaining, period, size = 40, muted = false }: ProgressRingProps) {
  // A record can carry a period of 0 or NaN — an old import, or the manual form
  // before it validated the field. Dividing by it painted `strokeDashoffset="NaN"`
  // and a literal "NaN" inside the ring. The TOTP default is the honest guess.
  const safePeriod = Number.isFinite(period) && period > 0 ? period : 30;
  const safeRemaining = Number.isFinite(remaining) ? remaining : safePeriod;
  // Grey while there is time, then the same two steps the code itself takes.
  // The thresholds are not repeated here — see codeUrgency in utils/totp.ts,
  // which exists because they used to be.
  const urgency = codeUrgency(safeRemaining, safePeriod);
  const urgencyColour =
    urgency === 'critical'
      ? 'text-red-500 dark:text-red-400'
      : urgency === 'warning'
        ? 'text-amber-500 dark:text-amber-400'
        : null;
  const center = size / 2;
  const radius = center - 4;

  /**
   * The sweep, aimed once and then left to CSS.
   *
   * The ring used to be drawn from `remaining`, which arrives as a whole
   * number once a second, with `transition-all duration-1000` smoothing over
   * the steps. That bought a ring permanently one second behind the number
   * beside it, and at every window boundary the jump from 0 back to the full
   * period was smoothed too — so the ring wound visibly *backwards* over a
   * second before starting down again.
   *
   * The phase comes from the clock rather than from `remaining`, so it is
   * exact to the millisecond instead of to the second, and the corrected clock
   * is used because that is the one the code itself was generated against. A
   * negative delay is what starts an animation partway through: at 12 seconds
   * into a 30-second window the sweep begins 12 seconds in.
   *
   * Memoised on the period alone, so the once-a-second re-render this
   * component still gets — the countdown in the middle needs it — hands React
   * the identical delay every time and never restarts what is running. Left
   * alone, `infinite` carries it across every later window on its own.
   */
  const sweep = useMemo(
    () => ({
      animationDuration: `${safePeriod}s`,
      animationDelay: `-${((Date.now() + getTimeOffsetMs()) / 1000) % safePeriod}s`,
    }),
    [safePeriod]
  );

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          className="text-gray-200 dark:text-dark-600"
        />
        {/* pathLength rescales the dash units so 100 is once around, whatever
            the radius. The dash array and the keyframes are then plain numbers
            that hold for both ring sizes — and the arithmetic that used to
            compute a circumference here from the wrong radius, and left the
            ring never quite reaching empty, is gone rather than corrected. */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          pathLength={100}
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeDasharray={100}
          className={`ring-sweep transition-colors duration-300 ${
            urgencyColour ?? 'text-gray-700 dark:text-gray-300'
          }`}
          style={sweep}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          // Out fast and back slowly, the mirror of whatever is replacing it:
          // the arrival answers something the user just did, the return is the
          // row going quiet again.
          className={`font-otp font-semibold transition-opacity ${size < 32 ? 'text-[10px]' : 'text-xs'} ${
            muted ? 'opacity-0 duration-150' : 'opacity-100 duration-500'
          } ${urgencyColour ?? 'text-gray-600 dark:text-gray-400'}`}
        >
          {safeRemaining}
        </span>
      </div>
    </div>
  );
}
