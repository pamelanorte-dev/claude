// Simula uma rodada do Apps Script em Node, sem postar nada.
// Uso: node alertas_zendesk/testes/simulacao.js <views.json> [10h00|13h30|17h00]
// views.json: { "<viewId>": [tickets...] } ou { "<qualquer>": [...] } na ordem de CFG.VIEWS
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const [arq, janela = '10h00'] = process.argv.slice(2);
const dados = JSON.parse(fs.readFileSync(arq, 'utf8'));
const listas = Object.values(dados);
const enviados = [], planilhas = [];

const fmt = (d, tz, p) => {
  const s = new Date(d.getTime() - 3 * 3600e3).toISOString(); // BRT fixo
  const [Y, M, D, h, m] = [s.slice(0, 4), s.slice(5, 7), s.slice(8, 10), s.slice(11, 13), s.slice(14, 16)];
  return p.replace('yyyy', Y).replace('MM', M).replace('dd', D).replace('HH', h).replace('mm', m).replace(/'h'/, 'h');
};
const ctx = {
  console, Logger: { log: m => console.log('[log] ' + m) },
  Utilities: { formatDate: fmt, sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => ({ ZENDESK_SUBDOMAIN: process.env.SUBDOMINIO || 'exemplo', GCHAT_WEBHOOK: 'https://chat.invalid/hook' })[k] }) },
  OAuth2: { createService: () => new Proxy({}, { get: (_, k) => k === 'hasAccess' ? () => true : k === 'getAccessToken' ? () => 'tok' : function () { return this; } }) },
  UrlFetchApp: { fetch: (url, opt) => {
    if (opt.method === 'post') { enviados.push(JSON.parse(opt.payload).text); return { getResponseCode: () => 200 }; }
    const id = Number(/views\/(\d+)/.exec(url)[1]);
    const i = ctx.CFG.VIEWS.findIndex(v => v.id === id);
    const tickets = dados[id] || listas[i] || [];
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ tickets, next_page: null }) };
  } },
  SpreadsheetApp: { create: t => { const p = { titulo: t }; planilhas.push(p); const rng = { setValues: v => { (p.linhas = p.linhas || []).push(...v); return rng; }, setFontWeight: () => rng };
    return { getId: () => 'x', getUrl: () => 'https://docs.invalid/planilha', getSheets: () => [{ getRange: () => rng, setFrozenRows() {}, autoResizeColumns() {} }] }; } },
  DriveApp: { getFileById: () => ({ moveTo() {} }), getFolderById: () => ({}) },
};
vm.createContext(ctx);
const dir = path.join(__dirname, '../apps_script');
vm.runInContext(fs.readFileSync(path.join(dir, 'Diagnostico.gs'), 'utf8') + '\n' +
  fs.readFileSync(path.join(dir, 'Codigo.gs'), 'utf8') + '\nthis.CFG = CFG; this.executarAlerta_ = executarAlerta_;', ctx);
ctx.executarAlerta_(janela, janela === '17h00');

enviados.forEach((t, i) => console.log(`\n===== mensagem ${i + 1} (${t.length} caracteres) =====\n${t}`));
planilhas.forEach(p => console.log(`\n[planilha] ${p.titulo}: cabeçalho = ${p.linhas[0].join(' | ')}; ${p.linhas.length - 1} linhas`));
const max = Math.max(0, ...enviados.map(t => t.length));
console.log(`\nmaior mensagem: ${max} caracteres (limite do Google Chat: 4096)`);
if (max > 4096) process.exitCode = 1;
