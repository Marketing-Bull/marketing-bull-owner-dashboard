/**
 * The dashboard's starting data: the clients and projects imported from the
 * retired mission-control database (verified import of 2026-08-13, cleaning
 * rules applied -- statuses normalized, 0-money fields as null).
 *
 * Committed so a fresh deployment is populated with zero setup: on first open,
 * `seedEntitiesIfEmpty` loads these rows only when BOTH tables are empty. It
 * never runs against a database that has any client or project, so nothing a
 * user edits is ever overwritten. `mc_id` is preserved, so running the real
 * mission-control import later still converges onto these same rows.
 *
 * This file contains real client contact details -- which is the point: the
 * owner asked for the data to be present without supplying anything at deploy
 * time. The repo is private. Delete the file (and the seeding call) once a
 * live database is the source of truth everywhere it needs to be.
 *
 * Generated from the imported database; do not hand-edit -- edit the real rows
 * in the app instead, and treat this only as first-boot data.
 */

import type { DatabaseSync } from "node:sqlite";

type SeedRow = Record<string, string | number | null>;

export const SEED_CLIENTS: SeedRow[] = [
  { id: "58ea3ea8-d575-486c-8920-0e38fbd832c5", mc_id: 8, name: "Better Wellness Clinic", status: "prospect", payment_type: "mrr", mrr: null, hourly_rate: null, project_est_cost: null, paid_through_date: "", invoice_status: "", contact_name: "Dr. Craig James", contact_email: "drcjames@betterwellnessclinic.com", contact_phone: "+19546665790", notes: "GBP audit done Feb 28 with 10 recommendations. Report on Notion ready to share. Oakland Park, FL (Broward). Notion: https://www.notion.so/GBP-Audit-Report-Feb-28-2026-3150c897e04a811ebbe1df14756ccdb4", is_archived: 0, created_at: "2026-03-05 05:50:25", updated_at: "2026-08-13T13:53:13.141Z" },
  { id: "dab9b7fd-3680-4133-ae4e-f8c8f098b899", mc_id: 7, name: "Earley Law Firm", status: "prospect", payment_type: "mrr", mrr: 1500.0, hourly_rate: null, project_est_cost: null, paid_through_date: "", invoice_status: "", contact_name: "Kaysia Earley, Esq.", contact_email: "", contact_phone: "+13013797528", notes: "WARM. 3-phase proposal sent (website+SEO+ads). $1,500/mo x 9mo = $15K. Follow-up overdue 30+ days. Notion proposal: https://www.notion.so/Proposal-Earley-Law-Firm-Brand-Digital-Transformation-3160c897e04a81b28b51ef45babe9d48", is_archived: 0, created_at: "2026-03-05 05:50:25", updated_at: "2026-08-13T13:53:13.139Z" },
  { id: "a26c168b-120c-42ac-9bf7-e3b6a53a6723", mc_id: 12, name: "Greenbills", status: "prospect", payment_type: "mrr", mrr: 1500.0, hourly_rate: null, project_est_cost: null, paid_through_date: "", invoice_status: "", contact_name: "", contact_email: "", contact_phone: "", notes: "", is_archived: 0, created_at: "2026-03-10 15:49:29", updated_at: "2026-08-13T13:53:13.148Z" },
  { id: "9b45c3bf-c830-4d06-9141-c2a8d83e6906", mc_id: 13, name: "HelloViki", status: "on_hold", payment_type: "mrr", mrr: null, hourly_rate: null, project_est_cost: null, paid_through_date: "", invoice_status: "", contact_name: "", contact_email: "", contact_phone: "", notes: "", is_archived: 0, created_at: "2026-03-10 15:49:32", updated_at: "2026-08-13T13:53:13.149Z" },
  { id: "42dfe7c5-553b-40ee-b977-cccd06492058", mc_id: 9, name: "Island Breeze Chiropractic", status: "prospect", payment_type: "mrr", mrr: null, hourly_rate: null, project_est_cost: null, paid_through_date: "", invoice_status: "", contact_name: "Dr. Latoya Evans", contact_email: "islandbreezechiro@gmail.com", contact_phone: "+19547203002", notes: "Social media growth proposal sent Feb 28. Current score: 1/10. Tamarac, FL. Massive opportunity.", is_archived: 0, created_at: "2026-03-05 05:50:25", updated_at: "2026-08-13T13:53:13.143Z" },
  { id: "e259378e-701b-4846-862f-5ff6ac3506db", mc_id: 2, name: "Linder Diaz Law", status: "active", payment_type: "mrr", mrr: 1000.0, hourly_rate: null, project_est_cost: null, paid_through_date: "", invoice_status: "", contact_name: "", contact_email: "", contact_phone: "", notes: "Intake management", is_archived: 0, created_at: "2026-02-19 03:41:21", updated_at: "2026-08-13T13:53:13.133Z" },
  { id: "52a81c99-94cf-4775-b8c7-babce5842510", mc_id: 14, name: "Marketing Bull", status: "active", payment_type: "mrr", mrr: null, hourly_rate: null, project_est_cost: null, paid_through_date: "", invoice_status: "", contact_name: "", contact_email: "", contact_phone: "", notes: "", is_archived: 0, created_at: "2026-03-16 04:14:44", updated_at: "2026-08-13T13:53:13.151Z" },
  { id: "c9b56e36-c41e-4650-bfb4-05e525d8a2d0", mc_id: 5, name: "Marketing Bull (Internal)", status: "on_hold", payment_type: "mrr", mrr: null, hourly_rate: null, project_est_cost: null, paid_through_date: "", invoice_status: "", contact_name: "", contact_email: "", contact_phone: "", notes: "", is_archived: 0, created_at: "2026-02-20 18:10:13", updated_at: "2026-08-13T13:53:13.137Z" },
  { id: "308c7ccb-590c-4069-a631-e155e189afda", mc_id: 11, name: "Millers Marketing Group", status: "on_hold", payment_type: "mrr", mrr: null, hourly_rate: null, project_est_cost: null, paid_through_date: "", invoice_status: "", contact_name: "Andrew Miller", contact_email: "millersmarketinggroup@gmail.com", contact_phone: "+15618272256", notes: "Referral partner. Alex is sponsor + regular event attendee. SEO audit done (148-msg Discord thread). Connects PI attorneys and doctors via monthly mixers.", is_archived: 0, created_at: "2026-03-05 05:50:25", updated_at: "2026-08-13T13:53:13.147Z" },
  { id: "2f0c0f6a-7420-463c-90e6-994ceef676a7", mc_id: 4, name: "Mosaic Open MRI", status: "on_hold", payment_type: "one-time", mrr: null, hourly_rate: null, project_est_cost: 2000.0, paid_through_date: "", invoice_status: "invoiced", contact_name: "Dr. Eric Feldmann", contact_email: "", contact_phone: "", notes: "Delaware website project. Invoice sent Feb 20, 2026. 7 items pending client input before site launch.", is_archived: 0, created_at: "2026-02-19 17:42:52", updated_at: "2026-08-13T13:53:13.135Z" },
  { id: "b31bcb53-130e-4245-bd0a-d412772dd5df", mc_id: 6, name: "Pain Injury Law", status: "on_hold", payment_type: "mrr", mrr: null, hourly_rate: null, project_est_cost: null, paid_through_date: "", invoice_status: "", contact_name: "", contact_email: "", contact_phone: "", notes: "", is_archived: 0, created_at: "2026-02-27 02:14:11", updated_at: "2026-08-13T13:53:13.138Z" },
  { id: "9394cecc-1c5b-4a6a-9ffd-16f09eb29dd9", mc_id: 3, name: "Queens Hyperbaric", status: "active", payment_type: "mrr", mrr: 1100.0, hourly_rate: null, project_est_cost: null, paid_through_date: "", invoice_status: "", contact_name: "", contact_email: "", contact_phone: "", notes: "Google Ads. Subcontracted to Whitelabelservices for $400/month", is_archived: 0, created_at: "2026-02-19 03:41:21", updated_at: "2026-08-13T13:53:13.134Z" },
  { id: "c46119e2-f4a4-4208-b654-811fbac604c4", mc_id: 1, name: "Rock The Treatment", status: "active", payment_type: "mrr", mrr: 1250.0, hourly_rate: null, project_est_cost: null, paid_through_date: "", invoice_status: "", contact_name: "Stacy Berkowitz", contact_email: "rockthetreatment@gmail.com", contact_phone: "", notes: "Google PPC + Meta Ads + TikTok Ads + Etsy Organic & Ads. Media Buyer: Yossi (50% split). Revenue: $45k-$50k+/mo.", is_archived: 0, created_at: "2026-02-19 03:41:21", updated_at: "2026-08-13T13:53:13.130Z" },
  { id: "de8d1577-13e6-459c-b747-cc1eca2637b2", mc_id: 10, name: "The Louis Law Firm", status: "prospect", payment_type: "mrr", mrr: null, hourly_rate: null, project_est_cost: null, paid_through_date: "", invoice_status: "", contact_name: "Skinner Louis", contact_email: "", contact_phone: "+14074555401", notes: "Orlando PI attorney. 33% annual growth, tech-savvy. Full partnership analysis done. Cold \u2014 no outreach yet.", is_archived: 0, created_at: "2026-03-05 05:50:25", updated_at: "2026-08-13T13:53:13.145Z" }
];

