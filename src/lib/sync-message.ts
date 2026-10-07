import type { SprintSyncSummary } from "./sprint-status-sync.ts";

// The line shown when a GitHub sync didn't run, the same wherever it was started from.
export function syncFailureMessage(result: { reason: string; message?: string }): string {
  if (result.reason === "not_configured") return "Sincronização do GitHub ainda não configurada (falta GITHUB_TOKEN no servidor).";
  if (result.reason === "unauthenticated") return result.message ?? "Entre para sincronizar o board.";
  return result.message ?? "Erro ao sincronizar.";
}

// How the current sprint and the Project's Development followed each other; nothing when neither had to.
function sprintLine(sprint: SprintSyncSummary): string {
  if (sprint.error) return ` A sprint atual não acompanhou o Project: ${sprint.error}.`;
  const parts = [
    sprint.pulled ? `${sprint.pulled} issue(s) puxada(s) para a sprint atual` : "",
    sprint.released ? `${sprint.released} devolvida(s) ao Roadmap` : "",
    sprint.written ? `${sprint.written} status escrito(s) no Project` : "",
    sprint.wouldWrite ? `${sprint.wouldWrite} status seriam escritos no Project, mas a escrita está desligada` : "",
    sprint.failed ? `${sprint.failed} falharam` : "",
    sprint.stuck ? `${sprint.stuck} sem bloco para voltar ao Roadmap` : "",
  ].filter(Boolean);
  return parts.length ? ` Sprint atual e Project: ${parts.join(", ")}.` : "";
}

// What the Sincronizar buttons say after a sync that ran: how many issues the Roadmap took in and let go.
export function roadmapSyncMessage(roadmap: {
  added: number;
  removed: number;
  issuesCreated: number;
  untyped?: number;
  error?: string;
  sprint?: SprintSyncSummary;
  retitled?: number;
}): string {
  if (roadmap.error) return roadmap.error;
  return (
    `${roadmap.added} issue(s) adicionada(s), ${roadmap.removed} encerrada(s) ou fora do Project removida(s)` +
    (roadmap.issuesCreated ? `, ${roadmap.issuesCreated} issue(s) criada(s) para itens sem issue.` : ".") +
    (roadmap.untyped ? ` ${roadmap.untyped} issue(s) aberta(s) sem label type:* ficaram de fora até ganharem tipo.` : "") +
    (roadmap.retitled ? ` ${roadmap.retitled} título(s) do Roadmap acompanharam a renomeação da issue no GitHub.` : "") +
    (roadmap.sprint ? sprintLine(roadmap.sprint) : "")
  );
}
