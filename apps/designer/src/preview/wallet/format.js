// Apple PassKit value formatting, so the preview matches how iOS Wallet renders fields.

const DATE_STYLE = {
  PKDateStyleShort: "short",
  PKDateStyleMedium: "medium",
  PKDateStyleLong: "long",
  PKDateStyleFull: "full"
};

/**
 * Format one boardingPass field value the way iOS Wallet would.
 * @param {{value:any, dateStyle?:string, timeStyle?:string, numberStyle?:string}} field
 * @returns {string}
 */
export function formatFieldValue(field) {
  const { value } = field;
  if (value === undefined || value === null || value === "") return "—";
  if (field.dateStyle || field.timeStyle) return formatDate(value, field.dateStyle, field.timeStyle);
  if (field.numberStyle) return formatNumber(value, field.numberStyle);
  return String(value);
}

/** @returns {string} */
export function formatDate(value, dateStyle = "PKDateStyleNone", timeStyle = "PKDateStyleNone") {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const opts = {};
  if (DATE_STYLE[dateStyle]) opts.dateStyle = DATE_STYLE[dateStyle];
  if (DATE_STYLE[timeStyle]) opts.timeStyle = DATE_STYLE[timeStyle];
  if (!opts.dateStyle && !opts.timeStyle) return String(value);
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

/** @returns {string} */
export function formatNumber(value, numberStyle) {
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  if (numberStyle === "PKNumberStylePercent") {
    return new Intl.NumberFormat(undefined, { style: "percent" }).format(n);
  }
  return new Intl.NumberFormat().format(n);
}
