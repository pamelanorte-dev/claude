/* ==========================================================================
   [CX] Alertas Cancelamento — 5 Views Zendesk (1P e 3P) + Fechamento 17h
   ========================================================================== */

const CFG = {
  VIEWS: [
    { id: 58898794602907, nome: '1P - Falha ao integrar no legado', tipo: 'padrao' },
    { id: 58898612845339, nome: '1P - Não chamou o gatilho no legado', tipo: 'padrao' },
    { id: 58898823649819, nome: '1P - Fora do prazo dos 7 dias pós entregue', tipo: 'padrao' },
    { id: 58899130156699, nome: '3P - Não chamou gatilho de integração', tipo: 'padrao' },
    { id: 58898999335835, nome: '3P - Falha ao integrar', tipo: '3p_falha' },
  ],
  CAMPO_ID_SESSAO_MENSAGERIA: 43040646129691, // ID Sessão Mensageria Seller
  CAMPO_STATUS_CANCELAMENTO:  48507184478491, // Status do cancelamento
  DATA_INICIO: new Date('2026-11-19T00:00:00-03:00'),
  MIN_TICKETS: 5,
  MAX_LISTA: 10,
  PASTA_PLANILHAS_ID: '1--VXH4k_EcQ76jMYn2ib_M-Vpj9GuxZ2',
  TZ: 'America/Sao_Paulo',
};

/* ---------- Gatilhos de Horário ---------- */
function alerta10h()   { executarAlerta_('10h00', false); }
function alerta13h30() { executarAlerta_('13h30', false); }
function alerta17h()   { executarAlerta_('17h00', true); }

/* ---------- OAuth2 Zendesk ---------- */
function getZendeskService() {
  const props = PropertiesService.getScriptProperties();
  const subdomain = props.getProperty('ZENDESK_SUBDOMAIN');

  return OAuth2.createService('zendesk')
    .setAuthorizationBaseUrl(`https://${subdomain}.zendesk.com/oauth/authorizations/new`)
    .setTokenUrl(`https://${subdomain}.zendesk.com/oauth/tokens`)
    .setClientId(props.getProperty('ZENDESK_CLIENT_ID'))
    .setClientSecret(props.getProperty('ZENDESK_CLIENT_SECRET'))
    .setCallbackFunction('authCallback')
    .setPropertyStore(props)
    .setScope('read');
}

function authCallback(request) {
  const service = getZendeskService();
  const authorized = service.handleCallback(request);
  return HtmlService.createHtmlOutput(
    authorized
      ? 'Autorizado com sucesso! Pode fechar esta aba e rodar o script.'
      : 'Autorização negada.'
  );
}

