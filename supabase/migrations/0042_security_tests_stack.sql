-- The Stack option "Tests/Security" is named "Security Tests" in RoadS and on Project #7 (issue #23). It is the same
-- option of the board (matched by its id, a0c84fd1), so only the stored name changes.
update public.roadmap_items
  set stack = 'Security Tests'
  where stack = 'Tests/Security';

-- The two-way sync's base keeps the same name, so the rename is not read as an edit on either side.
update public.roadmap_items
  set github_seen = jsonb_set(github_seen, '{stack}', '"Security Tests"')
  where github_seen->>'stack' = 'Tests/Security';
