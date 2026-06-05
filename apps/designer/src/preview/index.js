import { state } from "../state.js";
import { formStateToPassJson } from "@wpd/pass-builder/form-to-pass.js";
import { toPassView } from "./wallet/model.js";
import { renderFront } from "./wallet/card.js";
import { renderBack } from "./wallet/back.js";
import { renderDetail } from "./wallet/detail.js";
import { getActiveTab, onTabChange } from "../tabs.js";
import "./wallet/wallet.css";

const stage = () => document.getElementById("preview-stage");

export function renderActiveTab() {
  const root = stage();
  root.innerHTML = "";

  let pass;
  try {
    pass = formStateToPassJson(state);
  } catch (err) {
    const e = document.createElement("div");
    e.className = "wallet-error";
    e.textContent = `Preview error: ${err.message}`;
    root.appendChild(e);
    return;
  }

  const view = toPassView(pass);
  const logo = state.branding?.logoDataUrl ?? null;
  const t = getActiveTab();
  if (t === "front") renderFront(root, view, logo);
  else if (t === "back") renderBack(root, view, logo);
  else renderDetail(root, pass);
}

onTabChange(renderActiveTab);
