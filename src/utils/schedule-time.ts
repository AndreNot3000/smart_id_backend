/** Convert "HH:MM" (24h) to minutes since midnight. */
export function timeToMinutes(time: string): number {
  const parts = time.split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

/** Latest end time (minutes) treated as "next morning" for overnight classes. */
const OVERNIGHT_END_CUTOFF = 6 * 60; // 06:00

/**
 * Validate that end is after start on the same day.
 * Allows overnight sessions (e.g. 23:30 → 01:00) when end is early morning.
 */
export function validateScheduleTimeRange(
  startTime: string,
  endTime: string,
): string | null {
  if (startTime === endTime) {
    return 'Start time and end time cannot be the same';
  }

  const startM = timeToMinutes(startTime);
  const endM = timeToMinutes(endTime);

  if (endM <= startM) {
    if (endM <= OVERNIGHT_END_CUTOFF) {
      return null; // overnight class ending before 06:00
    }
    return 'End time must be after start time';
  }

  return null;
}

/** Reject past dates or a start time that has already passed today. */
export function validateScheduleNotInPast(
  date: string,
  startTime: string,
  now: Date = new Date(),
): string | null {
  const todayStr = now.toISOString().split('T')[0]!;
  if (date < todayStr) {
    return `Cannot schedule a class on a past date (${date})`;
  }
  if (date === todayStr && timeToMinutes(startTime) <= now.getHours() * 60 + now.getMinutes()) {
    return `Cannot schedule a class for ${startTime} today — that time has already passed`;
  }
  return null;
}
