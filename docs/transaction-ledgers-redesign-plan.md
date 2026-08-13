# Time, Expenses, and Mileage Redesign Plan

## Goal

Redesign Time, Expenses, and Mileage around two distinct jobs:

1. Review and manage a high volume of transactions quickly on desktop or tablet.
2. Add or edit one transaction with minimal effort on a phone.

The three screens should share one interaction model without hiding the fields that are unique to each record type. This plan is based on the current Phase 3-4 implementation on `preview`.

## Product principles

- Put the transaction ledger first. Summary cards must not push the working data below the fold.
- Keep filters visible, fast, and shareable. Every displayed or stored transaction field must be filterable.
- Optimize forms for the common path, then progressively disclose accounting and optional fields.
- Reuse recent values and sensible defaults, but never save an inferred value invisibly.
- Make edit and delete available from each row without expanding a large form inside the list.
- Preserve historical labels when a standardized dropdown option is retired.
- Meet WCAG 2.2 AA for contrast, focus, labels, keyboard use, error identification, and touch targets.

## Shared information architecture

Each screen uses the same vertical structure:

1. **Compact page header**: title, period total, record count, primary Add button.
2. **Sticky filter bar**: search, date range, the most-used filters, `All filters`, active-filter chips, Clear, and saved-view controls.
3. **Transaction ledger**: sortable columns, pinned primary column, row selection, compact density by default, and per-row actions.
4. **Pagination footer**: result count, 25/50/100 rows per page, previous/next controls. Filtering, sorting, and pagination run on the server.
5. **Add/edit surface**: a right-side sheet on desktop and a full-screen sheet on mobile. The list keeps its scroll position and filters when the sheet closes.

Summary totals always reflect the active filters. Recurring expense definitions remain a separate Expenses tab because they are templates, not transactions.

### Responsive behavior

- **Desktop, 1024 px and wider**: dense table, sticky header, optional resizable columns, 480-560 px form sheet.
- **Tablet, 768-1023 px**: horizontally scrollable table with Date and Description/Trip pinned; full-width filter drawer for secondary filters.
- **Mobile, below 768 px**: records become compact two-line rows rather than a squeezed table. Search/date/filter controls stay at the top; Add becomes a thumb-reachable floating or sticky action. Add/edit is full-screen with a sticky footer.
- Touch targets are at least 44 x 44 px. Form controls use at least 16 px text to avoid iOS input zoom.

## Filtering and high-volume behavior

The filter API should use URL query parameters so filtered views survive refresh and can be bookmarked. Filters debounce text input by 250-400 ms; dropdown and boolean changes apply immediately.

### Shared filters

- Free-text search across human-readable text fields
- Date from / date to, with presets: Today, This week, This month, Last month, This year, Custom
- Client (multi-select)
- Project (multi-select, narrowed by selected clients)
- Billable: all / billable / non-billable
- Created date and updated date
- Sort field and direction

### Time filters and columns

Filters cover date, hours range, client, project, billable, rate range, amount range, details, start time, and end time. Default columns are Date, Client, Project, Details, Hours, Rate, Amount, Billable, and Actions.

The footer shows filtered hours, billable hours, and amount. The first release does not need grouping, but the query contract should allow a later group-by Client, Project, Week, or Month.

### Expense filters and columns

Filters cover date, amount range, type, category, company, vendor, client, project, account code, billable, reimbursable, recurring frequency, payment method, status, tags, receipt attached, and free-text details.

Default columns are Date, Vendor/Details, Type, Category, Client/Project, Amount, Payment method, Status, Receipt, and Actions. Optional columns are Company, Account code, Recurring, Billable, Reimbursable, and Tags. The footer shows filtered expenses, income, and net.

### Mileage filters and columns

Filters cover date, trip name, start address, end address, one-way miles range, total miles range, one-way/round-trip, client, project, billable, purpose, notes, and reimbursement range.

Default columns are Date, Trip, Route, Client/Project, Total miles, Reimbursement, Billable, and Actions. Optional columns are One-way miles, Round trip, Purpose, and Notes. The footer shows filtered trips, miles, and reimbursement.

### Query and rendering requirements

