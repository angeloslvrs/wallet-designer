import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import "dotenv/config";

const profile = process.env.CERT_PROFILE ?? "dev";
const dir = `certs/${profile}`;

console.log(`Profile:  ${profile}`);
console.log(`Cert dir: ${dir}`);

for (const f of ["signerCert.pem", "signerKey.pem", "wwdr.pem"]) {
  const path = `${dir}/${f}`;
  const exists = existsSync(path);
  console.log(`  ${exists ? "✓" : "✗"} ${f}`);
}

if (!existsSync(`${dir}/signerCert.pem`)) process.exit(1);

const out = execFileSync("openssl", ["x509", "-in", `${dir}/signerCert.pem`, "-noout", "-subject", "-issuer", "-startdate", "-enddate"], { encoding: "utf8" });
console.log();
console.log(out);
