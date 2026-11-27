/**
 * [CX] Alertas Cancelamento — Diagnóstico de possíveis causas
 *
 * Arquivo separado do Código.gs. No Apps Script, todos os .gs do projeto
 * compartilham o mesmo escopo, então basta criar este arquivo no editor
 * (+ › Script › "Diagnostico") e chamar as funções públicas no Código.gs:
 *
 *   diagnosticarTicket_(ticket)          -> { causas: [...], naoIntegrado, naoIntegradoProblema }
 *   separarNaoIntegrados_(tickets, view) -> { listar: [...], naoIntegrados: [...] }
 *   blocoNaoIntegrado_(separacao)        -> texto ("" se não se aplica)
 *   blocoCausas_(tickets)                -> texto com o resumo de causas da fila
 *   causasCurtas_(ticket)                -> texto curto para a linha do ticket / coluna da planilha
 *
 * O ticket esperado é o objeto devolvido por /api/v2/views/{id}/tickets.json
 * (precisa de `id`, `tags` e `custom_fields`). Nenhuma chamada extra à API.
 */

var DIAG = {
  CAMPOS: {
    MOTIVO: 33907416823451,          // Motivo - Cancelamento e Devolução
    TIPO_VENDA: 33462263487643,      // Tipo de venda
    PEDIDO_PAI: 33462945946907,      // Pedido Pai
    PEDIDO_FILHO: 33669974881435,    // Pedido Filho
    SKU: 33670027501339              // SKU - Item e Quantidade
  },

  // Motivo (valor da opção) -> campo de submotivo que precisa estar preenchido.
  // "Cliente não informou o motivo" não tem submotivo, por isso não está aqui.
  SUBMOTIVO_POR_MOTIVO: {
    'categoria_cancelamento_do_produto': { id: 33907724842779, nome: 'Problemas com o produto' },
    'ticket_field_motivo_cancelamento_devolucao_problemas_com_a_entrega': { id: 35266035204763, nome: 'Problemas com a entrega' },
    'ticket_field_motivo_cancelamento_devolucao_problemas_com_o_pagamento': { id: 35266142305819, nome: 'Problemas com o pagamento' },
    'ticket_field_motivo_cancelamento_devolucao_ocorrencia_interna_ocultar': { id: 35265852032027, nome: 'Ocorrência' },
    'categoria_contestacao_de_pagamento_e_fraude_ocultar': { id: 33907924388379, nome: 'Contestação de pagamento e fraude' },
    'categoria_cancelamento_de_servicos_ocultar': { id: 33908037692187, nome: 'Cancelar serviços' },
    'categoria_ocorrencia_interna_-_aviso_de_cancelamento_ocultar': { id: 35157972595739, nome: 'Aviso de cancelamento' },
    'ticket_field_motivo_excecao_de_cancelamento_ocultar': { id: 49390347119259, nome: '[Causa Raíz] Exceção de cancelamento' }
  },

  TAGS: {
    NAO_INTEGRADO: 'integracao_marvin_falha_pedido_nao_integrado',
    NAO_INTEGRADO_APOS_48H: 'ticket_cancelamento_1p_resolvido_apos_48h_validacao_pedido_nao_integrado',
    ASSISTENCIA_30D: 'dentro_do_prazo_30dias_assistencia',
    FORA_30D_MELI: 'fora_do_prazo_30dias_cancelamento_meli',
    FALHA_GENERICA: 'integracao_marvin_falha'
  },

  // Motivo de falha que a integração (Marvin) devolve como tag.
  // pedido_nao_integrado fica de fora: ele tem tratamento próprio.
  FALHAS_INTEGRACAO: {
    'integracao_marvin_falha_pagamento_nao_efetuado': 'Integração: pagamento não efetuado',
    'integracao_marvin_falha_pedido_analise_antifraude': 'Integração: pedido em análise antifraude',
    'integracao_marvin_falha_pedido_cancelado': 'Integração: pedido já cancelado'
  },

  // View em que "pedido não integrado" não é listado, só contado.
  VIEWS_NAO_INTEGRADO: [58898794602907], // 1P - Falha ao integrar no legado

  // Valores de "Tipo de venda" aceitos em cada View.
  // Seller - Iguana Fix (ticket_field_tipo_de_venda_3p_iguanafix) é 1P, apesar do "3p" no valor.
  TIPOS_VENDA_1P: [
    'ticket_field_tipo_de_venda_1p', 'ticket_field_tipo_de_venda_1p_casatema',
    'ticket_field_tipo_de_venda_1p_marketplace', 'ticket_field_tipo_de_venda_3p_iguanafix'
  ],
  TIPOS_VENDA_3P: ['ticket_field_tipo_de_venda_3p'],
  TIPO_VENDA_ESPERADO: {
    58898794602907: '1P', 58898612845339: '1P', 58898823649819: '1P',
    58899130156699: '3P', 58898999335835: '3P'
  },

  MAX_TICKETS_POR_CAUSA: 5 // quantos números aparecem ao lado de cada causa no resumo
};