- Extend the three list endpoints with validated filter, sort, cursor/page, and page-size parameters.
- Return `{ items, pageInfo, filteredTotals, availableFacets }`; do not fetch 500-1000 records into the browser and filter there.
- Add database indexes only after checking real query plans. Likely composite candidates are date plus client/project/category, but migrations should be driven by measured queries.
- Keep the previous result visible with a loading indicator while filters refresh; prevent layout jumps.
- Provide skeleton, no-data, no-results, error, and retry states. `No results` must offer Clear filters without implying that no records exist.
- Persist column visibility, density, and page size locally per screen. Put shareable state such as filters and sort in the URL.
- Bulk delete is out of scope for the first release. Row selection is included only if a concrete bulk action (for example export or category reassignment) is implemented with it.

## Add, edit, and delete flows

### Shared form behavior

- Add opens an empty sheet without navigating away. Edit uses the same component with existing values.
- Put required/common fields first and place optional fields under `More details` or domain-specific sections.
- Use native mobile-friendly date and numeric controls, decimal keyboards, searchable selects for long option lists, and inline validation next to the field.
- The primary action is sticky and explicit: `Save time`, `Save expense`, or `Save trip`. Disable it only while invalid or saving.
- Support `Save and add another` on desktop and mobile. After saving another, retain safe context such as date, client, project, category, or route, and clear amount/hours and free text.
- Warn before closing a dirty form. On success, close the sheet, update the affected row and totals, and announce success to assistive technology.
- Editing and creation should not reset the ledger's filters, sort, page, or scroll position.

### Time form

Common section: Date, Hours, Client, Project, Billable, Details. Show the resolved hourly rate and calculated amount as read-only context. Keep imported Start/End time under More details. Prefill recent client/project/billable values with a visible `Using recent values` hint.

### Expense form

Common section: Date, Amount, Type, Vendor, Category, Payment method, and Receipt. Put Client/Project/Billable/Reimbursable in Assignment and Account code/Company/Status/Tags/Recurring fields in More details. Receipt capture must allow the phone camera, photo library, and file picker. Show upload progress and permit retry without losing the form.

Recurring configuration should be a separate explicit action, `Make recurring`, rather than placing every recurring field in the common path.

### Mileage form

Lead with recent/favorite routes as large tap targets, then Date, From, To, One-way miles, Round trip, and Purpose. Address fields use mobile-friendly autocomplete from the configured maps provider. After both endpoints are selected, calculate driving distance automatically and show the selected route, one-way distance, round-trip total, and reimbursement before save. Client, Project, Billable, and Notes follow below.

The calculated distance is a suggestion, not an invisible overwrite: users can edit miles manually, see whether the saved value is provider-calculated or manual, and recalculate after changing an address. If multiple routes are returned, default to the provider's recommended driving route and allow selection among meaningful alternatives. Reusing a recent route must fill route fields visibly and remain editable before save.

Maps failure must not block entry. On timeout, quota exhaustion, missing credentials, or no route, show a concise error and keep manual mileage available. Never send client, project, purpose, or notes to the maps provider—only the route inputs needed for geocoding and distance calculation.

### Maps integration

- Add a server-side maps adapter so provider credentials never reach the browser and the UI is not coupled directly to one vendor.
- Complete the Existing Solutions Preflight before implementation and prefer a maintained provider with an adequate free tier or self-hosted option. Do not enable a paid API or incur spend without explicit approval.
- Support address autocomplete/geocoding and driving-route distance. Store normalized display addresses plus provider place IDs when available.
- Persist the actual miles saved, calculation source (`provider` or `manual`), provider name, calculated distance, selected route metadata, and calculation timestamp. Historical reimbursements must not change when providers or routes later change.
- Cache identical normalized route calculations with a defined expiration to reduce latency, cost, and quota usage; do not cache failed responses as successful routes.
- Apply request timeouts, rate limiting, input validation, and structured provider-error handling in the server adapter.
- Put provider configuration and connection status in Settings. Secrets remain server-side; Settings may save/test/clear credentials using the same secure pattern as ClickUp.
- Treat precise addresses and route history as sensitive operational data: log timings and error codes, not full addresses or provider payloads.

### Row actions and deletion

- Clicking a row opens View/Edit; an overflow menu contains Edit, Duplicate, and Delete. Keep a visible Edit affordance at wider widths.
- Duplicate opens a new unsaved form with copied values and today's date; this is especially useful for repeated time and mileage entries.
- Delete uses a focused confirmation dialog that identifies the record and explains the effect. The destructive button says `Delete time entry`, `Delete expense`, or `Delete trip`, not just `OK`.
- After deletion, refresh the current result set and totals. If the last row on a page is removed, move to the prior valid page.
- A true Undo toast requires soft deletion or a delayed-delete queue and should not be faked. Treat soft-delete/restore as a later data-retention decision.

