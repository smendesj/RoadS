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
| `origin` do `payload` de um `move_lane` | `app`, `rotation`, `label`, `project` | **aberto**: um valor novo é aditivo; quem consome trata o desconhecido como informativo |

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
    { "sprintId": "sprint-02-03-2026", "laneId": "sprint-02-03-2026", "title": "Sprint 02–06/03", "startDate": "2026-03-02", "endDate": "2026-03-06", "items": [ /* item + overLimit */ ] }
  ],
  "groups": [ { "laneId": "…", "title": "…", "items": [ /* item */ ] } ],
  "removedPending": [ { "changeId": "…", "itemId": null, "title": "…", "laneId": "…" } ]
}
```

- **item:** `id`, `position` (a partir de 1), `title`, `description`, `produto`, `prioridade`, `effort`,
  `githubIssueUrl` (ou `null`), `issueNumber` (ou `null`), `status` (seção 3), `done` (`status === "done"`),
  `updatedAt`, `pendingChangeIds` (as mudanças ainda sem ack que mexem nele). Um item de sprint traz também
  `overLimit`: `true` do quinto item em diante (`maxSprintItems` é 4).
- **Cada sprint é uma semana.** `sprintId` é `sprint-` mais a segunda-feira em `DD-MM-AAAA`
  (`sprint-02-03-2026`) e não muda quando a semana vira. `laneId` é o id da lane, que é o mesmo `sprint-DD-MM-AAAA`
  (enquanto o banco ainda tiver as lanes posicionais de antes da migração 0031, `laneId` é o id dela, `atual`,
  `proxima` ou `terceira`, e o `sprintId` já vem pela data). `title` são só as datas (`"Sprint 02–06/03"`).
  `sprints[]` traz quantas semanas houver, na ordem da data de início, nunca do texto do id. Um sprint sem datas
  não aparece. A semana atual é a que contém hoje no fuso de `timezone` (no fim de semana, a que começa na segunda
  seguinte); não há campo para ela.
- **Quais semanas.** `sprints[]` traz só: a semana atual, sempre (mesmo vazia e mesmo sem lane); toda lane de semana
  com item, passada ou futura; e toda semana citada por uma mudança ainda sem ack, com a lane guardada vazia ou já
  apagada (uma lane posicional nunca é apagada ao esvaziar: fica guardada, vazia, até a 0031 traduzi-la). Citar é
  ter o id em `payload.lane_id` de um `add`, `remove` ou `move_lane`, ou em
  `payload.from_lane_id` de um `move_lane`. Uma lane guardada vazia que não é a atual nem é citada fica de fora. A
  semana citada cuja lane já não existe (a futura que perdeu o último item, porque a lane é apagada quando esvazia,
  e a que a virada encerrou e apagou) vem com `items: []`, `sprintId` e `laneId` iguais ao id citado, `startDate`
  na segunda e `endDate` na sexta tiradas do id e `title` pelas datas. Depois do ack, a semana deixa de ser citada
  e some na resposta seguinte. Para semana sem lane, só entra id `sprint-DD-MM-AAAA` de uma segunda-feira real
  (ids posicionais, lanes de tipo, grupos e `zz-test-*` ficam de fora), e uma semana que já tem lane nunca vem
  duas vezes. As semanas vazias que só a tela mostra (a do fim, para receber o próximo arraste, e os buracos no
  meio) nunca entram.
- **Ordem dos itens.** `position` segue o `sort_order` gravado; no empate, o id do item, a mesma ordem em que o
  Roadmap e o Dashboard mostram a semana.
- `removedPending[].laneId` de um item que saiu de uma sprint também vem como `sprint-DD-MM-AAAA`.
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
  seja o move de uma pessoa no app, a rotação dos sprints, a separação por etiqueta de tipo ou o que o Project
  ditou (`title` e `reason` vêm junto, informativos). Os `move_lane` que já estavam na fila antes de 2026-10-05
  podem não ter `from_lane_id` quando foram feitos por uma pessoa. O estado atual do item está em `item`.
- **`origin`** (opcional, informativo, no `payload` de um `move_lane`): quem fez o move. `"app"` (uma pessoa no
  app), `"rotation"` (a rotação dos sprints), `"label"` (a separação por etiqueta de tipo) ou `"project"` (o
  Project ditou). Os `move_lane` enfileirados antes de 2026-10-06 não o trazem; é um conjunto aberto (seção 3).
  **Um `move_lane` com `origin` `"project"` é escrito nos arquivos `.md` como qualquer outro e nunca deve ser
  aplicado de volta ao Project:** é de lá que ele veio. O plugin não escreve no Project em nenhum caso; quem
  mantém o sprint atual e o Project em acordo é só o RoadS (seção 4, `sync-board`).
- Um `add` pode nomear a semana atual (`sprint-DD-MM-AAAA`) em `lane_id`: é a issue que já estava em Development no
  Project quando entrou no Roadmap, e entra direto no sprint atual. `lane_id` e `from_lane_id` de uma sprint vêm
  sempre por data; os que ainda estavam sem ack quando a migração 0031 rodou foram traduzidos por ela.
- Um `modify` pode trazer `title` e `reason` `"title follows the issue on GitHub"`: a issue foi renomeada no GitHub
  e o título do item no Roadmap a acompanhou. É o `title` de `item` que vale para escrever o arquivo. O RoadS só
  acompanha uma **renomeação** (o título da issue mudou desde a última sincronização); um título que uma pessoa
  escreveu no Roadmap fica enquanto o da issue não muda.
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

Roda a mesma sincronização do botão Sincronizar e do cron diário (statuses do Project, o sprint atual do Roadmap
em acordo com o Project, retrato do Dashboard, issues abertas e fechadas do Roadmap), sem corpo. A resposta é um
resumo, nunca os cartões do quadro. Quem monta: `src/lib/frontlights/sync.ts`.

```json
{ "schemaVersion": 1, "ok": true, "ran": true, "syncedAt": "…", "roadmap": { "added": 0, "removed": 0, "issuesCreated": 0, "sprint": { "pulled": 0, "released": 0, "written": 0, "wouldWrite": 0, "failed": 0, "stuck": 0 } } }
```

- **Cooldown de 30 s**, o mesmo do botão e do cron diário (a cota do GitHub é compartilhada): uma segunda
  chamada em menos de 30 s não roda; responde do último retrato com `"ran": false` e `roadmap` zerado, sem
  `sprint`.
- Uma sincronização que falha é **`200`** com `{ "ok": false, "reason": "…", "message": "…" }` (seção 3), não um
  erro HTTP. `roadmap.error` aparece quando o quadro sincronizou e o Roadmap não.
- **`roadmap.retitled`** (opcional, número): quantos títulos do Roadmap acompanharam a renomeação da issue no
  GitHub nesta sincronização (cada um vira um `modify` com `title` na fila). Ausente quando nenhum.
- **`roadmap.fields`** (opcional, só contagens): a sincronização nos dois sentidos dos campos de cada item com a sua
  issue (issue #22 do RoadS): Title, Description (o primeiro parágrafo da seção `## Solução` do corpo, que desde a
  issue #28 do RoadS só vem do GitHub: vazia quando o corpo não tem Solução, nunca escrita na issue), Type (a label `type:`), Stack e
  Priority (campos do Project) e Effort (o campo de issue da organização). `pulled`: valores trazidos do GitHub (cada item com algum vira um `modify` com
  os campos trazidos, nas chaves `title`, `description`, `tipo`, `stack`, `prioridade` e `effort`, e `reason`
  `"field follows the issue on GitHub"`); `pushed`: valores escritos no GitHub (com as labels `type:`, `area:` e
  `priority:high` que eles implicam e o tipo nativo); `failed`: itens em que algo falhou; `error` (texto) quando o
  passo todo falhou. Ausente quando nada mudou. As lacunas das issues (campo vazio, label implicada, tipo nativo)
  passam a ser preenchidas aqui, com um valor editado no RoadS (nunca um padrão): a rotina de lacunas do Frontlights deixa de ser
  necessária.
