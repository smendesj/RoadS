"use client";

import { useEffect, useState } from "react";
import { NavBar } from "@/components/NavBar";
import { ItemCard, type EditDraft } from "@/components/ItemCard";
import { createRoadmapItem, deleteRoadmapItem, getRoadmapBoard, moveRoadmapItemLane, saveRoadmapItemEdit } from "@/lib/actions/roadmap";
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

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const canEdit = activeView === "scrum_master";

  function moveToLane(targetLaneId: string) {
    if (!draggingId) return;
    const itemId = draggingId;
    // Moving into a full sprint is allowed on purpose: the sprint shows n/4 and a warning until
    // the overflow is moved out.
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

  const laneIsFull = (laneId: string) => (lanes.find((l) => l.id === laneId)?.items.length ?? 0) >= MAX_ITEMS_PER_SPRINT;

  function addItem(laneId: string) {
    if (laneIsFull(laneId)) return;
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

      <div className="flex flex-col gap-6 p-10">
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-3xl font-extrabold text-rs-text">Roadmap</h1>
            {myRole !== null && (
              <p className="text-[15px] text-rs-text-soft">
                {activeView === "scrum_master" ? "GeoCloud · defina o que entra e quando" : "GeoCloud"}
              </p>
            )}
          </div>
        </div>

        {!boardLoaded ? (
          <p className="text-sm text-rs-text-soft">Carregando...</p>
        ) : (
          <>
            <div className="grid grid-cols-3 items-start gap-5">
              {lanes.map((lane) => (
                <div
                  key={lane.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    moveToLane(lane.id);
                  }}
                  className="flex min-h-[240px] flex-col gap-3 rounded-2xl border border-rs-border bg-rs-lane p-4"
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

                  {canEdit && !laneIsFull(lane.id) && (
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
                Você pode criar novos itens, arrastar itens existentes entre as Sprints ou Roadmap para atualizar a ordem.
              </div>
            )}

            <div className="mt-3 flex flex-col gap-3.5 border-t border-rs-border pt-6">
              <div>
                <div className="text-xl font-extrabold text-rs-text">Roadmap</div>
                {canEdit && (
                  <div className="text-[13px] text-rs-text-soft">
                    Tudo que ainda não entrou em uma sprint — arraste pra uma das três colunas acima quando priorizar
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 items-start gap-4">
                {groups.map((g) => (
                  <div
                    key={g.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      moveToLane(g.id);
                    }}
                    className="flex flex-col gap-2.5 rounded-2xl border border-rs-border bg-rs-lane p-3.5"
                  >
                    <span className="text-xs font-extrabold leading-snug text-rs-text-soft">{g.title}</span>
                    {g.items.map((item) => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        compact
                        canDrag={canModifyItem(item)}
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
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
