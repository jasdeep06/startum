# Chrome extension verification — 23 September 2026

> Historical verification of the retired builder milestone. Current chat and drawer results are in the [in-app chat guide](app-chat.md) and [screenshot gallery](screenshots.md).

## Result

The tested milestone workflows passed through the connected ChatGPT Chrome extension in Person 1. All browser interactions in this pass used that extension. Credit Review is now on **version 3**.

## What was checked

| Scenario | Observed result |
| --- | --- |
| Open Stratum | Connected locally; accepted app version and request history loaded |
| Embedded native preview | Credit Review displayed the five fictional borrowers and their risk grades without a login prompt |
| Required-field validation | Empty Create submission stayed in the form and identified Borrower, Requested amount and Risk grade |
| Choices | Review status offered New / Under review / Approved; risk grade offered Low / Medium / High |
| Form scrolling | Lower fields remained accessible within the embedded modal; save/cancel controls remained available |
| Create | A clearly marked fictional test borrower was created with amount 12,500 and Low risk |
| Edit and read back | Risk changed to High and notes were updated; a separately opened native app tab showed the saved values |
| Cleanup | The test record was deleted through the native UI; the list returned to five sample records |
| Open app | Opened the native ObjectStack application in another tab, already signed in |
| Changes | The risk-grade definition could be expanded and remained open across refresh polls after the fix |
| Activity | Events and native ObjectStack validation output were readable |
| Metadata | The accepted native definition included the required risk grade, list/form fields and all five seed borrowers |
| Live request | The browser prompt entered a running state, disabled prompt/harness/model editing, and exposed Stop |
| Generated result | Version 3 appeared and the native list/form displayed Reviewer notes |

The live browser prompt was:

> Rename the Notes field to Reviewer notes in the credit-request list and forms. Keep all existing fields, choices, required rules and all five sample borrowers unchanged.

Its successful run ID is `7963de2e-1f9c-4c00-aa35-db10b02ddd6d`. A direct comparison of the saved native definitions confirmed exactly one metadata change: `/objects/0/fields/notes/label`. Every other field, choice, required rule, view and seed record was unchanged.

## Issues fixed

1. **Expanded changes could not stay open.** Every state poll rebuilt the Changes panel, discarding disclosure state. Activity and Changes now update only when their underlying content changes. Overlapping refresh calls are also prevented.
2. **The conversation was cramped.** At the tested 1440 × 682 viewport, the welcome content consumed most of the left panel. After a request exists, that welcome content is hidden so the conversation has space. Successful messages use a short application-check result; the harness's full technical output remains under Builder notes.
3. **A stopped Stratum process left an orphan preview.** The original server was no longer listening, but its detached ObjectStack preview still occupied port 3002. After verifying its command and project directory, that orphan was stopped. New previews include a parent watcher that terminates their process group if Stratum disappears. An occupied-port check also prevents startup from treating a previously running application as the candidate preview.

The server was left running independently of the verification terminal. Its local PID and log are in `.stratum/server.pid` and `.stratum/server.log`.

## Additional validation

- Nine automated tests passed, including the occupied-port and abrupt-owner-exit regressions.
- TypeScript checking and browser JavaScript syntax checking passed.
- Ten API checks passed against version 3, including record create/update/read/delete and required-field rejection.
- The disposable browser-test record and API-test records were removed. The five sample borrowers remain.

This pass does not establish production financial controls, tenant isolation, data migration between generated versions, full workflow correctness, or compatibility across every browser and screen size. Those limitations remain in the milestone notes. Cancellation and model-provider failure were not newly exercised end to end in this browser pass.
