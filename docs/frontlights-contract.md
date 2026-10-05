# Contrato do RoadS com o Frontlights

O que o RoadS promete a quem o consome: o plugin Frontlights (`/update-roads`, o resumo para a diretoria) e os
scripts de envio e de anexo deste repositório (`scripts/progress/`). Este documento é o lado **servidor**. O
plugin tem o seu, escrito do ponto de vista de quem consome; **se os dois divergirem, o RoadS não decide sozinho:
abre-se uma issue no repositório do plugin** e o texto só muda depois da resposta.

**Plugin que entende este contrato:** a primeira versão do Frontlights que o cumpre como está aqui é a **0.18.0**
(confere a `schemaVersion`, se declara no `User-Agent`, lê `lane_id` e `from_lane_id` de `move_lane`, usa o
`weekMeeting` e a subpasta do último dia do período). Uma quebra futura só é publicada pelo RoadS depois de uma
versão do plugin que a entenda (seção 2).

Este repositório é público: aqui só há placeholders (`<origem>`), nunca endereço real, segredo, nome de pessoa ou
de cliente. O código que garante cada ponto está nos arquivos citados e é testado sem servidor.

## 1. Convenções

- **Base:** `<origem>/api/frontlights`.
- **Autenticação:** `Authorization: Bearer <segredo>`, o segredo compartilhado (`FRONTLIGHTS_API_SECRET`). Sem ele,
  ou com outro, a resposta é `401 { "schemaVersion": 1, "error": "unauthorized" }`. Não há sessão de usuário.
- **Corpo:** JSON, nos dois sentidos. Instantes são ISO 8601 **com fuso**, mas não todos no mesmo: `asOf`,
  `createdAt` e os carimbos do banco vêm em UTC (`…Z`); `window` vem no horário de São Paulo (`…-03:00`).
  Quem consome compara instantes, não textos. Datas de calendário (`startDate`, `weekMeeting`) são `AAAA-MM-DD`.
- **`schemaVersion`:** **toda** resposta JSON, erros incluídos (400, 401, 404, 409, 500), traz
  `"schemaVersion": 1`. O pedido de `POST /ack` e o de `POST /progress-report` podem trazer o campo; ausente vale
  1, e qualquer outro valor é recusado com `400 { "error": "unsupported_schema_version", "supported": 1 }` antes
  de qualquer outra coisa ser lida ou gravada.
- **Erro do servidor:** `500 { "schemaVersion": 1, "error": "internal_error" }`. Nada diz o que quebrou (tabela,
  SQL); os detalhes ficam só no log do servidor.
- **Nomes:** o estado do Roadmap e a fila usam `camelCase`. Os resumos de relatório de `GET /progress-report`
  (`draft`, `lastSent`) usam `snake_case`, como as colunas, e assim ficam: renomear seria uma quebra.
- **Fora do contrato:** a imagem pública do resumo (`/api/progress-report/<token>/<versão>/<arquivo>`) não é JSON
  e não tem `schemaVersion`.

## 2. Versão e aviso de quebra

O que **não quebra** (aditivo): campo novo opcional numa resposta, campo novo opcional num pedido, rota nova,
parâmetro novo opcional. Quem consome ignora campo que não conhece.

O que **quebra**: tirar ou renomear campo, mudar o tipo ou o sentido de um campo, mudar um código de status,
exigir um campo novo num pedido, e **acrescentar valor a um conjunto fechado** (seção 3).

Uma quebra segue sempre esta ordem, e só ela:

1. O RoadS decide a mudança e sobe a `schemaVersion`.
2. Abre uma **issue no repositório do plugin** descrevendo a quebra, antes de publicar qualquer coisa.
3. O **plugin que entende a versão nova é publicado primeiro**.
4. Só então o RoadS publica a quebra. **Não há duas versões servidas ao mesmo tempo**: um consumidor, um dono.

Uma mudança aditiva não pede issue, mas entra na seção 8 (histórico) deste documento.

## 3. Conjuntos fechados e abertos

