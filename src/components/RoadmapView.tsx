"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { NavBar } from "@/components/NavBar";
import { ItemCard, type EditDraft } from "@/components/ItemCard";
import { SyncButton } from "@/components/SyncButton";
import { createRoadmapItem, deleteRoadmapItem, getRoadmapBoard, moveRoadmapItemLane, saveRoadmapItemEdit } from "@/lib/actions/roadmap";
import { syncBoardAsViewer } from "@/lib/actions/sync";
import { retryDelay, touchesCurrentSprint } from "@/lib/auto-sync";
import { useAutoSync } from "@/lib/use-auto-sync";
import { useTouchDrag } from "@/lib/use-touch-drag";
import { orderGroups } from "@/lib/group-order";
import { isStack } from "@/lib/issue-fields";
import { newestIssueFirst } from "@/lib/issue-order";
import { moveItem } from "@/lib/roadmap-move";
import { brakeMessage, roadmapSyncMessage, syncFailureMessage } from "@/lib/sync-message";
import { MAX_ITEMS_PER_SPRINT, type Lane, type RoadmapGroup, type RoadmapItem, type ViewAs } from "@/lib/types";
import { roleLabel as labelFor, type Viewer } from "@/lib/viewer";

// Roadmap group columns for the current width: 3 from lg, 2 from sm, else 1 (the server renders 3).
function subscribeToWidth(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
function useGroupColumns(): number {
  return useSyncExternalStore(
    subscribeToWidth,
    () => (window.innerWidth >= 1024 ? 3 : window.innerWidth >= 640 ? 2 : 1),
    () => 3
  );
}

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
  const [groups, setGroups] = useState<RoadmapGroup[]>([]);
  const [boardLoaded, setBoardLoaded] = useState(false);

  // A reload that started before a move, or lands while one is still being saved, read the board before it: its
  // answer is dropped, so the card doesn't jump back.
  const moves = useRef({ generation: 0, inFlight: 0 });
  function reloadBoard() {
    const generation = moves.current.generation;
    getRoadmapBoard()
      .then(({ lanes, groups }) => {
        if (generation !== moves.current.generation || moves.current.inFlight > 0) return;
        setLanes(lanes);
        setGroups(groups);
        setBoardLoaded(true);
      })
      .catch((e) => console.error("getRoadmapBoard failed", e));
  }
  useEffect(reloadBoard, []);

  // Pulls GitHub again: open issues the Roadmap lacks come in, closed ones leave the groups.
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

  const [draggingId, setDraggingId] = useState<string | null>(null);
  // A finger holds a card and drags it (src/lib/use-touch-drag.ts); the drop is the same move as the desktop's.
  const touchDrag = useTouchDrag((itemId, toLane) => moveToLane(toLane, itemId));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const canEdit = activeView === "scrum_master";

  // Groups are dealt left to right (1-2-3, 4-5-6, 7...) into columns that each stack tightly, so
  // rows stay full in reading order and no short group leaves a gap under it.
  const groupColumnCount = useGroupColumns();
  const orderedGroups = orderGroups(groups);
  const groupColumns = Array.from({ length: groupColumnCount }, (_, c) => orderedGroups.filter((_, i) => i % groupColumnCount === c));

  // Drop targets call this with the dragged item; the "Mover para" select on each card (touch
  // screens have no HTML drag and drop) passes its item directly. Moving into a full sprint is
  // allowed on purpose: the sprint shows n/4 and a warning until the overflow is moved out.
  function moveToLane(targetLaneId: string, itemId: string | null = draggingId) {
    if (!itemId) return;
    setDraggingId(null);
    const from = [...lanes, ...groups].find((l) => l.items.some((it) => it.id === itemId))?.id;
    const next = moveItem({ lanes, groups }, itemId, targetLaneId);
    if (!next) return;
    setLanes(next.lanes);
    setGroups(next.groups);

    const counters = moves.current;
    counters.inFlight++;
    counters.generation++;
    moveRoadmapItemLane(itemId, targetLaneId)
      .then(() => {
        counters.inFlight--;
        if (from && touchesCurrentSprint(from, targetLaneId, currentWeek)) syncAfterMove();
      })
      .catch((e) => {
        counters.inFlight--;
        console.error("moveRoadmapItemLane failed, reloading board", e);
        reloadBoard();
      });
  }

  // The week whose dates hold today (the server tells which); null when the board has no lane for it.
  const currentWeek = lanes.find((l) => l.current)?.id ?? null;

  const moveTargets = [
    ...lanes.map((l) => ({ id: l.id, label: `${l.title} (${l.items.length}/${MAX_ITEMS_PER_SPRINT})` })),
    ...groups.map((g) => ({ id: g.id, label: `Roadmap · ${g.title}` })),
  ];

  function addItem(laneId: string) {
    createRoadmapItem(laneId)
      .then((item) => {
        setLanes((prev) => prev.map((lane) => (lane.id === laneId ? { ...lane, items: [...lane.items, item] } : lane)));
        // A new item opens straight into edit mode — no extra click on "Editar".
        startEdit(item);
      })
      .catch((e) => console.error("createRoadmapItem failed", e));
  }

  function startEdit(item: RoadmapItem) {
    setEditingId(item.id);
    setEditDraft({
      prioridade: item.prioridade,
      effort: item.effort,
      note: "",
      content: canEditContent(item)
        ? {
            title: item.title,
            description: item.desc,
            produto: item.produto,
            tipo: item.tipo ?? "feature",
            stack: isStack(item.stack) ? item.stack : "Geral",
          }
        : undefined,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  // Admin has full control. A scrum_master fully edits and deletes only their own items, can
  // still adjust prioridade/effort/nota/lane on the seeded ones (no creator), and can't touch
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
    setEditingId(null);
    setEditDraft(null);
    saveRoadmapItemEdit(itemId, { ...editDraft, activeView })
      .then(reloadBoard)
      .catch((e) => console.error("saveRoadmapItemEdit failed", e));
  }

  return (
    <div className="min-h-screen">
      <NavBar active="roadmap" roleLabel={labelFor(myRole)} avatar={viewer?.avatar ?? null} showConfig={isAdmin} />

      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-extrabold text-rs-text sm:text-3xl">Roadmap</h1>
            {myRole !== null && (
              <p className="text-[15px] text-rs-text-soft">
                {activeView === "scrum_master" ? "GeoCloud · defina o que entra e quando" : "GeoCloud"}
              </p>
            )}
          </div>
          {myRole !== null && (
            <div className="flex flex-col items-end gap-1">
              <SyncButton onClick={syncIssues} isPending={isSyncing} />
              {syncMessage && <span className="max-w-[260px] text-right text-[11px] text-rs-text-faint">{syncMessage}</span>}
            </div>
          )}
        </div>

        {!boardLoaded ? (
          <p className="text-sm text-rs-text-soft">Carregando...</p>
        ) : (
          <>
            {/* The sprints are weeks, in date order, titled by their dates; the current one is tinted. Below lg they sit
                in a swipeable row, each close to one screen wide. */}
            <div data-drag-scroll="x" className="-mx-4 flex snap-x snap-mandatory items-start gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0">
              {lanes.map((lane) => (
                <div
                  key={lane.id}
                  data-lane-id={lane.id}
                  aria-current={lane.current ? "date" : undefined}
                  data-drop-target={touchDrag.over === lane.id ? "" : undefined}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    moveToLane(lane.id);
                  }}
                  className={`flex min-h-[240px] w-[85%] max-w-[380px] shrink-0 snap-start flex-col gap-3 rounded-2xl border p-4 lg:w-auto lg:max-w-none ${
                    lane.current ? "bg-rs-brand-soft" : "bg-rs-lane"
                  } ${touchDrag.over === lane.id ? "border-rs-brand" : "border-rs-border"}`}
                >
                  <div className="flex items-center justify-between">
                    <div className={`text-sm font-extrabold ${lane.current ? "text-rs-brand-text" : "text-rs-text"}`}>{lane.title}</div>
                    <span
                      className={
                        lane.items.length > MAX_ITEMS_PER_SPRINT
                          ? "rounded-full border border-rs-brand bg-rs-brand-soft px-2.5 py-0.5 text-xs font-bold text-rs-brand-text"
                          : "rounded-full border border-rs-border bg-rs-card px-2.5 py-0.5 text-xs font-bold text-rs-text-faint"
                      }
                    >
                      {lane.items.length}/{MAX_ITEMS_PER_SPRINT}
                    </span>
                  </div>

                  {newestIssueFirst(lane.items, (i) => i.number).map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      canDrag={canModifyItem(item)}
                      laneId={lane.id}
                      moveTargets={moveTargets}
                      onMoveTo={(target) => moveToLane(target, item.id)}
                      isEditing={editingId === item.id}
                      editDraft={editingId === item.id ? editDraft : null}
                      onDragStart={(e) => (touchDrag.touchOwnsDrag() ? e.preventDefault() : setDraggingId(item.id))}
                      onDragEnd={() => setDraggingId(null)}
                      onTouchDragStart={(e) => touchDrag.start(e, item.id, lane.id)}
                      lifted={touchDrag.lifted === item.id}
                      canDelete={canDeleteItem(item)}
                      canEditContent={canEditContent(item)}
                      onStartEdit={() => startEdit(item)}
                      onDraftChange={setEditDraft}
                      onSaveEdit={() => saveEdit(item.id)}
                      onCancelEdit={cancelEdit}
                      onDelete={() => removeItem(item.id)}
                    />
                  ))}

                  {canEdit && (
                    <button
                      onClick={() => addItem(lane.id)}
                      className="rounded-[10px] border border-dashed border-rs-border bg-rs-card p-2.5 text-[13px] font-bold text-rs-text-soft"
                    >
                      + Novo item
                    </button>
                  )}

                  {lane.items.length > MAX_ITEMS_PER_SPRINT && (
                    <div className="rounded-[10px] border border-rs-brand bg-rs-brand-soft px-3 py-2 text-[12px] font-semibold text-rs-brand-text">
                      ⚠️ Esta sprint tem {lane.items.length} itens, e o limite é {MAX_ITEMS_PER_SPRINT} issues por sprint. Mova{" "}
                      {lane.items.length - MAX_ITEMS_PER_SPRINT} item(ns) para outra sprint ou de volta ao Roadmap.
                    </div>
                  )}
                </div>
              ))}
            </div>

            {canEdit && (
              <div className="rounded-[10px] bg-rs-brand-soft px-4 py-2.5 text-[13px] font-semibold text-rs-brand-text">
                Você pode criar novos itens e arrastar itens entre as Sprints e o Roadmap. No celular, segure o card e arraste.
              </div>
            )}

            <div className="mt-3 flex flex-col gap-3.5 border-t border-rs-border pt-6">
              <div>
                <div className="text-xl font-extrabold text-rs-text">Roadmap</div>
                {canEdit && (
                  <div className="text-[13px] text-rs-text-soft">
                    Toda issue aberta que ainda não entrou em uma sprint — arraste pra uma das três colunas acima quando priorizar
                  </div>
                )}
              </div>
              <div className="flex items-start gap-4">
                {groupColumns.map((column, c) => (
                  <div key={c} className="flex min-w-0 flex-1 flex-col gap-4">
                    {column.map((g) => (
                      <div
                        key={g.id}
                        data-lane-id={g.id}
                        data-drop-target={touchDrag.over === g.id ? "" : undefined}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          moveToLane(g.id);
                        }}
                        className={`flex flex-col gap-2.5 rounded-2xl border bg-rs-lane p-3.5 ${touchDrag.over === g.id ? "border-rs-brand" : "border-rs-border"}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-extrabold leading-snug text-rs-text-soft">{g.title}</span>
                          <span className="text-[11px] font-bold text-rs-text-faint">{g.items.length}</span>
                        </div>
                        {/* A long group scrolls inside its box instead of stretching the whole column. */}
                        <div data-drag-scroll="y" className="-mr-1.5 flex max-h-[560px] flex-col gap-2.5 overflow-y-auto pr-1.5">
                          {newestIssueFirst(g.items, (i) => i.number).map((item) => (
                            <ItemCard
                              key={item.id}
                              item={item}
                              compact
                              canDrag={canModifyItem(item)}
                              laneId={g.id}
                              moveTargets={moveTargets}
                              onMoveTo={(target) => moveToLane(target, item.id)}
                              isEditing={false}
                              editDraft={null}
                              onDragStart={(e) => (touchDrag.touchOwnsDrag() ? e.preventDefault() : setDraggingId(item.id))}
                              onDragEnd={() => setDraggingId(null)}
                              onTouchDragStart={(e) => touchDrag.start(e, item.id, g.id)}
                              lifted={touchDrag.lifted === item.id}
                              canDelete={canDeleteItem(item)}
                              onStartEdit={() => {}}
                              onDraftChange={() => {}}
                              onSaveEdit={() => {}}
                              onCancelEdit={() => {}}
                              onDelete={() => removeItem(item.id)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
