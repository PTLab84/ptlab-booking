'use client';

import { useEffect, useMemo, useState } from 'react';

type Window = { start: string; end: string };
type BaseHours = Record<string, Record<number, Window | null>>; // serviceId -> weekday -> window or null

const SERVICES = [
  { id: 'pt_private', name: 'PT @ Private Gym' },
  { id: 'pt_local',   name: 'PT @ Local Gym'  },
];

const BASE_KEY = 'ptlab-basehours-v1';
const BLACK_KEY = 'ptlab-blackouts-v1';

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export default function AdminPage() {
  const [active, setActive] = useState(SERVICES[0].id);
  const [base, setBase] = useState<BaseHours>({});
  const [blackouts, setBlackouts] = useState<string[]>([]);
  const [newDate, setNewDate] = useState('');

  // load
  useEffect(() => {
    try {
      setBase(JSON.parse(localStorage.getItem(BASE_KEY) || '{}'));
      setBlackouts(JSON.parse(localStorage.getItem(BLACK_KEY) || '[]'));
    } catch {}
  }, []);

  // ensure structure
  const data = useMemo(() => {
    const b = { ...base };
    for (const s of SERVICES) {
      b[s.id] ||= {};
      for (let d = 1; d <= 6; d++) b[s.id][d] ??= null; // Mon..Sat
    }
    return b as BaseHours;
  }, [base]);

  function setWin(svc: string, dow: number, w: Window | null) {
    setBase(prev => ({ ...prev, [svc]: { ...(prev[svc]||{}), [dow]: w }}));
  }

  function saveAll() {
    localStorage.setItem(BASE_KEY, JSON.stringify(data));
    localStorage.setItem(BLACK_KEY, JSON.stringify(blackouts));
    alert('Saved!');
  }

  return (
    <main className="min-h-screen bg-slate-900 text-white p-6">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Admin — PTLab Calendar</h1>
          <button onClick={saveAll} className="bg-orange-500 hover:bg-orange-600 rounded px-4 py-2">Save</button>
        </header>

        {/* Service tabs */}
        <div className="flex gap-2">
          {SERVICES.map(s => (
            <button key={s.id}
              onClick={() => setActive(s.id)}
              className={`px-3 py-1 rounded-full border ${active===s.id?'border-orange-500 bg-orange-500/10':'border-slate-700 bg-slate-800 hover:bg-slate-700'}`}>
              {s.name}
            </button>
          ))}
        </div>

        {/* Base hours editor */}
        <section className="bg-slate-800 rounded-2xl p-4">
          <h2 className="font-semibold mb-3">Base weekly hours (Mon–Sat)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1,2,3,4,5,6].map(d => {
              const w = data[active][d];
              return (
                <div key={d} className="rounded-xl bg-slate-900 p-3">
                  <div className="mb-2 font-medium">{DOW[d]}</div>
                  <label className="flex items-center gap-2 text-sm mb-2">
                    <input
                      type="checkbox"
                      checked={!!w}
                      onChange={e => setWin(active, d, e.target.checked ? {start:'09:00', end:'17:00'} : null)}
                    />
                    Enable
                  </label>
                  <div className="flex items-center gap-2">
                    <input type="time" className="bg-slate-800 rounded px-2 py-1"
                      value={w?.start || ''} disabled={!w}
                      onChange={e => setWin(active, d, { start: e.target.value, end: w?.end || '17:00' })} />
                    <span>–</span>
                    <input type="time" className="bg-slate-800 rounded px-2 py-1"
                      value={w?.end || ''} disabled={!w}
                      onChange={e => setWin(active, d, { start: w?.start || '09:00', end: e.target.value })} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Tip: This overrides the default availability for the booking page.
          </p>
        </section>

        {/* Blackout days */}
        <section className="bg-slate-800 rounded-2xl p-4">
          <h2 className="font-semibold mb-3">Blackout days</h2>
          <div className="flex gap-2">
            <input type="date" value={newDate} onChange={e=>setNewDate(e.target.value)} className="bg-slate-900 rounded px-2 py-1" />
            <button
              className="bg-slate-900 hover:bg-slate-700 rounded px-3"
              onClick={() => { if(newDate && !blackouts.includes(newDate)){ setBlackouts([...blackouts, newDate]); setNewDate(''); }}}
            >
              Add
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {blackouts.map(d => (
              <li key={d} className="flex items-center justify-between bg-slate-900 rounded px-3 py-2">
                <span>{d}</span>
                <button onClick={() => setBlackouts(blackouts.filter(x=>x!==d))}
                  className="text-sm text-slate-300 hover:text-white">Remove</button>
              </li>
            ))}
            {blackouts.length===0 && <li className="text-slate-400 text-sm">No blackout days.</li>}
          </ul>
        </section>

        <p className="text-xs text-slate-500">
          Note: This demo stores settings in your browser. We can later connect a real database or Google Calendar.
        </p>
      </div>
    </main>
  );
}