export const SEED_PROJECTS: SeedRow[] = [
  { id: "8e41b281-1554-4ad3-8240-09fd6c04f671", mc_id: 3, client_id: "c9b56e36-c41e-4650-bfb4-05e525d8a2d0", name: "AMB Mission Control", description: "Development, improvements, and ongoing maintenance of the Mission Control platform\n\nTake whatever ideas exist here:\nhttps://github.com/Marketing-Bull/client-mileage-keeper-pro", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-02-20 17:28:10", updated_at: "2026-08-13T13:53:13.156Z" },
  { id: "d1f806a8-e6a7-40a4-a21f-dc2ff4f191d3", mc_id: 18, client_id: "c46119e2-f4a4-4208-b654-811fbac604c4", name: "Analytics - Weekly Report", description: "", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-16 04:14:44", updated_at: "2026-08-13T13:53:13.180Z" },
  { id: "8bb9f177-cde6-40cb-86b4-d4d45d7bfe32", mc_id: 19, client_id: "52a81c99-94cf-4775-b8c7-babce5842510", name: "Cost Optimization", description: "", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-16 04:14:44", updated_at: "2026-08-13T13:53:13.181Z" },
  { id: "00857cbf-9c88-4918-a83c-52844382f910", mc_id: 17, client_id: "52a81c99-94cf-4775-b8c7-babce5842510", name: "Discord Bot Fixes", description: "", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-16 04:14:44", updated_at: "2026-08-13T13:53:13.178Z" },
  { id: "883d93ad-28ef-41d3-a60e-7178e4fdb113", mc_id: 8, client_id: "9394cecc-1c5b-4a6a-9ffd-16f09eb29dd9", name: "Google Maps (Organic)", description: "Improve Google Maps (Organic). Add new locations as Isak opens them.", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-05 05:58:07", updated_at: "2026-08-13T13:53:13.163Z" },
  { id: "c4f4f334-6531-40b3-a10d-c8ff94e2732d", mc_id: 7, client_id: "9394cecc-1c5b-4a6a-9ffd-16f09eb29dd9", name: "Google PPC Campaign", description: "Run a Google PPC campaign which generates 12 patients for Queens Hyperbaric on monthly basis.", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-05 05:57:14", updated_at: "2026-08-13T13:53:13.162Z" },
  { id: "5794b03c-dc3c-4bb1-bc26-2336dc339ca8", mc_id: 13, client_id: "e259378e-701b-4846-862f-5ff6ac3506db", name: "GTM/GA4 Setup", description: "", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-16 04:14:44", updated_at: "2026-08-13T13:53:13.172Z" },
  { id: "7ac6fcee-292c-4d0c-9464-df644f65134a", mc_id: 9, client_id: "e259378e-701b-4846-862f-5ff6ac3506db", name: "Hire \"Case Manager\"", description: "Hire a Case Manager on Indeed of part-time not to exceed $25/hour.", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-05 06:16:37", updated_at: "2026-08-13T13:53:13.165Z" },
  { id: "133763e9-742a-4ab3-828c-030f9d10fdea", mc_id: 16, client_id: "52a81c99-94cf-4775-b8c7-babce5842510", name: "Infrastructure - Cloudflare/DNS", description: "", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-16 04:14:44", updated_at: "2026-08-13T13:53:13.176Z" },
  { id: "13e48fdf-a1a4-47c3-8dd8-40c2a396eaed", mc_id: 15, client_id: "52a81c99-94cf-4775-b8c7-babce5842510", name: "Infrastructure - DO Server Security", description: "", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-16 04:14:44", updated_at: "2026-08-13T13:53:13.175Z" },
  { id: "338b3541-7d01-4304-9eba-be2fbd8a06f6", mc_id: 12, client_id: "52a81c99-94cf-4775-b8c7-babce5842510", name: "Intake Landing Page", description: "", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-16 04:14:44", updated_at: "2026-08-13T13:53:13.170Z" },
  { id: "37dc1120-acb9-47a4-bb52-9a013d4e069d", mc_id: 21, client_id: "52a81c99-94cf-4775-b8c7-babce5842510", name: "Markdown Editor App", description: "", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-16 04:14:44", updated_at: "2026-08-13T13:53:13.184Z" },
  { id: "dae58e11-c612-4b2d-9ce9-b76effcc35a5", mc_id: 5, client_id: "c9b56e36-c41e-4650-bfb4-05e525d8a2d0", name: "MB Website Refresh 2026", description: "Redesign getmarketingbull.com to clearly position Marketing Bull as an operational turnaround + intake optimization agency for PI law firms. Agent: mb-website-26 | Channel: #mb-website-26", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-02-20 20:38:57", updated_at: "2026-08-13T13:53:13.159Z" },
  { id: "c5a3d4f5-cb2a-4628-b8d5-38c9b955746d", mc_id: 14, client_id: "52a81c99-94cf-4775-b8c7-babce5842510", name: "Mission Control - Cron System", description: "", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-16 04:14:44", updated_at: "2026-08-13T13:53:13.173Z" },
  { id: "5b81067f-e1ec-4e2c-bc11-d72adec71035", mc_id: 20, client_id: "52a81c99-94cf-4775-b8c7-babce5842510", name: "Mission Control - System Improvements", description: "", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-16 04:14:44", updated_at: "2026-08-13T13:53:13.182Z" },
  { id: "e11ece76-4a2a-4d3e-a7b6-d9fb56ed6e8d", mc_id: 4, client_id: "c9b56e36-c41e-4650-bfb4-05e525d8a2d0", name: "New 3-5 Clients", description: "We need to acquire 3-5 clients ASAP.\nI am working on Lead enrichment in Discord > #clients channel.", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-02-20 20:16:18", updated_at: "2026-08-13T13:53:13.157Z" },
  { id: "a6203421-9bff-479c-924a-1d4824875dd3", mc_id: 1, client_id: "2f0c0f6a-7420-463c-90e6-994ceef676a7", name: "Open MRI Website", description: "Build a new website for Mosaic: \nhttps://mosaicopenmri.com/\n\nRemaining tasks on project are assigned to Oleg in ClickUp.", hourly_rate_override: 50.0, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-02-19 17:43:10", updated_at: "2026-08-13T13:53:13.153Z" },
  { id: "2963ad33-6a5f-4c6a-80a1-a816c5973a90", mc_id: 10, client_id: null, name: "Personal", description: "Personal tasks, errands, calls, reminders \u2014 Motion-style auto-scheduled", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-05 06:51:11", updated_at: "2026-08-13T13:53:13.166Z" },
  { id: "67a2e30a-427b-4e9f-a29f-f69553a67c43", mc_id: 6, client_id: "e259378e-701b-4846-862f-5ff6ac3506db", name: "Referral Management", description: "I am supposed to follow up with Pipo and Francois regarding new cases. I can check Neos by Assembly software to see if new cases have been delivered and the status. \n\nWe have already build a neos-extractor plugin which can extract Cases from Neos (by Assembly Software)\n\nI am also supposed to file a small claims against Case Connect. ", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-02-21 03:09:56", updated_at: "2026-08-13T13:53:13.160Z" },
  { id: "49887c7e-61a3-4251-b9a5-4b6efcb73511", mc_id: 22, client_id: "52a81c99-94cf-4775-b8c7-babce5842510", name: "Repo Audit", description: "", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-16 04:14:44", updated_at: "2026-08-13T13:53:13.185Z" },
  { id: "c7225439-3816-414c-9813-036cbc2fd25c", mc_id: 23, client_id: "52a81c99-94cf-4775-b8c7-babce5842510", name: "Time Log Review", description: "", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-16 04:14:44", updated_at: "2026-08-13T13:53:13.186Z" },
  { id: "27a2b1e9-7291-4ad7-9c89-97b1bd467d6d", mc_id: 11, client_id: "52a81c99-94cf-4775-b8c7-babce5842510", name: "Website Copy", description: "", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-03-16 04:14:44", updated_at: "2026-08-13T13:53:13.168Z" },
  { id: "78c724c4-95bc-45bb-95ef-7de857940cd3", mc_id: 2, client_id: "c46119e2-f4a4-4208-b654-811fbac604c4", name: "Website CRO Improvements", description: "Improve CRO on RockTheTreatment.com website in order to increase CR and Revenue.\n\nStaging Git:\nhttps://github.com/Marketing-Bull/staging_rockthetreatment", hourly_rate_override: null, status: "active", notes: "", urgent: 0, important: 0, is_archived: 0, created_at: "2026-02-20 00:40:53", updated_at: "2026-08-13T13:53:13.154Z" }
];

function insertAll(db: DatabaseSync, table: string, rowsToInsert: SeedRow[]): void {
  if (rowsToInsert.length === 0) return;
  const columns = Object.keys(rowsToInsert[0]);
  const insert = db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
  );
  for (const row of rowsToInsert) {
    insert.run(...columns.map((column) => row[column]));
  }
}

/**
 * First-boot data load. Fires only when the database has never held a client
 * or a project; any existing row -- seeded, imported, or hand-made -- disables
 * it forever. Runs in one transaction so a failure leaves nothing half-seeded.
 */
export function seedEntitiesIfEmpty(db: DatabaseSync): boolean {
  const clients = (db.prepare("SELECT COUNT(*) AS n FROM clients").get() as { n: number }).n;
  const projects = (db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n;
  if (clients > 0 || projects > 0) return false;

  db.exec("BEGIN");
  try {
    insertAll(db, "clients", SEED_CLIENTS);
    insertAll(db, "projects", SEED_PROJECTS);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return true;
}
