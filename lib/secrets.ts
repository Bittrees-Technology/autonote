import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
function key() {
  if (!process.env.AUTH_SECRET)
    throw new Error("Authentication secret missing");
  return createHash("sha256").update(process.env.AUTH_SECRET).digest();
}
export function encrypt(text: string) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key(), iv);
  return Buffer.concat([
    iv,
    c.update(text),
    c.final(),
    c.getAuthTag(),
  ]).toString("base64url");
}
export function decrypt(value: string) {
  const b = Buffer.from(value, "base64url"),
    c = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  c.setAuthTag(b.subarray(-16));
  return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString();
}
