'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Service, Booking, Slot,
  mondayOfWeek, addDays, ymd, hhmm,
  generateSlotsForDay, recommendedSlots
} from '../../lib/schedule';

// --- PTLab services (2 PT services only) ---
const SERVICES: Service[] = [
  {
    id: 'pt_private',
    name: 'PT @ Private Gym',
    durationMin: 45,
    gridMin: 15,
    windows: {
      1: [{ start: '07:00', end: '13:00' }], // Mon
      2: [{ start: '07:00', end: '13:00' }],
      3: [{ start: '07:00', end: '13:00' }],
      4: [{ start: '07:00', end: '13:00' }],
      5: [{ start: '07:00', end: '13:00' }], // Fri
    },
  },
  {
    id: 'pt_local',
    name: 'PT @ Local Gym',
    durationMin: 45,
    gridMin: 15,
    windows: {
      1: [{ start: '13:30', end: '16:30' }], // Mon
      2: [{ start: '13:30', end: '16:30' }],
      3: [{ start: '13:30', end: '16:30' }],
      4: [{ start: '13:30', end: '16:30' }], // Thu
    },
  },
];

// Simple localStorage helpers (browser-only)
const LS_KEY = 'ptlab-bookings-v1';
const loadBookings = (): Booking[] => {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
};
const saveBookings = (b: Booking[]) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_KEY, JSON.stringify(b));
};

