const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let db;
  let run;
  let get;
  let all;
  let TransfersService;
  let SystemService;
  let sourceAdminId;
  let targetAdminId;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "erp-tests-"));
  process.chdir(tempDir);

  db = require(path.join(projectRoot, "config/db.js"));
  ({ run, get, all } = require(path.join(projectRoot, "utils/dbAsync.js")));
  TransfersService = require(path.join(projectRoot, "services/transfers.service.js"));
  SystemService = require(path.join(projectRoot, "services/system/system.service.js"));
  await sleep(350);

  const tests = [];
  const it = (name, fn) => tests.push({ name, fn });

  async function seed() {
    await run("UPDATE schools SET name = ?, daterentrer = ? WHERE id = 1", ["FASSO", "2025-09-01"]);
    await run(
      "INSERT INTO schools (id, name, email, phone, address, subscription_plan, is_active, daterentrer) VALUES (2, ?, ?, '', '', 'premium', 1, ?)",
      ["BADESSO", "badesso@test.local", "2025-09-01"]
    );
    await run(
      "INSERT INTO schools (id, name, email, phone, address, subscription_plan, is_active, daterentrer) VALUES (3, ?, ?, '', '', 'premium', 1, ?)",
      ["AUTRE", "autre@test.local", "2025-09-01"]
    );

    const sourceAdmin = await run(
      `INSERT INTO users (school_id, matricule, full_name, email, phone, password_hash, role, is_active)
       VALUES (1, 'ADM001', 'Admin Source', ?, '', 'x', 'school_admin', 1)`,
      [`admin.source.${Date.now()}@test.local`]
    );
    const targetAdmin = await run(
      `INSERT INTO users (school_id, matricule, full_name, email, phone, password_hash, role, is_active)
       VALUES (2, 'ADM002', 'Admin Cible', ?, '', 'x', 'school_admin', 1)`,
      [`admin.target.${Date.now()}@test.local`]
    );
    sourceAdminId = sourceAdmin.lastID;
    targetAdminId = targetAdmin.lastID;

    await run(
      `INSERT INTO classes (school_id, nom, cycle, niveau, annee, mensuel, frais_inscription, effectif, totalapaie, totalpaie, effectif_max)
       VALUES (1, '2eme', 'fondamental', '2eme', '2025-2026', 5000, 7000, 0, 0, 0, 50)`
    );
    await run(
      `INSERT INTO classes (school_id, nom, cycle, niveau, annee, mensuel, frais_inscription, effectif, totalapaie, totalpaie, effectif_max)
       VALUES (2, '2eme A', 'fondamental', '2eme', '2025-2026', 6000, 12000, 0, 0, 0, 50)`
    );

    await run(
      `INSERT INTO eleves (school_id, matricule, nom, prenom, classe, sexe, dateNaissance, statut, caise, created_at)
       VALUES (1, 'E001', 'Diallo', 'Awa', '2eme', 'F', '2014-01-10', 'actif', 0, CURRENT_TIMESTAMP)`
    );
    await run(
      `INSERT INTO eleves (school_id, matricule, nom, prenom, classe, sexe, dateNaissance, statut, caise, created_at)
       VALUES (1, 'E002', 'Traore', 'Moussa', '2eme', 'M', '2013-12-20', 'actif', 0, CURRENT_TIMESTAMP)`
    );

    await run(
      `INSERT INTO personnel (school_id, matricule, full_name, role, type_payement, salaire_base, statut, created_at)
       VALUES (1, 'P001', 'Agent Test', 'Secretaire', 'mensuel', 25000, 'actif', CURRENT_TIMESTAMP)`
    );
  }

  it("transfert accepte: frais auto + notifications + isolation detail", async () => {
    const created = await TransfersService.requestTransfer({
      sourceSchoolId: 1,
      toSchoolId: 2,
      matricule: "E001",
      requestedBy: sourceAdminId
    });
    assert.ok(created.transferId > 0);

    const incomingTarget = await TransfersService.listIncomingTransfers({ schoolId: 2, status: "pending" });
    assert.ok(incomingTarget.some((row) => Number(row.id) === Number(created.transferId)));

    const detail = await TransfersService.getTransferDetailForSchool({
      schoolId: 2,
      transferId: created.transferId
    });
    assert.equal(detail.target_class_name, "2eme A");
    assert.equal(Number(detail.estimated_frais_inscription), 12000);

    await assert.rejects(
      () => TransfersService.getTransferDetailForSchool({ schoolId: 3, transferId: created.transferId }),
      /introuvable|autorise|Acces/i
    );

    await TransfersService.acceptTransfer({
      transferId: created.transferId,
      schoolId: 2,
      responseBy: targetAdminId
    });

    const transferRow = await get("SELECT status FROM transfers WHERE id = ?", [created.transferId]);
    assert.equal(transferRow.status, "accepted");

    const paiement = await get(
      `SELECT montant, mode_payement
       FROM paiements
       WHERE school_id = 2 AND mode_payement = 'frais_inscription_transfert_auto'
       ORDER BY id DESC
       LIMIT 1`
    );
    assert.equal(Number(paiement.montant), 12000);

    const sourceEleve = await get("SELECT statut FROM eleves WHERE school_id = 1 AND matricule = 'E001'");
    assert.equal(String(sourceEleve.statut).toLowerCase(), "transfere");

    const targetEleve = await get(
      "SELECT statut, caise, classe FROM eleves WHERE school_id = 2 ORDER BY id DESC LIMIT 1"
    );
    assert.equal(String(targetEleve.statut).toLowerCase(), "actif");
    assert.equal(Number(targetEleve.caise), 12000);
    assert.equal(targetEleve.classe, "2eme A");

    const notifRequested = await all(
      "SELECT id FROM notifications WHERE type = 'transfer_requested' AND school_id IN (1,2)"
    );
    const notifAccepted = await all(
      "SELECT id FROM notifications WHERE type = 'transfer_accepted' AND school_id IN (1,2)"
    );
    assert.ok(notifRequested.length >= 2);
    assert.ok(notifAccepted.length >= 2);
  });

  it("transfert refuse + notifications correspondantes", async () => {
    const created = await TransfersService.requestTransfer({
      sourceSchoolId: 1,
      toSchoolId: 2,
      matricule: "E002",
      requestedBy: sourceAdminId
    });
    assert.ok(created.transferId > 0);

    await TransfersService.rejectTransfer({
      transferId: created.transferId,
      schoolId: 2,
      responseBy: targetAdminId
    });

    const transferRow = await get("SELECT status FROM transfers WHERE id = ?", [created.transferId]);
    assert.equal(transferRow.status, "rejected");

    const notifRejected = await all(
      "SELECT school_id FROM notifications WHERE type = 'transfer_rejected' AND entity_id = ?",
      [created.transferId]
    );
    const schools = new Set(notifRejected.map((r) => Number(r.school_id)));
    assert.ok(schools.has(1));
    assert.ok(schools.has(2));
  });

  it("retards mensuels: generation notifications + non duplication + multi-tenant", async () => {
    await SystemService.ensureMonthlyRetardNotifications(1);
    const firstCountRow = await get(
      "SELECT COUNT(*) AS total FROM notifications WHERE school_id = 1 AND type IN ('retard_eleve', 'retard_personnel')"
    );
    assert.ok(Number(firstCountRow.total) > 0);

    await SystemService.ensureMonthlyRetardNotifications(1);
    const secondCountRow = await get(
      "SELECT COUNT(*) AS total FROM notifications WHERE school_id = 1 AND type IN ('retard_eleve', 'retard_personnel')"
    );
    assert.equal(Number(secondCountRow.total), Number(firstCountRow.total));

    const school2Count = await get(
      "SELECT COUNT(*) AS total FROM notifications WHERE school_id = 2 AND type IN ('retard_eleve', 'retard_personnel')"
    );
    assert.equal(Number(school2Count.total), 0);

    const unreadBefore = await SystemService.getNotificationsUnreadCount(1);
    assert.ok(unreadBefore > 0);
    const list = await SystemService.listNotifications(1, { status: "unread" });
    assert.ok(Array.isArray(list) && list.length > 0);

    await SystemService.markNotificationRead(1, list[0].id);
    const oneRead = await get("SELECT is_read FROM notifications WHERE id = ?", [list[0].id]);
    assert.equal(Number(oneRead.is_read), 1);

    await SystemService.markAllNotificationsRead(1);
    const unreadAfter = await SystemService.getNotificationsUnreadCount(1);
    assert.equal(unreadAfter, 0);
  });

  await seed();

  let pass = 0;
  for (const t of tests) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await t.fn();
      pass += 1;
      // eslint-disable-next-line no-console
      console.log(`PASS - ${t.name}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`FAIL - ${t.name}`);
      // eslint-disable-next-line no-console
      console.error(err);
      await new Promise((resolve) => db.close(() => resolve()));
      process.exitCode = 1;
      return;
    }
  }

  await new Promise((resolve) => db.close(() => resolve()));
  // eslint-disable-next-line no-console
  console.log(`\n${pass}/${tests.length} tests passed`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
