const id = String(pm.iterationData.get('ticket_id') || '').trim();
const code = pm.response.code;
const repetir = () => (pm.execution && pm.execution.setNextRequest)
  ? pm.execution.setNextRequest(pm.info.requestName)
  : postman.setNextRequest(pm.info.requestName);

const COLUNAS = ['ticket_id','erro','criado_em','canal_criacao','status_atual','status_anterior',
  'ultima_mudanca_status_em','grupo_atual','atribuido_atual','formulario','prioridade','tags_atuais',
  'ultima_atualizacao','ultimo_autor_tipo','ultimo_via','ultima_regra','ultimo_coment_publico_em',
  'ultimo_coment_publico_autor','qtd_audits','qtd_coment_publicos','qtd_reaberturas','qtd_trocas_grupo',
  'teve_side_conversation','regras_disparadas','trilha_ultimos_eventos'];
const esc = v => {
  const s = (v === undefined || v === null) ? '' : (Array.isArray(v) ? v.join(' ') : String(v));
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const gravarLinha = obj => {
  let csv = pm.collectionVariables.get('resultado_csv') || '';
  if (!csv) csv = COLUNAS.join(',') + '\n';
  csv += COLUNAS.map(c => esc(obj[c])).join(',') + '\n';
  pm.collectionVariables.set('resultado_csv', csv);
  pm.collectionVariables.set('estado', '');
  pm.collectionVariables.set('next_url', '');
};

if (code === 429) {
  // Limite de taxa: espera o Retry-After e repete a mesma página
  const espera = (parseInt(pm.response.headers.get('Retry-After') || '10', 10) + 1) * 1000;
  console.warn(`429 no ticket ${id}, aguardando ${espera / 1000}s`);
  repetir();
  setTimeout(() => {}, espera);
} else if (code !== 200) {
  gravarLinha({ ticket_id: id, erro: `HTTP ${code}` });
} else {
  const body = pm.response.json();
  const e = JSON.parse(pm.collectionVariables.get('estado') || 'null') || {
    ticket_id: id, qtd_audits: 0, qtd_coment_publicos: 0, qtd_reaberturas: 0, qtd_trocas_grupo: 0,
    teve_side_conversation: 'nao', regras: {}, trilha: []
  };
  const dt = s => (s || '').replace('T', ' ').replace('Z', '');

  (body.audits || []).forEach(a => {
    e.qtd_audits++;
    const via = a.via || {};
    const src = via.source || {};
    const rel = src.rel || '';
    if (!e.criado_em) { e.criado_em = dt(a.created_at); e.canal_criacao = via.channel; }

    e.ultima_atualizacao = dt(a.created_at);
    e.ultimo_autor_tipo = a.author_id === -1 ? 'sistema'
      : (String(a.author_id) === String(e.requester_id) ? 'cliente' : 'agente/integracao');
    e.ultimo_via = via.channel + (rel ? '/' + rel : '');
    if (['trigger', 'automation', 'macro', 'rule'].some(r => rel.includes(r)) && src.from && src.from.title) {
      e.ultima_regra = `${rel}: ${src.from.title}`;
      e.regras[e.ultima_regra] = (e.regras[e.ultima_regra] || 0) + 1;
    }
    if (String(via.channel).includes('side_conversation')) e.teve_side_conversation = 'sim';

    (a.events || []).forEach(ev => {
      if (/side.?conversation/i.test(ev.type || '')) e.teve_side_conversation = 'sim';
      if (ev.type === 'Comment' && ev.public) {
        e.qtd_coment_publicos++;
        e.ultimo_coment_publico_em = dt(a.created_at);
        e.ultimo_coment_publico_autor = String(ev.author_id) === String(e.requester_id) ? 'cliente'
          : (ev.author_id === -1 ? 'sistema' : 'agente/integracao');
        e.trilha.push(`${dt(a.created_at).slice(0, 16)} comentario_publico(${e.ultimo_coment_publico_autor})`);
      }
      if (ev.type !== 'Create' && ev.type !== 'Change') return;
      const campo = ev.field_name, v = ev.value;
      if (campo === 'requester_id') e.requester_id = v;
      if (campo === 'status') {
        if (ev.type === 'Change') {
          e.status_anterior = ev.previous_value;
          e.ultima_mudanca_status_em = dt(a.created_at);
          if (ev.previous_value === 'solved' && v !== 'closed') e.qtd_reaberturas++;
        }
        e.status_atual = v;
      }
      if (campo === 'group_id') { if (ev.type === 'Change') e.qtd_trocas_grupo++; e.grupo_atual = v; }
      if (campo === 'assignee_id') e.atribuido_atual = v;
      if (campo === 'ticket_form_id') e.formulario = v;
      if (campo === 'priority') e.prioridade = v;
      if (campo === 'tags') e.tags_atuais = v;
      if (ev.type === 'Change' && ['status', 'group_id', 'assignee_id', 'ticket_form_id'].includes(campo)) {
        e.trilha.push(`${dt(a.created_at).slice(0, 16)} ${campo}:${ev.previous_value || '-'}>${v || '-'}` +
          (src.from && src.from.title ? ` [${src.from.title}]` : ''));
      }
    });
  });
  e.trilha = e.trilha.slice(-15);

  if (body.meta && body.meta.has_more && body.links && body.links.next) {
    // Mais de 100 audits: guarda o estado e busca a próxima página do mesmo ticket
    pm.collectionVariables.set('estado', JSON.stringify(e));
    pm.collectionVariables.set('next_url', body.links.next);
    repetir();
  } else {
    e.regras_disparadas = Object.entries(e.regras).map(([k, n]) => `${k} (${n}x)`).join(' | ');
    e.trilha_ultimos_eventos = e.trilha.join(' | ');
    gravarLinha(e);
  }
}
