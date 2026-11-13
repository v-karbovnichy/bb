import { PluginMobileSettingsSections } from "@/components/plugin/PluginSettingsSections";
import { MobilePlatformIcon } from "@bb/shared-ui/mobile-platform-icon";
import { MachineAccessSettings } from "./MachineAccessSettings";
import { mobileAppDownloads } from "@bb/domain";
import { buttonVariants } from "@bb/shared-ui/button";
import { useQuery } from "@tanstack/react-query";
import { SettingsSection } from "@/components/ui/settings-section";
import { sdk } from "@/lib/sdk";
import { getNativeShell } from "@/lib/native-shell";

export function MobileAppSection() {
  const releases = useQuery({
    queryKey: ["system", "mobile-app-releases"],
    queryFn: () => sdk.system.mobileAppReleases(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const android = releases.data?.android;
  const handshake = getNativeShell()?.handshake;
  const installedAndroid = handshake?.platform === "android" ? handshake : null;
  return (
    <section aria-label="Загрузки мобильных приложений" className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Мобильные приложения</h2>
        <p className="mt-1 text-sm text-subtle-foreground">
          Пользуйтесь bb с телефона
        </p>
      </div>
      <MachineAccessSettings title="Доступ к bb с телефона">
        {(pluginId) => <PluginMobileSettingsSections pluginId={pluginId} />}
      </MachineAccessSettings>
      <div className="space-y-5">
        <SettingsSection
          title={
            <span className="flex items-center gap-2">
              <MobilePlatformIcon platform="ios" />
              iOS
            </span>
          }
          description="Доступно через TestFlight"
          bodyClassName="space-y-4"
        >
          <p className="text-sm text-subtle-foreground">
            Установите{" "}
            <a
              href="https://apps.apple.com/app/testflight/id899247664"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              TestFlight
            </a>
            , затем присоединитесь к бета-программе bb, чтобы установить приложение на iPhone.
          </p>
          <a
            href={mobileAppDownloads.ios}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants()}
          >
            Присоединиться к TestFlight для iOS
          </a>
        </SettingsSection>
        <SettingsSection
          title={
            <span className="flex items-center gap-2">
              <MobilePlatformIcon platform="android" />
              Android
            </span>
          }
          description="Прямая загрузка для телефонов Android"
          bodyClassName="space-y-4"
        >
          <p className="text-sm text-subtle-foreground">
            Загрузите APK и откройте его на телефоне для установки. Если появится
            запрос, разрешите установку из браузера.
          </p>
          <p className="text-sm text-subtle-foreground">
            Доступ к Google Play находится на рассмотрении. Пока проверяйте
            обновления здесь.
          </p>
          {installedAndroid && (
            <div className="space-y-1 text-sm">
              <p>
                Установлено: {installedAndroid.appVersion}
                {installedAndroid.androidVersionCode !== undefined &&
                  ` (сборка ${installedAndroid.androidVersionCode})`}
              </p>
              <p role="status">
                {installedAndroid.androidVersionCode === undefined
                  ? "Приложение не сообщает номер сборки. Загрузите последний APK, чтобы проверить обновления."
                  : releases.isPending
                    ? "Проверка обновлений…"
                    : !android
                      ? "Не удалось проверить обновления. Вы можете загрузить последний APK."
                      : installedAndroid.androidVersionCode <
                          android.versionCode
                        ? "Доступно обновление"
                        : installedAndroid.androidVersionCode ===
                            android.versionCode
                          ? "Установлена последняя версия"
                          : "У вас более новая сборка, чем последний опубликованный выпуск"}
              </p>
            </div>
          )}
          {android ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-subtle-foreground">Версия</dt>
              <dd>
                {android.version} (сборка {android.versionCode})
              </dd>
              <dt className="text-subtle-foreground">Обновлено</dt>
              <dd>
                <time dateTime={android.updatedAt}>
                  {new Date(android.updatedAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </dd>
              <dt className="text-subtle-foreground">Размер загрузки</dt>
              <dd>{Math.ceil(android.size / 1024 / 1024)} MB</dd>
            </dl>
          ) : (
            <p className="text-sm text-subtle-foreground" role="status">
              {releases.isPending
                ? "Проверка последнего выпуска…"
                : "Сведения о выпуске недоступны. Вы можете загрузить APK."}
            </p>
          )}
          <a
            href={mobileAppDownloads.android}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants()}
          >
            Download Android APK
          </a>
        </SettingsSection>
      </div>
    </section>
  );
}