// Ordem e texto das causas (a chave é usada no resumo e na planilha)
var CAUSAS = {
  ASSISTENCIA_30D:       { ordem: 1,  texto: 'Assistência em andamento (dentro de 30 dias) — não pode ser cancelado', curto: 'assistência 30d' },
  FORA_30D_MELI:         { ordem: 2,  texto: 'Fora do prazo de 30 dias (Meli)', curto: 'fora 30d Meli' },
  NAO_INTEGRADO_48H:     { ordem: 3,  texto: 'Pedido não integrado mesmo após a validação de 48h', curto: 'não integrado após 48h' },
  MOTIVO_VAZIO:          { ordem: 4,  texto: 'Motivo do cancelamento vazio', curto: 'motivo vazio' },
  SUBMOTIVO_VAZIO:       { ordem: 5,  texto: 'Submotivo vazio', curto: 'submotivo vazio' },
  TIPO_VENDA_VAZIO:      { ordem: 6,  texto: 'Tipo de venda vazio', curto: 'tipo de venda vazio' },
  TIPO_VENDA_DIVERGENTE: { ordem: 7,  texto: 'Tipo de venda não bate com a fila (1P × 3P)', curto: 'tipo de venda divergente' },
  PEDIDO_PAI_VAZIO:      { ordem: 8,  texto: 'Pedido Pai vazio', curto: 'pedido pai vazio' },
  PEDIDO_PAI_INVALIDO:   { ordem: 9,  texto: 'Pedido Pai com letra ou caractere', curto: 'pedido pai inválido' },
  PEDIDO_FILHO_VAZIO:    { ordem: 10, texto: 'Pedido Filho vazio', curto: 'pedido filho vazio' },
  PEDIDO_FILHO_INVALIDO: { ordem: 11, texto: 'Pedido Filho com letra ou caractere', curto: 'pedido filho inválido' },
  SKU_VAZIO:             { ordem: 12, texto: 'SKU vazio', curto: 'SKU vazio' },
  SKU_INVALIDO:          { ordem: 13, texto: 'SKU fora do padrão SKU-Quantidade (ex.: 12345-1)', curto: 'SKU fora do padrão' },
  FALHA_PAGAMENTO:       { ordem: 14, texto: 'Integração: pagamento não efetuado', curto: 'pagamento não efetuado' },
  FALHA_ANTIFRAUDE:      { ordem: 15, texto: 'Integração: pedido em análise antifraude', curto: 'antifraude' },
  FALHA_CANCELADO:       { ordem: 16, texto: 'Integração: pedido já cancelado', curto: 'pedido já cancelado' },
  FALHA_SEM_MOTIVO:      { ordem: 17, texto: 'Integração falhou sem informar o motivo', curto: 'falha sem motivo' }
};

var CAUSA_POR_TAG_FALHA_ = {
  'integracao_marvin_falha_pagamento_nao_efetuado': 'FALHA_PAGAMENTO',
  'integracao_marvin_falha_pedido_analise_antifraude': 'FALHA_ANTIFRAUDE',
  'integracao_marvin_falha_pedido_cancelado': 'FALHA_CANCELADO'
};

// ---------------------------------------------------------------- validação

function diagValorCampo_(ticket, id) {
  var cf = ticket.custom_fields || [];
  for (var i = 0; i < cf.length; i++) {
    if (Number(cf[i].id) === Number(id)) return cf[i].value;
  }
  return null;
}

function diagVazio_(v) {
  return v === null || v === undefined || v === false || String(v).trim() === '';
}

