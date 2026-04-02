# Spatial Workbench issue triage

## Purpose
This document groups the current open issues into a more intentional roadmap so it is easier to decide what to work on next.

---

## Recommended labels

Use these lightweight labels for now:

- `up next` = highest leverage work to do immediately
- `high priority` = important and near-term, but blocked by or downstream of `up next`
- `foundation` = core architecture or state model work
- `agent` = agent-facing execution, schemas, workflows, APIs
- `ui` = interface and interaction improvements
- `polish` = bug fixes or fit-and-finish
- `future` = valuable, but not needed yet

---

## Recommended order

### Up next
These are the most leverage-heavy issues because they shape execution, state, and tool contracts.

1. #22 Separate UI rendering from execution logic (`run(params, context)`)
2. #23 Define standard `ToolResult` contract for tool executions
3. #28 Add tool validation layer (`validate(params, state)`)
4. #26 Add selection as first-class state
5. #32 Add automated testing plan (unit + minimal integration)

Why these first:
- They create a stable execution model
- They make tools safe to call from both UI and agents
- They reduce refactor risk
- They give downstream issues a cleaner foundation

### High priority
These are strong follow-ons once the execution model is stable.

6. #21 Add Tool JSON Specification (`getSpec`) + `GET /api/tools`
7. #29 Introduce workflow / recipe engine for chaining tools
8. #6 Add tool results information
9. #7 Add tool history
10. #10 Add ability to turn on/off layers
11. #1 Add attribute table

Why these next:
- They improve discoverability, auditability, and usability
- They unlock stronger human + agent workflows
- They make the workbench feel more like a real spatial environment

### Important but later
12. #27 Create agent execution API (`GET /api/state`, `POST /api/run`)
13. #20 Make Spatial Workbench fully hosted with GH Pages + BYOK API backend
14. #37 Mobile-friendly UI pass (minimal)
15. #11 Add export all layers option to export tool
16. #8 Add popups to all layers
17. #9 Devise a way to distinguish features from layers
18. #3 ArcGIS Online integration ideas
19. #14 Explore transition to openfreemap

Why later:
- Several depend on the foundation and high-priority work
- Hosted or mobile work is easier after state and execution stabilize
- Integration work should come after the internal model is solid

### Polish / bugs
20. #4 Create a mechanism by which tools with invalid parameters cannot be executed
21. #5 Add tool loading UI indication
22. #12 Drawn polyline shows undefined vertices
23. #13 Override draw widget remove all to also remove tool results

Notes:
- #4 may collapse into #28 or be closed as superseded once #28 is complete
- #13 may become easier after clearer layer/result lineage is in place

---

## Proposed new issues

### Add feature provenance / lineage metadata and UI
Track where outputs came from and make the chain visible.

Suggested scope:
- Attach source feature IDs or layer IDs to tool outputs when applicable
- Attach tool name, parameters, and timestamp to output metadata
- Provide a small UI panel or popup section showing origin
- Make lineage accessible from state and exportable with workflow history

Why it matters:
- Gives the workbench receipts
- Supports debugging and learning
- Makes agent-generated outputs easier to trust
- Builds naturally on tool history and `ToolResult`

Suggested label(s): `high priority`, `foundation`, `agent`

### Add geometry comparison mode
Compare two selected features or layers and show what differs.

Suggested scope:
- Support intersect, only-in-A, only-in-B, and symmetric difference
- Report simple metrics like area or length delta where relevant
- Allow export of comparison geometry
- Work with both human-created and AI-created geometry

Why it matters:
- Fits the project identity very well
- Useful for manual vs AI comparison
- Good demo feature
- Builds on selection as first-class state

Suggested label(s): `high priority`, `ui`

---

## Suggested first milestone
A practical first milestone could be:

- #22 execution refactor
- #23 `ToolResult`
- #28 validation
- #26 selection state
- #6 results info
- #7 history
- provenance issue

That milestone would move Spatial Workbench from a promising demo into a small but real geometry runtime with visible receipts.

---

## Suggested second milestone
- #21 tool spec
- #29 workflow engine
- #32 tests
- geometry comparison issue
- #1 attribute table
- #10 layer visibility

That would make the app much more compelling for repeatable workflows and agent collaboration.
