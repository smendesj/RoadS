"use client";

import { useEffect, useRef, useState, useTransition, type ComponentProps, type HTMLAttributes, type ReactNode } from "react";
import { NavBar } from "@/components/NavBar";
import { ItemCard, type EditDraft } from "@/components/ItemCard";
import { SyncButton } from "@/components/SyncButton";
import { createRoadmapItem, deleteRoadmapItem, getRoadmapBoard, moveRoadmapItemLane, saveRoadmapItemEdit } from "@/lib/actions/roadmap";
import { syncBoardAsViewer } from "@/lib/actions/sync";
import { listAssignableProfiles } from "@/lib/actions/assignees";
import { retryDelay, touchesCurrentSprint } from "@/lib/auto-sync";
import type { SyncColumn } from "@/lib/board-sync";
import { useAutoSync } from "@/lib/use-auto-sync";
import { useTouchDrag, useTouchHover, type TouchHover, type TouchSpot } from "@/lib/use-touch-drag";
import { isStack } from "@/lib/issue-fields";
import { selectorStatus } from "@/lib/bilateral-sync";
import { KANBAN, NEW_ITEM_LANE, unplanLane } from "@/lib/issue-lane";
import { DONE_WINDOW_DAYS, kanbanColumns, type KanbanIssue } from "@/lib/kanban";
import { columnClass, KANBAN_TABS, shownTab, type KanbanTab } from "@/lib/kanban-tabs";
import { moveItem } from "@/lib/roadmap-move";
import { brakeMessage, roadmapSyncMessage, syncFailureMessage } from "@/lib/sync-message";
import { badgeClass } from "@/lib/tones";
import { MAX_ITEMS_PER_SPRINT, type Lane, type RoadmapGroup, type RoadmapItem, type ViewAs } from "@/lib/types";
import type { Viewer } from "@/lib/viewer";
import { elimsNote, recentDone, ROADMAP, showAllDone, showRecentDone } from "@/lib/text/roadmap";

/** Where a card being edited is: an item planned in a week shows in the week and in the Kanban's Open, and only the
 *  copy whose "Edit" was pressed opens. */
type Place = "week" | "open";

