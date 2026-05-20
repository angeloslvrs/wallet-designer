import { state } from "../state.js";
import { renderFront } from "./front.js";
import { renderBack } from "./back.js";
import { renderDetail } from "./detail.js";
import { getActiveTab, onTabChange } from "../tabs.js";

const stage = () => document.getElementById("preview-stage");

export function renderActiveTab() {
  const root = stage();
  const t = getActiveTab();
  root.innerHTML = "";
  if (t === "front") renderFront(root, state);
  else if (t === "back") renderBack(root, state);
  else renderDetail(root, state);
}

onTabChange(renderActiveTab);
