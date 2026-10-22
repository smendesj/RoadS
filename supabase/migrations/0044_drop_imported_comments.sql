-- Comments only go up to GitHub (issue #34): RoadS no longer brings an issue's comments down, and the Roadmap card
-- shows no Comments. The rows the two-way sync of issue #23 imported from GitHub are dropped. They are the ones with no
-- RoadS author (author_id is null) that came from a comment on the issue (github_comment_id is not null); a Comment
-- written in RoadS always has its author, so none of those is touched, and the comments themselves stay on GitHub.
delete from public.item_notes
  where author_id is null
    and github_comment_id is not null;
