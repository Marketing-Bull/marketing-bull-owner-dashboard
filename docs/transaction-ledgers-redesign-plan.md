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
