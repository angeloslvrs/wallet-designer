import { esc } from "./esc.js";
import badgeUrl from "./assets/add-to-apple-wallet/en.svg";

// Apple's OFFICIAL "Add to Apple Wallet" badge (US/UK locale), downloaded from
// developer.apple.com/wallet/add-to-apple-wallet-guidelines/ and committed
// verbatim under assets/add-to-apple-wallet/. Per Apple's guidelines the
// artwork is used as-is: never recreated, modified, re-colored, re-typeset,
// dimmed, flipped, rotated, or animated, no shadows/glows, uniform height
// everywhere it appears, and kept secondary to the app's own primary actions.
// When a pass can't be added (no URL), the badge is hidden — not dimmed.
export function appleWalletButton(url) {
  if (!url) return "";
  return `<a href="${esc(url)}" aria-label="Add to Apple Wallet">` +
    `<img src="${badgeUrl}" alt="Add to Apple Wallet" style="height:40px;display:block" /></a>`;
}