/* ---------- Execução Principal ---------- */
function executarAlerta_(janela, isFechamentoDia) {
  const props = PropertiesService.getScriptProperties();
  const subdomain = props.getProperty('ZENDESK_SUBDOMAIN');
  const webhookUrl = props.getProperty('GCHAT_WEBHOOK');

  // Falha de autorização: avisa no canal e encerra (os alertas desta rodada não foram verificados)
  const service = getZendeskService();
  let token = null;
  try {
    if (service.hasAccess()) token = service.getAccessToken();
  } catch (e) {
    Logger.log('Erro ao obter token do Zendesk: ' + e.message);
  }
  if (!token) {
    Logger.log('⚠️ ABRA ESTE LINK NO NAVEGADOR PARA AUTORIZAR O ZENDESK:\n' + service.getAuthorizationUrl());
    enviarGoogleChat_(webhookUrl,
      `🔴 *Alertas Cancelamento (${janela}) — falha de autorização no Zendesk*\n` +
      'As views *não foram verificadas* nesta rodada. É preciso reautorizar: abra o projeto ' +
      '[CX] Alertas Cancelamento no Apps Script, execute `alerta10h` e abra o link que aparece ' +
      'no Registro de execução.');
    return;
  }

  // No fechamento das 17h, filtra apenas tickets criados hoje (00:00 BRT)
  const hojeStr = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd');
  const dataCorte = isFechamentoDia
    ? new Date(`${hojeStr}T00:00:00-03:00`)
    : CFG.DATA_INICIO;

  const minimoExigido = isFechamentoDia ? 1 : CFG.MIN_TICKETS;

  const filasAvaliacao = [];
  const falhasLeitura = [];

  CFG.VIEWS.forEach(view => {
    let ticketsBrutos;
    try {
      ticketsBrutos = buscarTicketsDaView_(subdomain, token, view.id);
    } catch (e) {
      // Não usa leitura parcial: a view fica fora desta rodada e o canal é avisado
      Logger.log(`[${view.nome}] Falha na leitura: ${e.message}`);
      falhasLeitura.push({ view, erro: e.message });
      return;
    }
    const ticketsFiltrados = ticketsBrutos.filter(t => new Date(t.created_at) >= dataCorte);

    if (view.tipo === '3p_falha') {
      const { comSessaoSemStatus, demaisFalhas3P } = classificarTickets3PFalha_(ticketsFiltrados);

      filasAvaliacao.push({
        viewId: view.id,
        titulo: '⚠️ 3P - Com ID Sessão Mensageria (Status Cancelamento vazio)',
        nomePlanilha: '3P Sessão sem Status Cancelamento',
        tickets: comSessaoSemStatus,
        destacarSessao: true,
      });

      filasAvaliacao.push({
        viewId: view.id,
        titulo: '3P - Falha ao integrar (sem ID de sessão)',
        nomePlanilha: '3P Falha ao integrar',
        tickets: demaisFalhas3P,
        destacarSessao: false,
      });
    } else {
      filasAvaliacao.push({
        viewId: view.id,
        titulo: view.nome,
        nomePlanilha: view.nome,
        tickets: ticketsFiltrados,
        destacarSessao: false,
      });
    }
  });

  const blocosMensagem = [];
  let somaTotalDia = 0;
  const resumoFilas = []; // todas as filas lidas, inclusive as com 0 (vai no resumo do fechamento)

  filasAvaliacao.forEach(fila => {
    const total = fila.tickets.length;
    Logger.log(`[${fila.titulo}] Total encontrado: ${total}`);
    resumoFilas.push({ titulo: fila.titulo, total });

    if (total < minimoExigido) {
      return;
    }

    somaTotalDia += total;

    // Pedido não integrado (View 1P Falha): conta no total e no mínimo, mas não é listado.
    // Volta para a lista se também tiver a tag de "resolvido após 48h" (Diagnostico.gs).
    const sep = separarNaoIntegrados_(fila.tickets, fila.viewId);
    const casos = sep.listar.map(t => formatarCaso_(subdomain, t, fila.viewId));
    let urlPlanilha = null;

    if (casos.length > CFG.MAX_LISTA) {
      urlPlanilha = criarPlanilha_(fila.nomePlanilha, casos, fila.destacarSessao);
    }

    const montarAmostra = comCausas => casos.slice(0, CFG.MAX_LISTA).map(c => {
      const extraSessao = (fila.destacarSessao && c.id_sessao)
        ? ` | Sessão: *${c.id_sessao}*`
        : '';
      const extraCausas = (comCausas && c.causas) ? ` — ⚠️ _${c.causas}_` : '';
      return `• *<${c.link}|#${c.ticket}>*${extraSessao} — ${c.assunto} _(${c.criado_em})_${extraCausas}`;
    }).join('\n');
    // Google Chat aceita até 4096 caracteres: se passar, tira as causas de cada linha (o resumo continua)
    let amostra = montarAmostra(true);
    if (amostra.length > 2000) amostra = montarAmostra(false);

    const linkView = `https://${subdomain}.zendesk.com/agent/filters/${fila.viewId}`;

    let bloco = `*${total} ticket(s)*`;
    const blocoNI = blocoNaoIntegrado_(sep);
    if (blocoNI) bloco += `\n${blocoNI}`;
    if (casos.length) {
      bloco += `\n${amostra}`;
      bloco += `\n\n${blocoCausas_(sep.listar, fila.viewId)}`;
    }
    if (urlPlanilha) {
      bloco += `\n📄 _Lista completa (${casos.length} casos):_ <${urlPlanilha}|Abrir planilha>`;
    }
    bloco += `\n👉 _Acompanhe os casos aqui:_ <${linkView}|Abrir view no Zendesk>`;

    blocosMensagem.push({ titulo: fila.titulo, bloco });
  });

  // Uma mensagem por tema (fila). Falhas de leitura vão em mensagem própria.
  const mensagens = [];
  const dataFormatada = Utilities.formatDate(new Date(), CFG.TZ, 'dd/MM/yyyy');

  if (isFechamentoDia) {
    // Resumo com todas as filas: as que têm 0 aparecem como "0 erros encontrados"
    const linhasResumo = resumoFilas.map(f => f.total === 0
      ? `• ${f.titulo}: ✅ 0 erros encontrados`
      : `• ${f.titulo}: *${f.total} ticket(s)*`);
    falhasLeitura.forEach(f => linhasResumo.push(`• ${f.view.nome}: 🔴 não foi possível ler a view`));

    let resumo = `📊 *Fechamento Cancelamento (${janela} — ${dataFormatada})*\n`;
    resumo += somaTotalDia === 0
      ? `✅ Nenhum ticket registrado nos cenários hoje${falhasLeitura.length ? ' (nas views que puderam ser lidas)' : ''}.\n`
      : `*Total acumulado no dia: ${somaTotalDia} ticket(s)* em ${blocosMensagem.length} tema(s) — detalhes nas mensagens a seguir.\n`;
    resumo += linhasResumo.join('\n');
    mensagens.push(resumo);

    blocosMensagem.forEach(b => mensagens.push(
      `📊 *Fechamento Cancelamento (${janela} — ${dataFormatada}) — ${b.titulo}*\n${b.bloco}`));
  } else {
    blocosMensagem.forEach(b => mensagens.push(
      `🚨 *Alerta Cancelamento (${janela}) — ${b.titulo}*\n${b.bloco}`));
  }

  if (falhasLeitura.length > 0) {
    const linhas = falhasLeitura.map(f => {
      const linkView = `https://${subdomain}.zendesk.com/agent/filters/${f.view.id}`;
      return `• <${linkView}|${f.view.nome}> — ${f.erro}`;
    }).join('\n');
    mensagens.push(`🔴 *Alertas Cancelamento (${janela}) — falha ao ler ${falhasLeitura.length} view(s) no Zendesk*\n` +
      `Os números delas *não entraram* nesta rodada:\n${linhas}`);
  }

  if (mensagens.length === 0) {
    // 10h e 13h30 sem nenhuma fila com 5+ tickets e sem falhas: não envia nada
    Logger.log(`Janela ${janela}: nenhuma fila atingiu o mínimo de ${CFG.MIN_TICKETS} tickets.`);
    return;
  }

  // Tenta enviar todas; se alguma falhar, as outras ainda saem e a execução fica como Falha no fim
  const errosEnvio = [];
  mensagens.forEach((texto, i) => {
    try {
      enviarGoogleChat_(webhookUrl, texto);
    } catch (e) {
      Logger.log(`Mensagem ${i + 1} não enviada: ${e.message}`);
      errosEnvio.push(e.message);
    }
  });
  Logger.log(`Janela ${janela}: ${mensagens.length - errosEnvio.length} de ${mensagens.length} mensagem(ns) enviada(s).`);
  if (errosEnvio.length) {
    throw new Error(`${errosEnvio.length} mensagem(ns) não enviada(s) ao Google Chat. Primeiro erro: ${errosEnvio[0]}`);
  }
}

