import type { Host, MachineLifecycle } from "@bb/domain";
import { formatRelativeTime } from "@/lib/relative-time";

export type MachineStatusTone = "online" | "attention" | "failed" | "offline";

export function machinePhaseLabel(
  lifecycle: MachineLifecycle,
): "Приостановлена" | "Приостановка" | "Возобновление" | "Удаление" | "Очистка не удалась" | null {
  if (
    lifecycle.phase === "removing" &&
    lifecycle.teardown?.status === "failed"
  ) {
    return "Очистка не удалась";
  }
  if (lifecycle.phase === "suspending") return "Приостановка";
  if (lifecycle.phase === "suspended") return "Приостановлена";
  if (lifecycle.phase === "resuming") return "Возобновление";
  if (lifecycle.phase === "removing") return "Удаление";
  return null;
}

export function machineStatusTone(host: Host): MachineStatusTone {
  if (machinePhaseLabel(host.lifecycle) === "Очистка не удалась") return "failed";
  if (
    host.lifecycle.phase === "removing" ||
    host.lifecycle.phase === "suspending" ||
    host.lifecycle.phase === "resuming"
  )
    return "attention";
  return host.status === "connected" ? "online" : "offline";
}

export function machineStatusLabel({
  host,
  now,
}: {
  host: Host;
  now: number;
}): string {
  const parts: string[] = [];
  const phase = machinePhaseLabel(host.lifecycle);
  parts.push(phase ?? (host.status === "connected" ? "В сети" : "Не в сети"));
  if (host.lifecycle.message !== null) parts.push(host.lifecycle.message);
  else if (host.status !== "connected" && host.lastSeenAt !== null) {
    parts.push(
      `последний раз в сети ${formatRelativeTime({ timestamp: host.lastSeenAt, now })}`,
    );
  }
  return parts.join(" · ");
}

export function canReconnectMachine(host: Host): boolean {
  return host.status !== "connected" && host.lifecycle.phase === "active";
}

export function canForceRemoveMachine(host: Host): boolean {
  return (
    host.status !== "connected" &&
    host.lifecycle.phase === "removing" &&
    host.lifecycle.teardown?.status === "failed"
  );
}
