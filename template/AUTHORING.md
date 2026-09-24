# ObjectStack application authoring

Edit `app.json` in the working directory. It is native ObjectStack 17.4 metadata, consumed by `defineStack`. Do not create a separate frontend or change infrastructure. Return a brief plain-language summary when done.

Keep the manifest id `stratum-demo`, namespace `stratum_demo`, type `app`, and protocol `^17`. Change its name to suit the requested application. Only these top-level keys are supported in this first milestone: `manifest`, `objects`, `views`, `apps`, `data`.

The project deliberately starts empty. Create actual objects, fields, app navigation and fictional seed records. On follow-up requests, preserve existing metadata and records unless the user asks to change them. Do not invent SDK fields. Object names must start with `stratum_demo_`. Never put executable code, connectors or external URLs in this prototype.

Example native object:
```json
{
  "name": "stratum_demo_credit_request",
  "label": "Credit request", "pluralLabel": "Credit requests", "icon": "file-text",
  "nameField": "borrower", "sharingModel": "public_read_write",
  "fields": {
    "borrower": { "type": "text", "label": "Borrower", "required": true },
    "amount": { "type": "number", "label": "Requested amount", "required": true },
    "status": { "type": "select", "label": "Status", "defaultValue": "new", "options": [
      { "label": "New", "value": "new" }, { "label": "Under review", "value": "under_review" },
      { "label": "Approved", "value": "approved" }
    ] },
    "notes": { "type": "textarea", "label": "Notes" }
  }
}
```

An app in `apps` uses:
```json
{
  "name": "credit_review", "label": "Credit Review", "icon": "building-2",
  "description": "Review credit applications.",
  "navigation": [{ "id": "requests", "type": "object", "objectName": "stratum_demo_credit_request", "label": "Credit requests", "icon": "file-text" }]
}
```

Declare a native view for each object so all requested fields appear in its list and form. Example:
```json
{
  "object": "stratum_demo_credit_request",
  "list": { "type": "grid", "label": "Credit requests", "columns": ["borrower", "amount", "status", "notes"] },
  "form": { "type": "simple", "title": "Credit request", "layout": "vertical", "sections": [{ "label": "Details", "fields": ["borrower", "amount", "status", "notes"] }] }
}
```

A dataset in `data` uses `{"object":"stratum_demo_credit_request","mode":"upsert","externalId":"borrower","records":[{"borrower":"Northstar Services","amount":50000,"status":"new"}]}`. Use a stable, unique value for externalId in every seed record; never use insert mode because it duplicates seed rows on restart. Include 3–5 fictional records per object when creating it. Field types available here: text, textarea, number, boolean, date, datetime, select, email, phone, lookup. Lookup fields need `reference` naming an existing object. Select options are objects with `label` and `value`, never raw strings. Field values in seed records must match the field types. Do not add a field named `id`; the runtime manages IDs.

This is a local development prototype, not a production credit-decision system. Implement the requested application structure honestly; do not claim unsupported workflow or permission behavior.
