import bcrypt from "bcryptjs";

const pin = process.argv[2];
if (!pin || !/^\d{6,8}$/.test(pin)) {
  console.error("Usage: npm run auth:hash-pin -- 123456 or 12345678");
  process.exit(1);
}
const hash = await bcrypt.hash(pin, 12);
console.log(`ADMIN_PIN_HASH=${hash.replaceAll("$", "\\$")}`);