## Editable standardized dropdowns in Settings

Add a **Dropdowns & defaults** section to Settings. It manages user vocabulary, not structural enums or relational entities.

### Editable lists

- Expense categories
- Companies
- Payment methods
- Expense statuses
- Expense tags (if tags remain a controlled list rather than free-form labels)
- Mileage purposes
- Saved/favorite mileage routes (name, start, end, default miles, round-trip default)

Time Client and Project values continue to come from their entity screens. Account codes continue to come from the chart of accounts. System invariants such as expense/income type, recurring frequency, and active/paused/cancelled remain code-controlled because database constraints and business logic depend on them.

### Settings interaction

- Tabs or accordions for each list, with Add, Rename, Reorder, Set default, Deactivate/Reactivate, and Replace usages.
- Each option has a stable ID, label, normalized unique key, sort order, active flag, optional default flag, timestamps, and domain/list key.
- Deactivation removes an option from new-entry pickers but keeps its label on historical records and exposes it when editing a record that already uses it.
- Renaming updates the displayed vocabulary consistently. Before hard deletion, show usage count and require either replacement or confirmation that the option has no usages.
- Only one active default is allowed per list. Forms display when a default was applied.
- Seed lists from distinct existing values during migration so imported data is not lost.

### Proposed data model and API

Use one normalized `dropdown_options` table rather than a new table per field:

```text
id, list_key, label, normalized_label, sort_order,
is_active, is_default, metadata_json, created_at, updated_at
```

Enforce uniqueness on `(list_key, normalized_label)` and index `(list_key, is_active, sort_order)`. Route handlers should list options by key and support create, update, reorder, deactivate, and replacement. Validate `list_key` against a code-owned registry so arbitrary settings cannot become executable behavior.

For the first migration, transaction records may retain their current text columns while forms source suggestions from stable options. A follow-up can add option IDs where referential reporting is necessary. This staged approach avoids a risky all-at-once rewrite while still giving Settings immediate control.

## Component and file plan

Extract shared transaction primitives instead of expanding the current page files:

- `src/components/transactions/transaction-page.tsx`: header, filter state, ledger, pagination, sheets
- `src/components/transactions/filter-bar.tsx`: primary filters, chips, all-filters drawer
- `src/components/transactions/data-table.tsx`: sortable desktop table and mobile record rows
- `src/components/transactions/record-sheet.tsx`: accessible desktop/mobile sheet shell
- `src/components/transactions/delete-dialog.tsx`: typed confirmation and focus management
- `src/components/fields/searchable-select.tsx`: accessible long-list selector
- `src/app/(app)/time/page.tsx`: Time configuration, filters, columns, and form
- `src/app/(app)/expenses/page.tsx`: Expense/Recurring tabs, configuration, and forms
- `src/app/(app)/mileage/page.tsx`: Mileage configuration, filters, columns, and form
- `src/app/(app)/settings/dropdown-settings-card.tsx`: option-list management
- `src/app/(app)/settings/maps-settings-card.tsx`: provider configuration and connection test
- `src/app/api/dropdown-options/...`: settings endpoints
- `src/app/api/maps/autocomplete/route.ts`: proxied address suggestions
- `src/app/api/maps/distance/route.ts`: driving-route alternatives and distance
- `src/lib/transaction-query.ts`: shared parsing/validation for list queries
- `src/lib/dropdown-options.ts`: registry, validation, persistence, usage checks
- `src/lib/maps/provider.ts`: provider-neutral contract, validation, caching, and errors
- `src/lib/maps/providers/...`: selected provider implementation
- `src/lib/schema.ts`: dropdown migration and measured supporting indexes
- `src/app/(app)/entities.module.css`: split shared transaction styles into a dedicated module as the primitives land

Prefer native platform features and the existing React/Next.js/CSS stack. Add a table, combobox, or dialog dependency only if an accessibility review shows the in-house primitive would be more complex or fragile than a maintained library.

## Delivery sequence

### Phase 1: Foundation

- Define typed filter/sort contracts and add server-side query coverage for all three APIs.
- Build the shared filter bar, responsive ledger, pagination, sheet, dialog, and form-field primitives.
- Add URL state, loading/empty/error behavior, and accessibility tests.

