-- The Stacks RoadS stores are named in English (issue #22), as src/lib/issue-fields.ts now names them. Each one is still
-- the same option of Project #7 (matched by its id), so only the stored name changes; the names already in English stay.
update public.roadmap_items
  set stack = case stack
    when 'Modelagem' then 'Modeling'
    when 'Banco de dados' then 'Database'
    when 'Geral' then 'General'
    when 'Teste Geral' then 'General Tests'
    when 'Teste Frontend' then 'Frontend Tests'
    when 'Teste Backend' then 'Backend Tests'
    when 'Documentação' then 'Documentation'
    when 'Testes' then 'Tests'
    when 'Testes/Segurança' then 'Tests/Security'
  end
  where stack in ('Modelagem', 'Banco de dados', 'Geral', 'Teste Geral', 'Teste Frontend', 'Teste Backend', 'Documentação', 'Testes', 'Testes/Segurança');
