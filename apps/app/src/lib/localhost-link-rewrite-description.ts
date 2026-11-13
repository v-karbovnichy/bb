import { rewriteLocalhostLinkHref } from "@bb/client-core";

const EXAMPLE_HREF = "http://localhost:3000/";

export function localhostLinkRewriteDescription(
  currentHostname: string | undefined,
): string | null {
  if (currentHostname === undefined) {
    return null;
  }

  const rewrittenHref = rewriteLocalhostLinkHref({
    currentHostname,
    enabled: true,
    href: EXAMPLE_HREF,
  });
  if (rewrittenHref === EXAMPLE_HREF) {
    return null;
  }

  return `Если включено, ссылки localhost преобразуются с использованием хоста или IP-адреса, через который вы открыли bb. Например: ${EXAMPLE_HREF} → ${rewrittenHref}`;
}
