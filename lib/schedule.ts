// lib/schedule.ts
export type Window = { start: string; end: string }; // "HH:MM" 24h
export type Service = {
  id: string;
  name: string;
  durationMin: number;   // e.g. 45
  gridMin: number;       // e.g. 15
  windows: Record<number, Window[]>; // 0=Sun..6=Sat
};
export type Slot = { start: Date; end: Date };
export type Booking = { serviceId: string; start: Date; end: Date };

export const hhmm = (d: Date) =>
  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export const ymd = (d: Date) => d.toISOString().slice(0, 10);

const toMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
const atMinutes = (d: Date, totalMin: number) => {
  const dd = new Date(d);
  dd.setHours(0, 0, 0, 0);
  dd.setMinutes(totalMin);
  return dd;
};
export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const mondayOfWeek = (d = new Date()) => {
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun..6 Sat
  const diff = ((day + 6) % 7); // days since Monday
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - diff);
  return x;
};
export const overlaps = (a: Slot, b: Slot) =>
  a.start < b.end && b.start < a.end;

export function generateSlotsForDay(
  day: Date,
  svc: Service,
  dayBookings: Booking[]
): Slot[] {
  const weekday = day.getDay();
  const wins = svc.windows[weekday] || [];
  const out: Slot[] = [];
  wins.forEach((w) => {
    const startMin = toMin(w.start);
    const endMin = toMin(w.end);
    // align first slot to grid
    let cursor = Math.ceil(startMin / svc.gridMin) * svc.gridMin;
    while (cursor + svc.durationMin <= endMin) {
      const slot: Slot = {
        start: atMinutes(day, cursor),
        end: atMinutes(day, cursor + svc.durationMin),
      };
      const clash = dayBookings.some(
        (b) =>
          b.serviceId === svc.id &&
          overlaps(slot, { start: b.start, end: b.end })
      );
      if (!clash) out.push(slot);
      cursor += svc.gridMin;
    }
  });
  return out;
}

// Recommend slots next to existing bookings for tighter back-to-back work.
// If no bookings on that day -> return [] (per your rule).
export function recommendedSlots(
  allSlots: Slot[],
  dayBookings: Booking[]
): Slot[] {
  if (dayBookings.length === 0) return [];
  const ends = dayBookings.map((b) => +b.end).sort((a, b) => a - b);
  const anchor = ends[ends.length - 1]; // right after latest booking
  const next = allSlots
    .filter((s) => +s.start >= anchor)
    .slice(0, 2); // recommend up to 2
  return next;
}
