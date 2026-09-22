# RoadS

Dashboard e roadmap colaborativo da Essencis Labs — substitui o SCRUM síncrono por um board em tempo
real e priorização assíncrona, sincronizada com `ROADMAP.md`/`SPRINT.md` via IA (`/update-roads` no
GuardianS).

Protótipo interativo (referência de design, dados reais do board): https://claude.ai/artifact/HKN2kCFBESPSJibARZ56Jn

## Papéis

Dois papéis, sem nome amarrado a eles — escolhido no primeiro login:

- **SCRUM MASTER** — CEO ou Coordenador Dev Senior. Cria, arrasta entre sprints, ajusta
  prioridade/esforço, comenta.
- **Dev** — lê e comenta, não move nem cria.

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
hook de segurança do GuardianS bloqueia gravação de arquivos `.env*` por um agente).

## Setup do banco

```bash
npx supabase login          # abre o navegador, pede o seu token de acesso pessoal
npx supabase link --project-ref ctovfklkdmqrvpukrliv
npx supabase db push        # aplica supabase/migrations/0001_init.sql
```

Veja `NEXT_STEPS.md` para o que falta e o que cada passo precisa.
