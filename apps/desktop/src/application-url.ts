import { parseApplicationUrl } from "@bb/domain/application-url";
import { shell } from "electron";

export async function openApplicationUrl(value: unknown): Promise<void> {
  const target = parseApplicationUrl(value);
  if (target === null)
    throw new Error("Ссылка приложения заблокирована или недействительна.");
  await shell.openExternal(target.url);
}
