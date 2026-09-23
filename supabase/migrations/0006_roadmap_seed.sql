-- Replace the single catch-all "roadmap" lane with the 5 real catalog groups the
-- UI already renders (mock-data.ts's getRoadmapGroups), then seed every lane with
-- the real GeoCloudAI/ELIMS items that were previously only in mock-data.ts. This
-- is what makes the Roadmap page's persistence layer (roadmap.ts actions) have
-- real rows to read/move/edit instead of an empty board.

delete from public.lanes where id = 'roadmap';

insert into public.lanes (id, title, kind, start_date, end_date, sort_order) values
  ('g1', 'Sprint 5 · resto (com bloqueio)', 'group', null, null, 5),
  ('g2', 'Sprint 6 · IA e visão computacional', 'group', null, null, 6),
  ('g3', 'Dados, mapas e importação', 'group', null, null, 7),
  ('g4', 'Dívida técnica', 'group', null, null, 8),
  ('g5', 'Módulos futuros', 'group', null, null, 9);

insert into public.roadmap_items
  (lane_id, sort_order, title, description, produto, prioridade, effort, github_issue_url, github_issue_number)
values
  ('atual', 0, 'Gateway de pagamentos — Asaas e Stripe', 'Billing interno com adaptador por provedor. Provedor já decidido: os dois — cotação e contratação primeiro, depois credenciais e webhook.', 'GeoCloud', 'Critical', 'Very High', 'https://github.com/Essencis-Labs/GeoCloudAI/issues/715', 715),
  ('atual', 1, 'Cobrança por tokenização', 'Preço por token consumido, entrada e saída — como Anthropic e OpenAI cobram.', 'GeoCloud', 'High', 'Medium', 'https://github.com/Essencis-Labs/GeoCloudAI/issues/716', 716),
  ('atual', 2, 'As duas visualizações das caixas disponíveis, vertical e horizontal', 'Trazido do Sprint 4 pra cobrir o espaço que a entrega antecipada da pesquisa por profundidade abriu.', 'GeoCloud', 'Medium', 'Low', 'https://github.com/Essencis-Labs/GeoCloudAI/issues/717', 717),

  ('proxima', 0, 'Página própria do visualizador, com filtros de região até caixa', 'O maior item do lote de acabamento.', 'GeoCloud', 'Medium', 'Medium', null, null),
  ('proxima', 1, 'Sidebar recuado ao entrar em qualquer visualizador', 'Acabamento visível em toda tela.', 'GeoCloud', 'Low', 'Low', null, null),
  ('proxima', 2, 'Cota do topo do furo no Single View', '', 'GeoCloud', 'Low', 'Low', null, null),
  ('proxima', 3, 'Accordion do menu lateral direito: deixar explícito que abre listagem', '', 'GeoCloud', 'Low', 'Low', null, null),
  ('proxima', 4, 'Título do nível corrido, com a data ao lado e a imagem do nível menor', '', 'GeoCloud', 'Low', 'Low', null, null),

  ('terceira', 0, 'Marcações em colunas verticais', 'A parte de Single View sem bloqueio externo.', 'GeoCloud', 'Medium', 'Medium', null, null),
  ('terceira', 1, 'Accordion por classe de geologia, com todos/desativar todos', '', 'GeoCloud', 'Medium', 'Low', null, null),
  ('terceira', 2, 'Filtro para desligar classes de geologia por furo', '', 'GeoCloud', 'Medium', 'Low', null, null),

  ('g1', 0, 'Litologia metro a metro, normalizada', 'Bloqueio: regra de normalização, decide a geologia.', 'GeoCloud', 'Medium', 'Medium', null, null),
  ('g1', 1, 'Coluna de geoquímica com gráfico e seleção do elemento', 'Bloqueio: profundidade por amostra.', 'GeoCloud', 'Medium', 'Medium', null, null),
  ('g1', 2, 'Coluna de mapa hiperespectral', 'Bloqueio: mockup e armazenamento.', 'GeoCloud', 'Low', 'Medium', null, null),

  ('g2', 0, 'Guias especializadas por classe de geologia no chat', '', 'GeoCloud', 'Medium', 'High', null, null),
  ('g2', 1, 'Segmentação de testemunho na visão computacional', 'Modelo novo — litologia já treinada, acima de 90% de acurácia.', 'GeoCloud', 'Medium', 'High', null, null),
  ('g2', 2, 'Sincronizar sample e resultados com o ELIMS', 'Depende do schema do Victor, sem previsão.', 'ELIMS', 'Medium', 'Medium', null, null),

  ('g3', 0, 'Tela de upload das informações de perfuração', 'Pode entrar a qualquer momento.', 'GeoCloud', 'Medium', 'Medium', null, null),
  ('g3', 1, 'Mapa básico com geolocalização de poços e furos', '', 'GeoCloud', 'Low', 'Medium', null, null),

  ('g4', 0, 'Escopo de empresa ao conceder acesso a projeto', 'Hoje dá pra inserir usuário de outra empresa em projeto seu — urgente, mas rápido de corrigir.', 'GeoCloud', 'Critical', 'Low', null, null),
  ('g4', 1, 'Conversão de unidade de ensaio, hoje adivinhada', 'Antes de qualquer relatório de teor sair do sistema.', 'GeoCloud', 'Medium', 'Medium', null, null),

  ('g5', 0, 'Dashboards avançados, com pedido à LLM', 'Cobrança separada.', 'GeoCloud', 'Low', 'Very High', null, null),
  ('g5', 1, 'Visualização 3D como módulo desligável', '', 'GeoCloud', 'Low', 'Very High', null, null);
