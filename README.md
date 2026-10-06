# RoadS

Dashboard e roadmap colaborativo da Essencis Labs — substitui o SCRUM síncrono por um board em tempo
real e priorização assíncrona, sincronizada com `ROADMAP.md`/`SPRINT.md` via IA (`/update-roads` no
FrontlightS, que lê `/api/frontlights/pending-changes` e confirma em `/api/frontlights/ack`). O que o RoadS
promete ao FrontlightS (rotas, formatos, versão do contrato e regra de aviso de quebra) está em
`docs/frontlights-contract.md`.

Protótipo interativo (referência de design, dados reais do board): https://claude.ai/artifact/HKN2kCFBESPSJibARZ56Jn

## Papéis

Três papéis. Todo cadastro começa como **Dev**; o admin promove a Scrum Master na tela Config.

- **Admin** — só o fundador (e a conta de teste, veja Testes). Controle total: edita e apaga qualquer
  item, gerencia usuários na Config. O papel admin não é concedido nem retirado pelo app.
- **Scrum Master** — cria itens, edita e apaga só os que criou, ajusta prioridade/esforço/sprint e
  comenta nos itens vindos do GitHub (que não pode renomear nem apagar). Não mexe nos itens de outras
  pessoas.
- **Dev** — só lê. Não cria, não move, não comenta.

Só e-mails `@essencislabs.com` e `@essencistech.com.br` têm conta (a página de cadastro avisa, e o banco
recusa os demais).

## Stack

- Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind CSS
- Supabase (Postgres + Auth + Realtime) — schema em `supabase/migrations/`
- Vercel (deploy)
- GitHub Projects v2 (org Essencis-Labs, projeto #7) como fonte do Kanban

## Rodando localmente

```bash
npm install
npm run dev
```

Precisa de um `.env.local` (não é gerado automaticamente por design: o hook de segurança do agente
bloqueia gravação de arquivos `.env*`) com `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `GITHUB_TOKEN`, `CRON_SECRET` (autentica o cron diário) e `FRONTLIGHTS_API_SECRET`
(autentica o `/update-roads` do FrontlightS e os scripts de envio do resumo).

`GITHUB_TOKEN` é um PAT clássico com `repo`, `read:org` e `project`. O `project` é de leitura **e** escrita: o
RoadS já escreve no Project ao criar uma issue.

`PROJECT_STATUS_WRITE` é **opcional**. Com `on`, a sincronização (botão, cron diário e
`POST /api/frontlights/sync-board`) escreve Development ou Open no Project para manter o sprint atual do Roadmap
e o Status em acordo (vale quem mexeu por último; Done e Blocker nunca são escritos). Com qualquer outro valor,
ou sem a variável, ela só **informa** o que escreveria; o Roadmap continua seguindo o que o Project diz. A regra
e o que o Frontlights vê dela estão em `docs/frontlights-contract.md`.

## Setup do banco

```bash
npx supabase login          # abre o navegador, pede o seu token de acesso pessoal
npx supabase link --project-ref ctovfklkdmqrvpukrliv
npx supabase db push        # aplica tudo em supabase/migrations/
```

A migração nova entra sempre com o `db push`: as políticas e os gatilhos dela são a trava real de segurança.

## Testes

```bash
npm test                # unitários (lógica pura, sem rede)
npm run audit:rls       # permissões no banco: anônimo, Dev, Scrum Master e admin contra cada tabela
npm run scan:secrets    # segredos no bundle do cliente, no build do servidor e no histórico do git
npm run e2e             # as portas do FrontlightS e as telas de cada papel, num Chrome de verdade (precisa do servidor local, abaixo)
npm run e2e -- reset    # idem, mais o fluxo de redefinição de senha (envia 1 e-mail real; E2E_NO_EMAIL=1 pula esse passo)
npm run e2e:prod        # só leitura: um passeio por papel na produção
npm run e2e:prod -- recovery   # idem, e termina um link de recuperação pela página de produção (troca e restaura a senha da conta Dev de teste)
```

**Servidor para o `e2e`:** `npm run build && GITHUB_TOKEN= TZ=UTC npm start`. O token vazio faz salvar item
e sincronizar falharem de forma segura, sem nunca criar issue no GitHub de verdade; `TZ=UTC` reproduz o fuso
do servidor da Vercel (foi o que revelou um erro de hidratação que o modo dev escondia).

**O que cada um cobre.** `audit:rls` chama a API pública do Supabase como cada papel e confere a regra de
domínio no cadastro; sai com código 1 se achar furo (rode depois de toda migração que mexa em políticas) e
avisa se o Site URL do Auth não é o da produção. O `e2e` dirige cada papel pelas telas (controles que devem e
não devem existir, criar/editar/mover/apagar, notas, Config, inatividade, Sair, abas cruzadas, tema escuro,
celular) e chama **cada ação do servidor direto**, sem a interface, conferindo o banco depois. Uma lista em
`src/lib/actions/exports.test.ts` trava quais funções são endpoints: tudo que um arquivo `"use server"`
exporta pode ser chamado por qualquer usuário logado.

**Contas de teste.** Precisam de `.env.test-account` (ignorado pelo git) com `ROADS_TEST_*` (admin,
`sergio.mendes+roads-test@essencislabs.com`), `ROADS_TEST_SM_*` (Scrum Master) e `ROADS_TEST_DEV_*` (Dev),
cada uma com `_EMAIL` e `_PASSWORD`. A conta admin de teste existe por uma exceção única no trigger de
admin reservado (migração 0015). Os testes criam lanes `zz-test-*` e itens `[TESTE]` no banco real e os
apagam no fim, junto com as linhas que geram na fila do FrontlightS.