| Campo | Valores hoje | Se aparecer um valor novo |
| --- | --- | --- |
| `status` de um item em `roadmap-state` | `open`, `development`, `blocker`, `done`, `none` | **fechado**: é uma quebra |
| `status` de uma entrega do resumo, **no pedido** | `concluido`, `em_validacao`, `em_andamento`, `bloqueado`, `proximo` | **fechado**: o RoadS recusa o valor desconhecido com `400` |
| `status` de uma entrega, **na resposta** (`lastSent.entries[]`) | os mesmos | **aberto**: quem consome tolera; um valor novo aceito pelo RoadS no pedido é aditivo |
| `action` de uma mudança em `pending-changes` | `add`, `modify`, `move_lane`, `remove` | **aberto**: quem consome trata como ação desconhecida, sem recusar a resposta |
| `reason` de `sync-board` quando `ok` é `false` | `not_configured`, `no_access`, `unauthenticated`, `error` | **aberto**: quem consome mostra a `message` |

## 4. As rotas do plugin

### `GET /roadmap-state`

O Roadmap como está agora, só leitura: não consome nada e nunca dá ack. É o conteúdo e o contexto para escrever
`ROADMAP.md` e os arquivos de sprint. Quem monta: `src/lib/roadmap-state.ts`.

```json
{
  "schemaVersion": 1,
  "asOf": "2026-03-05T12:00:00.000Z",
  "snapshotSyncedAt": "2026-03-05T11:00:00.000Z",
  "maxSprintItems": 4,
  "timezone": "America/Sao_Paulo",
  "sprints": [
    { "sprintId": "sprint-2026-03-02", "laneId": "…", "title": "…", "startDate": "2026-03-02", "endDate": "2026-03-06", "items": [ /* item + overLimit */ ] }
  ],
  "groups": [ { "laneId": "…", "title": "…", "items": [ /* item */ ] } ],
  "removedPending": [ { "changeId": "…", "itemId": null, "title": "…", "laneId": "…" } ]
}
```

- **item:** `id`, `position` (a partir de 1), `title`, `description`, `produto`, `prioridade`, `effort`,
  `githubIssueUrl` (ou `null`), `issueNumber` (ou `null`), `status` (seção 3), `done` (`status === "done"`),
  `updatedAt`, `pendingChangeIds` (as mudanças ainda sem ack que mexem nele). Um item de sprint traz também
  `overLimit`: `true` do quinto item em diante (`maxSprintItems` é 4).
- `sprintId` é `sprint-` mais a data de início: **muda quando os sprints rodam**, no fim da semana. Um sprint sem
  datas não aparece.
- `snapshotSyncedAt` é `null` enquanto o quadro nunca foi sincronizado; então todo `status` é `none`.
- Falha de leitura de qualquer tabela é `500`, nunca um Roadmap pela metade.

### `GET /pending-changes[?since=<ISO>]`

O que mudou e ainda não foi escrito nos arquivos. Quem monta: `src/lib/frontlights/queue.ts`.

```json
{ "schemaVersion": 1, "asOf": "2026-03-03T10:00:00.000Z", "changes": [
  { "id": "…", "itemId": "…", "action": "modify", "payload": {}, "createdAt": "…",
    "item": { "title": "…", "description": "…", "produto": "…", "prioridade": "…", "effort": "…",
              "githubIssueUrl": "…", "lane": "…", "laneId": "…" } }
] }
```

- `payload` é informativo e livre por ação (por exemplo `add`: `lane_id` e `title`; podem vir `reason` e
  `github_issue_url`): campo novo ali é aditivo. **Dois são contrato:** o de `remove` (`item_id`, `lane_id`,
  `title`) e o de `move_lane`, que traz **sempre** `lane_id` (a lane de destino) e `from_lane_id` (a de origem),
  seja o move de uma pessoa no app, a rotação dos sprints ou a separação por etiqueta de tipo (`title` e `reason`
  vêm junto, informativos). Os `move_lane` que já estavam na fila antes de 2026-10-05 podem não ter
  `from_lane_id` quando foram feitos por uma pessoa. O estado atual do item está em `item`.
- O `id` de cada mudança é um UUID gerado pelo banco. O prefixo `done-` é **reservado ao plugin** (ele monta ids
  próprios para registrar conclusões, que nunca são confirmadas ao RoadS): o RoadS nunca emite um id assim, e o
  plugin recusa a busca inteira se vier um.
- Em ordem de criação, só o que não teve ack; com `since`, só o criado **depois** dele. `since` que não é um
  ISO com fuso: `400 { "error": "since must be an ISO timestamp string" }`.
- Uma `remove` chega com `item` e `itemId` `null` (a linha sumiu); o `payload` traz `item_id`, `lane_id` e
  `title`. Qualquer outra mudança de um item apagado desde então não tem mais o que escrever e **não vem**.
