"use client";

import { useState } from "react";

import { deleteItemComment, editItemComment } from "@/lib/actions/comments";
import { mayChangeComment } from "@/lib/comment-author";
import type { Note } from "@/lib/types";

// One Comment of an item (issue #23): who wrote it (the profile's name, or the GitHub login of a comment from there),
// when, and, for whoever wrote it and the admin, Edit and Delete. The next sync takes the change to the issue.
export function ItemComment({
  note,
  viewer,
  onChanged,
}: {
  note: Note;
  viewer: { id: string; role: string } | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const canChange = mayChangeComment(note, viewer);
  const author = note.authorName ?? (note.author === "scrum_master" ? "Scrum Master" : "Dev");

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    action()
      .then(onChanged)
      .catch((e) => console.error("Comment change failed", e))
      .finally(() => {
        setBusy(false);
        setEditing(false);
        setConfirming(false);
      });
  };

  return (
    <div data-comment-id={note.id} className="rounded-lg bg-rs-lane p-2 text-xs text-rs-text">
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <b>{author}</b>
        <span className="text-rs-text-faint">
          · {note.when}
          {note.edited ? " · edited" : ""}
        </span>
        {canChange && !editing && !confirming && (
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={() => setEditing(true)} className="font-bold text-rs-brand-text">
              Edit
            </button>
            <button type="button" onClick={() => setConfirming(true)} className="font-bold text-rs-text-faint">
              Delete
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <textarea
            aria-label="Edit Comment"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="rounded-md border border-rs-border bg-rs-card p-1.5 text-xs text-rs-text"
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !draft.trim()} onClick={() => run(() => editItemComment(note.id, draft))} className="font-bold text-rs-brand-text disabled:opacity-60">
              Save
            </button>
            <button type="button" onClick={() => { setEditing(false); setDraft(note.text); }} className="text-rs-text-faint">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="whitespace-pre-wrap">{note.text}</div>
      )}
      {confirming && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span>Delete this Comment? It is also deleted on the issue.</span>
          <button type="button" disabled={busy} onClick={() => run(() => deleteItemComment(note.id))} className="font-bold text-rs-red-text disabled:opacity-60">
            Delete
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="text-rs-text-faint">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
