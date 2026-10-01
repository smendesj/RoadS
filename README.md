# RoadS

Dashboard e roadmap colaborativo da Essencis Labs — substitui o SCRUM síncrono por um board em tempo
real e priorização assíncrona, sincronizada com `ROADMAP.md`/`SPRINT.md` via IA (`/update-roads` no
FrontlightS, que lê `/api/frontlights/pending-changes` e confirma em `/api/frontlights/ack`).

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

Precisa de um `.env.local` (veja `NEXT_STEPS.md` — não é gerado automaticamente por design: o
hook de segurança do agente bloqueia gravação de arquivos `.env*`). A variável que autentica o
`/update-roads` do FrontlightS é `FRONTLIGHTS_API_SECRET`.

## Setup do banco

```bash
npx supabase login          # abre o navegador, pede o seu token de acesso pessoal
npx supabase link --project-ref ctovfklkdmqrvpukrliv
npx supabase db push        # aplica tudo em supabase/migrations/
```

Veja `NEXT_STEPS.md` para o que falta e o que cada passo precisa.

## Testes

```bash
npm test                # unitários (lógica pura, sem rede)
npm run audit:rls       # auditoria de permissões no banco, com um usuário de cada papel
```

`audit:rls` chama a API pública do Supabase como anônimo, Dev, Scrum Master e admin e confere cada
tabela contra o modelo de permissões acima, além da regra de domínio no cadastro. Roda no projeto de
`.env.local` (o real), com lanes `zz-test-*` e usuários `roads-audit-*` descartáveis, apagados no fim,
e sai com código 1 se achar qualquer furo. Rode depois de toda migração que mexa em políticas.

Precisa de `.env.test-account` (ignorado pelo git) com as três contas de teste:
`ROADS_TEST_*` (admin, `sergio.mendes+roads-test@essencislabs.com`), `ROADS_TEST_SM_*` (Scrum Master) e
`ROADS_TEST_DEV_*` (Dev), cada uma com `_EMAIL` e `_PASSWORD`. A conta admin de teste existe por uma
exceção única no trigger de admin reservado (migração 0015); para testes de interface com escrita,
suba o servidor local com `GITHUB_TOKEN=` vazio, para que salvar item ou sincronizar nunca crie issue
no GitHub de verdade.