### Phase 2: Time pilot

- Convert Time first because it has the smallest form and proves the shared pattern.
- Validate dense-table usability with at least 5,000 seeded rows and mobile entry at 320/375/430 px widths.
- Adjust shared primitives before applying them elsewhere.

### Phase 3: Expenses

- Convert the expense ledger and simplified form; retain Recurring as a separate tab.
- Add receipt capture/upload states and all accounting filters.
- Verify filtered totals against database-level tests.

### Phase 4: Mileage

- Convert the mileage ledger and mobile route-first form.
- Move the mileage reimbursement rate from the transaction screen into Settings.
- Add favorite route management and recent-route reuse.
- Complete the provider preflight, add the server-side maps adapter and Settings configuration, then implement address autocomplete and automatic driving-distance calculation with manual fallback.
- Migrate mileage persistence to retain calculation provenance without rewriting existing entries.

### Phase 5: Dropdowns & defaults

- Add the normalized options model, migration seeds, Settings UI, and management API.
- Wire Expense and Mileage forms/filters to active options.
- Verify deactivate, rename, replace, history display, and default behavior.

### Phase 6: Hardening and release

- Test keyboard-only and screen-reader paths, 200% zoom, reduced motion, contrast, long labels, and validation errors.
- Run query benchmarks with 5,000, 25,000, and 100,000 records; target under 300 ms for typical filtered API requests on the deployment host.
- Test mobile Safari and installed-PWA behavior, including camera receipt upload and interrupted network requests.
- Add analytics-free operational checks: API timing logs and error visibility are sufficient for this private dashboard.
- Release behind a per-screen feature flag or in Time -> Expenses -> Mileage order, with the existing screens available for rollback until each conversion is accepted.

## Execution and recovery playbook

### Branch and pull-request strategy

Execute the redesign as small, ordered pull requests into `preview`; do not implement all phases in one long-lived branch. Suggested PR sequence:

1. `redesign/01-query-contracts`
2. `redesign/02-shared-ledger-ui`
3. `redesign/03-time-pilot`
4. `redesign/04-expenses-ledger`
5. `redesign/05-mileage-ledger`
6. `redesign/06-maps-adapter`
7. `redesign/07-dropdown-settings`
8. `redesign/08-hardening-release`

Each branch starts from the latest `preview`, contains one independently reviewable concern, and includes migrations/tests required by that concern. Merge only after CI, review, and a preview smoke test pass. After each merge, rebase or recreate the next branch from the new `preview` rather than carrying a deep stack of stale branches.

Each PR description must include scope, schema/API changes, screenshots at desktop and mobile widths, test evidence, feature-flag state, migration/rollback notes, and known limitations. Keep a checklist in the PR so another agent or developer can resume without relying on chat history.

### Per-PR execution loop

1. **Preflight**: pull `preview`, confirm a clean worktree, record the starting commit, inspect open PRs, run the baseline test/build suite, and back up a representative database.
2. **Contract first**: write or update types, request/response contracts, migrations, and acceptance tests before wiring the final UI.
3. **Implement narrowly**: touch only the current phase; place incomplete user-facing behavior behind a default-off feature flag.
4. **Verify locally**: lint, type-check, unit/integration tests, production build, migration test on both fresh and copied databases, and focused browser checks.
5. **Stress the change**: run seeded-volume queries and mobile viewport checks appropriate to the phase.
6. **Commit checkpoints**: create coherent commits after schema/API, UI, and tests so a failed approach can be reverted selectively.
7. **Open PR and preview**: deploy or run from the PR branch, complete the manual smoke checklist, and attach evidence.
8. **Merge and observe**: merge into `preview`, redeploy, verify health and key CRUD operations, then observe logs and response times before starting the next phase.

### Required gates

Work stops at a gate when its criteria fail; later phases do not paper over earlier defects.

- **Baseline gate**: existing tests and build pass before implementation. If not, document the pre-existing failure and either repair it in a separate PR or obtain an explicit exception.
- **Data gate**: migrations succeed on a new database and a scrubbed copy of the current database; row counts and sampled totals match before/after.
- **API gate**: invalid filters are rejected predictably, pagination has no duplicates/gaps, totals use the identical filter predicate, and typical queries meet the performance target.
- **UX gate**: common CRUD flows pass at 320, 375, 430, 768, and desktop widths; keyboard and focus behavior pass; loading, empty, no-results, error, and offline/interrupted states are usable.
- **Maps gate**: manual mileage works with maps disabled, credentials absent, quota exhausted, provider returning errors, and network requests timing out.
- **Release gate**: current and redesigned screens can be switched independently, database backups are current, rollback steps have been rehearsed, and preview smoke tests pass.

