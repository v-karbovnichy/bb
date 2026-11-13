// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ThreadQueuedMessage } from "@bb/domain";
import { makeThreadQueuedMessage } from "@bb/test-helpers/domain-fixtures";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  LazyQueuedMessagesList,
  QueuedMessagesPendingCard,
} from "./LazyQueuedMessagesList";

const mocks = vi.hoisted(() => {
  let releaseImport = () => {};
  const importGate = new Promise<void>((resolve) => {
    releaseImport = resolve;
  });
  return { imported: vi.fn(), importGate, releaseImport };
});

vi.mock("./QueuedMessagesList", async (importOriginal) => {
  mocks.imported();
  await mocks.importGate;
  return importOriginal();
});

afterEach(() => {
  cleanup();
});

const noop = () => {};
const noopAsync = async () => {};

function Queue({
  queuedMessages,
  initiallyExpanded = false,
}: {
  queuedMessages: readonly ThreadQueuedMessage[];
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <LazyQueuedMessagesList
      attachedToComposer
      queuedMessages={queuedMessages}
      sendAction="send-now"
      threadStatus="active"
      sendDisabled={false}
      actionDisabled={false}
      processingMessageId={null}
      processingAction={null}
      onSend={noop}
      onReorder={noop}
      onSetGroupBoundary={noop}
      onEdit={noop}
      onChangeSendTime={noopAsync}
      onDelete={noop}
      expanded={expanded}
      onExpandedChange={setExpanded}
    />
  );
}

it("downloads the queue only for queued work, warming it from the pending summary without mounting it", async () => {
  const view = render(<Queue queuedMessages={[]} />);
  await act(async () => {});
  expect(view.container.innerHTML).toBe("");
  expect(mocks.imported).not.toHaveBeenCalled();

  view.rerender(<QueuedMessagesPendingCard queuedMessageCount={2} />);
  await waitFor(() => expect(mocks.imported).toHaveBeenCalledOnce());
  view.rerender(
    <Queue
      initiallyExpanded
      queuedMessages={[
        makeThreadQueuedMessage({
          id: "q_1",
          content: [
            { type: "text", text: "Please check the follow-up", mentions: [] },
          ],
        }),
      ]}
    />,
  );
  screen.getByText("Please check the follow-up");
  expect(
    screen.queryByRole("button", { name: "Отправить сообщение 1 из очереди сейчас" }),
  ).toBeNull();
  view.rerender(<QueuedMessagesPendingCard queuedMessageCount={2} />);
  mocks.releaseImport();
  await act(() => LazyQueuedMessagesList.preload());
  expect(mocks.imported).toHaveBeenCalledOnce();
  screen.getByRole("status", { name: "Загрузка сообщений в очереди" });
  expect(
    screen.queryByRole("button", { name: "Отправить сообщение 1 из очереди сейчас" }),
  ).toBeNull();

  view.rerender(
    <Queue
      queuedMessages={[
        makeThreadQueuedMessage({ id: "q_1" }),
        makeThreadQueuedMessage({ id: "q_2" }),
      ]}
    />,
  );
  expect(
    screen.queryByRole("status", { name: "Загрузка сообщений в очереди" }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Показать или скрыть очередь сообщений" }),
  );
  screen.getByRole("button", { name: "Отправить сообщение 1 из очереди сейчас" });
  screen.getByRole("button", { name: "Изменить порядок сообщения 2 в очереди" });
});
