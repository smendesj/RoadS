"use client";

import { useId, useState, type ReactNode } from "react";
import {
  ENTRY_STATUSES,
  STATUS_LABEL,
  type EntryStatus,
  type LintIssue,
  type Overrides,
  type ProgressContent,
  type ProgressEntry,
} from "@/lib/progress-report";
import { lintSentence } from "@/lib/progress/lint";
import { locateKey, parseKey, type resolveHidden } from "@/lib/progress/resolve";
import { formatDay, partsLabel } from "@/lib/progress/report-view";

/** What saving one edit comes back with: what was stored (the server tidies text) and the language warnings. */
export type SaveOutcome = { ok: true; stored: string | boolean; warnings: LintIssue[] } | { ok: false; message: string };
export type SaveEdit = (key: string, value: string | boolean) => Promise<SaveOutcome>;

type SaveState = "idle" | "saving" | "saved" | "error";

const SAVE_FAILED: SaveOutcome = { ok: false, message: "Não foi possível salvar agora. Tente de novo." };
const attempt = (save: SaveEdit, key: string, value: string | boolean): Promise<SaveOutcome> => save(key, value).catch(() => SAVE_FAILED);

const label = "text-[11px] font-bold uppercase tracking-wide text-rs-text-faint";
const control =
  "w-full rounded-lg border border-rs-border bg-rs-bg px-3 py-2 text-base text-rs-text focus:border-rs-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-rs-brand/40 read-only:cursor-default read-only:opacity-80 sm:text-sm";

function SaveBadge({ state }: { state: SaveState }) {
  return (
    <span aria-live="polite" className="min-w-[3.5rem] text-right text-[11px] font-semibold text-rs-text-faint">
      {state === "saving" ? "Salvando…" : state === "saved" ? "Salvo" : ""}
    </span>
  );
}

