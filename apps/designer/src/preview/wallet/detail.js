import { formatDate } from "./format.js";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function section(title, lines) {
  const s = el("div", "wallet-detail-section");
  s.appendChild(el("div", "title", title));
  const body = el("div", "body");
  for (const [k, v] of lines) {
    const line = el("div", "line");
    line.appendChild(el("span", null, k));
    line.appendChild(el("span", null, v));
    body.appendChild(line);
  }
  s.appendChild(body);
  return s;
}

/**
 * Render the iOS 26 semantic expanded view from the signed pass.
 * @param {HTMLElement} root
 * @param {object} pass  output of formStateToPassJson
 */
export function renderDetail(root, pass) {
  const sem = pass.semantics ?? {};
  const card = el("div", "wallet-detail");

  const head = el("div", "wallet-back-head");
  const badge = el("div", "badge");
  badge.style.background = pass.backgroundColor ?? "#222";
  badge.textContent = sem.airlineCode ?? "✈";
  head.appendChild(badge);
  head.appendChild(el("div", null, `${sem.flightCode ?? ""} · ${pass.organizationName ?? ""}`));
  card.appendChild(head);

  card.appendChild(section("Route", [
    [`${sem.departureAirportCode ?? "—"} ${sem.departureLocationDescription ?? ""}`,
     sem.currentDepartureDate ? formatDate(sem.currentDepartureDate, "PKDateStyleMedium", "PKDateStyleShort") : "—"],
    [`${sem.destinationAirportCode ?? "—"} ${sem.destinationLocationDescription ?? ""}`,
     sem.currentArrivalDate ? formatDate(sem.currentArrivalDate, "PKDateStyleMedium", "PKDateStyleShort") : "—"]
  ]));

  const boardingLines = [];
  if (sem.boardingGroup) boardingLines.push(["Group", sem.boardingGroup]);
  if (sem.boardingSequenceNumber) boardingLines.push(["Sequence", sem.boardingSequenceNumber]);
  if (sem.currentBoardingDate) boardingLines.push(["Boards", formatDate(sem.currentBoardingDate, "PKDateStyleNone", "PKDateStyleShort")]);
  if (sem.departureGate) boardingLines.push(["Gate", sem.departureGate]);
  if (boardingLines.length) card.appendChild(section("Boarding", boardingLines));

  if (Array.isArray(sem.seats) && sem.seats.length) {
    card.appendChild(section("Seats", sem.seats.map(s => [s.seatNumber ?? "—", s.seatType ?? ""])));
  }

  if (typeof sem.duration === "number") {
    const h = Math.floor(sem.duration / 3600);
    const m = Math.floor((sem.duration % 3600) / 60);
    card.appendChild(section("Flight Duration", [["Estimated", `${h}h ${m}m`]]));
  }
  if (sem.securityScreening) card.appendChild(section("Security Screening", [["Type", sem.securityScreening]]));
  if (sem.transitProvider) card.appendChild(section("Transit", [["Info", sem.transitProvider]]));
  if (Array.isArray(sem.wifiAccess) && sem.wifiAccess.length) {
    card.appendChild(section("Wi-Fi", sem.wifiAccess.map(w => [w.ssid, w.password ?? ""])));
  }
  if (Array.isArray(pass.upcomingPassInformation) && pass.upcomingPassInformation.length) {
    card.appendChild(section("Upcoming", pass.upcomingPassInformation.map(e => [
      e.name ?? e.identifier,
      e.dateInformation?.date ? formatDate(e.dateInformation.date, "PKDateStyleMedium", "PKDateStyleShort") : "—"
    ])));
  }

  root.appendChild(card);
}
