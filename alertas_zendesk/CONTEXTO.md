# Contexto — [CX] Alertas Cancelamento (Zendesk → Google Chat)

> Atualizado em 27/11/2026. Projeto de monitoramento de tickets de cancelamento que ficam em "limbo" (não integraram, não chamaram gatilho, fora do prazo) nas Views do Zendesk, com alerta no Google Chat.

## 1. O que é

Um Google Apps Script consulta 5 Views do Zendesk três vezes ao dia e posta alertas no Space **"Alertas CX - Falha ao integrar tickets Cancelamento"**. Cada tema (fila) vai em uma mensagem própria, com os tickets, um link para a View e, acima de 10 tickets, um link para uma planilha com a lista completa.

## 2. Onde está cada coisa

| Item | Local |
|---|---|
| Projeto Apps Script | [CX] Alertas Cancelamento — https://script.google.com/home/projects/1R3ei4R0_sTT48KwJpRfCh_v04ZU2N3se4RElOLXl-MAEIPRrZhO9nq8L/edit |
| Código (2 arquivos) | `Código.gs` e `Diagnostico.gs` no projeto. Cópia local: `alertas_zendesk/apps_script/` |
| Testes locais | `node alertas_zendesk/testes/diagnostico.test.js` e `node alertas_zendesk/testes/simulacao.js <views.json> <janela>` (simula sem postar) |
| Biblioteca | OAuth2 (Google Apps Script OAuth2 library) |
| Space do Google Chat | "Alertas CX - Falha ao integrar tickets Cancelamento" — https://chat.google.com/room/AAQAizE500U |
| Pasta das planilhas (> 10 tickets) | Drive: "Alertas CX - Cancelamento 1P não integrado" — https://drive.google.com/drive/folders/1--VXH4k_EcQ76jMYn2ib_M-Vpj9GuxZ2 |
| Logs | Apps Script › Execuções (cada rodada registra o total de cada fila) |

## 3. Views monitoradas

| Fila | View ID | Tipo |
|---|---|---|
| 1P - Falha ao integrar no legado | 58898794602907 | padrão |
| 1P - Não chamou o gatilho no legado | 58898612845339 | padrão |
| 1P - Fora do prazo dos 7 dias pós entregue | 58898823649819 | padrão |
| 3P - Não chamou gatilho de integração | 58899130156699 | padrão |
| 3P - Falha ao integrar | 58898999335835 | `3p_falha` (dividida em 2 filas) |

**3P - Falha ao integrar** é dividida pelos campos personalizados:
- `ID Sessão Mensageria Seller` (43040646129691)
- `Status do cancelamento` (48507184478491)

Filas resultantes:
- **⚠️ 3P - Com ID Sessão Mensageria (Status Cancelamento vazio)**: tem ID de sessão e o status está vazio. A mensagem mostra o ID da sessão.
- **3P - Falha ao integrar (sem ID de sessão)**: todos os demais.

## 4. Regras de alerta

| Rodada | Gatilho | Tickets considerados | Quando posta |
|---|---|---|---|
| 10h | `alerta10h` | criados a partir de 19/11/2026 00:00 (BRT) | por fila com **5 ou mais** tickets |
| 13h30 | `alerta13h30` | criados a partir de 19/11/2026 00:00 (BRT) | por fila com **5 ou mais** tickets |
| 17h (fechamento) | `alerta17h` | criados **no dia** (00:00 BRT) | resumo com **todas as filas** (as zeradas aparecem como "✅ 0 erros encontrados") + uma mensagem por fila com **1 ou mais** |

- **Todos os dias, inclusive fim de semana** (decisão em 19/11).
- Os gatilhos do Apps Script disparam com folga de até ±15 min (fuso America/Sao_Paulo).
- Às 10h e 13h30, se nenhuma fila chega a 5 e não há falha, **nada é postado** (o resultado fica só no log).
- **Uma mensagem por tema.**
  - 10h e 13h30: `🚨 Alerta Cancelamento (janela) — <fila>`.
  - 17h: primeiro um resumo com o total do dia, depois uma mensagem por fila.
- Cada mensagem lista até **10 tickets** (número com link, assunto e data de criação) e o link da View.
- Cada ticket listado mostra as **possíveis causas** (⚠️) e a mensagem traz um resumo **🔎 Possíveis causas** com a contagem por causa (ver seção 4.1).
- **Acima de 10 tickets listados**, o script cria uma Planilha Google na pasta do Drive e põe o link na mensagem. A planilha tem as colunas Ticket, (ID Sessão), Link, Assunto, Possíveis causas, Status, Criado em, Atualizado em e Tags.

