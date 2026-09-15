# Transaction Ledger Query Contract

This contract is the server-side foundation for the redesigned Time, Expenses, and Mileage ledgers. It prevents the browser from downloading the entire transaction history and gives every stored transaction field a validated filter path.

## Shared request parameters

All three list endpoints accept:

| Parameter | Format | Notes |
| --- | --- | --- |
| `page` | integer, 1 or greater | Defaults to `1`. |
| `pageSize` | integer from 1 to 100 | Defaults to `50`. New ledger clients must use this parameter. |
| `sort` | endpoint-specific enum | Defaults to `date`. Values are mapped to known SQL expressions; arbitrary SQL is rejected. |
| `direction` | `asc` or `desc` | Defaults to `desc`. |
| `search` | text | Case-insensitive search over the screen's human-readable fields. |
| `from`, `to` | `YYYY-MM-DD` | Inclusive transaction-date range. |
| `clientId`, `projectId` | repeated or comma-separated IDs | Up to 50 values per field. |
| `createdFrom`, `createdTo` | `YYYY-MM-DD` | Inclusive created-date range. |
| `updatedFrom`, `updatedTo` | `YYYY-MM-DD` | Inclusive updated-date range. |

Boolean parameters accept `true`, `false`, `1`, or `0`. Minimum/maximum pairs are rejected when the minimum exceeds the maximum. Invalid dates, enums, ranges, sort fields, page values, and list sizes return HTTP `400` before SQL execution.

The old `limit` parameter remains temporarily available, capped at 1,000, so the current screens do not regress before they are replaced. It will be removed after all three ledgers use `pageSize`.

## Shared response

```json
{
  "items": [],
  "pageInfo": {
    "page": 1,
    "pageSize": 50,
    "totalItems": 0,
    "totalPages": 0,
    "hasPreviousPage": false,
    "hasNextPage": false
  },
  "filteredTotals": {},
  "availableFacets": {}
}
```

Totals and facets use the same validated predicate as `items`, but are calculated across the full filtered result, not only the current page. Sorting always includes stable secondary keys so page boundaries are deterministic.

For compatibility, each endpoint also exposes the current screen's legacy collection key (`timeEntries`, `expenses`, or `mileageEntries`) as an alias of `items`.

## Time: `GET /api/time-entries`

Additional filters:

- `id`, `mcId`
- `billable`
- `hoursMin`, `hoursMax`
- `rateMin`, `rateMax`
- `amountMin`, `amountMax` (`hours * frozen rate`)
- `details`
- `startTime`, `endTime`
- `hasStartTime`, `hasEndTime`

Sort fields: `date`, `hours`, `rate`, `amount`, `details`, `billable`, `startTime`, `endTime`, `createdAt`, `updatedAt`.

Filtered totals: hours, billable hours, amount, and billable amount. Facets: client, project, and billable.

## Expenses: `GET /api/expenses`

Additional filters:

- `id`, `mcId`, `recurringExpenseId`
- `amountMin`, `amountMax`
- `kind` (`expense`, `income`)
- `category`, `company`
- `vendor`, `details`
- `accountCode`
- `billable`, `reimbursable`
- `recurring` (`none`, `weekly`, `monthly`, `quarterly`, `yearly`)
- `recurringDayMin`, `recurringDayMax`
- `paymentMethod`, `status`
- `tags`
- `receiptAttached`, `receiptName`
- `annualizedMin`, `annualizedMax`

Multi-value fields accept repeated or comma-separated values. Sort fields: `date`, `amount`, `kind`, `category`, `company`, `vendor`, `details`, `accountCode`, `billable`, `reimbursable`, `recurring`, `paymentMethod`, `status`, `annualizedAmount`, `createdAt`, `updatedAt`.

Filtered totals: record count, expenses, income, reimbursable expenses, and net. Facets: client, project, kind, category, company, account code, payment method, status, recurring frequency, billable, reimbursable, and receipt presence.

## Mileage: `GET /api/mileage`

Additional filters:

- `id`, `mcId`
- `tripName`, `startAddress`, `endAddress`, `purpose`, `notes`
- `milesMin`, `milesMax`
- `roundTrip`
- `totalMilesMin`, `totalMilesMax`
- `billable`
- `reimbursementMin`, `reimbursementMax` using the saved mileage rate

Sort fields: `date`, `tripName`, `startAddress`, `endAddress`, `purpose`, `miles`, `roundTrip`, `totalMiles`, `billable`, `reimbursement`, `createdAt`, `updatedAt`.

Filtered totals: trip count, total miles, and reimbursement. Facets: client, project, purpose, round trip, and billable.

## Next consumer

The shared ledger UI should keep filter and sort state in the URL, debounce free text, request only the active page, render `filteredTotals` in the compact header/footer, and use `availableFacets` for option counts. It must not calculate totals from the current page or fall back to client-side filtering.
