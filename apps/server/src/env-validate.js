export function validateProdWebServiceURL(profileName, value) {
  if (profileName !== "prod") return;
  if (!value) {
    throw new Error("CERT_PROFILE=prod requires WEB_SERVICE_URL");
  }
  let parsed;
  try { parsed = new URL(value); }
  catch {
    throw new Error("CERT_PROFILE=prod requires WEB_SERVICE_URL to be a valid https:// URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("CERT_PROFILE=prod requires WEB_SERVICE_URL to use https://");
  }
}
