import "dotenv/config";
import { validateProdWebServiceURL } from "./env-validate.js";

const profile = process.env.CERT_PROFILE ?? "dev";
const webServiceURL = process.env.WEB_SERVICE_URL;

if (process.env.NODE_ENV !== "test") validateProdWebServiceURL(profile, webServiceURL);

export const env = {
  profile,
  certDir: `certs/${profile}`,
  passphrase: process.env.KEY_PASSPHRASE,
  port: Number(process.env.PORT ?? 4317),
  webServiceURL
};
