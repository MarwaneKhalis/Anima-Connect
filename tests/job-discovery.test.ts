import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { JobDiscovery } from "../server/job-discovery.ts";

test("discovery extracts structured jobs, canonicalizes and rejects private redirects", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "http://127.0.0.1:1/private" });
      res.end();
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<script type="application/ld+json">${JSON.stringify({
        "@graph": [
          {
            "@type": "JobPosting",
            title: "Ingénieur test",
            url: "/apply?utm_source=demo&ref=important",
            hiringOrganization: { name: "Fixture" },
            jobLocation: {
              address: { addressLocality: "Paris", addressCountry: "FR" },
            },
            description: "<p>Test automatisé</p>",
          },
          {
            "@type": "JobPosting",
            title: "Doublon",
            url: "/apply?ref=important",
          },
        ],
      })}</script>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const discovery = new JobDiscovery([base]);
    const value = await discovery.discover(`${base}/jobs`);
    assert.equal(value.offers.length, 1);
    assert.equal(value.offers[0].url, `${base}/apply?ref=important`);
    assert.equal(value.offers[0].company, "Fixture");
    assert.equal(value.offers[0].description, "Test automatisé");
    await assert.rejects(
      () => discovery.discover(`${base}/redirect`),
      /HTTPS publique/,
    );
    await assert.rejects(
      () => new JobDiscovery().discover(`${base}/jobs`),
      /HTTPS publique/,
    );
    await assert.rejects(
      () => discovery.discover("https://user:secret@example.com"),
      /identifiants/,
    );
    await assert.rejects(
      () => discovery.discover("https://127.0.0.1/jobs"),
      /privées/,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