### Feature flags and safe rollout

Use server-owned per-screen flags such as `transactionLedger.time`, `transactionLedger.expenses`, `transactionLedger.mileage`, `maps.enabled`, and `dropdownSettings.enabled`. Defaults stay off until the corresponding preview gate passes. Flags select UI/routes, not schema versions; all deployed code must safely tolerate the latest migrated schema whether a flag is on or off.

Roll out Time first to preview, then Expenses, then Mileage without maps, then maps, then editable dropdowns. Enable one flag at a time. Keep the previous screen reachable for at least one acceptance cycle. Once a new screen is accepted and stable, remove its old implementation in a separate cleanup PR rather than during rollout.

### Database migration safety

- Migrations are forward-only, idempotently tracked, and additive during the rollout window. Do not drop or rename existing columns while the old screens remain available.
- Before a migration, stop writes or use the application's existing consistent backup mechanism; record backup path, size, timestamp, and checksum.
- Test upgrade from the oldest supported live schema, the current live copy, and a fresh database.
- Verify migrations with row counts, null/constraint checks, orphan checks, and domain totals for Time, Expenses, and Mileage.
- For backfills, use deterministic batches with a persisted checkpoint and progress counts. Re-running a batch must not duplicate or corrupt data.
- If a migration fails before commit, abort the transaction and leave the prior schema usable. If validation fails after commit, disable the affected feature flag and restore the verified backup before allowing writes.
- Never claim rollback by running an untested down migration. The recovery path is old UI plus compatible additive schema, or database restore when data changed incorrectly.

### Failure classification and response

| Failure | Automatic behavior | Operator action | Resume point |
| --- | --- | --- | --- |
| Build, lint, type, or test failure | Stop the PR; no deploy | Fix in the same phase or revert the offending checkpoint | Re-run the full phase gate |
| Preview deploy fails | Keep the last healthy preview process | Inspect build/runtime logs; redeploy the last known-good commit if needed | Failed deployment commit |
| Migration fails | Roll back its transaction; keep feature flag off | Preserve logs, verify database integrity, fix migration against a copy | Migration preflight |
| CRUD regression or incorrect totals | Disable the affected screen flag | Capture reproducible filters/record IDs, compare old/new APIs, fix and retest | Affected phase PR |
| Slow queries or memory pressure | Enforce page-size cap; cancel/timeout request | Inspect query plan, add measured index or revise predicate | API performance gate |
| Receipt upload interruption | Preserve unsaved form; expose Retry | Check storage/disk limits and upload logs | Upload step only |
| Maps timeout, outage, bad route, or missing credentials | Stop retries quickly and expose manual miles | Test provider status/configuration; leave maps flag off if systemic | Distance calculation only |
| Maps quota or rate limit | Serve fresh cached routes; suspend live calls; show manual fallback | Review usage and limits; do not purchase capacity without approval | When quota window resets or provider changes |
| Dropdown option conflict or unsafe removal | Reject mutation; leave existing option active | Resolve duplicates/usages or select replacement explicitly | Settings mutation |
| Bad release after merge | Turn off affected flags and deploy last known-good app commit | Restore DB only if data validation shows corruption | Last completed gate |

### External API usage limits and provider resilience

- The maps adapter owns a request budget per minute and per day below the provider's hard limits. Reject or defer calls before crossing the configured budget.
- Autocomplete starts only after a minimum character count, debounces input, cancels stale requests, limits results, and uses provider session tokens when supported.
- Distance calculation occurs only when both validated endpoints are present or the user taps Recalculate; never call on every keystroke.
- Cache autocomplete briefly and route distances longer using normalized keys. Track cache hit rate, request count, latency, timeout count, provider status class, and remaining configured budget without logging addresses.
- Retry only transient failures (`429`, selected `5xx`, network timeout) with bounded exponential backoff and jitter: at most two automatic retries for an interactive request. Honor `Retry-After`. Do not retry invalid input, authentication failures, or no-route responses.
- Use a circuit breaker: after a configurable number of recent provider failures, stop live calls for a cooling period and immediately offer manual entry. A successful health probe closes the circuit.
- Provider selection remains behind the adapter. Adding a second provider is allowed after the preflight, but automatic failover must be opt-in because route results, privacy terms, and billing can differ.
- Usage-limit warnings appear in Settings at configurable thresholds such as 70%, 90%, and exhausted. Exhaustion disables calculation, not mileage CRUD.
- No code path may automatically upgrade a plan, enable billing, or send requests to a new provider without explicit approval and configured credentials.

