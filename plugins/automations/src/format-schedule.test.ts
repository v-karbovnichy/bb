import { describe, expect, it } from "vitest";
import {
  formatAutomationTrigger,
  formatDetailScheduleStatusLabel,
  formatOverviewScheduleMetadata,
  formatScheduleStatusLabel,
  getOneShotLifecycle,
  matchesAutomationStatusFilters,
  oneShotLifecycleAllowsToggle,
} from "../lib/format-schedule.js";

describe("automation schedule cadence", () => {
  it.each([
    ["*/5 9-17 * * *", "Каждые 5 минут, с 09:00 по 17:59"],
    ["0 9-17 * * 1-5", "Каждый час, с 09:00 по 17:00, с понедельника по пятницу"],
    ["15 9-17 * * *", "В 15 минут, с 09:00 по 17:59"],
    ["0 0-2 * * *", "Каждый час, с 00:00 по 02:00"],
    ["0 9,17 * * 1,3,5", "В 09:00 и 17:00, только в понедельник, среду, и пятницу"],
    ["30 9,12,17 * * *", "В 09:30, 12:30 и 17:30"],
    ["10-20 * * * *", "Минуты с 10 по 20"],
    ["*/5 * * * *", "Каждые 5 минут"],
    ["0 9 * * 1-5", "В 09:00, с понедельника по пятницу"],
    ["invalid", "Пользовательское расписание"],
  ])("formats %s as %s", (cron, expected) => {
    expect(
      formatAutomationTrigger({
        triggerType: "schedule",
        cron,
        timezone: "UTC",
      }),
    ).toBe(expected);
  });

  it("formats one-shot schedules", () => {
    expect(formatAutomationTrigger({ triggerType: "once", runAt: 2_000 })).toBe(
      "Однократно",
    );
  });
});

const NOW = 2_000;

describe("automation list and detail states", () => {
  it("omits paused detail metadata without hiding an active next run", () => {
    const pausedSchedule = {
      enabled: false,
      nextRunAt: null,
      trigger: {
        triggerType: "schedule" as const,
        cron: "0 * * * *",
        timezone: "UTC",
      },
      now: NOW,
    };

    expect(formatDetailScheduleStatusLabel(pausedSchedule)).toBeNull();
    expect(
      formatDetailScheduleStatusLabel({
        ...pausedSchedule,
        enabled: true,
        nextRunAt: NOW + 60_000,
      }),
    ).toMatch(/^Следующий запуск: /);
  });

  it("filters active versus paused automations", () => {
    expect(
      matchesAutomationStatusFilters({ enabled: true, nextRunAt: NOW }, []),
    ).toBe(true);
    expect(
      matchesAutomationStatusFilters({ enabled: true, nextRunAt: NOW }, [
        "active",
      ]),
    ).toBe(true);
    expect(
      matchesAutomationStatusFilters({ enabled: false, nextRunAt: null }, [
        "paused",
      ]),
    ).toBe(true);
    expect(
      matchesAutomationStatusFilters(
        {
          enabled: false,
          nextRunAt: null,
          trigger: { triggerType: "once", runAt: NOW - 1 },
          runCount: 1,
          lastRunStatus: "running",
          now: NOW,
        },
        ["active"],
      ),
    ).toBe(true);
    expect(
      matchesAutomationStatusFilters(
        {
          enabled: false,
          nextRunAt: null,
          trigger: { triggerType: "once", runAt: NOW - 1 },
          runCount: 1,
          lastRunStatus: "succeeded",
          now: NOW,
        },
        ["paused"],
      ),
    ).toBe(true);
    expect(
      matchesAutomationStatusFilters(
        {
          enabled: false,
          nextRunAt: null,
          trigger: { triggerType: "once", runAt: NOW - 1 },
          runCount: 0,
          lastRunStatus: null,
          now: NOW,
        },
        ["paused"],
      ),
    ).toBe(false);
    expect(
      matchesAutomationStatusFilters({ enabled: false, nextRunAt: null }, [
        "active",
        "paused",
      ]),
    ).toBe(true);
  });
});

