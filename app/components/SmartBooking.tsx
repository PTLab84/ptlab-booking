'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';

/* =========================
   Types
========================= */

type HHMM = `${number}:${number}`;

type Window = { start: HHMM; end: HHMM };

type Service = {
  id: 'pt_private' | 'pt_local';
  name: string;
  durationMin: number;    // length of an appointment
  slotGridMin: number;    // step for slot starts (e.g., 15 min)
  leadTimeMin: number;    // must book at least this far in advance
  windows: Record<number, Window[]>; // weekday (0..6) -> windows
};

type Booking = {
  svcId: Service['id'];
  date: string;     // YYYY-MM-DD
  start: HHMM;
  end: HHMM;
};

type RequestItem = {
  name: string;
  email?: string;
  phone?: string;
  note?: string;
  svcId: Service['id'];
  forDate: string; // YYYY-MM-DD
};

/* =========================
   Constants & Helpers
========================= */

const SERVICES: Service[] = [
  // PT at Private Gym — Mon–Fri 07:00–13:00
  {
    id: 'pt_private',
    name: 'PT @ Private Gym',
    durationMin: 45,
    slotGridMin: 15,
    leadTimeMin: 60,
    windows: {
      1: [{ start: '07:00', end: '13:00' }],
      2: [{ start: '07:00', end: '13:00' }],
      3: [{ start: '07:00', end: '13:00' }],
      4: [{ start: '07:00', end: '13:00' }],
      5: [{ start: '07:00', end: '13:00' }],
    },
  },
  // PT at Local Gym — Mon–Thu 13:30–16:30
  {
    id: 'pt_local',
    name: 'PT @ Local Gym',
    durationMin: 45,
    slotGridMin: 15,
    leadTimeMin: 60,
    windows: {
      1: [{ start: '13:30', end: '16:30' }],
      2: [{ start: '13:30', end: '16:30' }],
      3: [{ start: '13:30', end: '16:30' }],
      4: [{ start: '13:30', end: '16:30' }],
    },
  },
];

