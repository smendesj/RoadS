// The line shown when a GitHub sync didn't run, the same wherever it was started from.
export function syncFailureMessage(result: { reason: string; message?: string }): string {
  if (result.reason === "not_configured") return "Sincronização do GitHub ainda não configurada (falta GITHUB_TOKEN no servidor).";
  if (result.reason === "unauthenticated") return result.message ?? "Entre para sincronizar o board.";
  return result.message ?? "Erro ao sincronizar.";
}
