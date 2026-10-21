"use client";

import type { Effort, Prioridade, Produto, RoadmapItem } from "@/lib/types";
import { isStack, isTipo, STACKS, TIPO_LABELS, TIPOS, type Stack, type Tipo } from "@/lib/issue-fields";
import { badgeClass, effortTone, prioridadeTone, produtoTone } from "@/lib/tones";

const PRIORIDADES: Prioridade[] = ["Critical", "High", "Medium", "Low"];
const EFFORTS: Effort[] = ["Very High", "High", "Medium", "Low"];

/** content is only present when the viewer may edit title/description/produto (admin, or RoadS-created items). */
export type EditDraft = {
  prioridade: Prioridade;
  effort: Effort;
  note: string;
  content?: { title: string; description: string; produto: Produto; tipo: Tipo; stack: Stack };
};

export function ItemCard({
  item,
  canDrag,
  isEditing,
  editDraft,
  weekLabel = null,
  canDelete = false,
  canEditContent = false,
  laneId,
  moveTargets = [],
  onMoveTo,
  onDragStart,
  onDragEnd,
  onTouchDragStart,
  lifted = false,
  onDragOverCard,
  onDropOnCard,
  dropLine = false,
  onStartEdit,
  onDraftChange,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: {
  item: RoadmapItem;
  canDrag: boolean;
  isEditing: boolean;
  editDraft: EditDraft | null;
  /** A card of the Kanban's Open whose item is planned in a week: it says which ("▸ Sprint 19/10") and fades to 70%. */
  weekLabel?: string | null;
  canDelete?: boolean;
  canEditContent?: boolean;
  /** The lane the card is in and every lane it can go to — drive the "Mover para" select. A card in a week also lists
   *  "Kanban (sem semana)" (KANBAN), which unplans it like a drop on the Kanban's Open. */
  laneId?: string;
  moveTargets?: { id: string; label: string }[];
  onMoveTo?: (laneId: string) => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  /** A finger on the card: held, it lifts and follows the finger (src/lib/use-touch-drag.ts). */
  onTouchDragStart?: (e: React.TouchEvent<HTMLDivElement>) => void;
  /** The card is being dragged by a finger: its copy follows the finger, this one stays faded in place. */
  lifted?: boolean;
  /** A card of a week: another card dragged over it, and dropped, goes right before it. */
  onDragOverCard?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDropOnCard?: (e: React.DragEvent<HTMLDivElement>) => void;
  /** The orange line above the card: where the card being dragged goes if dropped now. */
  dropLine?: boolean;
  onStartEdit: () => void;
  onDraftChange: (draft: EditDraft) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const content = editDraft?.content;
  const setContent = (patch: Partial<NonNullable<EditDraft["content"]>>) => {
    if (editDraft && content) onDraftChange({ ...editDraft, content: { ...content, ...patch } });
  };

  return (
    <div
      data-item-id={item.id}
      draggable={canDrag && !isEditing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOverCard}
      onDrop={onDropOnCard}
      onTouchStart={canDrag && !isEditing ? onTouchDragStart : undefined}
      // On a touch screen a long press drags the card: no text selection, no link menu getting in the way.
      // `relative` keeps the screen-reader-only select inside the card (it is absolute): loose, it widened the page.
      style={canDrag && !isEditing ? { WebkitTouchCallout: "none" } : undefined}
      data-planned={weekLabel ? "" : undefined}
      className={`flex ${canDrag ? "cursor-move pointer-coarse:select-none pointer-coarse:[-webkit-user-drag:none]" : ""} ${
        lifted ? "opacity-40" : weekLabel ? "opacity-70" : ""
      } relative min-w-0 flex-col gap-2.5 rounded-xl border border-rs-border bg-rs-card p-3.5 [overflow-wrap:anywhere]`}
    >
      {dropLine && <div data-drop-line aria-hidden="true" className="pointer-events-none absolute -top-2 left-0 right-0 h-1 -translate-y-1/2 rounded-full bg-rs-brand" />}
      {item.url ? (
        <a href={item.url} target="_blank" rel="noreferrer" className="text-sm font-bold text-rs-text">
          {item.title}
          {item.number ? ` #${item.number}` : ""} ↗
        </a>
      ) : (
        <span className="text-sm font-bold text-rs-text">{item.title}</span>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {weekLabel && (
          <span data-week-label className={badgeClass("brand")}>
            {weekLabel}
          </span>
        )}
        <span className={badgeClass(produtoTone(item.produto))}>{item.produto}</span>
        <span className={badgeClass(prioridadeTone(item.prioridade))}>{item.prioridade}</span>
        <span className={badgeClass(effortTone(item.effort))}>{item.effort}</span>
        {item.status === "done" && <span className={badgeClass("green")}>Concluído</span>}
      </div>

      {item.desc && <p className="text-[13px] leading-snug text-rs-text-soft">{item.desc}</p>}

      {item.notes.map((n) => (
        <div key={n.id} className="rounded-lg bg-rs-lane p-2 text-xs text-rs-text">
          <b>{n.author === "scrum_master" ? "Scrum Master" : "Dev"}</b>{" "}
          <span className="text-rs-text-faint">· {n.when}</span>
          <div>{n.text}</div>
        </div>
      ))}

      {isEditing && editDraft && (
        <div className="flex flex-col gap-2 rounded-lg bg-rs-lane p-2.5">
          {content && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-rs-text-faint">Título</span>
                <input
                  value={content.title}
                  onChange={(e) => setContent({ title: e.target.value })}
                  className="rounded-lg border border-rs-border bg-rs-card px-2.5 py-2 text-base font-bold text-rs-text sm:text-xs"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-rs-text-faint">Descrição</span>
                <textarea
                  value={content.description}
                  onChange={(e) => setContent({ description: e.target.value })}
                  rows={3}
                  className="resize-y rounded-lg border border-rs-border bg-rs-card px-2.5 py-2 text-base text-rs-text sm:text-xs"
                />
              </label>
              <div className="flex gap-2">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-rs-text-faint">Tipo</span>
                  <select
                    value={content.tipo}
                    onChange={(e) => isTipo(e.target.value) && setContent({ tipo: e.target.value })}
                    className="rounded-lg border border-rs-border bg-rs-card px-2 py-1.5 text-base font-bold text-rs-text sm:text-xs"
                  >
                    {TIPOS.map((t) => (
                      <option key={t} value={t}>
                        {TIPO_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-rs-text-faint">Stack</span>
                  <select
                    value={content.stack}
                    onChange={(e) => isStack(e.target.value) && setContent({ stack: e.target.value })}
                    className="rounded-lg border border-rs-border bg-rs-card px-2 py-1.5 text-base font-bold text-rs-text sm:text-xs"
                  >
                    {STACKS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          )}
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-rs-text-faint">Prioridade</span>
              <select
                value={editDraft.prioridade}
                onChange={(e) => onDraftChange({ ...editDraft, prioridade: e.target.value as Prioridade })}
                className="rounded-lg border border-rs-border bg-rs-card px-2 py-1.5 text-base font-bold text-rs-text sm:text-xs"
              >
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-rs-text-faint">Effort</span>
              <select
                value={editDraft.effort}
                onChange={(e) => onDraftChange({ ...editDraft, effort: e.target.value as Effort })}
                className="rounded-lg border border-rs-border bg-rs-card px-2 py-1.5 text-base font-bold text-rs-text sm:text-xs"
              >
                {EFFORTS.map((ef) => (
                  <option key={ef} value={ef}>
                    {ef}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:flex-nowrap">
            <input
              value={editDraft.note}
              onChange={(e) => onDraftChange({ ...editDraft, note: e.target.value })}
              placeholder="Escrever nota (opcional)..."
              className="w-full min-w-0 flex-grow rounded-lg sm:w-auto border border-rs-border bg-rs-card px-2.5 py-2 text-base text-rs-text sm:text-xs"
            />
            <button
              onClick={onSaveEdit}
              disabled={!!content && !content.title.trim()}
              className="rounded-lg bg-rs-brand px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              Salvar
            </button>
            <button onClick={onCancelEdit} className="rounded-lg px-2 py-2 text-xs font-bold text-rs-text-soft">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {canDrag && !isEditing && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button onClick={onStartEdit} className="py-1 text-xs font-bold text-rs-brand-text">
            {canEditContent ? "Editar" : "+ nota"}
          </button>
          {canDelete && (
            <button
              onClick={() => {
                if (window.confirm(`Excluir "${item.title}"? Não dá pra desfazer.`)) onDelete();
              }}
              className="py-1 text-xs font-bold text-red-600 dark:text-red-400"
            >
              Excluir
            </button>
          )}
          {/* Below lg a select moves the card too, with a mouse; a touch screen holds and drags the card instead,
              and keeps the select only for screen readers (a way to move a card without dragging). */}
          {onMoveTo && moveTargets.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && onMoveTo(e.target.value)}
              aria-label="Mover para"
              className="ml-auto min-w-0 max-w-[65%] rounded-lg border border-rs-border bg-rs-card px-2 py-1 text-base font-bold text-rs-text-soft sm:text-xs lg:hidden pointer-coarse:sr-only pointer-coarse:focus:not-sr-only"
            >
              <option value="">Mover para…</option>
              {moveTargets
                .filter((t) => t.id !== laneId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
