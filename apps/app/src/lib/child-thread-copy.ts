export const CHILD_THREAD_NOUN = "дочерний чат";

export function childThreadNoun(count: number): string {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "дочерних чатов";
  const last = count % 10;
  if (last === 1) return CHILD_THREAD_NOUN;
  if (last >= 2 && last <= 4) return "дочерних чата";
  return "дочерних чатов";
}

export function formatChildThreadCount(count: number): string {
  return `${count} ${childThreadNoun(count)}`;
}