### Resumability and work-state recording

At the end of every work session or failed attempt, update the active PR checklist with:

- last known-good commit and preview URL/process
- completed and failing gates
- exact failing command or request, sanitized error, and reproduction steps
- migration applied/not applied and backup identifier
- feature-flag values
- provider usage/circuit state if maps are involved
- next smallest action

Do not store secrets, full addresses, receipts, access tokens, or copied production rows in PR descriptions or logs. A new operator should be able to continue from the branch, PR checklist, test output, and backup identifier alone.

### Observability and health checks

- Add structured logs for endpoint name, result status, duration, page size, and anonymous filter count; exclude filter values that can contain client or address data.
- Expose or log migration version, enabled feature flags, database reachability, and maps adapter state (`disabled`, `healthy`, `limited`, `open-circuit`) in an operator-safe health check.
- Alerting can remain lightweight for this private deployment, but the post-deploy checklist must inspect error logs, p95 query time, maps failures/limits, and disk space for database backups and receipts.
- Define last-known-good as a specific commit plus validated database backup, not simply “the previous deployment.”

### Rollback runbook

1. Stop new work and record the observed failure and current commit.
2. Disable only the affected feature flag when possible; verify the legacy screen and CRUD path.
3. If the process is unhealthy, deploy the recorded last-known-good application commit.
4. Check database integrity and domain totals. Do not restore merely because the UI failed.
5. If data or schema validation failed, stop writes, preserve the faulty database for diagnosis, restore the verified pre-migration backup, and restart on compatible code.
6. Verify login, list, add, edit, and delete for the affected domain; verify totals and Settings load.
7. Record the incident, root cause, recovery commit/backup, and preventive test before resuming development.

### Definition of done for the execution program

- All eight PRs (or equivalently scoped replacements) are merged into `preview` with their gates documented.
- Each redesigned screen passes its acceptance criteria with its legacy flag fallback tested.
- Backup/restore and application rollback have been rehearsed against non-production copies.
- Manual mileage entry succeeds during simulated maps timeouts, `401`, `429`, `5xx`, quota exhaustion, and open-circuit states.
- No external-service spend was enabled without explicit approval.
- Preview remains stable through an acceptance period with no unexplained data-count/total changes before promotion beyond `preview`.

## Acceptance criteria

- Every transaction field is filterable; common filters are visible at the top and secondary filters are reachable in one action.
- Filters and sort are represented in the URL and restored after refresh or returning from add/edit.
- A 100,000-row dataset never requires downloading the full result set to the browser.
- Desktop users can sort, filter, open, edit, duplicate, and delete records with keyboard or pointer.
- Mobile users can add each record type without horizontal scrolling, input zoom, or controls hidden by the keyboard.
- Common mobile entry fits in a short primary form; optional/accounting fields do not block saving a valid record.
- Delete confirmations name the affected record and no deletion occurs from a single accidental tap.
- Settings users can add, rename, reorder, default, deactivate, reactivate, and safely replace supported dropdown options.
- Deactivated or renamed options do not erase or mislabel historical transactions.
- Entering valid start and end addresses can calculate driving mileage without exposing provider credentials to the browser.
- Users can inspect, recalculate, choose an alternate returned route, or manually override calculated mileage before saving.
- Maps outages, unavailable routes, missing configuration, and quota errors never prevent manual mileage entry.
- Saved mileage retains its value and calculation provenance even if the route or maps provider later changes.
- Filtered totals equal the records returned by the same filter contract.
- Automated tests cover query validation, pagination boundaries, CRUD, dropdown lifecycle, historical option behavior, dirty-form protection, and key accessibility interactions.

## Explicit non-goals for this redesign

- OCR or automatic categorization of receipts
- Multi-user permissions and approval workflows
- Spreadsheet-style inline editing across many rows
- Fake undo behavior without a recoverable deletion model
- Replacing Clients, Projects, or Chart of Accounts with generic dropdown options
