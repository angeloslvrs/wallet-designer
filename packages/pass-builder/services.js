// The boarding-pass services page (Apple's "Offer additional flight
// information"): top-level pass.json keys Wallet turns into action buttons
// below the pass. Airline-level — they live on the airline design, not on a
// route or flight. (Our older iOS26.eventGuide links — bag policy, parking,
// transfer… — are poster-event-ticket keys Wallet ignores on boarding passes.)
// Browser-safe: Design and the builder share the list.

/** @type {ReadonlyArray<{key: string, label: string, kind: "url"|"email"|"phone"}>} */
export const SERVICE_LINKS = Object.freeze([
  { key: "managementURL",                label: "Manage booking",          kind: "url" },
  { key: "changeSeatURL",                label: "Change seat",             kind: "url" },
  { key: "upgradeURL",                   label: "Upgrade seat",            kind: "url" },
  { key: "purchaseAdditionalBaggageURL", label: "Add checked bag",         kind: "url" },
  { key: "purchaseWifiURL",              label: "In-flight Wi-Fi",         kind: "url" },
  { key: "purchaseLoungeAccessURL",      label: "Lounge access",           kind: "url" },
  { key: "orderFoodURL",                 label: "Meal ordering",           kind: "url" },
  { key: "entertainmentURL",             label: "Entertainment",           kind: "url" },
  { key: "trackBagsURL",                 label: "Track bags",              kind: "url" },
  { key: "reportLostBagURL",             label: "Report a lost bag",       kind: "url" },
  { key: "requestWheelchairURL",         label: "Request a wheelchair",    kind: "url" },
  { key: "registerServiceAnimalURL",     label: "Register a service animal", kind: "url" },
  { key: "transitProviderWebsiteURL",    label: "Airline website",         kind: "url" },
  { key: "transitProviderEmail",         label: "Airline email",           kind: "email" },
  { key: "transitProviderPhoneNumber",   label: "Airline phone",           kind: "phone" }
]);
export const SERVICE_LINK_KEYS = Object.freeze(SERVICE_LINKS.map(l => l.key));

/** User-facing problem with a link value, or null. */
export function serviceLinkError(kind, value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (kind === "email") return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : "Enter an email address";
  if (kind === "phone") return /^\+?[0-9 ()./-]{5,}$/.test(v) ? null : "Enter a phone number";
  try { const u = new URL(v); return u.protocol === "https:" ? null : "Use an https:// link"; } catch { return "Enter a full link (https://…)"; }
}
