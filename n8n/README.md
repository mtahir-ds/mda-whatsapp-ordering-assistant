# n8n workflows

Export each workflow from n8n (workflow menu → Download), put the raw files in a local folder that is **not** committed
(e.g. `raw_exports/`), then run:

```bash
python scripts/sanitize_workflows.py raw_exports/ n8n/workflows/
```

The script strips credential references and webhook ids and masks phone numbers and shared secrets. Open the output and
check it before committing.

| Workflow | Role |
|---|---|
| MDA Order Assistant Agent | WhatsApp trigger, live menu, customer AI agent, owner commands, replies |
| Sub - Find or Create Customer / Create Order / Add Order Item / Set Delivery Info / Get Order Summary / Finalize Order / Check Order Status | Tool sub-workflows the customer agent calls |
| Owner - Menu Assistant Agent | Owner-only agent: price, availability, limited stock, new items, categories, deals (chat YES + WhatsApp Approve) |
| Sub - Owner Update Order Status | Form-based, looping order status updates |
| Auto - Refresh Menu Image | Webhook, debounce, calls the Edge Function |
| Error handler | Writes failures to `error_logs` |
