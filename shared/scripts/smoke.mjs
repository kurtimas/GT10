// End-to-end smoke test against a running server.
// Exercises every tRPC procedure the basic version's GUI uses, including the
// full weigh flow, grading/shrink math, bin inventory movement, corrections,
// the lot-split join fix, reports, close-day, and void reversal.
//
// SAFETY (P1-10): this script MUTATES the target database — it opens sheets,
// weighs trucks, voids loads, and closes the day. Run it only against a
// throwaway database, e.g. boot the dev server with
//   GT_FORCE_OFFLINE=1 GT_OFFLINE_DB_PATH="$(mktemp).db" npm run dev
// By default the script REFUSES to run unless the server's /api/health
// reports mode "offline" (the embedded dev database). Pass --i-know (or
// SMOKE_I_KNOW=1) to override and run against a real database anyway.
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";

const port = process.env.SMOKE_PORT || 3000;
const base = `http://localhost:${port}`;

const iKnow =
  process.argv.includes("--i-know") || process.env.SMOKE_I_KNOW === "1";

// ---- destructive-run guard -------------------------------------------------
let health = null;
try {
  health = await (await fetch(`${base}/api/health`)).json();
} catch {
  console.error(`REFUSING to run: no /api/health answer at ${base} — is the server up?`);
  process.exit(2);
}
if (!iKnow && health?.mode !== "offline") {
  console.error(
    "REFUSING to run: the smoke test creates/voids sheets, weighs trucks, and " +
      "closes the day, but this server's database does NOT look throwaway " +
      `(/api/health reports mode "${health?.mode ?? "?"}").\n` +
      "Boot the server against a throwaway embedded database instead:\n" +
      "  GT_FORCE_OFFLINE=1 GT_OFFLINE_DB_PATH=<temp file> npm run dev\n" +
      "…or pass --i-know if you really mean to mutate this database.",
  );
  process.exit(2);
}
if (iKnow) {
  console.warn(
    `WARNING: --i-know given — mutating the database behind ${base} ` +
      `(mode "${health?.mode ?? "?"}").`,
  );
}

const client = createTRPCClient({
  links: [
    httpBatchLink({
      url: `${base}/api/trpc`,
      transformer: superjson,
    }),
  ],
});