/** Pedido Pai/Filho: só dígitos (espaços nas pontas são tolerados). */
function pedidoValido_(v) {
  return /^\d+$/.test(String(v).trim());
}

/**
 * SKU - Item e Quantidade: um ou mais itens "SKU-QTD", só números,
 * separados por vírgula, ponto e vírgula, quebra de linha ou espaço.
 * Ex. válidos: "12345-1", "12345-1, 67890-2". Inválidos: "12345", "12345- 1", "ABC-1", texto livre.
 */
function skuValido_(v) {
  var itens = String(v).trim().split(/\s*[,;\n]\s*|\s+(?=\d+-\d+)/);
  if (!itens.length) return false;
  for (var i = 0; i < itens.length; i++) {
    var m = /^(\d+)-(\d+)$/.exec(itens[i]);
    if (!m || Number(m[2]) === 0) return false;
  }
  return true;
}

/**
 * Analisa um ticket e devolve as possíveis causas encontradas.
 * @param {Object} ticket ticket da API
 * @param {number=} viewId View de origem (para conferir 1P × 3P)
 */
function diagnosticarTicket_(ticket, viewId) {
  var tags = ticket.tags || [];
  var tem = function (t) { return tags.indexOf(t) !== -1; };
  var causas = [];
  var C = DIAG.CAMPOS;

  if (tem(DIAG.TAGS.ASSISTENCIA_30D)) causas.push('ASSISTENCIA_30D');
  if (tem(DIAG.TAGS.FORA_30D_MELI)) causas.push('FORA_30D_MELI');

  var naoIntegrado = tem(DIAG.TAGS.NAO_INTEGRADO);
  var naoIntegradoProblema = naoIntegrado && tem(DIAG.TAGS.NAO_INTEGRADO_APOS_48H);
  if (naoIntegradoProblema) causas.push('NAO_INTEGRADO_48H');

  // Motivo / submotivo
  var motivo = diagValorCampo_(ticket, C.MOTIVO);
  if (diagVazio_(motivo)) {
    causas.push('MOTIVO_VAZIO');
  } else {
    var sub = DIAG.SUBMOTIVO_POR_MOTIVO[motivo];
    if (sub && diagVazio_(diagValorCampo_(ticket, sub.id))) causas.push('SUBMOTIVO_VAZIO');
  }

  // Tipo de venda
  var tipo = diagValorCampo_(ticket, C.TIPO_VENDA);
  if (diagVazio_(tipo)) {
    causas.push('TIPO_VENDA_VAZIO');
  } else if (viewId && DIAG.TIPO_VENDA_ESPERADO[viewId]) {
    var aceitos = DIAG.TIPO_VENDA_ESPERADO[viewId] === '1P' ? DIAG.TIPOS_VENDA_1P : DIAG.TIPOS_VENDA_3P;
    if (aceitos.indexOf(String(tipo)) === -1) causas.push('TIPO_VENDA_DIVERGENTE');
  }

  // Pedidos
  var pai = diagValorCampo_(ticket, C.PEDIDO_PAI);
  if (diagVazio_(pai)) causas.push('PEDIDO_PAI_VAZIO');
  else if (!pedidoValido_(pai)) causas.push('PEDIDO_PAI_INVALIDO');

  var filho = diagValorCampo_(ticket, C.PEDIDO_FILHO);
  if (diagVazio_(filho)) causas.push('PEDIDO_FILHO_VAZIO');
  else if (!pedidoValido_(filho)) causas.push('PEDIDO_FILHO_INVALIDO');

  // SKU
  var sku = diagValorCampo_(ticket, C.SKU);
  if (diagVazio_(sku)) causas.push('SKU_VAZIO');
  else if (!skuValido_(sku)) causas.push('SKU_INVALIDO');

  // Motivo da falha devolvido pela integração
  var achouFalha = false;
  Object.keys(CAUSA_POR_TAG_FALHA_).forEach(function (tag) {
    if (tem(tag)) { causas.push(CAUSA_POR_TAG_FALHA_[tag]); achouFalha = true; }
  });
  if (tem(DIAG.TAGS.FALHA_GENERICA) && !achouFalha && !naoIntegrado) causas.push('FALHA_SEM_MOTIVO');

  return { causas: causas, naoIntegrado: naoIntegrado, naoIntegradoProblema: naoIntegradoProblema };
}

