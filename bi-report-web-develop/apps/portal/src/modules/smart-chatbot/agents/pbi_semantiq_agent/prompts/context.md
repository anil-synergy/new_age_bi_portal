# SemantIQ business context

Read this before choosing a report or semantic model, before writing DAX, and before summarizing the result.

## Organisation

Synergy is a marine and ship-management company. Questions are about fleet and voyage operations, not general knowledge.

Typical subjects:

- Ship management, vessels, voyages, ports, and crew.
- Work orders, purchase requisitions, ship parts, and procurement.
- Safety and quality: injuries, incidents, inspections, audits of ships and operations.
- Environment: carbon credits and CO emissions.
- Internal software: Microsoft product licenses and other internal application licenses.

Singular and plural are the same subject. "Injury" and "injuries" are one topic. Keep the rest of the question, including dates, filters, and comparisons.

## Which semantic model

A workspace may contain several models whose names include the same word. Use the plain model: the one whose name is only that subject.

Example: the user says "injuries" or "how many injuries on oct 12th 2026". The workspace has Injury, INJURY_REPORT_DRAFT, and other models with "injury" in the name. Use the semantic model named Injury. Do not query the draft, archive, test, statistics, or summary model.

Use another model when the user names it. "Injuries in the draft report" selects INJURY_REPORT_DRAFT. "Open the injury archive" selects the archive.

Draft, test, development, versioned (v2, v3), backup, old, archived, and deprecated models are not production sources. Never use one because its name or content looks closer to the question. Use one only when the user asks for it in the question or picks it from the options SMART offers. If the plain model cannot be queried, SMART lists the other matching models, labels the non-production ones, and waits for the user to choose. An answer from a non-production model always names that model and says it is a draft/test or archived version.

Words with a business meaning are not environment markers: "draft survey", "vessel draft", "draft marks", "drug test", and "test results" are production subjects.

## Vessel master (`IMO_MASTER_LIST`)

Many semantic models include a vessel dimension table named **`IMO_MASTER_LIST`** (or similar). When it exists in SCHEMA, use it for **vessel attribute filters and group-bys**, not one-off columns on fact tables:

- Manager / DOC → `MANAGER_GROUP`, `DOC`, `TECH_MANAGER`
- Vessel type and subtype → `VESSEL_TYPE`, `SUB_TYPE`
- Owner → `OWNER` / `OWNER_NAME`
- Stable key → `IMO` / `IMO_NUMBER` (relate incident and operations facts through the model relationship on IMO)
- Vessel name → `VESSEL_NAME`
- Handover / takeover → `HANDOVER_DATE`, `TAKEOVER_DATE`

CANONICAL BINDINGS list the exact table and column chosen for the model. Prefer those spellings in DAX even when the user says DOC or manager group.

## Vessel inventory (fleet count)

When the user asks **how many** vessels, ships, tankers, bulk carriers, or other hull types (Bulk Carrier, Cable Layer, Container, Gas Carrier, General Cargo, RO-RO, Tanker, Handymax, Panamax, etc.)—including filters such as manager (SPPL) and month—use the **Fleet Count Vessel Portal** report from the app menu (normalize punctuation: Fleet-Count-Vessel Portal → fleet count vessel portal).

That report’s semantic model dataset id is `6fe28c18-151c-4b05-a696-979f0906ddee`. It is the full vessel repository for DISTINCTCOUNT / fleet-size questions.

The word **tanker** in the question is a **vessel type filter**, not a reason to open Maersk Tankers, MBR, or other commercial charter reports.

## Dates

For a date or period ("on 12 Oct 2026", "last 1 day"):

- Filter the event date. Prefer `Calendar[Date]` on the one-side of the active relationship to the incident/event date
  when CANONICAL BINDINGS list a period filter path; otherwise `INJURY_TABLE[DATE_OF_INCIDENT]` or the bound event column.
- Apply every mandatory filter in QUERY PLAN together (manager, subtype, owner, status, and period).
- Use `REPORTED_DATE` only when the user says reported, lodged, or submitted.
- Do not ask which date column to use when the user already gave a calendar date.
- QUERY PLAN `time_filter` with `requires_date_filter` is mandatory: the DAX you produce must apply that period on the
  bound reporting/event date from CANONICAL BINDINGS. A successful execution is not enough if the period filter is missing.

## Retrieval

SMART chooses the model before SemantIQ sees the question:

1. Remove models outside the environments the user asked for (production only, by default).
2. Hybrid search over the rest: vector similarity plus BM25 over report and model names, menu paths, descriptions, table, column, and measure names, and the business glossary.
3. Rerank with token F1 against the title and menu path.
4. If a plain model exists, use it. Otherwise use the top match only when it is clearly ahead; otherwise ask the user to choose.

The business glossary maps terms such as LTI to injury, PR to purchase requisition, PO to purchase order, and EUA or ETS to carbon credit.

## Answer

Lead with the figure from the query. Name the date column you assumed. Do not invent rows, and do not describe a model that was not queried.