- **`asOf`** é o `createdAt` da mudança pendente mais nova (nunca "agora", e conta também as que não vieram):
  `null` quando nada está pendente. Devolva-o ao `ack`; assim uma mudança que entrou entre a leitura e o ack não
  é engolida.

### `POST /ack`

`{ "asOf": "<ISO>", "schemaVersion": 1 }` (o segundo campo é opcional) → `200 { "schemaVersion": 1, "acked": 3 }`.
Fecha toda mudança pendente criada **até** `asOf`, inclusive; nada depois dele e nada que já tinha ack. Sem
`asOf` ISO: `400 { "error": "asOf must be an ISO timestamp string" }`. O RoadS só sabe que o ack chegou, não que
os arquivos foram escritos: **o ack é do plugin, depois de gravar**.

### `POST /sync-board`

Roda a mesma sincronização do botão Sincronizar (statuses do Project, retrato do Dashboard, issues abertas e
fechadas do Roadmap), sem corpo. A resposta é um resumo, nunca os cartões do quadro. Quem monta:
`src/lib/frontlights/sync.ts`.

```json
{ "schemaVersion": 1, "ok": true, "ran": true, "syncedAt": "…", "roadmap": { "added": 0, "removed": 0, "issuesCreated": 0 } }
```

- **Cooldown de 30 s**, o mesmo do botão e do cron diário (a cota do GitHub é compartilhada): uma segunda
  chamada em menos de 30 s não roda; responde do último retrato com `"ran": false` e `roadmap` zerado.
- Uma sincronização que falha é **`200`** com `{ "ok": false, "reason": "…", "message": "…" }` (seção 3), não um
  erro HTTP. `roadmap.error` aparece quando o quadro sincronizou e o Roadmap não.

## 5. As rotas do resumo para a diretoria

O formato do rascunho (`content`), os limites e as regras de texto estão em `docs/progress-draft.md`; aqui só o
que atravessa a porta. Quem faz o envio é o plugin, por `scripts/progress/push.ts`.

### `GET /progress-report`

```json
{
  "schemaVersion": 1,
  "weekMeeting": "2026-10-12",
  "window": { "start": "…", "end": "…" },
  "draft": { "id": "…", "period_start": "…", "period_end": "…", "pushed_at": "…", "rev": 0, "checked_at": null },
  "lastSent": { "id": "…", "period_start": "…", "period_end": "…", "pushed_at": "…", "rev": 5, "checked_at": "…", "entries": [ { "id": "…", "status": "concluido" } ] }
}
```

- `window` é o que coletar a seguir (a partir do fim do último enviado; num dia de envio, até agora). `draft` e
  `lastSent` são `null` quando não há. `lastSent.entries` é o que o último e-mail já contou, com as edições
  aplicadas, para o próximo não repetir.
- **`weekMeeting`** (`AAAA-MM-DD`, sempre uma segunda-feira, nunca `null`): a segunda-feira da reunião em que um
  resumo **desta janela** é apresentado. É a segunda-feira seguinte à semana (segunda a domingo, calendário de
  São Paulo) do **último instante** da janela; o fim é exclusivo, então uma janela que termina na segunda às
  00:00 é da semana que acabou, e o início não conta. Descreve **só** a `window` desta resposta: para outro
  período (um `--to` do usuário), quem consome calcula pela mesma regra. Regra em `src/lib/progress/week.ts`
  (`weekMeetingOf`). A pasta de prints que se nomeia a partir dela está em `docs/progress-draft.md`.

### `POST /progress-report`

`{ "schemaVersion": 1, "produto": "GeoCloud", "content": { … } }` (`schemaVersion` e `produto` opcionais; o
produto só pode ser `GeoCloud`). Até 4 MB.

- `200 { "schemaVersion": 1, "id": "…", "created": true, "url": "…" }`. Enviar de novo **atualiza** o `content` do
  rascunho e mantém as edições do usuário e o link das imagens; um novo envio invalida a conferência dos números.
- `400 { "error": "…" }`: o rascunho é inválido (a mensagem diz o **campo**, nunca o valor; a exceção são os
  números das issues de entregas sem print) ou fala outra `schemaVersion`.
- `409 { "error": "period_already_sent" | "concurrent_push" }`: o período já foi enviado e está congelado, ou dois
  envios se cruzaram.

### `POST /progress-report/shots`

