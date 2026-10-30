#!/usr/bin/env node
/**
 * Verify that the GEO Radar endpoint and token work.
 * Does not print the token.
 */
const base = (process.env.GEO_RADAR_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const token = process.env.GEO_RADAR_TOKEN;
if (!token) {
  console.error("GEO_RADAR_TOKEN is required");
  process.exit(1);
}
const res = await fetch(`${base}/api/brands`, {
  headers: { Authorization: `Bearer ${token}` },
});
const body = await res.text();
if (!res.ok) {
  console.error(`GEO Radar check failed: HTTP ${res.status}`);
  console.error(body.slice(0, 500));
  process.exit(1);
}
const data = JSON.parse(body);
console.log(`OK: ${data.data?.brands?.length ?? 0} brand(s) visible to this token`);
