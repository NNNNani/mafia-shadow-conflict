// Finds the addresses other devices on the same Wi-Fi can use to reach this server.
import os from "node:os";

/** True for private network ranges: 192.168.x.x, 10.x.x.x, 172.16-31.x.x */
function isPrivate(ip) {
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

/**
 * Local IPv4 addresses of this computer, best first (192.168.x.x is usually the Wi-Fi).
 * Example: ["192.168.1.24"]
 */
export function lanAddresses() {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((net) => net && net.family === "IPv4" && !net.internal)
    .map((net) => net.address);

  const rank = (ip) => (ip.startsWith("192.168.") ? 0 : isPrivate(ip) ? 1 : 2);
  return [...new Set(addresses)].sort((a, b) => rank(a) - rank(b));
}

/** Full URLs to share with the other players, e.g. ["http://192.168.1.24:3000"]. */
export function lanUrls(port) {
  return lanAddresses().map((ip) => `http://${ip}:${port}`);
}
