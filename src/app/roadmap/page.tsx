"use client";

import { useEffect, useState } from "react";
import { NavBar } from "@/components/NavBar";
import { ItemCard, type EditDraft } from "@/components/ItemCard";
import { ConfigPanel } from "@/components/ConfigPanel";
import { createRoadmapItem, getRoadmapBoard, moveRoadmapItemLane, saveRoadmapItemEdit } from "@/lib/actions/roadmap";
import { createClient } from "@/lib/supabase/client";
import type { Effort, Lane, Prioridade, Role, RoadmapGroup, RoadmapItem, ViewAs } from "@/lib/types";

export default function RoadmapPage() {
  // Real session, real role — null while loading, so we default to the least-privileged view
  // (no toggle, no edit) until we actually know who's asking.
  const [myRole, setMyRole] = useState<Role | null>(null);
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (profile?.role) setMyRole(profile.role as Role);
    });
  }, []);

  const isAdmin = myRole === "admin";

  // Non-admins are locked to their own role's view; only admin can flip between them, or open Config.
  const [adminView, setAdminView] = useState<ViewAs | "config">("scrum_master");
  useEffect(() => {
    if (myRole && myRole !== "admin") setAdminView(myRole === "dev" ? "dev" : "scrum_master");
  }, [myRole]);
  const activeView: ViewAs = adminView === "config" ? "scrum_master" : isAdmin ? adminView : ((myRole ?? "dev") as ViewAs);

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

  function addItem(laneId: string) {
    createRoadmapItem(laneId)
      .then((item) => {
        setLanes((prev) => prev.map((lane) => (lane.id === laneId ? { ...lane, items: [...lane.items, item] } : lane)));
      })
      .catch((e) => console.error("createRoadmapItem failed", e));
  }

  function startEdit(item: RoadmapItem) {
    setEditingId(item.id);
    setEditDraft({ prioridade: item.prioridade, effort: item.effort, note: "" });
  }

  function saveEdit(itemId: string) {
    if (!editDraft) return;
    setEditingId(null);
    setEditDraft(null);
    saveRoadmapItemEdit(itemId, { ...editDraft, activeView })
      .then(reloadBoard)
      .catch((e) => console.error("saveRoadmapItemEdit failed", e));
  }

  const roleLabel =
    myRole === null ? "Visitante" : adminView === "config" ? "Config" : activeView === "scrum_master" ? "Scrum Master" : "Dev";

  return (
    <div className="min-h-screen">
      <NavBar active="roadmap" roleLabel={roleLabel} />

      <div className="flex flex-col gap-6 p-10">
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-3xl font-extrabold text-rs-text">Roadmap</h1>
            {adminView !== "config" && activeView === "scrum_master" && (
              <p className="text-[15px] text-rs-text-soft">GeoCloud · defina o que entra e quando</p>
            )}
          </div>

          {isAdmin && (
            <div className="flex items-center gap-1 rounded-full border border-rs-border bg-rs-card p-1">
              {(["dev", "scrum_master", "config"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setAdminView(v)}
                  className={`rounded-full px-4 py-2 text-[13px] font-bold ${
                    adminView === v ? "bg-zinc-900 text-white" : "text-rs-text-soft"
                  }`}
                >
                  {v === "dev" ? "Dev" : v === "scrum_master" ? "Scrum Master" : "Config"}
                </button>
              ))}
            </div>
          )}
        </div>

        {adminView === "config" ? (
          <ConfigPanel />
        ) : !boardLoaded ? (
          <p className="text-sm text-rs-text-soft">Carregando...</p>
        ) : (
          <>
            {canEdit && (
              <div className="rounded-[10px] bg-rs-brand-soft px-4 py-2.5 text-[13px] font-semibold text-rs-brand-text">
                Editando como Scrum Master — pode criar, arrastar entre sprints, ajustar prioridade/esforço e comentar.
              </div>
            )}

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
                    <span className="rounded-full border border-rs-border bg-rs-card px-2.5 py-0.5 text-xs font-bold text-rs-text-faint">
                      {lane.items.length}
                    </span>
                  </div>

                  {lane.items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      canDrag={canEdit}
                      isEditing={editingId === item.id}
                      editDraft={editingId === item.id ? editDraft : null}
                      onDragStart={() => setDraggingId(item.id)}
                      onDragEnd={() => setDraggingId(null)}
                      onStartEdit={() => startEdit(item)}
                      onPrioridadeChange={(v: Prioridade) => setEditDraft((d) => (d ? { ...d, prioridade: v } : d))}
                      onEffortChange={(v: Effort) => setEditDraft((d) => (d ? { ...d, effort: v } : d))}
                      onNoteChange={(v) => setEditDraft((d) => (d ? { ...d, note: v } : d))}
                      onSaveEdit={() => saveEdit(item.id)}
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
                </div>
              ))}
            </div>

            {canEdit && (
              <div className="text-center text-xs text-rs-text-faint">
                Arraste um item entre sprints pra reagendar, ou puxe do Roadmap abaixo · alimenta o ROADMAP e os SPRINT.md semanais
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
              <div className="grid grid-cols-5 items-start gap-4">
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
                        canDrag={canEdit}
                        isEditing={false}
                        editDraft={null}
                        onDragStart={() => setDraggingId(item.id)}
                        onDragEnd={() => setDraggingId(null)}
                        onStartEdit={() => {}}
                        onPrioridadeChange={() => {}}
                        onEffortChange={() => {}}
                        onNoteChange={() => {}}
                        onSaveEdit={() => {}}
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
