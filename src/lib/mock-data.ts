// Placeholder data layer. Shapes match supabase/migrations/0001_init.sql so swapping these
// functions for real Supabase queries later doesn't touch any component.
import type { Lane, RoadmapGroup } from "./types";

const GH = "https://github.com/Essencis-Labs/GeoCloudAI/issues/";

export function getLanes(): Lane[] {
  return [
    {
      id: "atual",
      title: "Sprint atual",
      dates: "21–25/09",
      items: [
        {
          id: "715",
          title: "Gateway de pagamentos — Asaas e Stripe",
          produto: "GeoCloud",
          prioridade: "Critical",
          effort: "Very High",
          desc: "Billing interno com adaptador por provedor. Provedor já decidido: os dois — cotação e contratação primeiro, depois credenciais e webhook.",
          url: GH + "715",
          notes: [
            {
              id: "n1",
              author: "scrum_master",
              when: "seg",
              text: "Dois SDKs, dois webhooks — quase uma segunda integração. Marquei Very High por isso, não só pelos 3,5 dias originais.",
            },
          ],
        },
        {
          id: "716",
          title: "Cobrança por tokenização",
          produto: "GeoCloud",
          prioridade: "High",
          effort: "Medium",
          desc: "Preço por token consumido, entrada e saída — como Anthropic e OpenAI cobram.",
          url: GH + "716",
          notes: [],
        },
        {
          id: "717",
          title: "As duas visualizações das caixas disponíveis, vertical e horizontal",
          produto: "GeoCloud",
          prioridade: "Medium",
          effort: "Low",
          desc: "Trazido do Sprint 4 pra cobrir o espaço que a entrega antecipada da pesquisa por profundidade abriu.",
          url: GH + "717",
          notes: [],
        },
      ],
    },
    {
      id: "proxima",
      title: "Próxima sprint",
      dates: "28/09–02/10",
      items: [
        {
          id: "s4-5",
          title: "Página própria do visualizador, com filtros de região até caixa",
          produto: "GeoCloud",
          prioridade: "Medium",
          effort: "Medium",
          desc: "O maior item do lote de acabamento.",
          url: null,
          notes: [
            {
              id: "n2",
              author: "scrum_master",
              when: "sex",
              text: "Depende de decidir barra horizontal vs. menu lateral antes de começar.",
            },
          ],
        },
        { id: "s4-1", title: "Sidebar recuado ao entrar em qualquer visualizador", produto: "GeoCloud", prioridade: "Low", effort: "Low", desc: "Acabamento visível em toda tela.", url: null, notes: [] },
        { id: "s4-4", title: "Cota do topo do furo no Single View", produto: "GeoCloud", prioridade: "Low", effort: "Low", desc: "", url: null, notes: [] },
        { id: "s4-3", title: "Accordion do menu lateral direito: deixar explícito que abre listagem", produto: "GeoCloud", prioridade: "Low", effort: "Low", desc: "", url: null, notes: [] },
        { id: "s4-2", title: "Título do nível corrido, com a data ao lado e a imagem do nível menor", produto: "GeoCloud", prioridade: "Low", effort: "Low", desc: "", url: null, notes: [] },
      ],
    },
    {
      id: "terceira",
      title: "Sprint seguinte",
      dates: "05–09/10",
      items: [
        { id: "s5-1", title: "Marcações em colunas verticais", produto: "GeoCloud", prioridade: "Medium", effort: "Medium", desc: "A parte de Single View sem bloqueio externo.", url: null, notes: [] },
        { id: "s5-2", title: "Accordion por classe de geologia, com todos/desativar todos", produto: "GeoCloud", prioridade: "Medium", effort: "Low", desc: "", url: null, notes: [] },
        { id: "s5-3", title: "Filtro para desligar classes de geologia por furo", produto: "GeoCloud", prioridade: "Medium", effort: "Low", desc: "", url: null, notes: [] },
      ],
    },
  ];
}

