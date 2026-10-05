import dns from 'node:dns';
import net from 'node:net';

// On the internet, calendar links are downloaded from inside the hosting
// provider's network. With `guard` on, links that point back into private
// address space (cloud metadata services, the platform's own internal APIs,
// other machines on that network) are refused, and so is every redirect
// that leads there. At home this is off: a calendar server on your own
// network is a perfectly good thing to subscribe to.

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
]) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 96], ['64:ff9b::', 96], ['100::', 64], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) blocked.addSubnet(address, prefix, 'ipv6');

const PRIVATE_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/i;

function isBlockedAddress(address) {
  // An IPv4 address written as IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
  // goes to that IPv4 address, so check that instead.
  const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(address);
  if (mapped) {
    const [hi, lo] = [mapped[2], mapped[3]].map((h) => Number.parseInt(h, 16));
    return isBlockedAddress(mapped[1] || [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
  }
  const family = net.isIP(address);
  if (!family) return false;
  try {
    return blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
  } catch {
    return true;
  }
}

/** Throws if `url` points somewhere a server on the internet shouldn't fetch. */
export async function assertPublicUrl(url) {
  const { protocol, hostname } = new URL(url);
  if (protocol !== 'https:' && protocol !== 'http:') throw new Error('The link should start with https:// or webcal://');
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const refuse = () => {
    throw new Error("That link points to a private network address, which Hearth can't reach from the cloud.");
  };
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) refuse();
    return;
  }
  if (!host.includes('.') || PRIVATE_NAME.test(host)) refuse();
  let addresses;
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') throw new Error(`Couldn't find the calendar server ${host}`);
    // Some hosts (Cloudflare Workers) can't look names up this way, and
    // can't reach private addresses either, so there's nothing to check.
    return;
  }
  if (addresses.some((a) => isBlockedAddress(a.address))) refuse();
}

/** fetch(), but with `guard` every hop of a redirect is checked first. */
export async function fetchPublic(url, init = {}, { guard = false } = {}) {
  if (!guard) return fetch(url, { ...init, redirect: 'follow' });
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!location) return res;
    await res.body?.cancel();
    current = new URL(location, current).href;
  }
  throw new Error('The calendar link redirected too many times');
}
