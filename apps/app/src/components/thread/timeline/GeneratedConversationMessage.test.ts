import { describe, expect, it } from "vitest";
import type { SystemMessageKind, SystemMessageSubject } from "@bb/domain";
import type { TimelineTitleLink } from "@bb/thread-view";
import { generatedConversationTitle } from "./GeneratedConversationMessage.js";

const threadSubject: SystemMessageSubject = {
  kind: "thread",
  threadId: "thr_child",
  threadName: "Fix auth bug",
};

interface SystemTitleArgs {
  systemMessageKind: SystemMessageKind;
  systemMessageSubject: SystemMessageSubject | null;
}

function systemTitle({
  systemMessageKind,
  systemMessageSubject,
}: SystemTitleArgs) {
  return generatedConversationTitle({
    sourceKind: "system",
    sourceName: "BB",
    sourceThreadId: null,
    sourceIsPluginSideChat: false,
    systemMessageKind,
    systemMessageSubject,
  });
}

function threadLink(threadId: string): TimelineTitleLink {
  return { kind: "thread", threadId };
}

describe("generatedConversationTitle — system source", () => {
  const threadSubjectCases: ReadonlyArray<{
    kind: SystemMessageKind;
    plain: string;
    verb: string;
  }> = [
    {
      kind: "ownership-assigned",
      plain: "Fix auth bug назначен вам",
      verb: "назначен вам",
    },
    {
      kind: "ownership-removed",
      plain: "Fix auth bug снят с вас",
      verb: "снят с вас",
    },
    {
      kind: "child-needs-attention",
      plain: "Fix auth bug требует внимания",
      verb: "требует внимания",
    },
    {
      kind: "child-completed",
      plain: "Fix auth bug завершён",
      verb: "завершён",
    },
    { kind: "child-failed", plain: "Fix auth bug завершился с ошибкой", verb: "завершился с ошибкой" },
    {
      kind: "child-interrupted",
      plain: "Fix auth bug был прерван",
      verb: "был прерван",
    },
  ];

  it.each(threadSubjectCases)(
    "$kind links the thread name and appends the verb",
    ({ kind, plain, verb }) => {
      const title = systemTitle({
        systemMessageKind: kind,
        systemMessageSubject: threadSubject,
      });

      expect(title.plain).toBe(plain);
      expect(title.segments).toHaveLength(2);

      const [nameSegment, verbSegment] = title.segments;
      expect(nameSegment.text).toBe("Fix auth bug");
      expect(nameSegment.em).toBe(true);
      expect(nameSegment.link).toEqual(threadLink("thr_child"));

      expect(verbSegment.text).toBe(verb);
      expect(verbSegment.em).toBe(false);
      expect(verbSegment.link).toBeUndefined();
    },
  );

  it("renders the batch form with the count and no link", () => {
    const title = systemTitle({
      systemMessageKind: "child-outcome-batch",
      systemMessageSubject: { kind: "thread-batch", count: 3 },
    });

    expect(title.plain).toBe("Обновлено чатов: 3");
    expect(title.segments).toHaveLength(1);
    expect(title.segments[0]?.text).toBe("Обновлено чатов: 3");
    expect(title.segments[0]?.link).toBeUndefined();
  });

  it("names the tool whose detached result arrived", () => {
    const title = systemTitle({
      systemMessageKind: "tool-result-delivered",
      systemMessageSubject: {
        kind: "tool-call",
        toolName: "grill_round",
        suppress: false,
      },
    });

    expect(title.plain).toBe("Доставлено grill_round результат");
    expect(title.segments).toHaveLength(3);
    expect(title.segments[0]?.text).toBe("Доставлено");
    expect(title.segments[1]?.text).toBe("grill_round");
    expect(title.segments[1]?.em).toBe(true);
    expect(title.segments[1]?.link).toBeUndefined();
    expect(title.segments[2]?.text).toBe("результат");
  });

  it("falls back to the generic Системное сообщение title for unlabeled rows", () => {
    const title = systemTitle({
      systemMessageKind: "unlabeled",
      systemMessageSubject: null,
    });

    expect(title.plain).toBe("Системное сообщение");
    expect(title.segments).toHaveLength(1);
    expect(title.segments[0]?.text).toBe("Системное сообщение");
    expect(title.segments[0]?.link).toBeUndefined();
  });

  it("falls back to Системное сообщение when the subject shape mismatches the kind", () => {
    const title = systemTitle({
      systemMessageKind: "child-completed",
      systemMessageSubject: { kind: "thread-batch", count: 2 },
    });

    expect(title.plain).toBe("Системное сообщение");
  });
});

describe("generatedConversationTitle — agent source", () => {
  it("links the sender thread name (reference pattern, unchanged)", () => {
    const title = generatedConversationTitle({
      sourceKind: "agent",
      sourceName: "Worker 2",
      sourceThreadId: "thr_sender",
      sourceIsPluginSideChat: false,
      systemMessageKind: "unlabeled",
      systemMessageSubject: null,
    });

    expect(title.plain).toBe("Сообщение от Worker 2");
    expect(title.segments).toHaveLength(2);
    expect(title.segments[1]?.text).toBe("Worker 2");
    expect(title.segments[1]?.link).toEqual(threadLink("thr_sender"));
  });
  it("links the recipient thread name of a sent message", () => {
    const title = generatedConversationTitle({
      sourceKind: "agent-recipient",
      sourceName: "Worker 2",
      sourceThreadId: "thr_recipient",
      sourceIsPluginSideChat: false,
      systemMessageKind: "unlabeled",
      systemMessageSubject: null,
    });

    expect(title.plain).toBe("Отправлено для Worker 2");
    expect(title.segments[1]?.link).toEqual(threadLink("thr_recipient"));
  });
});