let failures = 0;
function check(name, cond, extra = "") {
  const ok = Boolean(cond);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

const round2 = (n) => Math.round(n * 100) / 100;

// 1. connectivity -------------------------------------------------------
const ping = await client.ping.query();
check("ping", ping.ok === true);

// 2. reference data ------------------------------------------------------
const sites = await client.core.sites.list.query();
check("sites.list", sites.length >= 1, `${sites.length} site(s)`);
const farmers = await client.people.farmers.list.query();
check("farmers.list", farmers.length >= 1, `${farmers.length} farmer(s)`);
const landlords = await client.people.landlords.list.query();
check("landlords.list", Array.isArray(landlords), `${landlords.length} landlord(s)`);
const lots = await client.people.lots.list.query();
check("lots.list", lots.length >= 1, `${lots.length} lot(s)`);
const binsBefore = await client.core.bins.list.query();
check("bins.list", binsBefore.length >= 1, `${binsBefore.length} bin(s)`);
const truckTares = await client.sheets.truckTares.query();
check("truckTares", Array.isArray(truckTares), `${truckTares.length} known truck(s)`);

// pick a crop-share lot (landlord attached) to prove the split join works,
// else fall back to any lot, else no lot
const splitLot = lots.find((l) => l.landlordId && l.landlordSplitPct > 0) ?? null;
const lot = splitLot ?? lots[0] ?? null;
const farmer = farmers.find((f) => f.id === (lot?.farmerId ?? farmers[0].id));

// 3. open sheet ----------------------------------------------------------
const created = await client.sheets.create.mutate({
  siteId: sites[0].id,
  farmerId: farmer.id,
  lotId: lot?.id ?? null,
  truckId: "SMOKE-01",
  driverName: "Smoke Test",
  crop: lot?.crop ?? "Corn",
  direction: "INBOUND",
  notes: "automated smoke test",
});
check("sheets.create", created.id > 0 && /^T-\d{5}$/.test(created.ticketNo), created.ticketNo);

const openQueue = await client.sheets.open.query();
check("sheets.open lists new sheet", openQueue.some((s) => s.id === created.id));

// 4. weigh flow: 81,250 gross − 29,500 tare = 51,750 net ------------------
await client.sheets.weighFirst.mutate({ id: created.id, weightLbs: 81250, truckId: "SMOKE-01", driverName: "Smoke Test" });
const weighed = await client.sheets.weighSecond.mutate({ id: created.id, weightLbs: 29500 });
check("weighSecond net lbs", weighed.netLbs === 51750, `net=${weighed.netLbs}`);

// 5. bin auto-assignment + inventory movement -----------------------------
let got = await client.sheets.get.query({ id: created.id });
const binId = got.sheet.loads?.at(-1)?.binId ?? null; // bin assignment lives on the load, not the sheet
const loadId = got.sheet.loads?.at(-1)?.id;
const crop = got.sheet.crop;
const expectedBin = binsBefore
  .filter((b) => b.siteId === sites[0].id && b.crop === crop)
  .sort((a, b) => a.currentLbs - b.currentLbs)[0];
if (expectedBin) {
  check("bin auto-assigned to least-filled crop bin", binId === expectedBin.id, `bin #${binId}`);
  const binsAfter = await client.core.bins.list.query();
  const before = binsBefore.find((b) => b.id === binId).currentLbs;
  const after = binsAfter.find((b) => b.id === binId).currentLbs;
  check("bin inventory increased by net lbs", after - before === 51750, `${before} → ${after}`);
} else {
  check("bin auto-assigned (no matching bin at site — skipped by design)", binId === null);
}

// 6. grading + shrink math -------------------------------------------------
const bw = { Corn: 56, Wheat: 60, Soybeans: 60, Sorghum: 56, Barley: 48, Oats: 32, Canola: 50, Sunflowers: 25 }[crop] ?? 60;
const graded = await client.sheets.updateLoadGrades.mutate({
  loadId,
  moisturePct: 16.3,
  dockagePct: 2,
  testWeightLbs: 56,
  proteinPct: null,
});
check("grades return recalculated bushels", graded.grossBushels != null);
got = await client.sheets.get.query({ id: created.id });
const smokeLoad = got.sheet.loads.find((l) => l.id === loadId);
check(
  "shrink % = moisture over base + dockage",
  smokeLoad.shrinkPct != null && smokeLoad.shrinkPct > 2,
  `shrink=${smokeLoad.shrinkPct}%`,
);
check(
  "netBushels = gross × (1 − shrink)",
  round2((51750 / bw) * (1 - smokeLoad.shrinkPct / 100)) === smokeLoad.netBushels,
  `${smokeLoad.netBushels} bu @ ${bw} lbs/bu`,
);

// 7. lot split join (regression: lotSplitPct was never selected) -----------
if (splitLot) {
  check(
    "lotSplitPct present in sheet join",
    got.sheet.lotSplitPct === splitLot.landlordSplitPct,
    `split=${got.sheet.landlordName} ${got.sheet.lotSplitPct}%`,
  );
} else {
  console.log("SKIP  lotSplitPct check — no crop-share lot in dataset");
}

// 8. weight correction with reason + bin rebalance --------------------------
const corrected = await client.sheets.updateLoadWeights.mutate({
  loadId,
  grossLbs: 81250,
  tareLbs: 30000,
  changeReason: "smoke test correction",
});
check("updateWeights recomputes net", corrected.netLbs === 51750 - 500, `net=${corrected.netLbs}`);
if (binId) {
  const binsNow = await client.core.bins.list.query();
  const level = binsNow.find((b) => b.id === binId).currentLbs;
  const before = binsBefore.find((b) => b.id === binId).currentLbs;
  check("bin rebalanced after correction", level - before === 51250, `delta=${level - before}`);
}
// restore original weights before close
await client.sheets.updateLoadWeights.mutate({
  loadId,
  grossLbs: 81250,
  tareLbs: 29500,
  changeReason: "smoke test restore",
});

// 9. audit trail ------------------------------------------------------------
got = await client.sheets.get.query({ id: created.id });
const actions = got.events.map((e) => e.action);
check(
  "audit trail captures full lifecycle",
  ["CREATED", "WEIGH_IN", "WEIGH_OUT", "GRADES", "WEIGHT_EDIT"].every((a) => actions.includes(a)),
  actions.join(","),
);

// 10. archive search ---------------------------------------------------------
const found = await client.sheets.list.query({ search: "SMOKE-01" });
check("archive search by truck id", found.some((s) => s.id === created.id));
const byFarmer = await client.sheets.list.query({ farmerId: farmer.id });
check("archive filter by farmer", byFarmer.some((s) => s.id === created.id));

// 11. daily report -------------------------------------------------------------
const report = await client.sheets.dailyReport.query();
check("dailyReport includes the load", report.loads.some((l) => l.sheetId === created.id));
check("dailyReport totals consistent", report.inboundLbs >= 51750, `in=${report.inboundLbs} lbs`);
check("dailyReport crop breakdown", report.byCrop.some((c) => c.crop === crop));
check("dailyReport bin levels", report.bins.length === binsBefore.length);

// 12. close day locks completed sheets -----------------------------------------
// The demo seed deliberately leaves one truck mid-weigh; closeDay refuses
// while any load is on the scale, so void it first (extra void coverage).
let closeBlocked = false;
try {
  await client.sheets.closeDay.mutate();
} catch (e) {
  closeBlocked = String(e?.message ?? e).includes("mid-weigh");
}
check("closeDay refuses while a truck is mid-weigh", closeBlocked);
const openSheets = await client.sheets.open.query();
const stranded = openSheets.filter((s) => s.activeLoad != null);
for (const s of stranded) {
  await client.sheets.voidLoad.mutate({ loadId: s.activeLoad.id, voidReason: "smoke: in-flight before close" });
}
check("in-flight loads voided before close", stranded.length >= 1, `${stranded.length} voided`);
const closed = await client.sheets.closeDay.mutate();
check("closeDay locks completed sheets", closed.closed >= 1, `${closed.closed} closed`);
got = await client.sheets.get.query({ id: created.id });
check("sheet status CLOSED after close-day", got.sheet.status === "CLOSED");
// The admin gate (core.admin.status) decides whether closed-ticket edits
// refuse without a password. When the gate is closed, probes use a WRONG
// password so the probe can never mutate anything. When the gate is open
// (default ADMIN_PASSWORD) the mutations would really execute — so no
// destructive probe is sent at all.
const gate = await client.core.admin.status.query();
const gateClosed = gate.passwordRequired;
const adminPw = process.env.SMOKE_ADMIN_PASSWORD || "grain-admin";
if (gateClosed) {
  let editBlocked = false;
  try {
    await client.sheets.updateLoadWeights.mutate({
      loadId, grossLbs: 80000, tareLbs: 29000, changeReason: "should fail",
      adminPassword: "definitely-wrong",
    });
  } catch {
    editBlocked = true;
  }
  check("closed sheet edit needs the admin password", editBlocked);

  // 13. void guard on closed sheets -----------------------------------------------
  let voidBlocked = false;
  try {
    await client.sheets.voidLoad.mutate({
      loadId, voidReason: "smoke guard probe", adminPassword: "definitely-wrong",
    });
  } catch {
    voidBlocked = true;
  }
  check("closed sheet void needs the admin password", voidBlocked);
} else {
  // gate open — admin mutations are unauthenticated by design; sending the
  // probes here would REALLY rewrite/void the load, so just assert the gate
  const gateStatus = await client.core.admin.status.query();
  check(
    "gate open — closed-ticket edits unauthenticated (by design)",
    gateStatus.passwordRequired === false,
  );
}

// 14. void removes a mid-weigh load from an open sheet ------------------------------
const tmp = await client.sheets.create.mutate({
  siteId: sites[0].id, farmerId: farmer.id, lotId: lot?.id ?? null, crop: lot?.crop ?? "Corn", direction: "OUTBOUND",
});
await client.sheets.weighFirst.mutate({ id: tmp.id, weightLbs: 30000, truckId: "SMOKE-02" });
const tmpSheet = await client.sheets.get.query({ id: tmp.id });
const tmpLoadId = tmpSheet.sheet.loads.at(-1)?.id;
await client.sheets.voidLoad.mutate({ loadId: tmpLoadId, voidReason: "smoke test void" });
const afterVoid = await client.sheets.get.query({ id: tmp.id });
check("void removes the in-progress load", afterVoid.sheet.loads.length === 0);

// 15. daily work no longer needs the admin password ---------------------------------
const newFarmer = await client.people.farmers.create.mutate({ name: "Smoke Farmer" });
check("farmers.create without admin password", newFarmer?.id != null);
const newLot = await client.people.lots.create.mutate({
  farmerId: farmer.id, code: `SMOKE-${Date.now()}`, crop: "Corn",
});
check("lots.create without admin password", newLot?.id != null);

// 16. closing a lot closes its OPEN weight sheets ------------------------------------
const lotsNow = await client.people.lots.list.query();
const openLot = lotsNow.find((l) => l.status === "OPEN");
if (openLot) {
  const mk = await client.sheets.create.mutate({
    siteId: sites[0].id, farmerId: openLot.farmerId, lotId: openLot.id,
    crop: openLot.crop, direction: "INBOUND",
  });
  const closeRes = await client.people.lots.setStatus.mutate({ id: openLot.id, status: "CLOSED" });
  check(
    "closing a lot reports the sheets it closed",
    closeRes.closedSheets.includes(mk.ticketNo),
    closeRes.closedSheets.join(","),
  );
  const closedSheet = await client.sheets.get.query({ id: mk.id });
  check(
    "sheet on a closed lot is CLOSED (LOT_CLOSED)",
    closedSheet.sheet.status === "CLOSED" && closedSheet.sheet.closeReason === "LOT_CLOSED",
  );
  let lotSheetBlocked = false;
  try {
    await client.sheets.weighFirst.mutate({ id: mk.id, weightLbs: 30000, truckId: "SMOKE-03" });
  } catch {
    lotSheetBlocked = true;
  }
  check("sheet closed by lot close refuses new loads", lotSheetBlocked);
  // reopen so repeat runs stay green and the lot stays usable
  await client.people.lots.setStatus.mutate({ id: openLot.id, status: "OPEN" });
}

// 17. closed-ticket edits need (and accept) the admin password ------------------------
const doneLoad = (await client.sheets.get.query({ id: created.id })).sheet.loads.find(
  (l) => l.netLbs != null && l.voidedAt == null,
);
if (gateClosed) {
  let pwRequired = false;
  try {
    await client.sheets.updateLoadGrades.mutate({
      loadId: doneLoad.id, moisturePct: 15.2, dockagePct: null, testWeightLbs: null,
      proteinPct: null, damagePct: null, grade: null, farmOrigin: null,
    });
  } catch {
    pwRequired = true;
  }
  check("closed-ticket edit without password is refused", pwRequired);
  await client.sheets.updateLoadGrades.mutate({
    loadId: doneLoad.id, moisturePct: 15.2, dockagePct: null, testWeightLbs: null,
    proteinPct: null, damagePct: null, grade: null, farmOrigin: null,
    adminPassword: adminPw,
  });
} else {
  await client.sheets.updateLoadGrades.mutate({
    loadId: doneLoad.id, moisturePct: 15.2, dockagePct: null, testWeightLbs: null,
    proteinPct: null, damagePct: null, grade: null, farmOrigin: null,
  });
}
const gradedClosed = (await client.sheets.get.query({ id: created.id })).sheet.loads.find(
  (l) => l.id === doneLoad.id,
);
check(
  "closed-ticket edit applies (gate-aware auth)",
  gradedClosed?.moisturePct === 15.2,
  `moisture=${gradedClosed?.moisturePct}`,
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
