import { randomUUID } from "node:crypto";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  addPushSubscriptionInputSchema,
  CLIENT_NOTIFICATION_CHANNEL,
  clientChannelSchema,
  DEFAULT_EXPO_PUSH_URL,
  DEVICE_LABEL_MAX_LENGTH,
  EXPO_PUSH_TOKEN_MAX_LENGTH,
  NOTIFICATION_BODY_MAX_LENGTH,
  NOTIFICATION_TITLE_MAX_LENGTH,
  pushNotificationsRpcContract,
  sendNotificationInputSchema,
  sendNotificationRpcContract,
  type ClientNotification,
  type DeliveryChannel,
  type PushSubscriptionSummary,
} from "./contract.js";
import {
  createNotificationPreferences,
  describeNotificationSource,
  NOTIFICATION_LEVEL_LABELS,
  notificationLevelSchema,
  ownNotificationLevelSchema,
  type ThreadNotifications,
} from "./preferences.js";
import {
  createPushSender,
  SendNotificationError,
  type CreatePushSenderArgs,
  type LastSendOutcome,
} from "./sender.js";
import { createPushSubscriptionStore } from "./subscriptions.js";

interface PushNotificationsPluginOptions {
  coalesceMs?: number;
  createId?: () => string;
  fetch?: CreatePushSenderArgs["fetch"];
  now?: () => number;
}

interface StatusView {
  enabled: true;
  subscriptionCount: number;
  mobileEnabled: boolean;
  webEnabled: boolean;
  desktopEnabled: boolean;
  defaultLevel: string;
  childLevel: string;
  relayUrl: string;
  lastSendOutcome: LastSendOutcome;
}

const JSON_OPTION = {
  type: "boolean",
  description: "Вывести JSON для машинной обработки",
} as const;

function formatSubscriptions(
  subscriptions: readonly PushSubscriptionSummary[],
): string {
  if (subscriptions.length === 0) return "Нет зарегистрированных push-устройств";
  return [
    "ID\tУстройство\tПлатформа\tПоследняя активность\tОкончание токена",
    ...subscriptions.map((subscription) =>
      [
        subscription.id,
        subscription.deviceLabel,
        subscription.platform,
        new Date(subscription.lastSeenAt).toISOString(),
        subscription.tokenSuffix,
      ].join("\t"),
    ),
  ].join("\n");
}

function formatLastOutcome(outcome: LastSendOutcome): string {
  if (outcome.status === "never") return "Никогда";
  if (outcome.status === "sent") {
    return `Отправлено ${outcome.sentCount} в ${new Date(outcome.at).toISOString()}`;
  }
  return `Ошибка в ${new Date(outcome.at).toISOString()}: ${outcome.reason}`;
}

function formatStatus(status: StatusView): string {
  return [
    `Включено: ${status.enabled}`,
    `Мобильные: ${status.mobileEnabled}`,
    `Браузер: ${status.webEnabled}`,
    `Компьютер: ${status.desktopEnabled}`,
    `Уровень по умолчанию: ${status.defaultLevel}`,
    `Уровень дочерних чатов: ${status.childLevel}`,
    `Подписки: ${status.subscriptionCount}`,
    `URL ретранслятора: ${status.relayUrl}`,
    `Последняя отправка: ${formatLastOutcome(status.lastSendOutcome)}`,
  ].join("\n");
}

function formatThreadNotifications(
  threadId: string,
  row: ThreadNotifications,
): string {
  return `Уведомления для ${threadId}: ${row.effective} (${describeNotificationSource(row)})`;
}