// One editable line of text. It saves when the person leaves the field, and only if it changed; the
// warnings under it come back from the server with the save (they start from the same rules run on the
// text already there). A "nova sugestão" notice offers the new pushed text next to the kept edit.
function TextField({
  fieldKey,
  name,
  value,
  multiline = false,
  readOnly,
  edited,
  suggestion,
  save,
}: {
  fieldKey: string;
  name: string;
  value: string;
  multiline?: boolean;
  readOnly: boolean;
  edited: boolean;
  suggestion: string | null;
  save: SaveEdit;
}) {
  const id = useId();
  const max = parseKey(fieldKey)?.max ?? 280;
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<LintIssue[]>(() => lintSentence(value));

  async function commit(next: string, force = false) {
    if (next === saved && !force) return;
    setState("saving");
    setError(null);
    const result = await attempt(save, fieldKey, next);
    if (result.ok) {
      const stored = String(result.stored);
      setSaved(stored);
      // Only adopt the tidied text if the person has not typed more in the meantime.
      setDraft((current) => (current === next ? stored : current));
      setWarnings(result.warnings);
      setState("saved");
    } else {
      setState("error");
      setError(result.message);
    }
  }

  const shared = {
    id,
    value: draft,
    maxLength: max,
    readOnly,
    "data-field": fieldKey,
    "aria-describedby": `${id}-notes`,
    className: control,
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value);
      if (state !== "idle") {
        setState("idle");
        setError(null);
      }
    },
    onBlur: () => void commit(draft),
  };

  return (
    <div data-field-box={fieldKey} data-save-state={state} className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className={label}>
          {name}
        </label>
        <span className="flex items-center gap-2 text-[11px]">
          {edited && <span className="rounded bg-rs-lane px-1.5 py-0.5 font-bold text-rs-text-soft">Editado</span>}
          <SaveBadge state={state} />
        </span>
      </div>
      {multiline ? (
        <textarea {...shared} rows={3} className={control + " resize-y"} />
      ) : (
        <input {...shared} type="text" onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      )}
      <div id={`${id}-notes`} className="flex flex-col gap-1">
        {!readOnly && (
          <span className={`self-end text-[11px] tabular-nums ${[...draft].length >= max ? "font-bold text-amber-700 dark:text-amber-400" : "text-rs-text-faint"}`}>
            {[...draft].length}/{max}
          </span>
        )}
        {error && (
          <p role="alert" className="text-[12px] font-semibold text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {warnings.length > 0 && (
          <ul data-lint className="flex flex-col gap-0.5 text-[12px] text-amber-800 dark:text-amber-300">
            {warnings.map((w) => (
              <li key={`${w.code}:${w.message}`}>Atenção: {w.message}</li>
            ))}
          </ul>
        )}
        {suggestion !== null && !readOnly && (
          <div data-suggestion className="flex flex-col gap-1.5 rounded-lg bg-rs-brand-soft p-2.5 text-[12px] text-rs-text">
            <span>
              <b>Nova sugestão.</b> O texto enviado mudou depois da sua edição, e a sua edição foi mantida. O Claude agora sugere:
            </span>
            <span className="italic">«{suggestion}»</span>
            <span className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setDraft(suggestion);
                  void commit(suggestion, true);
                }}
                className="font-bold text-rs-brand-text hover:underline"
              >
                Usar a sugestão
              </button>
              <button type="button" onClick={() => void commit(saved, true)} className="font-bold text-rs-text-soft hover:underline">
                Manter a minha
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusSelect({ fieldKey, value, readOnly, save }: { fieldKey: string; value: EntryStatus; readOnly: boolean; save: SaveEdit }) {
  const id = useId();
  const [current, setCurrent] = useState<EntryStatus>(value);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function change(next: EntryStatus) {
    const previous = current;
    setCurrent(next);
    setState("saving");
    setError(null);
    const result = await attempt(save, fieldKey, next);
    if (result.ok) {
      setState("saved");
    } else {
      setCurrent(previous);
      setState("error");
      setError(result.message);
    }
  }

  return (
    <div data-field-box={fieldKey} data-save-state={state} className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className={label}>
          Situação
        </label>
        <SaveBadge state={state} />
      </div>
      <select
        id={id}
        data-field={fieldKey}
        value={current}
        disabled={readOnly}
        onChange={(e) => void change(e.target.value as EntryStatus)}
        className={control + " sm:min-w-[10rem]"}
      >
        {ENTRY_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="text-[12px] font-semibold text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function HideToggle({ fieldKey, hidden, readOnly, save }: { fieldKey: string; hidden: boolean; readOnly: boolean; save: SaveEdit }) {
  const id = useId();
  const [current, setCurrent] = useState(hidden);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function change(next: boolean) {
    const previous = current;
    setCurrent(next);
    setState("saving");
    setError(null);
    const result = await attempt(save, fieldKey, next);
    if (result.ok) {
      setState("saved");
    } else {
      setCurrent(previous);
      setState("error");
      setError(result.message);
    }
  }

  return (
    <div data-field-box={fieldKey} data-save-state={state} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          data-field={fieldKey}
          checked={current}
          disabled={readOnly}
          onChange={(e) => void change(e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-rs-brand disabled:cursor-not-allowed"
        />
        <label htmlFor={id} className="cursor-pointer text-[13px] font-semibold text-rs-text-soft">
          Ocultar do e-mail
        </label>
        <SaveBadge state={state} />
      </div>
      {error && (
        <p role="alert" className="text-[12px] font-semibold text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

// A link from the payload is only drawn as a link if it is plain https: the text is the team's, but an
// address is still an address.
function sourceLabel(url: string): string | null {
  if (!/^https:\/\//i.test(url)) return null;
  const m = /\/(issues|pull)\/(\d+)/.exec(url);
  return m ? `${m[1] === "pull" ? "PR" : "issue"} ${m[2]}` : "fonte";
}

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 id={id} className="text-sm font-extrabold text-rs-text">
          {title}
        </h3>
        {hint && <p className="text-[12px] text-rs-text-faint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const card = "flex flex-col gap-3 rounded-xl border border-rs-border p-3.5";

export function ProgressReportEditor({
  raw,
  resolved,
  hidden,
  overrides,
  flags,
  readOnly,
  save,
}: {
  /** As pushed by the collectors (no edits). */
  raw: ProgressContent;
  /** With the edits applied. */
  resolved: ProgressContent;
  /** The difficulties and next steps the person hid (they leave `resolved`, and can come back here). */
  hidden: ReturnType<typeof resolveHidden>;
  overrides: Overrides;
  /** Keys whose pushed text changed since the edit ("nova sugestão"). */
  flags: ReadonlySet<string>;
  readOnly: boolean;
  save: SaveEdit;
}) {
  const edited = (key: string) => Object.hasOwn(overrides, key);
  const suggestion = (key: string) => (flags.has(key) ? (locateKey(raw, key)?.pushed ?? null) : null);
  const text = (key: string, name: string, value: string, multiline = false) => (
    <TextField
      key={key}
      fieldKey={key}
      name={name}
      value={value}
      multiline={multiline}
      readOnly={readOnly}
      edited={edited(key)}
      suggestion={suggestion(key)}
      save={save}
    />
  );

  const difficulties = raw.difficulties.map((d) => {
    if (!d.id) return { id: null, view: d, isHidden: false };
    const shown = resolved.difficulties.find((x) => x.id === d.id);
    const gone = hidden.difficulties.find((x) => x.id === d.id);
    return { id: d.id, view: shown ?? gone ?? d, isHidden: !shown && !!gone };
  });
  const steps = raw.nextSteps.map((n) => {
    if (!n.id) return { id: null, view: n, isHidden: false };
    const shown = resolved.nextSteps.find((x) => x.id === n.id);
    const gone = hidden.nextSteps.find((x) => x.id === n.id);
    return { id: n.id, view: shown ?? gone ?? n, isHidden: !shown && !!gone };
  });

  return (
    <section aria-labelledby="edicao-titulo" data-panel="edicao" className="flex flex-col gap-5 rounded-2xl border border-rs-border bg-rs-card p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="edicao-titulo" className="text-[13px] font-bold uppercase tracking-wide text-rs-text-soft">
          Edição do texto
        </h2>
        <p className="text-[13px] text-rs-text-soft">
          {readOnly
            ? "Este resumo já foi enviado: o texto está congelado."
            : "Cada campo é salvo quando você sai dele. O que você edita fica guardado à parte: um novo envio do Claude não apaga as suas edições."}
        </p>
      </div>

      <Section id="ed-abertura" title="Frase de abertura">
        {text("headline", "Frase de abertura", resolved.headline, true)}
      </Section>

      <Section id="ed-entradas" title="Entradas" hint="O que foi entregue ou está andando. Oculte o que não deve ir no e-mail.">
        {resolved.entries.length === 0 && <p className="text-sm text-rs-text-faint">Nenhuma entrada neste período.</p>}
        {resolved.entries.map((entry: ProgressEntry) => {
          const base = `entry:${entry.id}`;
          return (
            <article
              key={entry.id}
              data-entry={entry.id}
              aria-label={`Entrada: ${entry.title}`}
              className={card + (entry.hidden ? " bg-rs-lane opacity-70" : "")}
            >
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                {text(`${base}:title`, "Título", entry.title)}
                <StatusSelect fieldKey={`${base}:status`} value={entry.status} readOnly={readOnly} save={save} />
              </div>
              {text(`${base}:summary`, "Frase", entry.summary, true)}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <HideToggle fieldKey={`${base}:hidden`} hidden={entry.hidden} readOnly={readOnly} save={save} />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-rs-text-faint">
                  {entry.deliveredAt && <span>Entregue em {formatDay(entry.deliveredAt)}</span>}
                  {partsLabel(entry.subIssues) && <span>{partsLabel(entry.subIssues)}</span>}
                  {entry.sources.map((url) => {
                    const name = sourceLabel(url);
                    return name ? (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className="font-semibold text-rs-brand-text hover:underline">
                        {name} ↗
                      </a>
                    ) : null;
                  })}
                </div>
              </div>
            </article>
          );
        })}
      </Section>

      <Section id="ed-dificuldades" title="Dificuldades e bloqueios">
        {difficulties.length === 0 && <p className="text-sm text-rs-text-faint">Nenhuma dificuldade neste período.</p>}
        {difficulties.map(({ id, view, isHidden }, index) =>
          id ? (
            <article key={id} data-difficulty={id} aria-label={`Dificuldade: ${view.text}`} className={card + (isHidden ? " bg-rs-lane opacity-70" : "")}>
              {text(`difficulty:${id}:text`, "Dificuldade", view.text, true)}
              {text(`difficulty:${id}:needs`, "O que precisamos", view.needs)}
              <HideToggle fieldKey={`difficulty:${id}:hidden`} hidden={isHidden} readOnly={readOnly} save={save} />
            </article>
          ) : (
            <article key={`sem-id-${index}`} className={card}>
              <p className="text-sm text-rs-text">{view.text}</p>
              {view.needs && <p className="text-[13px] text-rs-text-soft">O que precisamos: {view.needs}</p>}
              <p className="text-[12px] text-rs-text-faint">Sem identificador: este item não pode ser editado aqui.</p>
            </article>
          )
        )}
      </Section>

      <Section id="ed-proximos" title="Próximos passos">
        {steps.length === 0 && <p className="text-sm text-rs-text-faint">Nenhum próximo passo informado.</p>}
        {steps.map(({ id, view, isHidden }, index) =>
          id ? (
            <article key={id} data-next-step={id} aria-label={`Próximo passo: ${view.text}`} className={card + (isHidden ? " bg-rs-lane opacity-70" : "")}>
              {text(`nextStep:${id}:text`, "Próximo passo", view.text, true)}
              <HideToggle fieldKey={`nextStep:${id}:hidden`} hidden={isHidden} readOnly={readOnly} save={save} />
            </article>
          ) : (
            <article key={`sem-id-${index}`} className={card}>
              <p className="text-sm text-rs-text">{view.text}</p>
              <p className="text-[12px] text-rs-text-faint">Sem identificador: este item não pode ser editado aqui.</p>
            </article>
          )
        )}
      </Section>

      {raw.internal.count > 0 && (
        <Section id="ed-interno" title="Trabalho interno" hint={`${raw.internal.count} ${raw.internal.count === 1 ? "item" : "itens"} que não aparecem um a um no e-mail.`}>
          {text("internal", "Linha sobre o trabalho interno", resolved.internal.text, true)}
        </Section>
      )}
    </section>
  );
}
