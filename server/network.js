import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];
// Virtual adapters (WSL, Hyper-V, Docker, LXD, libvirt, VPNs, macOS
// Internet Sharing/AirDrop) have addresses other devices on the Wi-Fi can't
// reach, so list them last.
const VIRTUAL =
  /(vethernet|wsl|docker|br-|veth|virbr|lxdbr|lxcbr|cni|flannel|cali|kube|virtualbox|vmware|vmnet|vmenet|hyper-v|tailscale|zerotier|^zt|^wg\d|utun|tun|tap|^bridge\d|^anpi|^awdl|^llw|^ap\d)/i;

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

let cachedMdns;

/**
 * The "name.local" address other devices can use instead of the IP, when
 * this machine announces one: always on macOS (Bonjour), and on Linux when
 * avahi-daemon is running. Survives the IP changing.
 */
export function mdnsName() {
  if (cachedMdns !== undefined) return cachedMdns;
  cachedMdns = null;
  try {
    if (process.platform === 'darwin') {
      const name = execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8', timeout: 2000 }).trim();
      if (name) cachedMdns = `${name.toLowerCase()}.local`;
    } else if (process.platform === 'linux' && ['/run/avahi-daemon/pid', '/var/run/avahi-daemon/pid'].some((f) => fs.existsSync(f))) {
      const name = os.hostname().split('.')[0].toLowerCase();
      if (name && name !== 'localhost') cachedMdns = `${name}.local`;
    }
  } catch {
    cachedMdns = null;
  }
  return cachedMdns;
}

/** Names to put in the HTTPS certificate. */
export function hostnames() {
  const host = os.hostname().toLowerCase();
  const names = new Set(['localhost']);
  if (host && host !== 'localhost') {
    names.add(host);
    if (!host.includes('.')) names.add(`${host}.local`);
  }
  const mdns = mdnsName();
  if (mdns) names.add(mdns);
  return [...names];
}
