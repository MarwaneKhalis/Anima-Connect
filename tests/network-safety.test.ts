import assert from "node:assert/strict";
import test from "node:test";
import { isPublicAddress } from "../server/network-safety.ts";

test("network guard accepts public unicast addresses only", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(ip), true, ip);
  for (const ip of [
    "127.0.0.1", "10.2.3.4", "172.16.0.1", "192.168.1.1", "169.254.1.1",
    "100.64.0.1", "192.0.0.9", "192.0.2.1", "198.18.0.1", "198.51.100.2",
    "203.0.113.2", "224.0.0.1", "255.255.255.255", "::1", "::ffff:127.0.0.1",
    "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "2001:1::1", "2002:0808:0808::1", "3fff::1", "3fff:000f::1",
  ]) assert.equal(isPublicAddress(ip), false, ip);
});
