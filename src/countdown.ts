export interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** True once the target moment has arrived. */
  done: boolean;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Whole days, hours, minutes and seconds from `now` until `target` (both epoch ms). */
export function remaining(target: number, now: number): Remaining {
  const left = Math.max(0, target - now);
  // Round up to the next whole second so the display reaches zero exactly at the target.
  const whole = Math.ceil(left / SECOND) * SECOND;
  return {
    days: Math.floor(whole / DAY),
    hours: Math.floor((whole % DAY) / HOUR),
    minutes: Math.floor((whole % HOUR) / MINUTE),
    seconds: Math.floor((whole % MINUTE) / SECOND),
    done: left === 0,
  };
}

/** Zero-padded to at least two digits; day counts above 99 keep all their digits. */
export function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** A sentence for assistive technology, which should not hear a ticking clock. */
export function describe(r: Remaining): string {
  if (r.done) return 'Registration is open.';
  const days = `${r.days} ${r.days === 1 ? 'day' : 'days'}`;
  const hours = `${r.hours} ${r.hours === 1 ? 'hour' : 'hours'}`;
  return `${days} and ${hours} until registration opens.`;
}

const UNITS = ['days', 'hours', 'minutes', 'seconds'] as const;
type Unit = (typeof UNITS)[number];

/**
 * Runs the countdown inside `root`, counting to the moment in the
 * `datetime` attribute of `timeEl`. Returns a function that stops it.
 */
export function startCountdown(root: HTMLElement, timeEl: HTMLTimeElement): () => void {
  const target = Date.parse(timeEl.dateTime);
  if (Number.isNaN(target)) return () => {};

  const cells = new Map<Unit, HTMLElement>();
  for (const unit of UNITS) {
    const cell = root.querySelector<HTMLElement>(`[data-unit="${unit}"]`);
    if (cell) cells.set(unit, cell);
  }

  const shown = new Map<Unit, string>();
  let timer = 0;
  let describedHour = -1;

  const render = (): void => {
    const now = Date.now();
    const r = remaining(target, now);

    for (const unit of UNITS) {
      const text = pad(r[unit]);
      if (shown.get(unit) === text) continue;
      shown.set(unit, text);
      const cell = cells.get(unit);
      if (!cell) continue;
      cell.replaceChildren(
        ...Array.from(text, (digit) => {
          const span = document.createElement('span');
          span.className = 'countdown__digit';
          span.textContent = digit;
          return span;
        }),
      );
    }

    // Refresh the spoken description once an hour, not once a second.
    if (r.hours !== describedHour || r.done) {
      describedHour = r.hours;
      root.setAttribute('aria-label', describe(r));
    }

    if (r.done) {
      root.dataset.state = 'done';
      return;
    }
    // Re-arm on the next whole second to stay in step with the clock.
    timer = window.setTimeout(render, SECOND - (now % SECOND) + 5);
  };

  root.hidden = false;
  render();

  // Timers are throttled in background tabs; catch up as soon as the page is visible again.
  const onVisible = (): void => {
    if (document.visibilityState !== 'visible') return;
    window.clearTimeout(timer);
    render();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