// The viewer comes from the server with the page, so the real session and role are known from the
// first render (null only when nobody is signed in, which gets the least-privileged view: no edit).
export function RoadmapView({ viewer }: { viewer: Viewer | null }) {
  const myRole = viewer?.role ?? null;
  const myId = viewer?.id ?? null;

  const isAdmin = myRole === "admin";

  // The view follows the real role, with no toggle: dev always sees the dev view; scrum_master
  // and admin (full, unrestricted access) always see the scrum_master view.
  const activeView: ViewAs = myRole === "scrum_master" || myRole === "admin" ? "scrum_master" : "dev";

  const [lanes, setLanes] = useState<Lane[]>([]);
  // The type lanes: where an item with no week sits. No screen shows them as such; their items are the Kanban's Open.
  const [groups, setGroups] = useState<RoadmapGroup[]>([]);
  // The Project #7 snapshot the Kanban is built from (src/lib/kanban.ts), and when the board was read: Done's 14 days
  // are counted to then.
  const [columns, setColumns] = useState<SyncColumn[]>([]);
  const [readAt, setReadAt] = useState(0);
  const [boardLoaded, setBoardLoaded] = useState(false);

  // A reload that started before a move, or lands while one is still being saved, read the board before it: its
  // answer is dropped, so the card doesn't jump back.
  const moves = useRef({ generation: 0, inFlight: 0 });
  function reloadBoard() {
    const generation = moves.current.generation;
    getRoadmapBoard()
      .then(({ lanes, groups, columns }) => {
        if (generation !== moves.current.generation || moves.current.inFlight > 0) return;
        setLanes(lanes);
        setGroups(groups);
        setColumns(columns);
        setReadAt(Date.now());
        setBoardLoaded(true);
      })
      .catch((e) => console.error("getRoadmapBoard failed", e));
  }
  useEffect(reloadBoard, []);

  // Who can be an Assignee (issue #23): the profiles the admin tied to a GitHub login; cards show them by name.
  const [people, setPeople] = useState<{ login: string; name: string }[]>([]);
  useEffect(() => {
    if (!viewer) return;
    listAssignableProfiles()
      .then(setPeople)
      .catch((e) => console.error("listAssignableProfiles failed", e));
  }, [viewer]);

  // Pulls GitHub again: open issues the Roadmap lacks come in, closed ones leave the Kanban.
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [isSyncing, startSync] = useTransition();
  function syncIssues() {
    setSyncMessage(null);
    startSync(async () => {
      const result = await syncBoardAsViewer();
      if (!result.ok) {
        setSyncMessage(syncFailureMessage(result));
        return;
      }
      setSyncMessage(result.cached ? brakeMessage(result.retryInMs) : roadmapSyncMessage(result.roadmap));
      reloadBoard();
    });
  }

  const mounted = useRef(true);
  const retryTimer = useRef<number | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, []);

  // Kept in step with GitHub by itself (src/lib/auto-sync.ts), quietly; the board reloads only when the sync ran.
  useAutoSync(() => {
    syncBoardAsViewer({ auto: true })
      .then((result) => {
        if (result.ok && !result.cached) reloadBoard();
      })
      .catch((e) => console.error("auto sync failed", e));
  }, viewer !== null);

  // A move into or out of the current sprint changes the Status on the Project, so it is synced at once. If the
  // button's 30-second brake holds it, it goes again when the server says the brake lets go; never after the page
  // is gone.
  function syncAfterMove() {
    syncBoardAsViewer()
      .then((result) => {
        if (!mounted.current) return;
        if (!result.ok) return setSyncMessage(syncFailureMessage(result));
        if (result.cached) {
          if (retryTimer.current) window.clearTimeout(retryTimer.current);
          retryTimer.current = window.setTimeout(syncAfterMove, retryDelay(result.retryInMs));
          return;
        }
        setSyncMessage(roadmapSyncMessage(result.roadmap));
        reloadBoard();
      })
      .catch((e) => console.error("sync after move failed", e));
  }

  /** The week or type lane an item is in. */
  const laneOf = (itemId: string) => [...lanes, ...groups].find((l) => l.items.some((it) => it.id === itemId))?.id;

  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Where the card being dragged (mouse or finger) was taken from: only a card taken out of a week unplans on the Kanban.
  const [dragFrom, setDragFrom] = useState<Place | null>(null);
  // The card of a week a mouse drag is over: the dragged card goes right before it, where an orange line shows.
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  // A finger holds a card and drags it (src/lib/use-touch-drag.ts); the drop is the same move as the desktop's.
  const touchDrag = useTouchDrag((itemId, toLane, beforeId) => moveToLane(toLane, itemId, beforeId));
  const [editing, setEditing] = useState<{ id: string; place: Place } | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [allDone, setAllDone] = useState(false);
  // Below lg the Kanban shows one column at a time, picked by its tabs (src/lib/kanban-tabs.ts).
  const [tab, setTab] = useState<KanbanTab>("open");

  const canEdit = activeView === "scrum_master";

  // Drop targets call this with the dragged item; the "Move to" select on each card (touch
  // screens have no HTML drag and drop) passes its item directly. Moving into a full sprint is
  // allowed on purpose: the sprint shows n/4 and a warning until the overflow is moved out.
  // In a week the item goes right before the card it was dropped on (`beforeId`), else last (src/lib/roadmap-move.ts).
  // A card of the Kanban's Open is its item, wherever that is: dropped on a week, the item is planned there (or moved
  // there from the week it was planned in), and its card stays in Open, labelled with the week.
  // A card taken out of a week and dropped on the Kanban's Open (KANBAN) unplans the item: the server puts it in a type
  // lane of its choosing, so the screen shows it there at once by the item's stored type and then reads the board again.
  // Its own card in Open dropped back on Open is no unplanning: nothing changes. The "Move to" select names the place
  // its card is in (`taken`), since no drag says it.
  function moveToLane(targetLaneId: string, itemId: string | null = draggingId, beforeId: string | null = null, taken: Place | null = dragFrom) {
    setDropBefore(null);
    setDragFrom(null);
    if (!itemId) return;
    setDraggingId(null);
    const unplan = targetLaneId === KANBAN;
    if (unplan && taken !== "week") return;
    const before = lanes.some((l) => l.id === targetLaneId) ? beforeId : null;
    const from = laneOf(itemId);
    // The row of weeks changes shape when a week is born (dropped on one the database lacks) or a week empties (the
    // server deletes a future one): the board is read again once the move is saved.
    const reshapes = !!lanes.find((l) => l.id === targetLaneId)?.virtual || lanes.find((l) => l.id === from)?.items.length === 1;
    const next = unplan ? unplanOnScreen(itemId) : moveItem({ lanes, groups }, itemId, targetLaneId, before);
    if (!next) return;
    setLanes(next.lanes);
    setGroups(next.groups);

    const counters = moves.current;
    counters.inFlight++;
    counters.generation++;
    moveRoadmapItemLane(itemId, targetLaneId, before)
      .then(() => {
        counters.inFlight--;
        if (from && touchesCurrentSprint(from, targetLaneId, currentWeek)) syncAfterMove();
        else if (reshapes || unplan) reloadBoard();
      })
      .catch((e) => {
        counters.inFlight--;
        console.error("moveRoadmapItemLane failed, reloading board", e);
        reloadBoard();
      });
  }

  // The board right after an item of a week is dropped on the Kanban, until the server's answer is read: the item out of
  // its week, in the type lane of its stored type. Null for an item in no week.
  function unplanOnScreen(itemId: string): { lanes: Lane[]; groups: RoadmapGroup[] } | null {
    const item = lanes.flatMap((l) => l.items).find((it) => it.id === itemId);
    if (!item) return null;
    const to = unplanLane([], item.tipo ?? null, new Set(groups.map((g) => g.id)));
    const withLane = groups.some((g) => g.id === to) ? groups : [...groups, { id: to, title: to, items: [] }];
    return moveItem({ lanes, groups: withLane }, itemId, to);
  }

  // The week whose dates hold today (the server tells which); null when the board has no lane for it.
  const currentWeek = lanes.find((l) => l.current)?.id ?? null;

  // A card goes to a week; a card in a week can also go back to the Kanban, unplanned the way a drop on Open does it.
  const moveTargets = lanes.map((l) => ({ id: l.id, label: `${l.title} (${l.items.length}/${MAX_ITEMS_PER_SPRINT})` }));
  const weekMoveTargets = [...moveTargets, { id: KANBAN, label: ROADMAP.kanbanNoWeek }];

  // "+ New item": born in a type lane, with no week, it shows first in the Kanban's Open, open for editing.
  function addItem() {
    createRoadmapItem()
      .then((item) => {
        setGroups((prev) =>
          prev.some((g) => g.id === NEW_ITEM_LANE)
            ? prev.map((g) => (g.id === NEW_ITEM_LANE ? { ...g, items: [...g.items, item] } : g))
            : [...prev, { id: NEW_ITEM_LANE, title: "Features", items: [item] }]
        );
        // A new item opens straight into edit mode — no extra click on "Edit".
        startEdit(item, "open");
      })
      .catch((e) => console.error("createRoadmapItem failed", e));
  }

  function startEdit(item: RoadmapItem, place: Place) {
    setEditing({ id: item.id, place });
    const inCurrentWeek = !!currentWeek && lanes.some((l) => l.id === currentWeek && l.items.some((it) => it.id === item.id));
    setEditDraft({
      prioridade: item.prioridade,
      effort: item.effort,
      note: "",
      assignees: item.assignees ?? [],
      status: selectorStatus(item.state ?? "Open", inCurrentWeek),
      content: canEditContent(item)
        ? {
            title: item.title,
            description: item.desc,
            produto: item.produto,
            tipo: item.tipo ?? "feature",
            stack: isStack(item.stack) ? item.stack : "General",
          }
        : undefined,
    });
  }

  function cancelEdit() {
    setEditing(null);
    setEditDraft(null);
  }

  // Admin has full control. A scrum_master fully edits and deletes only their own items, can
  // still adjust priority/effort/comment/lane on the seeded ones (no creator), and can't touch
  // items another user created. Mirrors getItemAccess in roadmap.ts.
  const isOwn = (item: RoadmapItem) => !!myId && item.createdBy === myId;
  const canModifyItem = (item: RoadmapItem) => canEdit && (isAdmin || isOwn(item) || !item.createdBy);
  const canEditContent = (item: RoadmapItem) => isAdmin || isOwn(item);
  const canDeleteItem = (item: RoadmapItem) => canEdit && (isAdmin || isOwn(item));

  function removeItem(itemId: string) {
    setLanes((prev) => prev.map((lane) => ({ ...lane, items: lane.items.filter((it) => it.id !== itemId) })));
    setGroups((prev) => prev.map((g) => ({ ...g, items: g.items.filter((it) => it.id !== itemId) })));
    deleteRoadmapItem(itemId).catch((e) => {
      console.error("deleteRoadmapItem failed, reloading board", e);
      reloadBoard();
    });
  }

  function saveEdit(itemId: string) {
    if (!editDraft) return;
    setEditing(null);
    setEditDraft(null);
    saveRoadmapItemEdit(itemId, { ...editDraft, activeView })
      .then(reloadBoard)
      .catch((e) => console.error("saveRoadmapItemEdit failed", e));
  }

  // What every card, in a week or in Open, does with its item.
  const cardProps = (item: RoadmapItem, place: Place, laneId: string | undefined) => {
    const isEditing = editing?.id === item.id && editing.place === place;
    return {
      item,
      canDrag: canModifyItem(item),
      laneId,
      moveTargets: place === "week" ? weekMoveTargets : moveTargets,
      onMoveTo: (target: string) => moveToLane(target, item.id, null, place),
      isEditing,
      editDraft: isEditing ? editDraft : null,
      onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
        if (touchDrag.touchOwnsDrag()) return e.preventDefault();
        setDraggingId(item.id);
        setDragFrom(place);
      },
      onDragEnd: () => {
        setDraggingId(null);
        setDragFrom(null);
        setDropBefore(null);
      },
      onTouchDragStart: (e: React.TouchEvent<HTMLDivElement>) => {
        const from = laneOf(item.id);
        if (!from) return;
        setDragFrom(place);
        touchDrag.start(e, item.id, from);
      },
      lifted: touchDrag.lifted === item.id,
      canDelete: canDeleteItem(item),
      canEditContent: canEditContent(item),
      onStartEdit: () => startEdit(item, place),
      onDraftChange: setEditDraft,
      onSaveEdit: () => saveEdit(item.id),
      onCancelEdit: cancelEdit,
      onDelete: () => removeItem(item.id),
      viewer: viewer ? { id: viewer.id, role: viewer.role } : null,
      onCommentsChanged: reloadBoard,
      people,
    };
  };

  const kanban = kanbanColumns(columns, { lanes, groups }, readAt);
  // A finger carrying a card taken out of a week is over the Kanban's Open.
  const unplanOver = (spot: TouchSpot) => spot.over === KANBAN && dragFrom === "week";
  const done = allDone ? kanban.done.all : kanban.done.recent;
  // A card taken out of a week, carried by mouse or finger, brings Open on screen, where it is dropped to unplan it.
  const shown = shownTab(tab, dragFrom === "week" && (draggingId !== null || touchDrag.lifted !== null));
  const counts: Record<KanbanTab, number> = { open: kanban.open.length, done: done.length };
  const elims = columns.reduce((sum, c) => sum + (c.elims ?? 0), 0);

  return (
    <div className="min-h-screen">
      {/* Sync sits in the bar, beside the theme toggle; its message hangs below it without moving the bar. */}
      <NavBar
        active="roadmap"
        role={myRole}
        avatar={viewer?.avatar ?? null}
        showConfig={isAdmin}
        actions={
          myRole !== null && (
            <div className="relative">
              <SyncButton onClick={syncIssues} isPending={isSyncing} />
              {syncMessage && (
                <span className="absolute right-0 top-full z-30 mt-1 w-max max-w-[260px] rounded-md bg-rs-card px-1.5 py-0.5 text-right text-[11px] text-rs-text-faint">
                  {syncMessage}
                </span>
              )}
            </div>
          )
        }
      />

      {/* The page has no visible title: the weeks start right under the bar. From lg the page keeps a narrow margin (14px)
          so three weeks fit side by side on a laptop. */}
      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:px-3.5 lg:pb-10 lg:pt-0.5">
        <h1 className="sr-only">Roadmap</h1>

        {!boardLoaded ? (
          <p className="text-sm text-rs-text-soft">{ROADMAP.loading}</p>
        ) : (
          <>
            {/* The sprints are weeks, in date order, titled by their dates; the current one is tinted. They sit in one row
                that scrolls sideways at every width (below lg each week is 85% of the screen wide, so the next one shows
                at the edge): from the current week to the last one with an item, plus an empty one at the end. A week the
                database lacks (dashed) is still a drop target: dropping an item on it creates it. On a wide screen the row
                stays at the top while the Kanban under it scrolls, so a week is always in reach of a card dragged from
                Open; a long week scrolls inside itself, so the row never covers the screen. */}
            <div data-weeks className="lg:sticky lg:top-0 lg:z-20 lg:-mx-3.5 lg:bg-rs-bg lg:px-3.5 lg:pb-3 lg:pt-3">
              <div data-drag-scroll="x" className="-mx-4 flex snap-x snap-mandatory items-start gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:snap-none lg:gap-5 lg:px-0">
                {lanes.map((lane) => (
                  <DropZone
                    key={lane.id}
                    hover={touchDrag.hover}
                    lit={(spot) => spot.over === lane.id}
                    data-lane-id={lane.id}
                    data-virtual={lane.virtual ? "" : undefined}
                    aria-current={lane.current ? "date" : undefined}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDropBefore(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      moveToLane(lane.id);
                    }}
                    className={(lit) =>
                      `flex min-h-[240px] w-[85vw] max-w-[380px] shrink-0 snap-start flex-col gap-3 rounded-2xl border p-4 lg:max-h-[calc(45vh_+_4rem)] lg:w-[max(300px,calc((100%_-_2.5rem)/3))] lg:max-w-none ${
                        lane.current ? "bg-rs-brand-soft" : "bg-rs-lane"
                      } ${lane.virtual ? "border-dashed" : ""} ${lit ? "border-rs-brand" : "border-rs-border"}`
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                        <div className={`text-sm font-extrabold ${lane.current ? "text-rs-brand-text" : "text-rs-text"}`}>{lane.title}</div>
                        {lane.items.length > MAX_ITEMS_PER_SPRINT && (
                          <span data-over-limit className="text-[12px] font-semibold text-rs-brand-text">
                            {ROADMAP.sprintOverLimit}
                          </span>
                        )}
                      </div>
                      <span
                        className={
                          lane.items.length > MAX_ITEMS_PER_SPRINT
                            ? "shrink-0 rounded-full border border-rs-brand bg-rs-brand-soft px-2.5 py-0.5 text-xs font-bold text-rs-brand-text"
                            : "shrink-0 rounded-full border border-rs-border bg-rs-card px-2.5 py-0.5 text-xs font-bold text-rs-text-faint"
                        }
                      >
                        {lane.items.length}/{MAX_ITEMS_PER_SPRINT}
                      </span>
                    </div>

                    {/* A week keeps the order it was given (sort_order), the one the Dashboard and Frontlights read too. The
                        padding on top keeps the orange line over the first card inside the scrolling list. */}
                    <div data-drag-scroll="y" className="-mt-2.5 flex flex-col gap-3 pt-2.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                      {lane.items.map((item) => (
                        <WeekCard
                          key={item.id}
                          hover={touchDrag.hover}
                          {...cardProps(item, "week", lane.id)}
                          // A card dragged over this one goes right before it; over itself, it stays where it is.
                          onDragOverCard={(e) => {
                            if (!draggingId) return;
                            e.preventDefault();
                            e.stopPropagation();
                            setDropBefore(item.id === draggingId ? null : item.id);
                          }}
                          onDropOnCard={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (item.id !== draggingId) return moveToLane(lane.id, draggingId, item.id);
                            setDropBefore(null);
                            setDraggingId(null);
                          }}
                          dropLine={dropBefore === item.id}
                        />
                      ))}
                    </div>
                  </DropZone>
                ))}
              </div>
            </div>

            {/* The Kanban (src/lib/kanban.ts): Open, to plan, and Done, to look at. Blocker and Development stay out. Open is
                where a card taken out of a week is dropped to unplan it (data-unplan-target, for a finger too); it is no
                lane (no data-lane-id), and the server picks the type lane the item goes to. Below lg one column shows at a
                time, picked by the tabs Open and Done (src/lib/kanban-tabs.ts); from lg both sit side by side and the tabs
                are hidden. Unlike the weeks, it is no scrolling area: a long word or link in a title or a description (an
                issue's body) breaks anywhere, or it would widen the whole page on a narrow phone. */}
            <div data-kanban className="grid grid-cols-1 items-start gap-4 [overflow-wrap:anywhere] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-5">
              <div role="tablist" aria-label="Kanban" className="flex gap-2 lg:hidden">
                {KANBAN_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    data-kanban-tab={t.id}
                    aria-selected={shown === t.id}
                    aria-controls={`kanban-${t.id}`}
                    onClick={() => setTab(t.id)}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-bold ${
                      shown === t.id ? "border-rs-brand bg-rs-brand-soft text-rs-brand-text" : "border-rs-border bg-rs-card text-rs-text-soft"
                    }`}
                  >
                    {t.label}
                    <span className="text-[12px] text-rs-text-faint">{counts[t.id]}</span>
                  </button>
                ))}
              </div>
              <DropZone
                as="section"
                hover={touchDrag.hover}
                lit={unplanOver}
                id="kanban-open"
                data-kanban-column="open"
                data-unplan-target
                onDragOver={(e) => {
                  if (!draggingId || dragFrom !== "week") return;
                  e.preventDefault();
                  setDropBefore(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  moveToLane(KANBAN);
                }}
                className={(lit) => `${columnClass("open", shown)} min-w-0 flex-col gap-3 rounded-2xl border bg-rs-lane p-4 ${lit ? "border-rs-brand" : "border-rs-border"}`}
              >
                <div className="flex items-center justify-between">
                  <span className={badgeClass("neutral")}>Open</span>
                  <span className="text-[13px] font-bold text-rs-text-faint">{kanban.open.length}</span>
                </div>
                {canEdit && (
                  <button
                    onClick={addItem}
                    className="rounded-[10px] border border-dashed border-rs-border bg-rs-card p-2.5 text-[13px] font-bold text-rs-text-soft"
                  >
                    {ROADMAP.newItem}
                  </button>
                )}
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                  {kanban.open.map((card) =>
                    card.item ? (
                      <ItemCard key={card.item.id} {...cardProps(card.item, "open", card.week?.laneId ?? laneOf(card.item.id))} weekLabel={card.week?.label ?? null} />
                    ) : (
                      <IssueCard key={card.issue!.url} issue={card.issue!} />
                    )
                  )}
                </div>
                {kanban.open.length === 0 && <div className="p-2.5 text-[13px] text-rs-text-faint">{ROADMAP.noOpenIssues}</div>}
              </DropZone>

              <section
                id="kanban-done"
                data-kanban-column="done"
                className={`${columnClass("done", shown)} min-w-0 flex-col gap-3 rounded-2xl border border-rs-border bg-rs-lane p-4`}
              >
                <div className="flex items-center justify-between">
                  <span className={badgeClass("green")}>Done</span>
                  <span className="text-[13px] font-bold text-rs-text-faint">{done.length}</span>
                </div>
                <span className="text-[12px] text-rs-text-faint">
                  {allDone ? ROADMAP.allDone : recentDone(DONE_WINDOW_DAYS)}
                </span>
                {done.map((issue) => (
                  <IssueCard key={issue.url} issue={issue} />
                ))}
                {done.length === 0 && <div className="p-2.5 text-[13px] text-rs-text-faint">{ROADMAP.noIssuesHere}</div>}
                {kanban.done.all.length > kanban.done.recent.length && (
                  <button onClick={() => setAllDone((v) => !v)} className="self-start py-1 text-xs font-bold text-rs-brand-text">
                    {allDone ? showRecentDone(DONE_WINDOW_DAYS) : showAllDone(kanban.done.all.length)}
                  </button>
                )}
              </section>
            </div>

            {/* The Project's ELIMS cards are never shown (only GeoCloud is RoadS's), so the gap to GitHub's counts is said here. */}
            {elims > 0 && (
              <p data-elims-note className="text-[13px] text-rs-text-faint">
                {elimsNote(elims)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// A card of the Project no Roadmap item holds (in Open, an issue with no type label; every card of Done): a link to the
// issue, nothing to drag.
function IssueCard({ issue }: { issue: KanbanIssue }) {
  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noreferrer"
      data-issue-card
      className="block rounded-[10px] border border-rs-border bg-rs-card p-2.5 text-[13px] text-rs-text hover:opacity-80"
    >
      {issue.title}
      <div className="mt-0.5 font-mono text-[11px] text-rs-text-faint">{issue.ref}</div>
    </a>
  );
}

// A week, or the Kanban's Open, that lights up (data-drop-target, an orange border) while a finger carries a card over
// it. It reads the spot under the finger itself, so a finger crossing the row renders again only the zone it enters
// and the one it leaves; what is inside comes from the Roadmap as it was, and stays as it is.
function DropZone({
  as: Tag = "div",
  hover,
  lit,
  className,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, "className"> & {
  as?: "div" | "section";
  hover: TouchHover;
  lit: (spot: TouchSpot) => boolean;
  className: (lit: boolean) => string;
  children: ReactNode;
}) {
  const on = useTouchHover(hover, lit);
  return (
    <Tag {...rest} data-drop-target={on ? "" : undefined} className={className(on)}>
      {children}
    </Tag>
  );
}

// A card of a week, with the orange line above it while a finger carrying another card is over it (or a mouse, by
// dropLine): only this card renders again when the line comes or goes.
function WeekCard({ hover, dropLine, ...props }: ComponentProps<typeof ItemCard> & { hover: TouchHover }) {
  const id = props.item.id;
  const touchLine = useTouchHover(hover, (spot) => spot.before === id && spot.over === props.laneId) && !props.lifted;
  return <ItemCard {...props} dropLine={dropLine || touchLine} />;
}
