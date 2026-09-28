"use client";

import { useEffect, useState, useTransition } from "react";
import { NavBar } from "@/components/NavBar";
import { ItemCard, type EditDraft } from "@/components/ItemCard";
import { createRoadmapItem, deleteRoadmapItem, getRoadmapBoard, moveRoadmapItemLane, saveRoadmapItemEdit } from "@/lib/actions/roadmap";
import { syncBoardAsViewer } from "@/lib/actions/sync";
import { createClient } from "@/lib/supabase/client";
import { MAX_ITEMS_PER_SPRINT, type Lane, type Role, type RoadmapGroup, type RoadmapItem, type ViewAs } from "@/lib/types";

export default function RoadmapPage() {
  // Real session, real role — null while loading, so we default to the least-privileged view
  // (no edit) until we actually know who's asking.
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setMyId(user.id);
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (profile?.role) setMyRole(profile.role as Role);
    });
  }, []);

  const isAdmin = myRole === "admin";

  // The view follows the real role, with no toggle: dev always sees the dev view; scrum_master
  // and admin (full, unrestricted access) always see the scrum_master view.
  const activeView: ViewAs = myRole === "scrum_master" || myRole === "admin" ? "scrum_master" : "dev";

  const [lanes, setLanes] = useState<Lane[]>([]);
  const [groups, setGroups] = useState<RoadmapGroup[]>([]);
  const [boardLoaded, setBoardLoaded] = useState(false);

  function reloadBoard() {
    getRoadmapBoard().then(({ lanes, groups }) => {
      setLanes(lanes);
      setGroups(groups);
      setBoardLoaded(true);
    });
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
        setSyncMessage(result.message ?? "Erro ao sincronizar.");
        return;
      }
      const { added, removed, issuesCreated, error } = result.roadmap;
      setSyncMessage(
        error ??
          `${added} issue(s) adicionada(s), ${removed} encerrada(s) removida(s)` +
            (issuesCreated ? `, ${issuesCreated} issue(s) criada(s) para itens sem issue.` : ".")
      );
      reloadBoard();
    });
  }

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const canEdit = activeView === "scrum_master";

  // Drop targets call this with the dragged item; the "Mover para" select on each card (touch
  // screens have no HTML drag and drop) passes its item directly. Moving into a full sprint is
  // allowed on purpose: the sprint shows n/4 and a warning until the overflow is moved out.
  function moveToLane(targetLaneId: string, itemId: string | null = draggingId) {
    if (!itemId) return;
    const target = [...lanes, ...groups].find((l) => l.id === targetLaneId);
    if (target?.items.some((it) => it.id === itemId)) {
      setDraggingId(null);
      return;
    }
    let found: RoadmapItem | null = null;

    const nextLanes = lanes.map((lane) => {
      const items = lane.items.filter((it) => {
        if (it.id === itemId) {
          found = it;
          return false;
        }
        return true;
      });
      return { ...lane, items };
    });
    const nextGroups = groups.map((g) => {
      const items = g.items.filter((it) => {
        if (it.id === itemId) {
          found = it;
          return false;
        }
        return true;
      });
      return { ...g, items };
    });

    if (!found) return;
    setLanes(nextLanes.map((lane) => (lane.id === targetLaneId ? { ...lane, items: [...lane.items, found as RoadmapItem] } : lane)));
    setGroups(nextGroups);
    setDraggingId(null);

    moveRoadmapItemLane(itemId, targetLaneId).catch((e) => {
      console.error("moveRoadmapItemLane failed, reloading board", e);
      reloadBoard();
    });
  }

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
      content: canEditContent(item) ? { title: item.title, description: item.desc, produto: item.produto } : undefined,
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

  const roleLabel = myRole === null ? "Visitante" : isAdmin ? "Admin" : activeView === "scrum_master" ? "Scrum Master" : "Dev";

  return (
    <div className="min-h-screen">
      <NavBar active="roadmap" roleLabel={roleLabel} showConfig={isAdmin} />

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
          {canEdit && (
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={syncIssues}
                disabled={isSyncing}
                className="rounded-full border border-rs-border bg-rs-card px-3.5 py-2 text-[13px] font-bold text-rs-text-soft transition-colors hover:border-rs-brand hover:text-rs-brand-text disabled:opacity-70"
              >
                {isSyncing ? "Sincronizando..." : "Sincronizar issues"}
              </button>
              {syncMessage && <span className="max-w-[260px] text-right text-[11px] text-rs-text-faint">{syncMessage}</span>}
            </div>
          )}
        </div>

        {!boardLoaded ? (
          <p className="text-sm text-rs-text-soft">Carregando...</p>
        ) : (
          <>
            {/* Below lg the three sprints sit in a swipeable row, each close to one screen wide. */}
            <div className="-mx-4 flex snap-x snap-mandatory items-start gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0">
              {lanes.map((lane) => (
                <div
                  key={lane.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    moveToLane(lane.id);
                  }}
                  className="flex min-h-[240px] w-[85%] max-w-[380px] shrink-0 snap-start flex-col gap-3 rounded-2xl border border-rs-border bg-rs-lane p-4 lg:w-auto lg:max-w-none"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-extrabold text-rs-text">{lane.title}</div>
                      <div className="text-[11px] text-rs-text-faint">{lane.dates}</div>
                    </div>
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

                  {lane.items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      canDrag={canModifyItem(item)}
                      laneId={lane.id}
                      moveTargets={moveTargets}
                      onMoveTo={(target) => moveToLane(target, item.id)}
                      isEditing={editingId === item.id}
                      editDraft={editingId === item.id ? editDraft : null}
                      onDragStart={() => setDraggingId(item.id)}
                      onDragEnd={() => setDraggingId(null)}
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
                Você pode criar novos itens e arrastar itens entre as Sprints e o Roadmap. No celular, use &quot;Mover para…&quot; no card.
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
              {/* Masonry: each group sits right under the one above it in its column, whatever the
                  heights, so no row leaves a gap below a short group. */}
              <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
                {groups.map((g) => (
                  <div
                    key={g.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      moveToLane(g.id);
                    }}
                    className="mb-4 flex break-inside-avoid flex-col gap-2.5 rounded-2xl border border-rs-border bg-rs-lane p-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-extrabold leading-snug text-rs-text-soft">{g.title}</span>
                      <span className="text-[11px] font-bold text-rs-text-faint">{g.items.length}</span>
                    </div>
                    {/* A long group scrolls inside its box instead of stretching the whole column. */}
                    <div className="-mr-1.5 flex max-h-[560px] flex-col gap-2.5 overflow-y-auto pr-1.5">
                      {g.items.map((item) => (
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
                          onDragStart={() => setDraggingId(item.id)}
                          onDragEnd={() => setDraggingId(null)}
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