### 4.1 Possíveis causas (`Diagnostico.gs`)

| Causa | Regra |
|---|---|
| Assistência em andamento (30 dias), não pode ser cancelado | tag `dentro_do_prazo_30dias_assistencia` |
| Fora do prazo de 30 dias (Meli) | tag `fora_do_prazo_30dias_cancelamento_meli` |
| Pedido não integrado após 48h | tags `integracao_marvin_falha_pedido_nao_integrado` + `ticket_cancelamento_1p_resolvido_apos_48h_validacao_pedido_nao_integrado` |
| Motivo vazio | "Motivo - Cancelamento e Devolução" (33907416823451) |
| Submotivo vazio | campo de submotivo correspondente ao motivo (mapa `DIAG.SUBMOTIVO_POR_MOTIVO`); "Cliente não informou o motivo" não exige submotivo |
| Tipo de venda vazio / divergente | "Tipo de venda" (33462263487643). Views 1P aceitam MadeiraMadeira, CasaTema, MarketPlace e **Seller - Iguana Fix (é 1P)**; Views 3P aceitam Seller |
| Pedido Pai / Filho vazio ou inválido | 33462945946907 / 33669974881435: só números |
| SKU vazio ou fora do padrão | "SKU - Item e Quantidade" (33670027501339): itens `SKU-QTD` só com números, separados por vírgula, ponto e vírgula, quebra de linha ou espaço; quantidade > 0 |
| Motivo da falha da integração | tags `integracao_marvin_falha_pagamento_nao_efetuado`, `_pedido_analise_antifraude`, `_pedido_cancelado`; só `integracao_marvin_falha` = "falhou sem informar o motivo" |

### 4.2 Pedido não integrado (View 1P - Falha ao integrar no legado)

- Tickets com `integracao_marvin_falha_pedido_nao_integrado` **contam no total e no mínimo de 5** (decisão em 27/11), mas **não são listados** nem vão para a planilha. A mensagem mostra "📦 Total com pedido não integrado na view: X".
- Se também tiverem `ticket_cancelamento_1p_resolvido_apos_48h_validacao_pedido_nao_integrado`, voltam para a lista como problema.

### 4.3 Limite do Google Chat

- Mensagem com até 4096 caracteres. Se a lista passar de 2000 caracteres, as causas saem das linhas dos tickets (o resumo continua). Acima de 4000, a mensagem é cortada no fim de uma linha com aviso.

## 5. Falhas (avisadas no próprio Space)

- **Autorização do Zendesk** (sem acesso ou token com erro): posta `🔴 … falha de autorização no Zendesk` e encerra a rodada. Para reautorizar, rode `alerta10h` pelo editor e abra o link que aparece no Registro de execução. O link fica **só no log**, nunca no canal.
- **Leitura de uma View** (HTTP ≠ 200, erro de conexão, falha no meio da paginação):
  - O script tenta mais 1 vez em caso de 429 ou 5xx.
  - Se continuar falhando, a View fica **fora da rodada**, sem usar leitura parcial.
  - Sai uma mensagem `🔴 … falha ao ler N view(s)` com o link de cada View e o motivo (401/403 sem autorização, 404 View não encontrada, erro da API, erro de conexão).
- **Google Chat 429 (limite ~1 mensagem/s por Space):** o envio espera 1,5 s entre mensagens e repete em 429/5xx (2 s, 5 s, 10 s). Se ainda falhar, as demais mensagens saem e a execução fica como **Falha** no fim. Era a causa das falhas de 24 a 27/11.
- Outros erros (ex.: falha ao criar a planilha) aparecem como **Falha** em Execuções.

## 6. Credenciais

Ficam nas **Propriedades do script** (Configurações do projeto). São cadastradas pelo dono do projeto, **nunca no código, em arquivos ou no chat**:

| Propriedade | Uso |
|---|---|
| `ZENDESK_SUBDOMAIN` | subdomínio do Zendesk |
| `ZENDESK_CLIENT_ID` / `ZENDESK_CLIENT_SECRET` | cliente OAuth do Zendesk (escopo `read`) |
| `GCHAT_WEBHOOK` | webhook de entrada do Space de alertas |

