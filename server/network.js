import os from 'node:os';

const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];
// Virtual adapters (WSL, Hyper-V, Docker, VirtualBox, VPNs) have addresses
// other devices on the Wi-Fi can't reach, so list them last.
const VIRTUAL = /(vethernet|wsl|docker|br-|veth|virtualbox|vmware|vmnet|hyper-v|tailscale|zerotier|utun|tun|tap)/i;

/** IPv4 addresses other devices on the network can use to reach this machine. */
export function lanAddresses() {
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      found.push({ address: a.address, iface: name, virtual: VIRTUAL.test(name) });
    }
  }
  const rank = (x) => (x.virtual ? 2 : 0) + (PRIVATE.some((r) => r.test(x.address)) ? 0 : 1);
  return found.sort((a, b) => rank(a) - rank(b)).map((x) => x.address);
}

export function hostnames() {
  const host = os.hostname().toLowerCase();
  const names = new Set(['localhost']);
  if (host && host !== 'localhost') {
    names.add(host);
    if (!host.includes('.')) names.add(`${host}.local`);
  }
  return [...names];
}
