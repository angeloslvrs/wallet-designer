import { esc } from "./esc.js";

// Apple "Add to Apple Wallet" lockup as an inline-SVG link. Per Apple's
// "Add to Apple Wallet" guidelines this prototype lockup is a visual stand-in:
// production must ship Apple's official localized SVG badge under the Wallet
// Marketing Agreement (and a native app uses PKAddPassButton). Wording is the
// exact "Add to Apple Wallet" (not "Add to Wallet"), black on light surfaces,
// no shadow/animation/dimming, kept secondary to the page's primary action.
export function appleWalletButton(url) {
  return `<a class="wpd-wallet" href="${esc(url)}" aria-label="Add to Apple Wallet">` +
    `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">` +
    `<rect x="3" y="6.5" width="18" height="12" rx="2.6" fill="#fff"/>` +
    `<rect x="3" y="9.4" width="18" height="1.5" fill="#000"/>` +
    `<rect x="14.4" y="12.6" width="4.2" height="3.1" rx="1.1" fill="#000"/></svg>` +
    `<span class="wpd-wallet-txt"><span class="wpd-wallet-sm">Add to</span>` +
    `<span class="wpd-wallet-lg">Apple Wallet</span></span></a>`;
}