const BOOKINGS_KEY = 'ptlab-bookings-v1';
const REQUESTS_KEY = 'ptlab-requests-v1';
const BASE_KEY = 'ptlab-basehours-v1';
const BLACK_KEY = 'ptlab-blackouts-v1';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad2(n: number) {
  return n.toString().padStart(2, '0');
}
function toMinutes(t: HHMM): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function fromMinutes(min: number): HHMM {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}` as HHMM;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseHMToDate(day: Date, hm: HHMM): Date {
  const [h, m] = hm.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}
function addMinutes(dt: Date, mins: number): Date {
  const d = new Date(dt);
  d.setMinutes(d.getMinutes() + mins);
  return d;
}
function minutesBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 60000);
}

function startOfWeekMonday(d: Date) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = (day + 6) % 7; // 0=>6, 1=>0, 2=>1, ...
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

/* =========================
   Suggested times (packing)
========================= */

// Given candidate slots and existing bookings for the same day,
// score each slot by distance to the nearest booking boundary
// (start or end). Lower score is "tighter packing".
function rankSuggestedSlots(
  day: Date,
  candidates: { start: Date; end: Date }[],
  dayBookings: Booking[]
) {
  if (dayBookings.length === 0) return []; // no suggestions when no bookings that day

  const boundaries: Date[] = [];
  for (const b of dayBookings) {
    boundaries.push(parseHMToDate(day, b.start));
    boundaries.push(parseHMToDate(day, b.end));
  }

  const scored = candidates.map((s) => {
    const nearest = Math.min(
      ...boundaries.map((b) => Math.abs(minutesBetween(s.start, b)))
    );
    // Prefer earlier when tie
    const tie = s.start.getTime();
    return { slot: s, score: nearest * 10000 + tie };
  });

  scored.sort((a, b) => a.score - b.score);
  // take top 4 unique times
  const unique: { start: Date; end: Date }[] = [];
  for (const s of scored) {
    if (!unique.find((u) => u.start.getTime() === s.slot.start.getTime())) {
      unique.push(s.slot);
    }
    if (unique.length >= 4) break;
  }
  return unique;
}

/* =========================
   Component
========================= */

export default function SmartBooking() {
  /* ---- state ---- */
  const [selectedSvcId, setSelectedSvcId] = useState<Service['id']>('pt_private');

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);

  // Admin overrides
  const [baseHours, setBaseHours] = useState<
    Record<Service['id'], Record<number, Window | null>>
  >({});
  const [blackouts, setBlackouts] = useState<Set<string>>(new Set());

  // Modal state
  const [openDay, setOpenDay] = useState<Date | null>(null);
  const [requestMode, setRequestMode] = useState(false);
  const [reqName, setReqName] = useState('');
  const [reqEmail, setReqEmail] = useState('');
  const [reqPhone, setReqPhone] = useState('');
  const [reqNote, setReqNote] = useState('');
  const [formErr, setFormErr] = useState('');

  /* ---- load/save ---- */
  useEffect(() => {
    try {
      const b = JSON.parse(localStorage.getItem(BOOKINGS_KEY) || '[]');
      setBookings(b);
    } catch {}
    try {
      const r = JSON.parse(localStorage.getItem(REQUESTS_KEY) || '[]');
      setRequests(r);
    } catch {}
    try {
      const bh = JSON.parse(localStorage.getItem(BASE_KEY) || '{}');
      setBaseHours(bh || {});
    } catch {}
    try {
      const bb = JSON.parse(localStorage.getItem(BLACK_KEY) || '[]');
      setBlackouts(new Set(bb));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
  }, [bookings]);

  useEffect(() => {
    localStorage.setItem(REQUESTS_KEY, JSON.stringify(requests));
  }, [requests]);

  /* ---- derived ---- */
  const svc = useMemo(
    () => SERVICES.find((s) => s.id === selectedSvcId)!,
    [selectedSvcId]
  );

  // 4-week grid starting Monday (Mon–Sat only)
  const gridDays = useMemo(() => {
    const start = startOfWeekMonday(new Date()); // Monday of current week
    const days: Date[] = [];
    for (let w = 0; w < 4; w++) {
      for (let d = 0; d < 6; d++) {
        const dt = new Date(start);
        dt.setDate(start.getDate() + w * 7 + d + 0); // Mon..Sat
        dt.setHours(0, 0, 0, 0);
        days.push(dt);
      }
    }
    return days;
  }, []);

  // Map bookings by date
  const bookingsByDate = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const b of bookings) {
      const k = b.date;
      const arr = m.get(k);
      if (arr) arr.push(b);
      else m.set(k, [b]);
    }
    return m;
  }, [bookings]);

  /* =========================
     Availability generation
  ========================= */

  function effectiveWindowsFor(day: Date, service: Service): Window[] {
    // blackout day?
    if (blackouts.has(ymd(day))) return [];

    // baseHours override?
    const bh = baseHours[service.id];
    if (bh) {
      const v = bh[day.getDay()];
      if (v === null) return []; // explicitly closed
      if (v) return [v];         // single admin window
    }

    // default windows
    return service.windows[day.getDay()] || [];
  }

  function generateSlotsForDay(
    day: Date,
    service: Service,
    dayBookings: Booking[]
  ) {
    const now = new Date();
    const windows = effectiveWindowsFor(day, service);
    const result: { start: Date; end: Date }[] = [];

    // precompute booked intervals for quick overlap test
    const booked: { start: Date; end: Date }[] = dayBookings.map((b) => ({
      start: parseHMToDate(day, b.start),
      end: parseHMToDate(day, b.end),
    }));

    for (const w of windows) {
      const startMin = toMinutes(w.start);
      const endMin = toMinutes(w.end);
      for (
        let m = startMin;
        m + service.durationMin <= endMin;
        m += service.slotGridMin
      ) {
        const slotStart = parseHMToDate(day, fromMinutes(m));
        const slotEnd = addMinutes(slotStart, service.durationMin);

        // enforce lead time / past time
        if (minutesBetween(now, slotStart) < service.leadTimeMin) continue;

        // overlap with existing bookings?
        const overlaps = booked.some(
          (b) => slotStart < b.end && slotEnd > b.start
        );
        if (overlaps) continue;

        result.push({ start: slotStart, end: slotEnd });
      }
    }
    return result;
  }

  function slotsForDay(day: Date) {
    const all = generateSlotsForDay(
      day,
      svc,
      bookingsByDate.get(ymd(day))?.filter((b) => b.svcId === svc.id) || []
    );
    return all;
  }

  function availableCount(day: Date) {
    return slotsForDay(day).length;
  }

  /* =========================
     Booking & Requests
  ========================= */

  function bookSlot(day: Date, start: Date, end: Date) {
    const dateKey = ymd(day);
    const newItem: Booking = {
      svcId: svc.id,
      date: dateKey,
      start: fromMinutes(start.getHours() * 60 + start.getMinutes()),
      end: fromMinutes(end.getHours() * 60 + end.getMinutes()),
    };

    // add this booking
    setBookings((prev) => [...prev, newItem]);

    // ask for recurring
    setTimeout(() => {
      const confirmRecurring = window.confirm(
        'Book the same slot for the next 4 weeks as well?'
      );
      if (!confirmRecurring) return;

      // try next 3 additional weeks (total 4 weeks including this one)
      for (let w = 1; w < 4; w++) {
        const d2 = new Date(day);
        d2.setDate(d2.getDate() + w * 7);

        // only book if still within a valid window (and free)
        const slots = slotsForDay(d2);
        const match = slots.find(
          (s) =>
            s.start.getHours() === start.getHours() &&
            s.start.getMinutes() === start.getMinutes()
        );
        if (match) {
          setBookings((prev) => [
            ...prev,
            {
              svcId: svc.id,
              date: ymd(d2),
              start: fromMinutes(
                match.start.getHours() * 60 + match.start.getMinutes()
              ),
              end: fromMinutes(
                match.end.getHours() * 60 + match.end.getMinutes()
              ),
            },
          ]);
        }
      }
    }, 0);
  }

  function submitRequest(forDate: string) {
    setFormErr('');
    const name = reqName.trim();
    const email = reqEmail.trim();
    const phone = reqPhone.trim();
    if (!name) {
      setFormErr('Please enter your name.');
      return;
    }
    if (!email && !phone) {
      setFormErr('Please enter either an email or a mobile number.');
      return;
    }
    const item: RequestItem = {
      name,
      email: email || undefined,
      phone: phone || undefined,
      note: reqNote.trim() || undefined,
      svcId: svc.id,
      forDate,
    };
    setRequests((prev) => [item, ...prev]);
    setReqName('');
    setReqEmail('');
    setReqPhone('');
    setReqNote('');
    alert('Thanks! Your request has been recorded.');
  }

  /* =========================
     UI: slots modal
  ========================= */

  function SlotsModal() {
    if (!openDay) return null;
    const day = openDay;
    const dateKey = ymd(day);
    const dayBookings =
      bookingsByDate.get(dateKey)?.filter((b) => b.svcId === svc.id) || [];

    const allSlots = slotsForDay(day);
    const suggested =
      dayBookings.length > 0 ? rankSuggestedSlots(day, allSlots, dayBookings) : [];
    const suggestedKeys = new Set(suggested.map((s) => s.start.getTime()));
    const otherSlots = allSlots.filter((s) => !suggestedKeys.has(s.start.getTime()));

    const hasAnySlots = allSlots.length > 0;

    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl rounded-2xl bg-slate-900 text-white shadow-xl">
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400">{DOW[day.getDay()]}</div>
              <div className="text-lg font-semibold">{new Date(day).toDateString()}</div>
              <div className="text-sm text-slate-400">{svc.name}</div>
            </div>
            <button
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700"
              onClick={() => {
                setOpenDay(null);
                setRequestMode(false);
              }}
            >
              Close
            </button>
          </div>

          <div className="p-5 space-y-6">
            {hasAnySlots && dayBookings.length > 0 && suggested.length > 0 && (
              <div className="space-y-3">
                <div className="font-medium text-green-300">Suggested times</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {suggested.map((s) => (
                    <button
                      key={s.start.getTime()}
                      className="rounded-xl border border-green-400 bg-green-400/10 hover:bg-green-400/20 px-4 py-3 text-left"
                      onClick={() => bookSlot(day, s.start, s.end)}
                    >
                      {s.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} –{' '}
                      {s.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {hasAnySlots && (
              <div className="space-y-3">
                <div className="font-medium text-slate-300">Other times available</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {otherSlots.map((s) => (
                    <button
                      key={s.start.getTime()}
                      className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-3 text-left"
                      onClick={() => bookSlot(day, s.start, s.end)}
                    >
                      {s.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} –{' '}
                      {s.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </button>
                  ))}
                  {otherSlots.length === 0 && suggested.length === 0 && (
                    <div className="text-sm text-slate-400">No free slots left.</div>
                  )}
                </div>
              </div>
            )}

            {!hasAnySlots && (
              <div className="text-slate-300">No free slots on this day.</div>
            )}

            {/* Request different time */}
            <div className="pt-2 border-t border-slate-800">
              <p className="text-sm text-slate-400 mb-3">
                If your desired time isn’t available, request a different time below.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  className="bg-slate-800 rounded px-3 py-2"
                  placeholder="Your name *"
                  value={reqName}
                  onChange={(e) => setReqName(e.target.value)}
                />
                <input
                  className="bg-slate-800 rounded px-3 py-2"
                  placeholder="Email (optional)"
                  value={reqEmail}
                  onChange={(e) => setReqEmail(e.target.value)}
                />
                <input
                  className="bg-slate-800 rounded px-3 py-2"
                  placeholder="Mobile (optional)"
                  value={reqPhone}
                  onChange={(e) => setReqPhone(e.target.value)}
                />
                <input
                  className="bg-slate-800 rounded px-3 py-2 sm:col-span-2"
                  placeholder="Note (optional)"
                  value={reqNote}
                  onChange={(e) => setReqNote(e.target.value)}
                />
              </div>
              {formErr && <div className="text-red-400 text-sm mt-2">{formErr}</div>}
              <div className="mt-3">
                <button
                  className="rounded-lg bg-orange-500 hover:bg-orange-600 px-4 py-2"
                  onClick={() => submitRequest(dateKey)}
                >
                  Request a different time
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* =========================
     Render
  ========================= */

  const today = new Date();
  const monday = startOfWeekMonday(today);

  return (
    <main className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="PTLab" className="h-10 w-auto" />
          <div className="text-xl font-semibold">PTLab Booking</div>
        </div>
        <div className="flex gap-2">
          {SERVICES.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedSvcId(s.id)}
              className={`px-3 py-2 rounded-full border ${
                selectedSvcId === s.id
                  ? 'border-orange-500 bg-orange-500/10'
                  : 'border-slate-700 bg-slate-800 hover:bg-slate-700'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </header>

      {/* Calendar Grid (4 weeks, Mon–Sat) */}
      <section className="max-w-6xl mx-auto px-4 pb-16">
        <div className="mb-4 text-slate-400">
          Showing the next 4 weeks (Monday–Saturday). Past days this week are greyed out.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {gridDays.map((day) => {
            const key = ymd(day);
            const isPastThisWeek =
              day < today && day >= monday && day.getDay() !== 0; // past but within current week
            const isSunday = day.getDay() === 0;
            if (isSunday) return <Fragment key={key} />; // never show Sunday (defensive)

            const count = availableCount(day);
            const disabled = count === 0;
            const cardClasses = [
              'rounded-2xl',
              'bg-slate-800',
              'border',
              'shadow',
              disabled ? 'opacity-70' : '',
              isPastThisWeek ? 'border-slate-800 opacity-60' : 'border-slate-700',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div key={key} className={cardClasses}>
                <div className="px-4 py-3 border-b border-slate-700">
                  <div className="text-sm text-slate-400">
                    {DOW[day.getDay()]}, {day.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                  </div>
                </div>
                <div className="p-4 space-y-4">
                  {count > 0 ? (
                    <div className="text-lg">
                      <span className="font-semibold">{count}</span>{' '}
                      <span className="text-slate-300">slots available</span>
                    </div>
                  ) : (
                    <div className="text-slate-400">No slots</div>
                  )}

                  <div className="flex gap-2">
                    <button
                      disabled={count === 0}
                      onClick={() => setOpenDay(day)}
                      className={`flex-1 rounded-xl px-3 py-2 ${
                        count === 0
                          ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                          : 'bg-orange-500 hover:bg-orange-600'
                      }`}
                    >
                      {count > 0 ? `View slots (${count})` : 'No availability'}
                    </button>
                  </div>

                  <p className="text-xs text-slate-400">
                    If a desired slot isn’t available, you can request a different time in the
                    popup.
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {openDay && <SlotsModal />}
    </main>
  );
}
