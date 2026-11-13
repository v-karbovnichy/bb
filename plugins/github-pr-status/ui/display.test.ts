import type { PullRequest } from "../contract";
import { describe, expect, it } from "vitest";
import {
  getPullRequestGithubCheckStatus,
  describePullRequestStatus,
  getPullRequestNextStep,
  getPullRequestStateDisplay,
  isPullRequestAutoMergeOn,
} from "./display";

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 42,
    title: "Change",
    url: "https://github.com/acme/bb/pull/42",
    state: "open",
    baseRefName: "main",
    headRefName: "change",
    updatedAt: "2026-09-25T12:00:00Z",
    autoMerge: false,
    inMergeQueue: false,
    checks: {
      state: "passing",
      totalCount: 1,
      passedCount: 1,
      failedCount: 0,
      pendingCount: 0,
    },
    review: { state: "approved", reviewRequestCount: 0 },
    mergeability: {
      state: "blocked",
      mergeStateStatus: "BLOCKED",
      mergeable: "MERGEABLE",
    },
    attention: "blocked",
    ...overrides,
  };
}

describe("pull request signals", () => {
  it.each([
    ["checks_failed", "failing", "Проверки не пройдены", "action"],
    ["changes_requested", "passing", "Запрошены изменения", "action"],
    ["conflicts", "passing", "Конфликт с main", "action"],
    ["checks_pending", "pending", "Проверки выполняются", "waiting"],
    ["review_requested", "passing", "Ревью запрошено", "waiting"],
    ["queued", "passing", "В очереди на объединение", "waiting"],
    ["ready_to_merge", "passing", "Готов к объединению", "ready"],
    ["none", "no_checks", "Нет проверок", "waiting"],
    ["draft", "pending", "Проверки выполняются", "waiting"],
    ["draft", "unknown", "Статус проверок неизвестен", "waiting"],
  ] as const)(
    "names one next step for %s with %s checks",
    (attention, checksState, label, tone) => {
      const pr = pullRequest({ attention });
      pr.checks.state = checksState;
      expect(getPullRequestNextStep(pr)).toMatchObject({ label, tone });
    },
  );

  it.each([
    ["BEHIND", "Позади main"],
    ["BLOCKED", "Заблокирован правилами"],
  ] as const)("explains a %s block", (mergeStateStatus, label) => {
    const pr = pullRequest();
    pr.mergeability.mergeStateStatus = mergeStateStatus;
    expect(getPullRequestNextStep(pr)).toMatchObject({ label, tone: "action" });
  });

  it("marks only running checks as animated", () => {
    const pending = pullRequest({ attention: "checks_pending" });
    expect(getPullRequestNextStep(pending)).toMatchObject({
      icon: "Clock",
      running: true,
    });
    const passing = pullRequest({ attention: "none" });
    expect(getPullRequestNextStep(passing)).toMatchObject({
      icon: "CircleCheck",
      running: false,
    });
    expect(getPullRequestNextStep(pullRequest())?.icon).toBeNull();
  });

  it("separates review required from a requested review", () => {
    const pr = pullRequest({
      attention: "review_requested",
      review: { state: "review_required", reviewRequestCount: 0 },
    });
    expect(getPullRequestNextStep(pr)?.label).toBe("Требуется ревью");
  });

  it.each(["merged", "closed"] as const)(
    "has no next step once a pull request is %s",
    (state) => {
      const pr = pullRequest({ state, attention: state, autoMerge: true });
      expect(getPullRequestNextStep(pr)).toBeNull();
      expect(isPullRequestAutoMergeOn(pr)).toBe(false);
      expect(getPullRequestGithubCheckStatus(pr)).toBeNull();
      expect(getPullRequestStateDisplay(pr).label).toBe(
        state === "merged" ? "Объединён" : "Закрыт",
      );
    },
  );

  it("describes lifecycle, next step, and auto-merge for assistive text", () => {
    const pr = pullRequest({
      state: "draft",
      attention: "draft",
      autoMerge: true,
    });
    expect(describePullRequestStatus(pr)).toBe("Черновик, Проверки пройдены");
    const open = pullRequest({ autoMerge: true, attention: "queued" });
    expect(describePullRequestStatus(open)).toBe(
      "Открыт, В очереди на объединение, автообъединение включено",
    );
  });

  it("keeps auto-merge out of the next step", () => {
    const pr = pullRequest({ autoMerge: true, attention: "checks_pending" });
    pr.checks.state = "pending";
    expect(getPullRequestNextStep(pr)?.label).toBe("Проверки выполняются");
    expect(isPullRequestAutoMergeOn(pr)).toBe(true);
  });

  it.each([
    ["passing", "success"],
    ["failing", "failure"],
    ["pending", "pending"],
    ["no_checks", null],
    ["unknown", null],
  ] as const)("maps checks %s to the favicon badge", (state, status) => {
    const pr = pullRequest();
    pr.checks.state = state;
    expect(getPullRequestGithubCheckStatus(pr)).toBe(status);
  });
});
