/**
 * Bark's hours. He lives in Pittsburgh, and whatever the visitor's own clock
 * says, it is the time there that makes him sleepy.
 */

const HOME = 'America/New_York';
/** The small hours: from two in the morning until six. */
const FROM = 2;
const UNTIL = 6;

const clock = (() => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: HOME, hour: 'numeric', hourCycle: 'h23' });
  } catch {
    // A browser that cannot tell the time there: he keeps ordinary hours.
    return null;
  }
})();

/** True if, at this moment, it is the small hours in Pittsburgh. */
export function smallHours(moment: Date): boolean {
  if (!clock) return false;
  const hour = Number(clock.format(moment));
  return hour >= FROM && hour < UNTIL;
}
