export function sortFollowupEntries(entries) {
  return [...entries].sort((a, b) =>
    Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
    new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime() ||
    String(b.id).localeCompare(String(a.id))
  );
}
