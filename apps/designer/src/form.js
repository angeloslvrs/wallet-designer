import { setPath, getPath } from "./state.js";

const sections = [
  ["Meta", [
    { path: "meta.passTypeId", label: "Pass Type ID", type: "text" },
    { path: "meta.teamId", label: "Team ID", type: "text" },
    { path: "meta.organizationName", label: "Organization", type: "text" },
    { path: "meta.serialNumber", label: "Serial Number", type: "text" },
    { path: "meta.description", label: "Description", type: "text" }
  ]],
  ["Branding", [
    { path: "branding.logoText", label: "Logo Text", type: "text" },
    { path: "branding.foregroundColor", label: "Foreground (rgb)", type: "text" },
    { path: "branding.backgroundColor", label: "Background (rgb)", type: "text" },
    { path: "branding.labelColor", label: "Label (rgb)", type: "text" }
  ]],
  ["Flight", [
    { path: "flight.airlineCode", label: "Airline Code (IATA)", type: "text" },
    { path: "flight.flightNumber", label: "Flight Number", type: "text" }
  ]],
  ["Departure", [
    { path: "flight.departure.iata", label: "IATA", type: "text" },
    { path: "flight.departure.name", label: "Airport Name", type: "text" },
    { path: "flight.departure.city", label: "City", type: "text" },
    { path: "flight.departure.terminal", label: "Terminal", type: "text" },
    { path: "flight.departure.gate", label: "Gate", type: "text" },
    { path: "flight.departure.boarding", label: "Boarding (ISO 8601)", type: "text" },
    { path: "flight.departure.depart", label: "Depart (ISO 8601)", type: "text" }
  ]],
  ["Arrival", [
    { path: "flight.arrival.iata", label: "IATA", type: "text" },
    { path: "flight.arrival.name", label: "Airport Name", type: "text" },
    { path: "flight.arrival.city", label: "City", type: "text" },
    { path: "flight.arrival.terminal", label: "Terminal", type: "text" },
    { path: "flight.arrival.arrive", label: "Arrive (ISO 8601)", type: "text" }
  ]],
  ["Passenger", [
    { path: "passenger.name", label: "Name", type: "text" },
    { path: "passenger.boardingGroup", label: "Boarding Group", type: "text" },
    { path: "passenger.seqNumber", label: "Sequence", type: "text" }
  ]],
  ["Seat (first only — multi-seat in CLI for now)", [
    { path: "passenger.seats.0.number", label: "Seat Number", type: "text" },
    { path: "passenger.seats.0.cabin", label: "Cabin", type: "select", options: ["economy", "premium", "business", "first"] }
  ]],
  ["Barcode", [
    { path: "barcode.format", label: "Format", type: "select", options: ["PKBarcodeFormatQR", "PKBarcodeFormatPDF417", "PKBarcodeFormatAztec", "PKBarcodeFormatCode128"] },
    { path: "barcode.message", label: "Message", type: "text" },
    { path: "barcode.altText", label: "Alt Text", type: "text" }
  ]],
  ["iOS 26 Semantic", [
    { path: "iOS26.duration", label: "Duration (seconds)", type: "number" },
    { path: "iOS26.securityScreening", label: "Security Screening", type: "text" },
    { path: "iOS26.transitInfo", label: "Transit Info", type: "text" },
    { path: "iOS26.wifi.0.ssid", label: "Wifi SSID", type: "text" },
    { path: "iOS26.wifi.0.password", label: "Wifi Password", type: "text" }
  ]]
];

export function renderForm(root) {
  root.innerHTML = "";
  for (const [title, fields] of sections) {
    const fs = document.createElement("fieldset");
    const lg = document.createElement("legend");
    lg.textContent = title;
    fs.appendChild(lg);
    for (const f of fields) {
      const lbl = document.createElement("label");
      lbl.textContent = f.label;
      fs.appendChild(lbl);
      let input;
      if (f.type === "select") {
        input = document.createElement("select");
        for (const o of f.options) {
          const opt = document.createElement("option");
          opt.value = o; opt.textContent = o;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement("input");
        input.type = f.type;
      }
      input.value = getPath(f.path) ?? "";
      input.addEventListener("input", e => {
        const v = f.type === "number" ? Number(e.target.value) : e.target.value;
        setPath(f.path, v);
      });
      fs.appendChild(input);
    }
    root.appendChild(fs);
  }
}
