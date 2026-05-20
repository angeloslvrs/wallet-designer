import "dotenv/config";

const profile = process.env.CERT_PROFILE ?? "dev";
export const env = {
  profile,
  certDir: `certs/${profile}`,
  passphrase: process.env.KEY_PASSPHRASE,
  port: Number(process.env.PORT ?? 4317)
};