/* ---------- Consulta Paginada na View do Zendesk ---------- */
function buscarTicketsDaView_(subdomain, token, viewId) {
  let tickets = [];
  let url = `https://${subdomain}.zendesk.com/api/v2/views/${viewId}/tickets.json?per_page=100`;

  // Lança erro em qualquer falha (inclusive no meio da paginação), para não devolver leitura parcial.
  while (url) {
    let res = null;
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      try {
        res = UrlFetchApp.fetch(url, {
          method: 'get',
          headers: { 'Authorization': 'Bearer ' + token },
          muteHttpExceptions: true,
        });
      } catch (e) {
        res = null;
        if (tentativa === 2) throw new Error('erro de conexão com o Zendesk: ' + e.message);
      }
      const code = res ? res.getResponseCode() : 0;
      // Repete uma vez em limite de requisições (429) ou instabilidade (5xx)
      if (res && code !== 429 && code < 500) break;
      if (tentativa === 1) Utilities.sleep(3000);
    }

    const code = res.getResponseCode();
    if (code !== 200) {
      Logger.log(`Erro ao consultar view ${viewId} (${code}): ${res.getContentText().slice(0, 300)}`);
      const motivo = code === 401 || code === 403
        ? 'sem autorização (reautorizar o Zendesk no Apps Script)'
        : code === 404 ? 'view não encontrada' : 'erro da API';
      throw new Error(`HTTP ${code} — ${motivo}`);
    }

    const json = JSON.parse(res.getContentText());
    tickets = tickets.concat(json.tickets || []);
    url = json.next_page || null;
  }

  return tickets;
}

/* ---------- Classificação 3P (ID Sessão Mensageria vs Status Cancelamento) ---------- */
function lerCampoPersonalizado_(ticket, fieldId) {
  const campo = (ticket.custom_fields || []).find(f => Number(f.id) === Number(fieldId));
  return campo && campo.value !== null && String(campo.value).trim() !== ''
    ? String(campo.value).trim()
    : '';
}

