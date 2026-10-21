// The two-way sync of an item's Assignees with its issue's (issue #23). A person is a GitHub login; a RoadS profile
// is tied to one by its github_login, filled by the admin in Config. The Assignees are one field for the rule of
// issue #22 (bilateral-sync.ts): their logins, in order and in lower case, compared with the base kept per item.
// One exception on the first sync of the field: the column is new, so Assignees set in RoadS were always set by
// someone, and they go to an issue that has nobody assigned instead of being wiped by it.
//
// Pure on purpose: assignees-sync.ts reads both sides and applies the decision.

import { decideField, type FieldDecision } from "./bilateral-sync.ts";

/** The Assignees as one value: logins in lower case, sorted, joined by commas. */
export function assigneeKey(logins: string[]): string {
  return [...new Set(logins.map((l) => l.trim().toLowerCase()).filter(Boolean))].sort().join(",");
}

export function decideAssignees(f: { roads: string[]; base: string | null; github: string[]; roadsAt: string | null; githubAt: string | null }): FieldDecision {
  const roads = assigneeKey(f.roads);
  const github = assigneeKey(f.github);
  if (f.base === null && roads && !github) return "push";
  return decideField({ roads, base: f.base, github, roadsAt: f.roadsAt, githubAt: f.githubAt });
}

/** How each assignee is shown: the name of the profile with that login, else the login itself. */
export function assigneeNames(logins: string[], names: Map<string, string>): string[] {
  return logins.map((l) => names.get(l.toLowerCase()) ?? l);
}

const LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;

/** A GitHub login typed in Config: null for an empty one (clears it), undefined for one GitHub would never accept. */
export function parseLogin(input: string): string | null | undefined {
  const login = input.trim().replace(/^@/, "").toLowerCase();
  if (!login) return null;
  return LOGIN.test(login) ? login : undefined;
}