- **`roadmap.comments`** e **`roadmap.assignees`** (opcionais, só contagens): a sincronização nos dois sentidos dos
  Comments de cada item com os comentários da sua issue, e dos Assignees com os da issue (issue #23 do RoadS). `pulled`,
  `pushed` e `failed` como em `roadmap.fields`, e `error` (texto) quando o passo todo falhou. Ausentes quando nada mudou.
- **`roadmap.sprint`** (opcional, só contagens): o que a sincronização fez para manter o sprint atual do
  Roadmap (a semana cujas datas contêm hoje) e o Project em acordo. `pulled`: issues que o Project pôs no sprint atual;
  `released`: issues que o Project tirou dele (voltaram ao seu bloco); `written`: Statuses que o RoadS escreveu
  no Project; `wouldWrite`: o que teria escrito com a escrita desligada; `failed`: moves ou escritas que
  falharam; `stuck`: issues que o Project tirou do sprint e que não tinham bloco para onde voltar (ficam onde
  estão). `error` (texto) aparece quando o passo todo falhou; as contagens vêm zeradas. O objeto não vem quando
  não havia cartão a julgar. Quem consome ignora o campo que não conhece, e a mudança é aditiva (seção 8).
- **A regra do sprint é só do RoadS.** "No sprint atual do Roadmap" e "Status Development no Project" são o mesmo
  fato; o Project não tem campo de sprint, então as semanas seguintes existem só no Roadmap (Open no Project). Quando os dois lados discordam, vale quem mexeu por último: o horário que o GitHub
  guarda para o Status do cartão contra a linha `add`/`move_lane` mais nova do item na fila. Se o Project é o
  mais recente, o RoadS move o item (para a semana atual, criando a lane dela se faltar, ou dela de volta ao seu bloco de tipo) e enfileira um
  `move_lane` com as duas lanes (`origin` `"project"`); se o Roadmap é o mais recente, escreve o Status
  (Development ou Open) no Project. Só uma discordância é tratada, então uma escrita do RoadS nunca volta como
  mudança nova. Esta regra não escreve nem move Done e Blocker; só issues abertas do GeoCloud participam, nunca as
  do ELIMS. Desde 21/10 (issue #22) a escrita no Project não depende mais de `PROJECT_STATUS_WRITE`: escreve quem
  empurra (scrum master, admin, o cron e esta rota); a sincronização de um dev só informa `wouldWrite`. Blocker e
  Done passam a ser o Status próprio do item, sincronizado nos dois sentidos com `roadmap.fields` (Done fecha a
  issue como concluída, sair de Done a reabre; um item apagado no RoadS fecha a issue como not planned, com um
  Comment). O Frontlights não escreve no Project e não precisa mudar: segue escrevendo `ROADMAP.md` e os arquivos
  de sprint a partir da fila.

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

- `200 { "schemaVersion": 1, "id": "…", "created": true, "url": "…" }`. Enviar de novo (com o mesmo início de período)
  **atualiza** o `content` do rascunho e mantém as edições do usuário e o link das imagens; um novo envio invalida a conferência dos números.
- `400 { "error": "…" }`: o rascunho é inválido (a mensagem diz o **campo**, nunca o valor; a exceção são os
  números das issues de entregas sem print) ou fala outra `schemaVersion`.
- `409 { "error": "period_already_sent" | "concurrent_push" }`: o período já foi enviado e está congelado, ou dois
  envios se cruzaram.
- `409 { "error": "other_draft_pending", "draft": { "period_start": "…", "period_end": "…" } }`: já existe um
  rascunho de **outro** período (o início, como instante, é diferente do `content.window.start` enviado). Nada é
  alterado: o rascunho de outro resumo nunca é sobrescrito. `draft` traz o período desse rascunho (instantes UTC,
  como o banco guarda) para quem envia dizer qual resolver antes: marcá-lo como enviado no RoadS (ou descartá-lo).
  O mesmo início é um reenvio do mesmo resumo (o fim pode ter avançado) e atualiza o rascunho como sempre.

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

### Fatos do GitHub (`facts.json`)

Não é rota: é o arquivo que o coletor (`scripts/progress/github.ts`) grava em `.frontlights/progress/facts.json` e que
o plugin lê para escrever os textos. Entra aqui porque o plugin depende de cada campo. Valem as regras da seção 2:
campo novo opcional é aditivo. O Frontlights 0.24.0 é o que passa a usar os campos abaixo; quem não os conhece os
ignora. `scope`, `window`, `entries`, `internal`, `gitWork` e o resto de cada entrada seguem como eram.

- **O período por instante.** Os dois coletores (`scripts/progress/github.ts` e `scripts/progress/usage.ts`) aceitam,
  além de `--from AAAA-MM-DD --to AAAA-MM-DD` (dias de São Paulo, o `--to` incluído, como sempre), `--start <instante>
  --end <instante>`: ISO-8601 com deslocamento explícito ou `Z` (por exemplo `2026-10-07T20:05:12-03:00`), período
  semiaberto `[start, end)`. As duas formas juntas, só uma de `--start`/`--end`, instante sem deslocamento ou inválido,
  e `--end` que não vem depois de `--start` são recusados. O `window` de `facts.json` e de `usage.json` é exatamente
  esse período, escrito com `-03:00` (os milissegundos ficam quando há). Cada resumo começa no instante em que o
  anterior foi coletado: o `--start` é o `period_end` do último enviado (o `window.start` do `GET`), então o trabalho
  feito num dia de envio depois da coleta entra no resumo seguinte. Todo filtro usa os instantes; no `usage.json` o
  primeiro e o último dia passam a ser parciais (contam só o que cai dentro do período).

- **A entrega é a raiz de trabalho; o epic só agrupa.** Uma issue com o rótulo `type:epic` **nunca é uma entrega**
  (não vira entrada, não pede print). A entrega (`entries[]`) é a issue **mais alta que não é epic**: para toda issue com
  atividade no período, o ancestral mais alto que não é epic (ela mesma, se não há epic acima). Uma issue sem epic acima
  segue sendo a própria entrega. Um epic dentro de uma entrega é só mais uma parte dela. Todas as regras abaixo valem
  para a subárvore de cada entrega, e `hide.json` por número ou título de um epic esconde as entregas sob ele.
- **A família.** As sub-issues de uma entrega, **em qualquer profundidade**,
  são lidas e contam para ela: um PR ou commit que cita só uma neta é trabalho da capa, e o fechamento de uma
  sub-issue de qualquer nível (como concluída) é atividade da capa, mesmo que ela já não seja parte (veja `subIssues`). Criar sub-issues não é atividade (é planejamento). Uma sub-issue tocada no
  período traz a entrega junto (e os epics acima dela), mesmo parada e fora da coluna Development. Quem monta:
  `src/lib/progress/gh-client.ts` (a leitura, com limites) e `gh-facts.ts` (a conta). A leitura percorre os epics
  (um pedido cada, para achar as entregas) e só desce até as partes nas entregas com novidade (tocadas no período, na
  coluna Development/Blocker ou com parte tocada); as demais ficam só com nome e estado, o bastante para o epic contá-las.
  As regras de rótulo (`chore`, `infra`, teste) e de corpo ("pendência de revisão") são para tickets avulsos: uma issue
  já decomposta em sub-issues é trabalho de verdade e não é tratada como interna por elas.
- **`entries[].subIssues`** `{ total, done }` (ou `null` quando a entrega não tem partes) conta as **partes** da
  entrega pela regra de `src/lib/parts.ts`, a mesma do quadro Sprint do Dashboard (desde 2026-10-16): as **caixas da
  seção de critérios de aceitação** do corpo, sempre, mais as **sub-issues diretas ainda abertas**. `done` são as
  caixas marcadas; uma sub-issue aberta nunca está pronta. Sub-issue **fechada**, seja como concluída, não planejada
  ou duplicada, **não é parte**: fica fora de `total` e de `done`. Netas não contam, só os filhos diretos. Quando
  nenhuma sub-issue da entrega foi lida, as que o GitHub informa como ainda não concluídas (`total − completed` do `subIssuesSummary`) valem por elas. Sem caixas e sem
  sub-issues abertas, `subIssues` é `null` (e a entrega conta 1 no `delivered`). O formato é o mesmo de sempre; o que
  ele conta mudou em 07/10, 13/10 e 16/10 (seção 8).
- **As caixas** (desde 2026-10-13, quando o Frontlights deixou de criar sub-issues: issue #23 do plugin). As partes de
  uma entrega nova são as **caixas da seção de critérios de aceitação** do corpo; numa família antiga, as caixas que
  houver somam com as sub-issues abertas. As regras de leitura são as do Frontlights (`scan` em
  `skills/frontlights/scripts/closeout.py`) e moram em `src/lib/criteria.ts`: título markdown de qualquer nível cujo
  texto, sem acentos e em minúsculas, começa com "acceptance criteria", "criterios de aceitacao" ou "criterios de
  aceite", até o próximo título do mesmo nível ou acima; itens `- [ ]`, `* [x]`, `+ [X]`, `1. [ ]` e `1) [ ]`, com ou sem
  recuo; código cercado e comentários HTML ignorados; várias seções somam; sub-item sem caixa não conta; a seção legada
  "pendências conhecidas" não conta. Caixa de pendência ("Pendência (achado da revisão): …") é parte como as outras.
  **A data de uma caixa marcada** vem do histórico de edições do corpo (`Issue.userContentEdits`, as 100 edições mais
  novas): é a edição em que ela passou de aberta a marcada pela última vez (ou em que entrou já marcada). A mesma caixa
  é reconhecida entre versões pelo texto, ou por um texto que cresceu a partir do outro (marcar com a evidência no fim
  da linha). Sem histórico lido, a caixa conta mas não tem data. O coletor lê o histórico de toda issue com ao menos
  uma caixa marcada, tenha ou não sub-issues. Uma caixa marcada no período (com data) é atividade (a entrega entra no
  resumo) e trabalho feito (nunca `proximo`), mas **não muda a situação**: as caixas contam partes, não seguram a
  entrega. A situação segue os PRs, o fechamento da issue e, numa família com sub-issues, as **folhas da árvore** (uma
  folha aberta mantém a entrega em andamento), embora as folhas já não entrem na contagem de partes.
- **"Bloqueada:"** (convenção combinada em 2026-10-13): um sub-item sem caixa logo abaixo de uma caixa **aberta**, mais
  recuado que ela, cujo texto começa com "Bloqueada:" (sem acento ou caixa importarem, com ou sem negrito), marca a
  slice como parada; o resto da linha é o motivo.
- **`entries[].epic`** `{ issue, title, parts: { total, done } }` e **`entries[].epicPath`** `[{ issue, title }]`
  (opcionais, só em entrega com epic acima; só no `facts.json`, o rascunho montado nunca os leva). `epic` é o epic
  **mais próximo**; `parts` conta as **entregas** sob ele (através de epics intermediários, não as partes delas): quantas
  há e quantas estão fechadas como concluídas, sem contar as canceladas. `epicPath` traz a cadeia inteira, do mais
  externo ao mais próximo, com o título do GitHub, para o texto agrupar ("MVP · 1A: …"). Um PR que cita **só** epics
  não pertence a entrega nenhuma: entra em `internal` com a razão "PR que cita só um epic (agrupador)".
- **A situação** continua só do coletor. Uma entrega com sub-issue de qualquer nível fechada como concluída, ou com
  caixa marcada (com data), até o fim do período nunca fica `proximo`, mesmo sem PR nem commit: é trabalho feito,
  ainda que a sub-issue fechada não seja parte.
- **`entries[].slices`** (opcional, só em entrega com partes, isto é, com `subIssues` não nulo): evidência para quem
  escreve. **Só existe no `facts.json`: o rascunho montado nunca o leva** (`assemble.ts` monta cada entrada campo a
  campo).
  - `closed`: `[{ title, closedAt }]`, as **caixas marcadas dentro do período**, na ordem em que foram marcadas.
    `title` é o texto da caixa até a primeira frase, no máximo 120 caracteres (o redator o reescreve); `closedAt` é a
    edição que a marcou, no horário de São Paulo, como `deliveredAt`. Caixa marcada sem data não entra. Sub-issue
    fechada não é parte e **nunca aparece aqui**: o fechamento dela fica só na evidência ("N sub-issues fechadas no
    período").
  - `blocked`: `[{ title, reason? }]`, as partes abertas paradas: as caixas **abertas** com "Bloqueada:", cada uma
    com o campo **`reason`** (aditivo, só nas caixas), o texto depois de "Bloqueada:"; e as sub-issues diretas
    **abertas** que carregam o rótulo `status:blocker` (o mesmo nome da coluna Blocker do Project #7; um `blocker`
    solto não vale, pode ser "bloqueia a release") **ou** cujo cartão no Project estava em Blocker no fim do período.
    Sub-issue em geral não tem cartão, então na prática é o rótulo. A relação "bloqueada por" do GitHub não é lida.
- **A sprint.** Cada item aberto do Project #7 (do repositório) com Status Development no fim do período é uma **capa
  da sprint**, epic ou não, e **nunca é uma entrada** (não pede texto por entrega nem print); uma capa dentro de
  outra conta só na de cima, e uma issue escondida (`hide.json`), de teste de sincronização ou sob um epic escondido
  não é capa. `sprint: { epics: [ { issue, title, issues: { total, done }, parts: { total, done, remaining }, open:
  [ { issue, title } ] } ], totals: { covers, remainingParts } }`: `issues` são as entregas da capa (filhas que não
  são epic, através dos epics intermediários, sem as canceladas); `parts` são as partes dela pela mesma regra de
  `subIssues`. Uma capa que não é epic conta como uma entrega: as caixas dos seus critérios de aceitação mais as
  sub-issues diretas abertas. Um epic com filhas soma as entregas sob ele, cada uma pela regra, e uma entrega sem
  partes vale 1, pronta quando fechada (um epic vazio dentro dele não conta). Uma capa sem filhas e sem caixas é a sua
  única parte. Como sub-issue aberta nunca está pronta, toda sub-issue direta aberta entra em `remaining`, e uma capa cujas
  sub-issues já fecharam e que não tem caixas fica com `remaining` zero. Uma capa sem filhas tem `issues: { total: 1, done: 0 }` (capa é item aberto no fim do
  período, então nunca está fechada); `open` são as entregas ainda abertas,
  até 30. Só entram em `epics` as capas com `remaining` maior que zero, então `totals.covers` é o número delas (o K do
  chip) e `totals.remainingParts` a soma do que falta (o N). O coletor lê a árvore inteira de cada capa, tenha ou não
  havido novidade. Um item em Blocker continua sendo uma entrada `bloqueado`.
- **`delivered`** `{ issues, parts }` (só nos fatos, como evidência): as entradas visíveis e concluídas e a soma de
  `max(1, subIssues.done)` delas, isto é, das caixas marcadas (sub-issue fechada não soma; a entrega sem caixa
  marcada conta 1). O chip do e-mail e da visão semanal **não lê este campo**: refaz a conta com as
  entradas que estão à mostra, para seguir o que a pessoa esconde ou muda na tela.
- **`content.sprint`** (opcional, aditivo, no `POST /progress-report`): o mesmo `sprint` dos fatos, com um `summary` a
  mais por capa (a frase do redator, vazia quando não há). O servidor refaz `parts.remaining` e `totals`, e recusa
  capa repetida ou `done` maior que `total`, dizendo o campo. Sem ele, o e-mail volta aos chips de antes. Com ele, o
  e-mail e a visão semanal mostram **"Concluído: N partes em M issues"** e **"Em andamento: N partes em K
  issues"** (e "Bloqueado: N" se houver), sem o chip "Em validação", e o bloco "Em andamento na sprint" depois das
  entregas. A visão semanal soma as entregas dos resumos da semana (cada issue uma vez) e traz o bloco do último.
- **`ignored.covers`** (número): quantas capas da sprint o coletor achou (uma capa epic entra também em `epics`).
- **`ignored.epics`** (número): quantos epics foram tratados como agrupador (nenhum é entrada).
- **`ignored.cut`** (número): quantas issues tinham sub-issues que o GitHub conta e o coletor **não leu** (árvore
  mais funda que 6 níveis abaixo da entrega, mais de 400 sub-issues sob uma entrega, ou sub-issues de outro
  repositório). A leitura não estoura em silêncio: a entrega afetada traz uma linha de `evidence` ("Leitura das
  sub-issues cortada…") e o coletor imprime um aviso. Sob uma issue cortada, o `subIssues` conta o que o GitHub diz
  que há embaixo dela, e o que está mais fundo fica de fora: **a contagem pode estar abaixo do real**.
- O e-mail e a visão semanal mostram, sozinhos, "X de Y partes prontas" abaixo da frase da entrega (nunca para
  `proximo`, nunca com número de issue). Quem escreve o texto não repete a contagem (`docs/progress-draft.md`).
- **Prints:** o print de uma parte entra em `captions.json` com o número da **entrega** (a raiz de trabalho, nunca o
  de um epic); o RoadS não aceita número de sub-issue ali.

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
| `roadmap-state` | `src/lib/frontlights/state.ts`, `src/lib/roadmap-state.ts`, `src/lib/sprint-week.ts` (a semana: id, título, ordem e semana atual) | `src/app/api/frontlights/roadmap-state/route.ts` |
| `pending-changes`, `ack` | `src/lib/frontlights/queue.ts` | `…/pending-changes/route.ts`, `…/ack/route.ts` |
| `sync-board` | `src/lib/frontlights/sync.ts`, `src/lib/sync-summary.ts` | `…/sync-board/route.ts` |
| sprint atual e Project em acordo (`roadmap.sprint`, `origin` do `move_lane`) | `src/lib/sprint-status-sync.ts` (a regra, testada sem servidor), `src/lib/sprint-week.ts` (qual é a semana atual), `src/lib/board-sync.ts` (as portas reais), `src/lib/board.ts` (a leitura dos cartões) | o mesmo `sync-board`, o botão Sincronizar e o cron diário |
| rotas do resumo | `src/lib/progress/ingest.ts`, `draft.ts`, `shot-upload.ts`, `attach.ts` | `…/progress-report/**/route.ts` |
| fatos do GitHub (`facts.json`: família, `subIssues`, `slices`, `ignored.cut`) | `src/lib/progress/gh-client.ts`, `gh-facts.ts`, `gh-status.ts`, `src/lib/criteria.ts` (as caixas), `src/lib/parts.ts` (as partes) | `scripts/progress/github.ts` (`gh-cli.ts`) |
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
- **2026-10-06 (aditivo):** `roadmap.sprint` no resumo do `POST /sync-board`: contagens `pulled`, `released`,
  `written`, `wouldWrite`, `failed`, `stuck` e, se o passo falhou, `error`. Ausente quando não havia cartão a
  julgar.
- **2026-10-06 (aditivo):** `origin` (`app`, `rotation`, `label`, `project`) no `payload` do `move_lane`, e um
  `add` pode nomear `atual` em `lane_id`. Os moves enfileirados antes desta data não têm `origin`.
- **2026-10-06:** o acordo entre o sprint atual do Roadmap e o Project é feito só pelo RoadS (Status Development é
  o sprint atual; vale quem mexeu por último). Nada é pedido ao plugin, que não escreve no Project.
- **2026-10-06 (aditivo):** o título de um item do Roadmap acompanha a renomeação da issue no GitHub: vem como
  `modify` com `title` e `reason` `"title follows the issue on GitHub"`, e o resumo do `POST /sync-board` pode
  trazer `roadmap.retitled` (quantos títulos acompanharam; ausente quando nenhum). Os 19 itens do plano MVP que
  tinham ficado com o nome antigo foram acertados de uma vez e enfileirados do mesmo jeito.
- **2026-10-07 (aditivo):** `facts.json` conta a árvore inteira de sub-issues. `entries[].subIssues` passa a contar as
  folhas de qualquer nível (antes, só os filhos diretos), PRs, commits e fechamentos de qualquer descendente são
  atividade da capa, uma capa com parte entregue nunca fica `proximo`, e há dois campos novos opcionais:
  `entries[].slices` (`closed` e `blocked`, só no `facts.json`) e `ignored.cut`. E-mail e visão semanal mostram "X de
  Y partes prontas". Nenhuma rota mudou e a `schemaVersion` segue 1.
- **2026-10-07 (aditivo, mesmo dia):** `type:epic` passa a ser agrupador, não entrega. A entrega é a raiz de trabalho
  (o ancestral mais alto que não é epic), com as mesmas regras sobre a sua subárvore; `entries[].epic` e
  `entries[].epicPath` (só no `facts.json`) dão o epic como cabeçalho, e `ignored.epics` conta os agrupadores. Muda o
  que é uma entrada: antes, só a issue sem pai; agora, cada raiz de trabalho sob um epic. Uma issue já decomposta em
  partes deixa de ser tida por interna só pelo rótulo ou pelo corpo.
- **2026-10-07 (aditivo, à noite):** a sprint vira bloco à parte. `facts.json` ganha `sprint` (as capas, itens do
  Project em Development, com `issues`, `parts`, `open` e `totals`), `delivered` e `ignored.covers`; um item em
  Development deixa de ser entrada (antes virava `proximo` ou `em_andamento`, com texto e print). `content.sprint`
  (opcional) vai no rascunho, e o e-mail e a visão semanal passam a dizer "Concluído: N sub-issues em M issues" e
  "Em andamento: N sub-issues em K issues", sem o chip "Em validação". O arquivo de textos ganha `sprint` (uma frase
  por capa). Relatórios sem o bloco seguem como eram.
- **2026-10-13 (aditivo):** entrega cortada em caixas. Numa issue sem sub-issues, `subIssues`, `slices` (`closed`,
  `blocked`), `sprint.epics[].parts` e `delivered.parts` contam as caixas dos critérios de aceitação, datadas pelo
  histórico de edições do corpo; famílias com sub-issues seguem pela árvore. Campo novo opcional:
  `slices.blocked[].reason`, só em caixa com "Bloqueada:". O bloco Slices do Dashboard mostra as caixas de uma issue da
  sprint sem sub-issues. Nenhum nome ou tipo de campo mudou e a `schemaVersion` segue 1. No e-mail, na visão semanal
  e na tela, "sub-issues" vira "partes" ("Concluído: N partes em M issues", "X de Y partes"), porque uma parte pode
  ser sub-issue ou caixa; o e-mail já enviado não muda, mas a tela monta o texto na hora e mostra a palavra nova.
- **2026-10-16 (aditivo, Dashboard e Resumo):** uma regra só para as partes de uma issue, em `src/lib/parts.ts`: as
  caixas dos critérios de aceitação, sempre, mais as sub-issues diretas ainda abertas; sub-issue fechada (concluída,
  não planejada ou duplicada) não é parte. No Dashboard, o bloco Slices deixa de existir e vira o quadro Sprint: cada
  issue da sprint atual com as caixas logo abaixo, em linhas recuadas, e as sub-issues ainda abertas como linha extra
  com link; sub-issue fechada não aparece, e o "x de y" deixa de usar o total de sub-issues do GitHub. No coletor do
  Resumo, quatro campos mudam de sentido, com o mesmo nome e o mesmo tipo: `entries[].subIssues` passa a contar caixas
  mais sub-issues diretas abertas (antes, as folhas da árvore, ou só as caixas numa issue sem sub-issues), com `done`
  = caixas marcadas; `slices.closed` passa a trazer só as caixas marcadas no período (antes, também as sub-issues
  fechadas); `sprint.epics[].parts` conta cada capa pela mesma regra (antes, as folhas da árvore dela); e
  `delivered.parts` soma as caixas marcadas das entregas concluídas (antes, também as folhas fechadas). O histórico do
  corpo passa a ser lido também em issue com sub-issues, e as folhas da árvore seguem decidindo só a situação. O
  Frontlights só lê esses números para redigir o texto, então nada nele quebra. Nenhuma rota ou campo entra ou sai, e
  a `schemaVersion` segue 1.
- **2026-10-16 (mudança de sentido, `schemaVersion` segue 1):** as sprints viram semanas com id pela data. Em
  `roadmap-state`, `sprintId` e `laneId` passam a `sprint-DD-MM-AAAA` (a segunda-feira; antes, `sprintId` era
  `sprint-AAAA-MM-DD` e `laneId` era `atual`, `proxima` ou `terceira`), `title` passa a ser só as datas, e
  `sprints[]` traz N semanas na ordem da data, e só estas: a atual sempre (mesmo vazia), toda lane de semana com
  item e, até o ack, toda semana que uma mudança sem ack cita em `lane_id` ou `from_lane_id`, guardada vazia ou já
  apagada (a futura que perdeu o último item, a que a virada encerrou; sem lane, vem com `items: []`); uma lane
  vazia que não é a atual nem é citada fica de fora. O `sprintId` de uma semana é fixo e não anda com a virada. A
  ordem dos itens desempata pelo id, como na tela. `removedPending[].laneId` de sprint e
  `lane_id`/`from_lane_id` na fila de `pending-changes` também vêm por data; a migração 0031 traduziu as mudanças
  ainda sem ack. Pela seção 2 isto seria uma quebra; **por decisão do usuário no rollout, a `schemaVersion`
  continua 1** em `roadmap-state`, `pending-changes` e `ack`, porque o Frontlights publicou antes a versão que
  aceita as duas formas (ids posicionais e por data). O RoadS faz o `db push` da 0031 e o deploy depois disso.
  Nenhum campo foi tirado ou renomeado.
- **2026-10-21 (aditivo):** `roadmap.fields` no resumo do `POST /sync-board` (`pulled`, `pushed`, `failed` e, se o passo
  falhou, `error`), e o `modify` com `reason` `"field follows the issue on GitHub"` pode trazer `description`, `tipo`,
  `stack`, `prioridade` e `effort` além de `title`. Os nomes de Stack guardados passam ao inglês (Modeling, Database,
  General, General Tests, Frontend Tests, Backend Tests, Documentation, Tests, Tests/Security; os demais já eram), e é
  com eles que vêm em `modify` e em `roadmap-state`. As lacunas das issues passam ao RoadS. Nenhuma rota mudou e a
  `schemaVersion` segue 1.
- **2026-10-21 (aditivo):** o Status próprio do item (Open, Blocker, Done) sincroniza nos dois sentidos e conta em
  `roadmap.fields`; o `modify` pode trazer `status`. Um `remove` feito no app fecha a issue como not planned antes. A
  escrita de Status no Project deixa de depender de `PROJECT_STATUS_WRITE` e passa a seguir o papel de quem
  sincroniza. Nenhuma rota mudou e a `schemaVersion` segue 1.
- **2026-10-21 (aditivo):** `roadmap.comments` e `roadmap.assignees` no resumo do `POST /sync-board`. O quadro passa a
  usar os nomes em inglês: o campo Prioridade virou Priority, as opções de Stack em português foram renomeadas (os ids
  continuam), e a opção Tests/Security do RoadS passa a se chamar Security Tests, também nos nomes guardados (migração
  0042) e no que vem em `modify` e em `roadmap-state`. O campo próprio Repositório saiu do quadro (o Repository nativo
  diz o mesmo), e o campo de data Week foi criado. Nenhuma rota mudou e a `schemaVersion` segue 1.
- **2026-10-21:** o Effort sincroniza com o campo de issue Effort da organização no GitHub (o Effort do Project só o
  espelha), e o RoadS deixa de ter "Very High": o Effort passa a ser High, Medium ou Low, e os valores guardados como
  Very High viraram High (migração 0043), também em `modify` e em `roadmap-state`. As chaves do `modify` não mudaram
  e a `schemaVersion` segue 1.