// ---- UI ----
export default function SmartBooking() {
  const [serviceId, setServiceId] = useState<string|undefined>();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [week0, setWeek0] = useState<Date>(() => mondayOfWeek());
  const [openDay, setOpenDay] = useState<Date | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);

  // request-a-different-time form
  const [reqName, setReqName] = useState('');
  const [reqEmail, setReqEmail] = useState('');
  const [reqMobile, setReqMobile] = useState('');
  const requestValid = reqName.trim() !== '' && (reqEmail.trim() !== '' || reqMobile.trim() !== '');

  useEffect(() => { setBookings(loadBookings()); }, []);
  useEffect(() => { saveBookings(bookings); }, [bookings]);

  const svc = useMemo(
    () => SERVICES.find(s => s.id === serviceId),
    [serviceId]
  );

  // 4 rolling weeks, Monday start, exclude Sundays
  const days: Date[] = useMemo(() => {
    const out: Date[] = [];
    for (let w = 0; w < 4; w++) {
      for (let d = 0; d < 6; d++) { // Mon..Sat
        out.push(addDays(week0, w * 7 + d));
      }
    }
    return out;
  }, [week0]);

  const today = new Date();

  // group bookings by date for quick lookup
  const bookingsByDate = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const b of bookings) {
      const k = ymd(b.start);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(b);
    }
    return m;
  }, [bookings]);

  function countSlots(day: Date): number {
    if (!svc) return 0;
    const dayBookings = bookingsByDate.get(ymd(day)) || [];
    return generateSlotsForDay(day, svc, dayBookings).length;
  }

  function onChooseSlot(slot: Slot) {
    // Ask for recurring (next 4 weeks)
    const repeat = confirm('Book the same slot for the next 4 weeks? Click OK for Yes, Cancel for just this date.');
    const newBookings: Booking[] = [];
    for (let i = 0; i < (repeat ? 4 : 1); i++) {
      const s = addDays(slot.start, i * 7);
      const e = addDays(slot.end,   i * 7);
      newBookings.push({ serviceId: svc!.id, start: s, end: e });
    }
    setBookings(prev => [...prev, ...newBookings]);
    setOpenDay(null);
    alert('Booked! (Saved in your browser for demo)');
  }

  function DayCell({ day }: { day: Date }) {
    const past = day < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const disabled = !svc || past;
    const n = svc ? countSlots(day) : 0;
    return (
      <button
        onClick={() => !disabled && n > 0 && setOpenDay(day)}
        className={`rounded-2xl p-4 text-left shadow
          ${disabled ? 'bg-slate-800/60 text-slate-500 cursor-not-allowed' : 'bg-slate-800 hover:bg-slate-700'}
        `}
      >
        <div className="font-semibold">
          {day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
        </div>
        <div className="mt-3 text-sm">
          {!svc ? 'Pick a service' : (n === 0 ? 'No slots' : `${n} slots available`)}
        </div>
        <div className="mt-3">
          <span className={`inline-block px-3 py-1 rounded-full text-xs
            ${n === 0 || disabled ? 'bg-slate-700 text-slate-400' : 'bg-orange-500 text-white'}`}>
            {n === 0 || disabled ? 'Closed' : 'View'}
          </span>
        </div>
      </button>
    );
  }

  function DayModal({ day }: { day: Date }) {
    if (!svc) return null;
    const dayKey = ymd(day);
    const dayBookings = bookingsByDate.get(dayKey) || [];
    const slots = generateSlotsForDay(day, svc, dayBookings);
    const recs = recommendedSlots(slots, dayBookings);
    const other = slots.filter(s => !recs.includes(s));

    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
        <div className="bg-slate-900 w-full max-w-3xl rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-lg font-semibold">Choose a time</div>
              <div className="text-slate-400">
                {day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
            </div>
            <button className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700" onClick={() => setOpenDay(null)}>Close</button>
          </div>

          {/* Suggested section — only if there are existing bookings that day */}
          {recs.length > 0 && (
            <>
              <div className="mb-2 text-sm uppercase tracking-wide text-green-400">Suggested times</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                {recs.map((s, i) => (
                  <button
                    key={`rec-${i}`}
                    className="border-2 border-green-400/60 bg-green-500/10 rounded-full px-4 py-3 hover:bg-green-500/20 text-left"
                    onClick={() => onChooseSlot(s)}
                  >
                    {hhmm(s.start)} – {hhmm(s.end)}
                  </button>
                ))}
              </div>
              <div className="mb-2 text-sm uppercase tracking-wide text-slate-400">Other times available</div>
            </>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(recs.length > 0 ? other : slots).map((s, i) => (
              <button
                key={i}
                className="rounded-full bg-slate-800 hover:bg-slate-700 px-4 py-3 text-left"
                onClick={() => onChooseSlot(s)}
              >
                {hhmm(s.start)} – {hhmm(s.end)}
              </button>
            ))}
            {slots.length === 0 && (
              <div className="text-slate-400">No availability for this day.</div>
            )}
          </div>

          <div className="mt-8 border-t border-slate-700 pt-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-slate-400">
                Don’t see your ideal time? Request a different time and we’ll contact you.
              </div>
              <button className="bg-orange-500 hover:bg-orange-600 text-white rounded-full px-4 py-2"
                onClick={() => setRequestOpen(true)}>
                Request a different time
              </button>
            </div>
          </div>
        </div>

        {/* Request form drawer */}
        {requestOpen && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-full max-w-2xl bg-slate-900 rounded-2xl p-5 border border-slate-700">
            <div className="font-semibold mb-3">Request a different time</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input placeholder="Name *" className="bg-slate-800 rounded px-3 py-2"
                value={reqName} onChange={e => setReqName(e.target.value)} />
              <input placeholder="Email" className="bg-slate-800 rounded px-3 py-2"
                value={reqEmail} onChange={e => setReqEmail(e.target.value)} />
              <input placeholder="Mobile" className="bg-slate-800 rounded px-3 py-2"
                value={reqMobile} onChange={e => setReqMobile(e.target.value)} />
            </div>
            <div className="text-xs text-slate-400 mt-2">* Name and either Email or Mobile are required.</div>
            <div className="mt-3 flex gap-3">
              <button
                disabled={!requestValid}
                className={`rounded-full px-4 py-2 ${requestValid ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-slate-700 text-slate-400 cursor-not-allowed'}`}
                onClick={() => { setRequestOpen(false); alert('Thanks! We’ll contact you.'); }}
              >
                Send request
              </button>
              <button className="rounded-full px-4 py-2 bg-slate-800 hover:bg-slate-700" onClick={() => setRequestOpen(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Week header / controls
  function WeekControls() {
    return (
      <div className="flex items-center justify-between mb-4">
        <div className="text-lg font-semibold">Next 4 weeks</div>
        <div className="flex gap-2">
          <button className="px-3 py-1 bg-slate-800 rounded hover:bg-slate-700" onClick={() => setWeek0(mondayOfWeek(addDays(week0, -7)))}>{'‹'} Prev</button>
          <button className="px-3 py-1 bg-slate-800 rounded hover:bg-slate-700" onClick={() => setWeek0(mondayOfWeek(new Date()))}>This week</button>
          <button className="px-3 py-1 bg-slate-800 rounded hover:bg-slate-700" onClick={() => setWeek0(mondayOfWeek(addDays(week0, 7)))}>Next {'›'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Logo / header optional – add your logo in /public later */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="text-2xl font-bold">PTLab Booking</div>
      </div>

      {/* Step 1 — choose a service */}
      <div className="mb-6">
        <div className="text-sm text-slate-400 mb-2">Step 1 — Choose a service</div>
        <div className="flex flex-wrap gap-3">
          {SERVICES.map(s => (
            <button key={s.id}
              className={`px-4 py-2 rounded-full border ${serviceId === s.id ? 'border-orange-500 bg-orange-500/10 text-orange-200' : 'border-slate-700 bg-slate-800 hover:bg-slate-700'}`}
              onClick={() => setServiceId(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {/* Step 2 — calendar grid */}
      <div className="mb-3 text-sm text-slate-400">Step 2 — Pick a day (Mon–Sat). Grey = unavailable or past days of current week.</div>
      <WeekControls />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {days.map((d, i) => (
          <DayCell key={i} day={d} />
        ))}
      </div>

      {openDay && <DayModal day={openDay} />}
    </div>
  );
}
