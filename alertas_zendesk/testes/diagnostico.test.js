// Rodar: node alertas_zendesk/testes/diagnostico.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const m = {}; // carrega o .gs como módulo
new Function('module', fs.readFileSync(path.join(__dirname, '../apps_script/Diagnostico.gs'), 'utf8'))({ set exports(v) { Object.assign(m, v); } });

const V1P = 58898794602907, V3P = 58898999335835;
const cf = o => Object.entries(o).map(([id, value]) => ({ id: Number(id), value }));
const base = (extra = {}, tags = []) => ({
  id: 1, tags,
  custom_fields: cf(Object.assign({
    33907416823451: 'categoria_cancelamento_do_produto', 33907724842779: 'x',
    33462263487643: 'ticket_field_tipo_de_venda_1p', 33462945946907: '123456', 33669974881435: '654321',
    33670027501339: '12345-1'
  }, extra))
});
const causas = (t, v = V1P) => m.diagnosticarTicket_(t, v).causas;

// ticket limpo
assert.deepStrictEqual(causas(base()), []);
// SKU
['12345-1', '12345-1, 678-2', '1-1,2-2;3-3', '1-1 2-2 3-3', '1-1\n2-2'].forEach(s => assert(m.skuValido_(s), s));
['12345', '12345- 1', 'ABC-1', '12345-0', 'Guarda-Roupa 3 portas', '1-1,,2-2', '12345-1x'].forEach(s => assert(!m.skuValido_(s), s));
// pedidos
assert(m.pedidoValido_('123')); assert(m.pedidoValido_(' 123 '));
['R66794200', 'Z68122866', 'false', '12-3', '12 3'].forEach(s => assert(!m.pedidoValido_(s), s));
assert.deepStrictEqual(causas(base({ 33669974881435: 'R66794200', 33462945946907: null })), ['PEDIDO_PAI_VAZIO', 'PEDIDO_FILHO_INVALIDO']);
// motivo / submotivo / tipo de venda
assert.deepStrictEqual(causas(base({ 33907416823451: null })), ['MOTIVO_VAZIO']);
assert.deepStrictEqual(causas(base({ 33907724842779: null })), ['SUBMOTIVO_VAZIO']);
assert.deepStrictEqual(causas(base({ 33907416823451: 'ticket_field_motivo_cliente_nao_informou_o_motivo_de_cancelamento_ocultar' })), []);
assert.deepStrictEqual(causas(base({ 33462263487643: '' })), ['TIPO_VENDA_VAZIO']);
assert.deepStrictEqual(causas(base(), V3P), ['TIPO_VENDA_DIVERGENTE']);
assert.deepStrictEqual(causas(base({ 33462263487643: 'ticket_field_tipo_de_venda_1p_marketplace' })), []);
// Seller - Iguana Fix é 1P
assert.deepStrictEqual(causas(base({ 33462263487643: 'ticket_field_tipo_de_venda_3p_iguanafix' })), []);
assert.deepStrictEqual(causas(base({ 33462263487643: 'ticket_field_tipo_de_venda_3p_iguanafix' }), V3P), ['TIPO_VENDA_DIVERGENTE']);
assert.deepStrictEqual(causas(base({ 33462263487643: 'ticket_field_tipo_de_venda_3p' }), V3P), []);
// tags
assert.deepStrictEqual(causas(base({}, ['dentro_do_prazo_30dias_assistencia'])), ['ASSISTENCIA_30D']);
assert.deepStrictEqual(causas(base({}, ['integracao_marvin_falha'])), ['FALHA_SEM_MOTIVO']);
assert.deepStrictEqual(causas(base({}, ['integracao_marvin_falha', 'integracao_marvin_falha_pagamento_nao_efetuado'])), ['FALHA_PAGAMENTO']);

// pedido não integrado: só conta na View 1P Falha; com a tag de 48h, volta para a lista
const ni = { ...base({}, ['integracao_marvin_falha', 'integracao_marvin_falha_pedido_nao_integrado']), id: 10 };
const ni48 = { ...base({}, ['integracao_marvin_falha_pedido_nao_integrado', 'ticket_cancelamento_1p_resolvido_apos_48h_validacao_pedido_nao_integrado']), id: 11 };
const normal = { ...base(), id: 12 };
let sep = m.separarNaoIntegrados_([ni, ni48, normal], V1P);
assert.deepStrictEqual(sep.listar.map(t => t.id), [11, 12]);
assert.strictEqual(sep.naoIntegrados.length, 2);
assert(m.blocoNaoIntegrado_(sep).includes('Total com pedido não integrado na view: 2'));
assert(m.blocoNaoIntegrado_(sep).includes('*1* seguem sem integrar'));
sep = m.separarNaoIntegrados_([ni, ni48, normal], V3P);
assert.strictEqual(sep.listar.length, 3); assert.strictEqual(m.blocoNaoIntegrado_(sep), '');
assert.deepStrictEqual(causas(ni48), ['NAO_INTEGRADO_48H']);

// resumo
const txt = m.blocoCausas_([ni48, normal, { ...base({ 33670027501339: '999' }), id: 13 }], V1P, 'sub');
assert(txt.includes('SKU fora do padrão') && txt.includes('<https://sub.zendesk.com/agent/tickets/13|#13>'));
assert(txt.includes('Sem causa identificada: *1*'));
assert.strictEqual(m.causasCurtas_({ ...base({ 33670027501339: '999', 33462945946907: 'A1' }) }, V1P), 'pedido pai inválido; SKU fora do padrão');
console.log('ok: todos os testes passaram');
