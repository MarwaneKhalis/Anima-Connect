import { isIP } from "node:net";

function ipv4Octets(value: string): number[] | null {
  if (isIP(value) !== 4) return null;
  return value.split(".").map(Number);
}

function publicIPv4(value: string): boolean {
  const octets = ipv4Octets(value);
  if (!octets) return false;
  const [a, b, c] = octets;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function ipv6Words(value: string): number[] | null {
  if (isIP(value) !== 6) return null;
  let input = value.toLowerCase();
  const mapped = input.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const octets = ipv4Octets(mapped[2]);
    if (!octets) return null;
    input = `${mapped[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").map((word) => parseInt(word, 16)) : [];
  const right = halves[1] ? halves[1].split(":").map((word) => parseInt(word, 16)) : [];
  const missing = 8 - left.length - right.length;
  const words = halves.length === 1 ? left : [...left, ...Array(Math.max(0, missing)).fill(0), ...right];
  return words.length === 8 && words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff) ? words : null;
}

function publicIPv6(value: string): boolean {
  const words = ipv6Words(value);
  if (!words) return false;
  // Only global unicast (2000::/3) is eligible. Reject transition, documentation,
  // and other special-purpose blocks even when they are syntactically global.
  const first = words[0];
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x3fff && (words[1] & 0xfff0) === 0) return false; // RFC 9637 documentation prefix 3fff::/20.
  if (first === 0x2001 && words[1] <= 0x01ff) return false;
  if (first === 0x2001 && words[1] === 0x0db8) return false;
  if (first === 0x2002) return false; // 6to4 embeds an independently routed IPv4 address.
  return true;
}

export function isPublicAddress(value: string): boolean {
  return publicIPv4(value) || publicIPv6(value);
}
