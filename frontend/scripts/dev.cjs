/**
 * Dev/start launcher for restricted environments.
 * Shims os.networkInterfaces() when the host forbids interface enumeration,
 * then hands off to the Next.js CLI.
 */
const os = require("node:os");

try {
  os.networkInterfaces();
} catch {
  os.networkInterfaces = () => ({});
}

if (!process.env.HOSTNAME) process.env.HOSTNAME = "localhost";

const args = process.argv.slice(2);
process.argv = [process.argv[0], "next", ...args];
require("next/dist/bin/next");