export function getRoadmapGroups(): RoadmapGroup[] {
  return [
    {
      id: "g1",
      title: "Sprint 5 · resto (com bloqueio)",
      items: [
        { id: "r1", title: "Litologia metro a metro, normalizada", produto: "GeoCloud", prioridade: "Medium", effort: "Medium", desc: "Bloqueio: regra de normalização, decide a geologia.", url: null, notes: [] },
        { id: "r2", title: "Coluna de geoquímica com gráfico e seleção do elemento", produto: "GeoCloud", prioridade: "Medium", effort: "Medium", desc: "Bloqueio: profundidade por amostra.", url: null, notes: [] },
        { id: "r3", title: "Coluna de mapa hiperespectral", produto: "GeoCloud", prioridade: "Low", effort: "Medium", desc: "Bloqueio: mockup e armazenamento.", url: null, notes: [] },
      ],
    },
    {
      id: "g2",
      title: "Sprint 6 · IA e visão computacional",
      items: [
        { id: "r4", title: "Guias especializadas por classe de geologia no chat", produto: "GeoCloud", prioridade: "Medium", effort: "High", desc: "", url: null, notes: [] },
        { id: "r5", title: "Segmentação de testemunho na visão computacional", produto: "GeoCloud", prioridade: "Medium", effort: "High", desc: "Modelo novo — litologia já treinada, acima de 90% de acurácia.", url: null, notes: [] },
        { id: "r6", title: "Sincronizar sample e resultados com o ELIMS", produto: "ELIMS", prioridade: "Medium", effort: "Medium", desc: "Depende do schema do Victor, sem previsão.", url: null, notes: [] },
      ],
    },
    {
      id: "g3",
      title: "Dados, mapas e importação",
      items: [
        { id: "r7", title: "Tela de upload das informações de perfuração", produto: "GeoCloud", prioridade: "Medium", effort: "Medium", desc: "Pode entrar a qualquer momento.", url: null, notes: [] },
        { id: "r8", title: "Mapa básico com geolocalização de poços e furos", produto: "GeoCloud", prioridade: "Low", effort: "Medium", desc: "", url: null, notes: [] },
      ],
    },
    {
      id: "g4",
      title: "Dívida técnica",
      items: [
        { id: "r9", title: "Escopo de empresa ao conceder acesso a projeto", produto: "GeoCloud", prioridade: "Critical", effort: "Low", desc: "Hoje dá pra inserir usuário de outra empresa em projeto seu — urgente, mas rápido de corrigir.", url: null, notes: [] },
        { id: "r10", title: "Conversão de unidade de ensaio, hoje adivinhada", produto: "GeoCloud", prioridade: "Medium", effort: "Medium", desc: "Antes de qualquer relatório de teor sair do sistema.", url: null, notes: [] },
      ],
    },
    {
      id: "g5",
      title: "Módulos futuros",
      items: [
        { id: "r11", title: "Dashboards avançados, com pedido à LLM", produto: "GeoCloud", prioridade: "Low", effort: "Very High", desc: "Cobrança separada.", url: null, notes: [] },
        { id: "r12", title: "Visualização 3D como módulo desligável", produto: "GeoCloud", prioridade: "Low", effort: "Very High", desc: "", url: null, notes: [] },
      ],
    },
  ];
}

export const dashboardData = {
  branch: "SPRINT-21_09-25_09",
  kpis: [
    { label: "Development", value: "3", hint: "Sprint atual · 21–25/09", tone: "neutral" as const },
    { label: "Concluídas na sprint", value: "0 de 3", hint: "Comprometidas esta semana", tone: "green" as const },
    { label: "Bloqueios", value: "0", hint: "Nenhum agora", tone: "green" as const },
  ],
  columns: [
    {
      key: "open",
      title: "Open",
      count: 27,
      tone: "neutral" as const,
      items: [
        { title: "Financeiro: introduzir IFinanceService e parar de pular a camada", ref: "#521", url: GH + "521" },
        { title: "security: imagens de testemunho são servidas sem autenticação", ref: "#491", url: GH + "491" },
      ],
    },
    {
      key: "dev",
      title: "Development",
      count: 23,
      tone: "brand" as const,
      items: [
        { title: "Gateway de pagamentos — Asaas e Stripe", ref: "#715", url: GH + "715" },
        { title: "Cobrança por tokenização", ref: "#716", url: GH + "716" },
        { title: "As duas visualizações das caixas disponíveis", ref: "#717", url: GH + "717" },
      ],
    },
    { key: "blocker", title: "Blocker", count: 0, tone: "red" as const, items: [] },
    {
      key: "done",
      title: "Done",
      count: 97,
      tone: "green" as const,
      items: [
        { title: "[EPIC] Sprint 08/09 a 11/09 — GeoCloud Core", ref: "#423", url: GH + "423" },
        { title: "[Épico] KoreGeo3 — paridade com KoreGeo2", ref: "#315", url: GH + "315" },
      ],
    },
  ],
  entregas: [
    { title: "Gateway de pagamentos — Asaas e Stripe", status: "EM ANDAMENTO", tone: "brand" as const, effort: "Very High", ref: "#715", url: GH + "715" },
    { title: "Cobrança por tokenização", status: "EM ANDAMENTO", tone: "brand" as const, effort: "Medium", ref: "#716", url: GH + "716" },
    { title: "As duas visualizações das caixas disponíveis, vertical e horizontal", status: "EM ANDAMENTO", tone: "brand" as const, effort: "Low", ref: "#717", url: GH + "717" },
  ],
  paralelo: [{ title: "TASK-067 · Colunas do Single View, mockadas a partir do Relatório", url: GH + "681" }],
  proxima: [
    { title: "Sidebar recuado ao entrar em qualquer visualizador · Low" },
    { title: "Página própria do visualizador, com filtros de região até caixa · Medium" },
  ],
};
