// Monta a URL da página atual de audits do ticket desta iteração
const id = String(pm.iterationData.get('ticket_id') || '').trim();
const next = pm.collectionVariables.get('next_url');

// Primeira iteração do lote: zera o resultado anterior
if (pm.info.iteration === 0 && !next && !pm.collectionVariables.get('estado')) {
  pm.collectionVariables.set('resultado_csv', '');
}

pm.collectionVariables.set('audits_url', next ||
  `https://${pm.environment.get('subdomain')}.zendesk.com/api/v2/tickets/${id}/audits.json?page[size]=100`);
