export function buildAutomationEditThreadPrompt({
  name,
  projectId,
  automationId,
}: {
  name: string;
  projectId: string;
  automationId: string;
}): string {
  return `Измени автоматизацию bb ${JSON.stringify(name)} (ID ${automationId}) в проекте ${projectId}. Я хочу `;
}
