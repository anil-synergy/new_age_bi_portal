# Power BI provider

Default provider. It does not add or change any Power BI behavior.

- **Routes**: unchanged, `/dashboard/:reportId` (`app/dashboard/[reportId]/page.tsx` still renders `ReportViewer` directly).
- **Embedding, auth, filters, ACL, RLS, refresh, export**: unchanged, all inside `components/ReportViewer.tsx`,
  `tile-engine/PowerBIReportTile` and `services/pbiEmbedService` (`/api/embed/token`).
- **Configuration**: the existing `AZURE_FUNCTION_BASE` / Power BI settings; nothing new.

## Files

- `index.ts`: provider definition for the dropdown.
- `PowerBiHost.tsx`: adapter for `ReportHost`; renders `<ReportViewer reportId={reportId} />`, or a
  "select a report" hint when no report id is given.

## Administration

Power BI is the default application type in Administration → Reports. Its form, validation, payload and
bi-report-api calls are the original ones. Existing reports always open as Power BI.
`/dashboard/apps/power-bi` redirects to `/dashboard`.