function classificarTickets3PFalha_(tickets) {
  const comSessaoSemStatus = [];
  const demaisFalhas3P = [];

  tickets.forEach(t => {
    const idSessao = lerCampoPersonalizado_(t, CFG.CAMPO_ID_SESSAO_MENSAGERIA);
    const statusCancel = lerCampoPersonalizado_(t, CFG.CAMPO_STATUS_CANCELAMENTO);

    if (idSessao !== '' && statusCancel === '') {
      t._idSessao = idSessao;
      comSessaoSemStatus.push(t);
    } else {
      demaisFalhas3P.push(t);
    }
  });

  return { comSessaoSemStatus, demaisFalhas3P };
}

/* ---------- Formatação de Ticket ---------- */
function formatarCaso_(subdomain, t, viewId) {
  return {
    causas: causasCurtas_(t, viewId), // Diagnostico.gs
    ticket: t.id,
    link: `https://${subdomain}.zendesk.com/agent/tickets/${t.id}`,
    assunto: t.subject || 'Sem assunto',
    status: t.status || '',
    id_sessao: t._idSessao || lerCampoPersonalizado_(t, CFG.CAMPO_ID_SESSAO_MENSAGERIA),
    criado_em: Utilities.formatDate(new Date(t.created_at), CFG.TZ, 'dd/MM/yyyy HH:mm'),
    atualizado_em: Utilities.formatDate(new Date(t.updated_at), CFG.TZ, 'dd/MM/yyyy HH:mm'),
    tags: (t.tags || []).join(', '),
  };
}

/* ---------- Envio Google Chat ---------- */
function enviarGoogleChat_(webhookUrl, texto) {
  // Última proteção do limite de 4096 caracteres: corta em fim de linha
  if (texto.length > 4000) {
    texto = texto.slice(0, 3900).replace(/\n[^\n]*$/, '') + '\n_(mensagem cortada — veja a planilha ou a view)_';
  }
  // O webhook do Google Chat aceita ~1 mensagem por segundo por Space (acima disso, erro 429).
  // Espera entre envios e, em 429 ou 5xx, tenta de novo com espera crescente (2s, 5s, 10s).
  const ESPERAS_MS = [2000, 5000, 10000];
  let r = null;
  for (let tentativa = 0; tentativa <= ESPERAS_MS.length; tentativa++) {
    const desdeUltimo = Date.now() - ultimoEnvioChatMs_;
    if (desdeUltimo < 1500) Utilities.sleep(1500 - desdeUltimo);

    r = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: texto }),
      muteHttpExceptions: true,
    });
    ultimoEnvioChatMs_ = Date.now();

    const code = r.getResponseCode();
    if (code !== 429 && code < 500) break;
    if (tentativa < ESPERAS_MS.length) {
      Logger.log(`Google Chat respondeu ${code}; nova tentativa em ${ESPERAS_MS[tentativa] / 1000}s.`);
      Utilities.sleep(ESPERAS_MS[tentativa]);
    }
  }

  if (r.getResponseCode() >= 400) {
    throw new Error(`Falha ao postar no Google Chat (${r.getResponseCode()}): ${r.getContentText().slice(0, 300)}`);
  }
}
let ultimoEnvioChatMs_ = 0; // horário do último envio ao Google Chat nesta execução

/* ---------- Planilha (> 10 tickets) ---------- */
function criarPlanilha_(nomeFila, casos, incluirSessao) {
  const titulo = `${nomeFila} - ${Utilities.formatDate(new Date(), CFG.TZ, "dd/MM/yyyy HH'h'mm")}`;
  const ss = SpreadsheetApp.create(titulo);
  const sh = ss.getSheets()[0];

  const cab = incluirSessao
    ? ['Ticket', 'ID Sessão Mensageria', 'Link', 'Assunto', 'Possíveis causas', 'Status', 'Criado em', 'Atualizado em', 'Tags']
    : ['Ticket', 'Link', 'Assunto', 'Possíveis causas', 'Status', 'Criado em', 'Atualizado em', 'Tags'];

  const linhas = casos.map(c => incluirSessao
    ? [c.ticket, c.id_sessao, c.link, c.assunto, c.causas, c.status, c.criado_em, c.atualizado_em, c.tags]
    : [c.ticket, c.link, c.assunto, c.causas, c.status, c.criado_em, c.atualizado_em, c.tags]
  );

  sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
  sh.getRange(2, 1, linhas.length, cab.length).setValues(linhas);
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, cab.length);

  DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(CFG.PASTA_PLANILHAS_ID));
  return ss.getUrl();
}
