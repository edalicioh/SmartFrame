export const MAX_SELECTED_PHOTOS = 100;

export function addPhotoSelection(ids: string[], id: string, limit = MAX_SELECTED_PHOTOS) {
  if (ids.includes(id)) return { ids, reason: "duplicate" as const };
  if (ids.length >= limit) return { ids, reason: "limit" as const };
  return { ids: [...ids, id], reason: null };
}

export function removePhotoSelection(ids: string[], id: string) {
  return ids.filter((value) => value !== id);
}

export function movePhotoSelection(ids: string[], index: number, delta: number) {
  const target = index + delta;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function photoStatusLabel(status: string) {
  switch (status) {
    case "ready":
      return "Pronta para seleção";
    case "pending":
      return "Aguardando processamento";
    case "processing":
      return "Processando — ainda não selecionável";
    case "failed":
    case "error":
      return "Falha no processamento";
    default:
      return "Estado desconhecido — indisponível";
  }
}
