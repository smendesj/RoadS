// The line shown when a GitHub sync didn't run, the same wherever it was started from.
export function syncFailureMessage(result: { reason: string; message?: string }): string {
  if (result.reason === "not_configured") return "Sincronização do GitHub ainda não configurada (falta GITHUB_TOKEN no servidor).";
  if (result.reason === "unauthenticated") return result.message ?? "Entre para sincronizar o board.";
  return result.message ?? "Erro ao sincronizar.";
}

// What the Sincronizar buttons say after a sync that ran: how many issues the Roadmap took in and let go.
export function roadmapSyncMessage(roadmap: { added: number; removed: number; issuesCreated: number; untyped?: number; error?: string }): string {
  if (roadmap.error) return roadmap.error;
  return (
    `${roadmap.added} issue(s) adicionada(s), ${roadmap.removed} encerrada(s) ou fora do Project removida(s)` +
    (roadmap.issuesCreated ? `, ${roadmap.issuesCreated} issue(s) criada(s) para itens sem issue.` : ".") +
    (roadmap.untyped ? ` ${roadmap.untyped} issue(s) aberta(s) sem label type:* ficaram de fora até ganharem tipo.` : "")
  );
}