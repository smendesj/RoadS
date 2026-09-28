-- Sprint rules and the 28/09 replan.
--
-- 1. Every sprint lane holds at most 4 items (the Roadmap groups have no limit). Mirrors
--    MAX_ITEMS_PER_SPRINT in src/lib/types.ts and the check in src/lib/actions/roadmap.ts.
-- 2. The three sprint lanes roll one week forward: the current sprint is now 28/09 a 02/10.
-- 3. The current sprint takes the three items the Scrum Master Luiz Damore asked for (their
--    titles kept as he wrote them); everything that was already in a sprint moves one sprint
--    later, capped at 4, and the overflow goes back to the Roadmap. Same order as the
--    SCRUM/2026/ROADMAP.md rewrite of 28/09.
-- 4. The three unedited "Novo item — edite a descrição" placeholders (created while testing,
--    no notes) are removed so they don't take sprint slots.

-- 2. Lane dates.
update public.lanes set start_date = '2026-09-28', end_date = '2026-10-02' where id = 'atual';
update public.lanes set start_date = '2026-10-05', end_date = '2026-10-09' where id = 'proxima';
update public.lanes set start_date = '2026-10-12', end_date = '2026-10-16' where id = 'terceira';

-- Group titles no longer carry sprint numbers, which shift every replan.
update public.lanes set title = 'Single View com colunas de dados' where id = 'g1';
update public.lanes set title = 'IA, relatórios e visão computacional' where id = 'g2';

-- 4. Placeholders.
delete from public.roadmap_items i
where i.title = 'Novo item — edite a descrição'
  and i.description = 'Escreva aqui, em linguagem natural, o que precisa ser feito.'
  and not exists (select 1 from public.item_notes n where n.item_id = i.id);

-- 3. Moves. Próxima sprint (05/10 a 09/10): the Sprint 3 revenue chain, still open, plus the
-- cheapest finishing item.
update public.roadmap_items set lane_id = 'proxima', sort_order = 0 where title = 'Gateway de pagamentos — Asaas e Stripe';
update public.roadmap_items set lane_id = 'proxima', sort_order = 1 where title = 'Cobrança por tokenização';
update public.roadmap_items set lane_id = 'proxima', sort_order = 2 where title = 'As duas visualizações das caixas disponíveis, vertical e horizontal';
update public.roadmap_items set lane_id = 'proxima', sort_order = 3 where title = 'Sidebar recuado ao entrar em qualquer visualizador';

-- Sprint seguinte (12/10 a 16/10): the rest of the viewer finishing batch.
update public.roadmap_items set lane_id = 'terceira', sort_order = 0 where title = 'Página própria do visualizador, com filtros de região até caixa';
update public.roadmap_items set lane_id = 'terceira', sort_order = 1 where title = 'Título do nível corrido, com a data ao lado e a imagem do nível menor';
update public.roadmap_items set lane_id = 'terceira', sort_order = 2 where title = 'Accordion do menu lateral direito: deixar explícito que abre listagem';
update public.roadmap_items set lane_id = 'terceira', sort_order = 3 where title = 'Cota do topo do furo no Single View';

-- Back to the Roadmap: the Single View items without a blocker go first in their group.
update public.roadmap_items set lane_id = 'g1', sort_order = 0 where title = 'Marcações em colunas verticais';
update public.roadmap_items set lane_id = 'g1', sort_order = 1 where title = 'Accordion por classe de geologia, com todos/desativar todos';
update public.roadmap_items set lane_id = 'g1', sort_order = 2 where title = 'Filtro para desligar classes de geologia por furo';
update public.roadmap_items set lane_id = 'g1', sort_order = 3 where title = 'Litologia metro a metro, normalizada';
update public.roadmap_items set lane_id = 'g1', sort_order = 4 where title = 'Coluna de geoquímica com gráfico e seleção do elemento';
update public.roadmap_items set lane_id = 'g1', sort_order = 5 where title = 'Coluna de mapa hiperespectral';

-- Sprint atual (28/09 a 02/10): Luiz Damore's three items, titles as he wrote them (only the
-- "nobtop" typo fixed). created_by stays null — like the other GitHub-backed items they're
-- owned by no RoadS user, so only admin changes their text.
insert into public.roadmap_items
  (lane_id, sort_order, title, description, produto, prioridade, effort, github_issue_url, github_issue_number)
values
  ('atual', 0, 'sincronização das info do user no top bar',
   'Pedido do Scrum Master Luiz Damore. Nome, foto e perfil já sincronizam (#747); falta mostrar e manter atualizados empresa, conta e plano, também na top bar horizontal.',
   'GeoCloud', 'High', 'Low', 'https://github.com/Essencis-Labs/GeoCloudAI/issues/869', 869),
  ('atual', 1, 'envio do email c link p cadastro de senha de novos usuários',
   'Pedido do Scrum Master Luiz Damore. O convite existe, mas o e-mail nunca é enviado — o link só vai para o log. Entra junto o e-mail de redefinição de senha (KI-0008), trocando código por link.',
   'GeoCloud', 'High', 'Medium', 'https://github.com/Essencis-Labs/GeoCloudAI/issues/870', 870),
  ('atual', 2, 'endpoint + frontend c tratamento do menu e telas com base nas funcionalidades atribuidas ao user',
   'Pedido do Scrum Master Luiz Damore. Endpoint com as permissões e módulos do usuário, menu montado a partir dele e guard de rota por permissão. Esconder botões dentro das telas fica para a próxima sprint.',
   'GeoCloud', 'High', 'High', 'https://github.com/Essencis-Labs/GeoCloudAI/issues/871', 871);

-- 1. The cap, enforced on insert and on any move into a sprint lane.
create or replace function public.enforce_sprint_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.lane_id = old.lane_id then
    return new;
  end if;
  if exists (select 1 from public.lanes l where l.id = new.lane_id and l.kind = 'sprint')
     and (select count(*) from public.roadmap_items i where i.lane_id = new.lane_id and i.id <> new.id) >= 4 then
    raise exception 'sprint % already has 4 items', new.lane_id;
  end if;
  return new;
end;
$$;

drop trigger if exists roadmap_items_sprint_capacity on public.roadmap_items;
create trigger roadmap_items_sprint_capacity
  before insert or update of lane_id on public.roadmap_items
  for each row execute function public.enforce_sprint_capacity();
