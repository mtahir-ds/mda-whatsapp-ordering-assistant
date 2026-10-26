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
| Sub - Auto - Refresh Menu Image | Webhook, debounce, calls the Edge Function |
| Owner - Add Restaurant Info | Owner adds FAQ / restaurant info to the knowledge base |
| Owner - Upload Menu Image | Owner uploads a menu picture to replace the generated one |
| Sub - Generate Report | Owner sales report |
| Error handler | Writes failures to `error_logs` |

## How replies stay reliable

The AI model can ignore tool results, so anything the customer must be able to trust is built in code:

- **Direct YES path.** A bare "yes" is caught before the AI step. The order is found in the database (`order_to_confirm`), finalized, and the confirmation is sent from the tool result.
- **Tool-built replies.** Add Order Item, Get Order Summary and Finalize Order return a `reply_text`. The *Detect Image Marker* code node sends that text instead of the model's version, and replaces any "Added X" the tools did not back up with an honest "couldn't add X, please send it again".
- **No fake confirmations.** "Order confirmed" or an order summary written by the model without a matching tool result is never sent.
- **Pickup/Delivery is the customer's choice.** Set Delivery Info rejects Pickup unless the customer's message mentions it.
- **If the AI step fails after the order is confirmed**, the customer still gets the real confirmation (`recent_confirmed_order`).
- **Stale drafts** (Pending orders never completed) are cancelled and deleted nightly by a pg_cron job (`cleanup_stale_drafts`).

The demo menu is 10 live items; other items are archived (`is_archived`), not deleted.