describe("one-shot automation lifecycle", () => {
  it("omits row state repeated by icons or controls and separates the next-run label", () => {
    expect(
      formatOverviewScheduleMetadata({
        enabled: false,
        nextRunAt: null,
        trigger: { triggerType: "once", runAt: NOW - 1_000 },
        runCount: 1,
        lastRunStatus: "failed",
        now: NOW,
      }),
    ).toBeNull();

    expect(
      formatOverviewScheduleMetadata({
        enabled: false,
        nextRunAt: null,
        trigger: { triggerType: "once", runAt: NOW - 1_000 },
        runCount: 1,
        lastRunStatus: "succeeded",
        now: NOW,
      }),
    ).toBeNull();

    expect(
      formatOverviewScheduleMetadata({
        enabled: false,
        nextRunAt: NOW + 60_000,
        trigger: {
          triggerType: "schedule",
          cron: "0 * * * *",
          timezone: "UTC",
        },
        now: NOW,
      }),
    ).toBeNull();

    expect(
      formatOverviewScheduleMetadata({
        enabled: false,
        nextRunAt: null,
        trigger: { triggerType: "once", runAt: NOW - 1 },
        runCount: 0,
        lastRunStatus: null,
        now: NOW,
      }),
    ).toBeNull();

    const next = formatOverviewScheduleMetadata({
      enabled: true,
      nextRunAt: NOW + 60_000,
      trigger: {
        triggerType: "schedule",
        cron: "0 * * * *",
        timezone: "UTC",
      },
      now: NOW,
    });
    expect(next?.isNextRun).toBe(true);
    expect(next?.text).not.toContain("Следующий запуск:");
  });

  it("allows pausing a scheduled run and resuming a future paused run", () => {
    const trigger = { triggerType: "once" as const, runAt: NOW + 1_000 };

    expect(
      getOneShotLifecycle({
        enabled: true,
        trigger,
        runCount: 0,
        lastRunStatus: null,
        now: NOW,
      }),
    ).toBe("scheduled");
    expect(
      getOneShotLifecycle({
        enabled: false,
        trigger,
        runCount: 0,
        lastRunStatus: null,
        now: NOW,
      }),
    ).toBe("paused");
    expect(oneShotLifecycleAllowsToggle("scheduled")).toBe(true);
    expect(oneShotLifecycleAllowsToggle("paused")).toBe(true);
  });

  it("locks a paused run once its deadline has expired", () => {
    const trigger = { triggerType: "once" as const, runAt: NOW - 1 };
    const lifecycle = getOneShotLifecycle({
      enabled: false,
      trigger,
      runCount: 0,
      lastRunStatus: null,
      now: NOW,
    });

    expect(lifecycle).toBe("expired");
    expect(oneShotLifecycleAllowsToggle(lifecycle)).toBe(false);
    expect(
      formatScheduleStatusLabel({
        enabled: false,
        nextRunAt: null,
        trigger,
        runCount: 0,
        lastRunStatus: null,
        now: NOW,
      }),
    ).toBe("Срок истёк — измените расписание");
  });

  it.each([
    ["running", "running", "Выполняется"],
    ["succeeded", "completed", "Завершено"],
    ["failed", "failed", "Ошибка"],
    ["skipped", "skipped", "Пропущено"],
  ] as const)(
    "shows a terminal %s run truthfully",
    (lastRunStatus, expectedLifecycle, expectedLabel) => {
      const trigger = { triggerType: "once" as const, runAt: NOW - 1 };
      const lifecycle = getOneShotLifecycle({
        enabled: false,
        trigger,
        runCount: 1,
        lastRunStatus,
        now: NOW,
      });

      expect(lifecycle).toBe(expectedLifecycle);
      expect(oneShotLifecycleAllowsToggle(lifecycle)).toBe(false);
      expect(
        formatScheduleStatusLabel({
          enabled: false,
          nextRunAt: null,
          trigger,
          runCount: 1,
          lastRunStatus,
          now: NOW,
        }),
      ).toBe(expectedLabel);
    },
  );
});