O token OAuth do Zendesk (fluxo de autorização da biblioteca OAuth2) também fica salvo nas propriedades pela própria biblioteca.

## 7. Estrutura do código (`Código.gs`)

| Bloco | Função |
|---|---|
| `CFG` | Views, IDs de campos, data de início, mínimo (5), máximo listado (10), pasta, fuso |
| Gatilhos | `alerta10h`, `alerta13h30`, `alerta17h` → `executarAlerta_(janela, isFechamentoDia)` |
| OAuth | `getZendeskService`, `authCallback` |
| Fluxo principal | `executarAlerta_`: autorização → lê as Views → monta as filas → monta e envia as mensagens |
| Zendesk | `buscarTicketsDaView_` (paginada, com retry, lança erro em falha) |
| 3P | `lerCampoPersonalizado_`, `classificarTickets3PFalha_` |
| Saída | `formatarCaso_` (inclui `causas`), `enviarGoogleChat_` (limite 4096), `criarPlanilha_` |
| Diagnóstico (`Diagnostico.gs`) | `DIAG` (IDs e tags), `diagnosticarTicket_`, `separarNaoIntegrados_`, `blocoNaoIntegrado_`, `blocoCausas_`, `causasCurtas_` |

## 8. Como fazer manutenção

- **Nova causa:** incluir a regra em `diagnosticarTicket_` e o texto em `CAUSAS` (`Diagnostico.gs`), com teste em `diagnostico.test.js`.
- **Novo motivo com submotivo:** adicionar em `DIAG.SUBMOTIVO_POR_MOTIVO`.
- **Nova View:** adicionar `{ id, nome, tipo: 'padrao' }` em `CFG.VIEWS`. Ela vira uma fila e uma mensagem própria.
- **Mudar horários:** editar ou criar os gatilhos em Acionadores. Se criar um horário novo, crie também a função correspondente que chama `executarAlerta_`.
- **Testar:** **não há modo de teste sem postar.** Executar qualquer `alerta*` pelo editor posta no Space de verdade (decisão em 19/11).
- **Editar pelo agente (Claude):**
  - Ler o código copiando do editor (ctrl+a, ctrl+c) para um arquivo local. A leitura via JavaScript é bloqueada por conter URLs.
  - Antes de colar, conferir o SHA-256 do código no editor (Monaco) contra a última versão conhecida, para não sobrescrever mudanças feitas direto no editor.
  - Colar com ctrl+v, salvar e conferir o hash de novo.
  - Testar localmente com simulação em Node antes de aplicar (`alertas_zendesk/testes/`).

## 9. Histórico e decisões

| Data | Decisão |
|---|---|
| 19/11/2026 | V1 com 1 View (1P Falha ao integrar), script Python local + tarefas agendadas do Claude. Logo migrada para o Apps Script. As tarefas `alerta-cancelamento-1p-*` estão **pausadas e não devem ser reativadas**. |
| 19/11/2026 | Aviso diário de "script funcionando" para Pedro e Pamela: **descartado**, o acompanhamento é pelos logs de Execuções. |
| 19/11/2026 | Projeto ampliado para 5 Views (1P/3P), divisão do 3P por ID de sessão e fechamento das 17h. |
| 19/11/2026 | Roda também no fim de semana. Sem função de teste sem postar. |
| 19/11/2026 | Falhas de autorização e de leitura de View passam a ser avisadas no Space. |
| 19/11/2026 | Uma mensagem por tema (antes, um alerta juntava todas as filas). |
| 27/11/2026 | Diagnóstico de possíveis causas por ticket e resumo por fila (`Diagnostico.gs`). |
| 27/11/2026 | Pedido não integrado: só volume na View 1P Falha, mas conta no mínimo de 5; com a tag de 48h, é listado como problema. |
| 27/11/2026 | Seller - Iguana Fix é tratado como 1P na conferência de tipo de venda. |
| 27/11/2026 | Falhas de 24 a 27/11 eram 429 do Google Chat (mensagens rápidas demais). Envio passou a esperar entre mensagens e repetir. |
| 27/11/2026 | Fechamento 17h lista todas as filas, com "✅ 0 erros encontrados" nas zeradas. |

## 10. Pendências

- Compartilhar a **pasta das planilhas** com quem está no Space. Sem isso, o link da planilha (> 10 tickets) só abre para o dono.