function formatSent(channels: readonly DeliveryChannel[]): string {
  return `Отправлено в ${channels.join(", ")}`;
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export function createPushNotificationsPlugin(
  options: PushNotificationsPluginOptions = {},
) {
  return async function pushNotificationsPlugin(
    bb: BbPluginApi,
  ): Promise<void> {
    const settings = bb.settings.define({
      mobileEnabled: {
        type: "boolean",
        label: "Мобильные уведомления",
        description:
          "Отправлять push-уведомления на зарегистрированные телефоны и планшеты.",
        default: true,
      },
      webEnabled: {
        type: "boolean",
        label: "Уведомления в браузере",
        description:
          "Показывать системные уведомления, пока bb открыт в браузере. В каждом браузере нужно разрешение.",
        default: true,
      },
      desktopEnabled: {
        type: "boolean",
        label: "Уведомления на компьютере",
        description:
          "Показывать системные уведомления, пока работает приложение bb для компьютера.",
        default: true,
      },
      defaultLevel: {
        type: "select",
        label: "Уведомления по умолчанию",
        description:
          "Для чатов без отдельной настройки. Режим «Требуется ответ» пропускает завершённые ходы.",
        options: [...notificationLevelSchema.options],
        experimental_optionLabels: {
          all: NOTIFICATION_LEVEL_LABELS.all,
          "input-only": NOTIFICATION_LEVEL_LABELS["input-only"],
          muted: NOTIFICATION_LEVEL_LABELS.muted,
        },
        default: "all",
        experimental_schema: notificationLevelSchema,
      },
      childLevel: {
        type: "select",
        label: "Уведомления дочерних чатов",
        description:
          "Для дочерних чатов без отдельной настройки. Уровень родительского чата также ограничивает дочерние.",
        options: [...ownNotificationLevelSchema.options],
        experimental_optionLabels: {
          inherit: NOTIFICATION_LEVEL_LABELS.inherit,
          all: NOTIFICATION_LEVEL_LABELS.all,
          "input-only": NOTIFICATION_LEVEL_LABELS["input-only"],
          muted: NOTIFICATION_LEVEL_LABELS.muted,
        },
        default: "input-only",
        experimental_schema: ownNotificationLevelSchema,
      },
      expoPushUrl: {
        type: "string",
        label: "URL ретранслятора Expo push",
        description: "Адрес ретранслятора Expo push для мобильных уведомлений.",
        default: DEFAULT_EXPO_PUSH_URL,
        experimental_schema: z.string().url(),
      },
    });
    const preferences = createNotificationPreferences({
      bb,
      getDefaults: async () => {
        const { defaultLevel, childLevel } = await settings.get();
        return {
          defaultLevel: notificationLevelSchema.parse(defaultLevel),
          childLevel: ownNotificationLevelSchema.parse(childLevel),
        };
      },
      publish: (threadIds) =>
        bb.rpc.experimental_invalidate(threadIds.map((id) => `thread:${id}`)),
    });
    const subscriptions = createPushSubscriptionStore(bb, {
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.createId === undefined ? {} : { createId: options.createId }),
    });
    const sender = createPushSender({
      bb,
      subscriptions,
      getDeliverySettings: () => settings.get(),
      getExpoPushUrl: async () => (await settings.get()).expoPushUrl,
      isDismissalEnabled: async () => {
        try {
          const { experiments } = await bb.sdk.system.config();
          return experiments.dismissReadNotifications;
        } catch {
          return false;
        }
      },
      getNotificationLevel: (thread) => preferences.effectiveLevel(thread),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.coalesceMs === undefined
        ? {}
        : { coalesceMs: options.coalesceMs }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });

    async function status(): Promise<StatusView> {
      const [
        {
          expoPushUrl,
          mobileEnabled,
          webEnabled,
          desktopEnabled,
          defaultLevel,
          childLevel,
        },
        rows,
      ] = await Promise.all([settings.get(), subscriptions.list()]);
      return {
        enabled: true,
        subscriptionCount: rows.length,
        mobileEnabled,
        webEnabled,
        desktopEnabled,
        defaultLevel,
        childLevel,
        relayUrl: expoPushUrl,
        lastSendOutcome: sender.getLastOutcome(),
      };
    }

    async function sendTest(channel: "web" | "desktop") {
      const config = await settings.get();
      if (!(channel === "web" ? config.webEnabled : config.desktopEnabled)) {
        throw new Error(`Уведомления ${channel} отключены`);
      }
      bb.realtime.publish(CLIENT_NOTIFICATION_CHANNEL, {
        id: randomUUID(),
        title: "Уведомления bb работают",
        body: "Вы получите уведомление, когда чату потребуется ваше внимание.",
        threadId: null,
        channels: [channel],
      } satisfies ClientNotification);
      return { ok: true as const };
    }

    bb.rpc.register(
      sendNotificationRpcContract,
      {
        "notifications.send": async (input, context) => ({
          ok: true as const,
          channels: await sender.send(input, context.experimental_caller),
        }),
      },
      {
        experimental_discoverable: true,
        experimental_description:
          "Notifications on bb's mobile, web and desktop channels.",
      },
    );

    bb.rpc.register(pushNotificationsRpcContract, {
      "notifications.test": ({ channel }) => sendTest(channel),
      "pushSubscriptions.list": async () => ({
        subscriptions: await subscriptions.listSummaries(),
      }),
      "pushSubscriptions.add": (input) => subscriptions.add(input),
      "pushSubscriptions.remove": async ({ id }) => {
        if (!(await subscriptions.remove(id))) {
          throw new Error(`Push-подписка не найдена: ${id}`);
        }
        return { ok: true as const };
      },
      "threadNotifications.keyed": async ({ keys }) => {
        const rows = await preferences.list(keys);
        return Object.fromEntries(
          keys.map((key) => [
            key,
            rows[key] ?? { own: "inherit" as const, ancestorCap: null },
          ]),
        );
      },
      "threadNotifications.list": async ({ threadIds }) => ({
        threads: await preferences.list(threadIds),
      }),
      "threadNotifications.set": ({ threadId, level }) =>
        preferences.set(threadId, level),
    });

    bb.cli.register(
      defineCli({
        name: "push-notifications",
        summary: "Управление мобильными уведомлениями, уведомлениями в браузере и на компьютере",
        description:
          "Мобильные устройства получают push-сообщения Expo; браузер и приложение для компьютера показывают системные уведомления, пока открыты.",
        commands: {
          test: cliCommand({
            summary:
              "Отправить тестовое уведомление подключённым клиентам браузера или компьютера с разрешением",
            positionals: [
              {
                name: "channel",
                description: "Тип клиента для уведомления: web или desktop",
                required: true,
              },
            ],
            options: { json: JSON_OPTION },
            async run(input) {
              const channel = clientChannelSchema.safeParse(
                input.positionals.channel,
              );
              if (!channel.success) {
                throw new PluginCliError("Используйте web или desktop", {
                  code: "invalid_channel",
                  hint: "Мобильные устройства тестируются с телефона; эта команда доступна только для браузера и компьютера.",
                });
              }
              try {
                await sendTest(channel.data);
              } catch (error) {
                throw new PluginCliError(
                  error instanceof Error ? error.message : String(error),
                  {
                    code: "channel_disabled",
                    hint: `Включите командой \`bb plugin config push-notifications set ${channel.data}Enabled true\`.`,
                  },
                );
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ ok: true, channel: channel.data })
                  : `Тестовое уведомление отправлено подключённым клиентам ${channel.data} с разрешением`,
              };
            },
          }),
          send: cliCommand({
            summary: "Отправить уведомление во все включённые каналы",
            description: `Доставка как у уведомлений чатов: подключённые клиенты браузера и компьютера с разрешением и все зарегистрированные мобильные устройства. Название ограничено ${NOTIFICATION_TITLE_MAX_LENGTH} символами, текст — ${NOTIFICATION_BODY_MAX_LENGTH}. С --thread нажатие открывает указанный чат, иначе bb.`,
            options: {
              title: {
                type: "string",
                required: true,
                placeholder: "text",
                description: "Название уведомления",
              },
              body: {
                type: "string",
                placeholder: "text",
                description: "Текст уведомления под названием",
              },
              thread: {
                type: "string",
                placeholder: "thread-id",
                description: "Чат, который откроется при нажатии на уведомление",
              },
              json: JSON_OPTION,
            },
            async run(input) {
              const parsed = sendNotificationInputSchema.safeParse({
                title: input.options.title,
                ...(input.options.body === undefined
                  ? {}
                  : { body: input.options.body }),
                ...(input.options.thread === undefined
                  ? {}
                  : { threadId: input.options.thread }),
              });
              if (!parsed.success) {
                throw new PluginCliError(
                  parsed.error.issues
                    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                    .join("; "),
                  { code: "invalid_notification" },
                );
              }
              let channels: DeliveryChannel[];
              try {
                channels = await sender.send(parsed.data, { kind: "client" });
              } catch (error) {
                if (!(error instanceof SendNotificationError)) throw error;
                throw new PluginCliError(
                  error.message,
                  error.code === "thread_not_found"
                    ? { code: error.code }
                    : {
                        code: error.code,
                        hint: "Проверьте службу push-sender командой `bb plugin list`.",
                      },
                );
              }
              if (channels.length === 0) {
                throw new PluginCliError(
                  "Ни один канал не получил уведомление",
                  {
                    code: "not_delivered",
                    hint: "Выполните `bb push-notifications status`, чтобы увидеть включённые каналы, число устройств и последнюю мобильную отправку.",
                  },
                );
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ ok: true, channels })
                  : formatSent(channels),
              };
            },
          }),
          list: cliCommand({
            summary: "Показать зарегистрированные push-устройства",
            options: { json: JSON_OPTION },
            async run(input) {
              const rows = await subscriptions.listSummaries();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ subscriptions: rows })
                  : formatSubscriptions(rows),
              };
            },
          }),
          add: cliCommand({
            summary: "Зарегистрировать или обновить push-устройство Expo",
            options: {
              token: {
                type: "string",
                required: true,
                placeholder: "expo-push-token",
                aliases: ["expo-token", "push-token", "expo-push-token"],
                description: `Push-токен Expo, предоставленный устройством, до ${EXPO_PUSH_TOKEN_MAX_LENGTH} символов`,
              },
              platform: {
                type: "enum",
                required: true,
                values: ["ios", "android"],
                aliases: ["os"],
                description: "Операционная система устройства",
              },
              label: {
                type: "string",
                required: true,
                placeholder: "device-label",
                aliases: ["device-label", "device", "name"],
                description: `Отображаемое имя устройства, до ${DEVICE_LABEL_MAX_LENGTH} символов`,
              },
              json: JSON_OPTION,
            },
            async run(input) {
              const parsed = addPushSubscriptionInputSchema.safeParse({
                expoPushToken: input.options.token,
                platform: input.options.platform,
                deviceLabel: input.options.label,
              });
              if (!parsed.success) {
                throw new PluginCliError(
                  parsed.error.issues.map((issue) => issue.message).join("; "),
                  { code: "invalid_device" },
                );
              }
              const result = await subscriptions.add(parsed.data);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : `${result.created ? "Зарегистрировано" : "Обновлено"} push-устройство ${result.id}`,
              };
            },
          }),
          remove: cliCommand({
            summary: "Удалить зарегистрированное push-устройство",
            positionals: [
              {
                name: "id",
                description:
                  "ID подписки из вывода `bb push-notifications list`",
                required: true,
              },
            ],
            options: { json: JSON_OPTION },
            async run(input) {
              const id = input.positionals.id;
              if (!(await subscriptions.remove(id))) {
                throw new PluginCliError(`Push-подписка не найдена: ${id}`, {
                  code: "subscription_not_found",
                  hint: "Выполните `bb push-notifications list`, чтобы увидеть зарегистрированные ID.",
                });
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ id, removed: true })
                  : `Push-устройство ${id} удалено`,
              };
            },
          }),
          thread: cliCommand({
            summary: "Показать или задать уровень уведомлений чата",
            description:
              "Без --level показывает итоговый уровень и его источник. Чат использует свой уровень, иначе childLevel при наличии родителя или defaultLevel; уровень каждого предка ограничивает его.",
            positionals: [
              {
                name: "thread",
                description: "ID чата",
                required: true,
              },
            ],
            options: {
              level: {
                type: "enum",
                values: ownNotificationLevelSchema.options,
                description:
                  "Задать уровень чата; inherit сбрасывает его и применяет уровень родителя или значение по умолчанию",
              },
              json: JSON_OPTION,
            },
            async run(input) {
              const threadId = input.positionals.thread;
              let row: ThreadNotifications;
              try {
                if (input.options.level !== undefined) {
                  await preferences.set(threadId, input.options.level);
                }
                row = await preferences.get(threadId);
              } catch (error) {
                throw new PluginCliError(
                  error instanceof Error ? error.message : String(error),
                  { code: "thread_not_found" },
                );
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ threadId, ...row })
                  : formatThreadNotifications(threadId, row),
              };
            },
          }),
          status: cliCommand({
            summary: "Показать состояние доставки push-уведомлений",
            options: { json: JSON_OPTION },
            async run(input) {
              const view = await status();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(view)
                  : formatStatus(view),
              };
            },
          }),
        },
      }),
    );

    bb.events.on("interaction.pending", (payload) => {
      sender.onInteractionPending(payload);
    });
    bb.events.on("thread.idle", (payload) => {
      sender.onThreadIdle(payload);
    });
    bb.events.on("thread.failed", (payload) => {
      sender.onThreadFailed(payload);
    });
    bb.events.on("experimental_thread.read", (payload) => {
      sender.onThreadRead(payload);
    });
    bb.events.on("experimental_thread.parentChanged", ({ thread }) =>
      preferences.publishSubtree(thread.id),
    );
    bb.events.on("thread.unarchived", ({ thread }) =>
      preferences.publishSubtree(thread.id),
    );
    bb.background.service("push-sender", {
      async start(signal) {
        await sender.start();
        try {
          await waitForAbort(signal);
        } finally {
          await sender.stop();
        }
      },
    });
  };
}

export default createPushNotificationsPlugin();
