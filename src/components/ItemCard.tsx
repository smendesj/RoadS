"use client";

import type { Effort, Prioridade, RoadmapItem } from "@/lib/types";
import { badgeClass, effortTone, prioridadeTone, produtoTone } from "@/lib/tones";

const PRIORIDADES: Prioridade[] = ["Critical", "High", "Medium", "Low"];
const EFFORTS: Effort[] = ["Very High", "High", "Medium", "Low"];

export type EditDraft = { prioridade: Prioridade; effort: Effort; note: string };

export function ItemCard({
  item,
  canDrag,
  isEditing,
  editDraft,
  compact = false,
  onDragStart,
  onDragEnd,
  onStartEdit,
  onPrioridadeChange,
  onEffortChange,
  onNoteChange,
  onSaveEdit,
}: {
  item: RoadmapItem;
  canDrag: boolean;
  isEditing: boolean;
  editDraft: EditDraft | null;
  compact?: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onStartEdit: () => void;
  onPrioridadeChange: (v: Prioridade) => void;
  onEffortChange: (v: Effort) => void;
  onNoteChange: (v: string) => void;
  onSaveEdit: () => void;
}) {
  return (
    <div
      draggable={canDrag}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`flex cursor-move flex-col gap-2.5 rounded-xl border border-rs-border bg-rs-card ${
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
          <b>{n.author === "scrum_master" ? "SCRUM MASTER" : "Dev"}</b>{" "}
          <span className="text-rs-text-faint">· {n.when}</span>
          <div>{n.text}</div>
        </div>
      ))}

      {isEditing && editDraft && !compact && (
        <div className="flex flex-col gap-2 rounded-lg bg-rs-lane p-2.5">
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-rs-text-faint">Prioridade</span>
              <select
                value={editDraft.prioridade}
                onChange={(e) => onPrioridadeChange(e.target.value as Prioridade)}
                className="rounded-lg border border-rs-border bg-rs-card px-2 py-1.5 text-xs font-bold text-rs-text"
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
                onChange={(e) => onEffortChange(e.target.value as Effort)}
                className="rounded-lg border border-rs-border bg-rs-card px-2 py-1.5 text-xs font-bold text-rs-text"
              >
                {EFFORTS.map((ef) => (
                  <option key={ef} value={ef}>
                    {ef}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex gap-1.5">
            <input
              value={editDraft.note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="Escrever nota (opcional)..."
              className="flex-grow rounded-lg border border-rs-border bg-rs-card px-2.5 py-2 text-xs text-rs-text"
            />
            <button onClick={onSaveEdit} className="rounded-lg bg-rs-brand px-3 py-2 text-xs font-bold text-white">
              Salvar
            </button>
          </div>
        </div>
      )}

      {canDrag && !compact && !isEditing && (
        <button onClick={onStartEdit} className="self-start text-xs font-bold text-rs-brand-text">
          + nota
        </button>
      )}
    </div>
  );
}
