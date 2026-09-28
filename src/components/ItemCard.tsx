"use client";

import type { Effort, Prioridade, Produto, RoadmapItem } from "@/lib/types";
import { badgeClass, effortTone, prioridadeTone, produtoTone } from "@/lib/tones";

const PRIORIDADES: Prioridade[] = ["Critical", "High", "Medium", "Low"];
const EFFORTS: Effort[] = ["Very High", "High", "Medium", "Low"];
const PRODUTOS: Produto[] = ["GeoCloud", "ELIMS"];

/** content is only present when the viewer may edit title/description/produto (admin, or RoadS-created items). */
export type EditDraft = {
  prioridade: Prioridade;
  effort: Effort;
  note: string;
  content?: { title: string; description: string; produto: Produto };
};

export function ItemCard({
  item,
  canDrag,
  isEditing,
  editDraft,
  compact = false,
  canDelete = false,
  canEditContent = false,
  laneId,
  moveTargets = [],
  onMoveTo,
  onDragStart,
  onDragEnd,
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
  compact?: boolean;
  canDelete?: boolean;
  canEditContent?: boolean;
  /** The lane the card is in and every lane it can go to — drive the "Mover para" select. */
  laneId?: string;
  moveTargets?: { id: string; label: string }[];
  onMoveTo?: (laneId: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
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
      draggable={canDrag && !isEditing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`flex ${canDrag ? "cursor-move" : ""} flex-col gap-2.5 rounded-xl border border-rs-border bg-rs-card ${
        compact ? "p-2.5" : "p-3.5"
      }`}
    >
      {item.url ? (
        <a href={item.url} target="_blank" rel="noreferrer" className={`font-bold text-rs-text ${compact ? "text-xs" : "text-sm"}`}>
          {item.title} ↗
        </a>
      ) : (
        <span className={`font-bold text-rs-text ${compact ? "text-xs" : "text-sm"}`}>{item.title}</span>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={badgeClass(produtoTone(item.produto)) + (compact ? " !text-[9px] !px-1.5" : "")}>{item.produto}</span>
        <span className={badgeClass(prioridadeTone(item.prioridade)) + (compact ? " !text-[9px] !px-1.5" : "")}>{item.prioridade}</span>
        <span className={badgeClass(effortTone(item.effort)) + (compact ? " !text-[9px] !px-1.5" : "")}>{item.effort}</span>
      </div>

      {item.desc && <p className="text-[13px] leading-snug text-rs-text-soft">{item.desc}</p>}

      {item.notes.map((n) => (
        <div key={n.id} className="rounded-lg bg-rs-lane p-2 text-xs text-rs-text">
          <b>{n.author === "scrum_master" ? "Scrum Master" : "Dev"}</b>{" "}
          <span className="text-rs-text-faint">· {n.when}</span>
          <div>{n.text}</div>
        </div>
      ))}

      {isEditing && editDraft && !compact && (
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
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-rs-text-faint">Produto</span>
                <select
                  value={content.produto}
                  onChange={(e) => setContent({ produto: e.target.value as Produto })}
                  className="rounded-lg border border-rs-border bg-rs-card px-2 py-1.5 text-base font-bold text-rs-text sm:text-xs"
                >
                  {PRODUTOS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
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
          {!compact && (
            <button onClick={onStartEdit} className="py-1 text-xs font-bold text-rs-brand-text">
              {canEditContent ? "Editar" : "+ nota"}
            </button>
          )}
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
          {/* Touch screens have no HTML drag and drop, so below lg a select moves the card. */}
          {onMoveTo && moveTargets.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && onMoveTo(e.target.value)}
              aria-label="Mover para"
              className="ml-auto min-w-0 max-w-[65%] rounded-lg border border-rs-border bg-rs-card px-2 py-1 text-base font-bold text-rs-text-soft sm:text-xs lg:hidden"
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
