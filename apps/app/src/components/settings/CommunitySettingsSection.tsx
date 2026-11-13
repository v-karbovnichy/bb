import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section.js";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";

const DISCORD_INVITE_URL = "https://discord.gg/kvBU6tJhcJ";
const GITHUB_REPO_URL = "https://github.com/get-bb/bb";

interface CommunityLinkRowProps {
  description: string;
  href: string;
  icon: IconName;
  iconClassName?: string;
  label: string;
  openLabel: string;
}

function CommunityLinkRow({
  description,
  href,
  icon,
  iconClassName,
  label,
  openLabel,
}: CommunityLinkRowProps) {
  return (
    <SettingsWithControl label={label} description={description}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2.5 text-xs"
        aria-label={openLabel}
        onClick={() => {
          openUrlInExternalBrowser(href);
        }}
      >
        <Icon name={icon} className={cn("size-3.5 shrink-0", iconClassName)} />
        {openLabel}
        <Icon
          name="ExternalLink"
          className="size-3 shrink-0 text-muted-foreground"
        />
      </Button>
    </SettingsWithControl>
  );
}

export function CommunitySettingsSection() {
  return (
    <SettingsSection
      title="Сообщество"
      description="Общайтесь с другими пользователями bb и следите за разработкой на GitHub."
    >
      <div className="space-y-5">
        <CommunityLinkRow
          label="Discord"
          description="Присоединяйтесь к серверу для поддержки, отзывов и объявлений."
          href={DISCORD_INVITE_URL}
          icon="DiscordLogo"
          iconClassName="text-brand-discord"
          openLabel="Присоединиться к Discord"
        />
        <CommunityLinkRow
          label="GitHub"
          description="Исходный код, задачи и выпуски проекта bb."
          href={GITHUB_REPO_URL}
          icon="GithubLogo"
          openLabel="Открыть на GitHub"
        />
      </div>
    </SettingsSection>
  );
}