// ------------------------------------------------- pedido não integrado (1P)

/**
 * Na View "1P - Falha ao integrar no legado", tira da lista os tickets com
 * a tag integracao_marvin_falha_pedido_nao_integrado. Eles só são contados.
 * Exceção: se também tiver a tag de "resolvido após 48h", continua na lista,
 * porque aí é problema (já deveria ter integrado).
 * Em outras Views, devolve tudo em `listar`.
 */
function separarNaoIntegrados_(tickets, viewId) {
  var out = { listar: [], naoIntegrados: [], aplica: DIAG.VIEWS_NAO_INTEGRADO.indexOf(Number(viewId)) !== -1 };
  tickets.forEach(function (t) {
    var d = diagnosticarTicket_(t, viewId);
    if (out.aplica && d.naoIntegrado) out.naoIntegrados.push(t);
    if (out.aplica && d.naoIntegrado && !d.naoIntegradoProblema) return;
    out.listar.push(t);
  });
  return out;
}

/** Linha de volume de "pedido não integrado" (vazia se a View não se aplica ou não há nenhum). */
function blocoNaoIntegrado_(sep) {
  if (!sep.aplica || !sep.naoIntegrados.length) return '';
  var comProblema = sep.naoIntegrados.filter(function (t) {
    return (t.tags || []).indexOf(DIAG.TAGS.NAO_INTEGRADO_APOS_48H) !== -1;
  }).length;
  var txt = '📦 *Total com pedido não integrado na view: ' + sep.naoIntegrados.length + '* (não listados)';
  if (comProblema) txt += '\n⚠️ Desses, *' + comProblema + '* seguem sem integrar após a validação de 48h e estão na lista abaixo.';
  return txt;
}

// ------------------------------------------------------------- saída texto

/** Resumo das causas da fila, para ir na mensagem do Google Chat. */
function blocoCausas_(tickets, viewId, subdominio) {
  var porCausa = {};
  var semCausa = 0;
  tickets.forEach(function (t) {
    var d = diagnosticarTicket_(t, viewId);
    if (!d.causas.length) { semCausa++; return; }
    d.causas.forEach(function (c) { (porCausa[c] = porCausa[c] || []).push(t.id); });
  });
  var chaves = Object.keys(porCausa).sort(function (a, b) { return CAUSAS[a].ordem - CAUSAS[b].ordem; });
  if (!chaves.length) return '🔎 *Possíveis causas:* nenhuma identificada automaticamente.';

  var linhas = ['🔎 *Possíveis causas* (um ticket pode ter mais de uma):'];
  chaves.forEach(function (c) {
    var ids = porCausa[c];
    var amostra = ids.slice(0, DIAG.MAX_TICKETS_POR_CAUSA).map(function (id) {
      return subdominio ? '<https://' + subdominio + '.zendesk.com/agent/tickets/' + id + '|#' + id + '>' : '#' + id;
    }).join(', ');
    var resto = ids.length > DIAG.MAX_TICKETS_POR_CAUSA ? ' e +' + (ids.length - DIAG.MAX_TICKETS_POR_CAUSA) : '';
    linhas.push('• ' + CAUSAS[c].texto + ': *' + ids.length + '* — ' + amostra + resto);
  });
  if (semCausa) linhas.push('• Sem causa identificada: *' + semCausa + '*');
  return linhas.join('\n');
}

/** Causas em poucas palavras, para a linha do ticket e para a coluna da planilha. */
function causasCurtas_(ticket, viewId) {
  return diagnosticarTicket_(ticket, viewId).causas
    .sort(function (a, b) { return CAUSAS[a].ordem - CAUSAS[b].ordem; })
    .map(function (c) { return CAUSAS[c].curto; })
    .join('; ');
}

// Para os testes em Node (no Apps Script, `module` não existe e isto é ignorado)
if (typeof module !== 'undefined') {
  module.exports = {
    DIAG: DIAG, CAUSAS: CAUSAS, diagnosticarTicket_: diagnosticarTicket_, separarNaoIntegrados_: separarNaoIntegrados_,
    blocoNaoIntegrado_: blocoNaoIntegrado_, blocoCausas_: blocoCausas_, causasCurtas_: causasCurtas_,
    skuValido_: skuValido_, pedidoValido_: pedidoValido_
  };
}
