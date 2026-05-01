
WITH ids AS (
  SELECT unnest(ARRAY['AB-692','AB-693','AB-689','AB-691','AB-688','AB-690','AB-687','AB-686','AB-685','AB-683','AB-684','AB-682','AB-681','AB-680','AB-679','AB-678','AB-677','AB-676','AB-675','AB-673','AB-672','AB-674','AB-671','AB-670','AB-669','AB-668','AB-667','AB-666','AB-665','AB-664','AB-663','AB-662','AB-661']) AS oid
)
DELETE FROM whatsapp_messages WHERE order_id IN (SELECT oid FROM ids) AND status = 'failed';

DELETE FROM whatsapp_automation_runs WHERE order_id IN ('AB-692','AB-693','AB-689','AB-691','AB-688','AB-690','AB-687','AB-686','AB-685','AB-683','AB-684','AB-682','AB-681','AB-680','AB-679','AB-678','AB-677','AB-676','AB-675','AB-673','AB-672','AB-674','AB-671','AB-670','AB-669','AB-668','AB-667','AB-666','AB-665','AB-664','AB-663','AB-662','AB-661');

UPDATE whatsapp_conversations SET pending_button_intent = NULL WHERE order_id IN ('AB-692','AB-693','AB-689','AB-691','AB-688','AB-690','AB-687','AB-686','AB-685','AB-683','AB-684','AB-682','AB-681','AB-680','AB-679','AB-678','AB-677','AB-676','AB-675','AB-673','AB-672','AB-674','AB-671','AB-670','AB-669','AB-668','AB-667','AB-666','AB-665','AB-664','AB-663','AB-662','AB-661');

UPDATE orders SET
  confirmation_channel = 'whatsapp',
  confirmation_status = 'new_wts',
  whatsapp_status = 'pending',
  whatsapp_retry_count = 0,
  whatsapp_last_sent_at = NULL,
  agent_id = NULL
WHERE order_id IN ('AB-692','AB-693','AB-689','AB-691','AB-688','AB-690','AB-687','AB-686','AB-685','AB-683','AB-684','AB-682','AB-681','AB-680','AB-679','AB-678','AB-677','AB-676','AB-675','AB-673','AB-672','AB-674','AB-671','AB-670','AB-669','AB-668','AB-667','AB-666','AB-665','AB-664','AB-663','AB-662','AB-661');