`{ "data": "<base64>" }` → `200 { "schemaVersion": 1, "path": "<hash>.png", "mime": "image/png" }`. Um print por
chamada, **antes** do rascunho que o nomeia (o rascunho viaja só com os caminhos). JPEG ou PNG, conferido pelos
bytes, até 1 MB; guardado sob o hash dos bytes, então repetir o mesmo print é inofensivo. `400 { "error": "…" }`
quando não é imagem ou passa do limite.

### `POST /progress-report/<id>/shots`

`{ "shots": [ { "caption": "…", "mime": "image/png", "issue": 101, "path": "<hash>.png" } ] }` → `200
{ "schemaVersion": 1, "added": 2, "existing": 0 }`. Acrescenta prints a um resumo **já enviado** (de uma entrega,
com `issue`, ou gerais, sem); o texto, as situações, os números e os prints que ele já tinha não mudam, e um print
que já estava lá é pulado. `404 { "error": "not_found" }`, `409 { "error": "not_sent" | "concurrent_change" }`,
`400` para o corpo inválido.

## 6. O registro das chamadas

Toda chamada que passa pela checagem do segredo é registrada, depois de a resposta sair (nunca atrasa nem derruba a
chamada): **método, padrão da rota** (`/progress-report/[id]/shots`, nunca o endereço com o id), **status**,
**cliente declarado** (o cabeçalho `User-Agent`, limpo e cortado em 200 caracteres) e **duração** em milissegundos.
Nada do pedido: sem corpo, sem query string, sem endereço de quem chamou, nunca o segredo. As chamadas sem o
segredo (401) não são registradas, para ninguém de fora encher a tabela. Guardam-se **90 dias**; o cron diário
apaga o que passou disso. Só o serviço do RoadS lê e escreve a tabela (`frontlights_calls`).

**O limite:** o `User-Agent` é *declarado* pelo chamador. O registro mostra qual cliente e qual versão **disseram**
que chamaram, não quem tem o segredo. Provar quem chamou exigiria um segredo por consumidor, o que hoje não existe.

Os clientes se declaram assim: o plugin, `frontlights-roadmap-sync/<versão do plugin>`; os scripts deste
repositório, `roads-script/push` e `roads-script/attach`.

## 7. Onde está cada regra

| Rota | Regra (testada sem servidor) | Porta de entrada |
| --- | --- | --- |
| `roadmap-state` | `src/lib/frontlights/state.ts`, `src/lib/roadmap-state.ts` | `src/app/api/frontlights/roadmap-state/route.ts` |
| `pending-changes`, `ack` | `src/lib/frontlights/queue.ts` | `…/pending-changes/route.ts`, `…/ack/route.ts` |
| `sync-board` | `src/lib/frontlights/sync.ts`, `src/lib/sync-summary.ts` | `…/sync-board/route.ts` |
| rotas do resumo | `src/lib/progress/ingest.ts`, `draft.ts`, `shot-upload.ts`, `attach.ts` | `…/progress-report/**/route.ts` |
| versão, segredo, registro | `src/lib/frontlights/contract.ts`, `door.ts`, `calls.ts` | `src/lib/frontlights/doors.ts` |

## 8. Histórico

- **2026-09-28:** `pending-changes` (com `asOf`, sem as mudanças de item apagado) e `ack`.
- **2026-10-01:** as rotas do resumo (`GET` e `POST /progress-report`).
- **2026-10-02:** `roadmap-state` (`schemaVersion: 1`) e `sync-board`.
- **2026-10-05:** `POST /progress-report/shots` e `POST /progress-report/<id>/shots`; o print por entrega passa a
  ser obrigatório no rascunho (uma quebra do resumo, anterior a este documento).
- **2026-10-05 (aditivo):** `schemaVersion: 1` em toda resposta e campo opcional nos pedidos de `ack` e do
  rascunho; `weekMeeting` no `GET /progress-report`; registro das chamadas e `User-Agent` dos scripts.
- **2026-10-05:** o plugin **0.18.0** é publicado e passa a cumprir este contrato. Ele registra nos arquivos as
  conclusões (item de sprint com `done: true` em `roadmap-state`) a partir do estado, sem confirmá-las ao RoadS.
- **2026-10-05 (aditivo):** todo `move_lane` novo traz `from_lane_id` além de `lane_id`, inclusive o feito por uma
  pessoa no app (antes só vinha nos moves do sistema).
