// Tiny pub-sub form state. Single source of truth for previews + build.

const initial = {
  meta: { passTypeId: "pass.dev.local", teamId: "DEV0000000", organizationName: "Rocket Partners Airlines", serialNumber: "RP-001", description: "Boarding pass" },
  branding: { logoText: "Rocket Partners", foregroundColor: "rgb(255,255,255)", backgroundColor: "rgb(20,30,80)", labelColor: "rgb(180,200,255)" },
  flight: {
    airlineCode: "RP",
    flightNumber: "247",
    departure: { iata: "SFO", name: "San Francisco Intl", city: "San Francisco", terminal: "2", gate: "B12", boarding: "2026-06-01T07:30:00-07:00", depart: "2026-06-01T08:15:00-07:00" },
    arrival:   { iata: "JFK", name: "John F. Kennedy Intl", city: "New York", terminal: "4", arrive: "2026-06-01T16:45:00-04:00" }
  },
  passenger: { name: "ANGELO SOLIVERES", seats: [{ number: "14A", cabin: "economy", row: "14", letter: "A" }], boardingGroup: "3", seqNumber: "0042" },
  barcode: { format: "PKBarcodeFormatQR", message: "RP247-SFOJFK-14A-0042", altText: "RP247 14A" },
  iOS26: { duration: 19800, securityScreening: "TSA PreCheck", wifi: [{ ssid: "GoGoInflight", password: "RP247" }] }
};

const STORAGE_KEY = "wpd:form-state";

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export const state = loadPersisted() ?? structuredClone(initial);
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  listeners.forEach(fn => fn(state));
};

export function resetState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, structuredClone(initial));
  notify();
}

/** Replace the whole state object (used when loading a fixture). */
export function replaceState(next) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, structuredClone(next));
  notify();
}

/** Set a deep path like "flight.departure.iata" to a value. */
export function setPath(path, value) {
  const segs = path.split(".");
  let o = state;
  for (let i = 0; i < segs.length - 1; i++) o = o[segs[i]];
  o[segs.at(-1)] = value;
  notify();
}

/** Get a deep path value. */
export function getPath(path) {
  return path.split(".").reduce((o, k) => o?.[k], state);
}
