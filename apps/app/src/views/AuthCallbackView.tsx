import { useSearchParams } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";

const STATUS_CONTENT = {
  success: {
    title: "Авторизация завершена",
    message: "Можно закрыть это окно.",
  },
  error: {
    title: "Не удалось авторизоваться",
    message: "Произошла ошибка. Закройте это окно и попробуйте ещё раз.",
  },
} as const;

export function AuthCallbackView() {
  const [searchParams] = useSearchParams();
  const status = searchParams.get("status") === "error" ? "error" : "success";
  const content = STATUS_CONTENT[status];

  return (
    <div className="flex justify-center bg-background px-4 pt-12">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          {status === "error" ? (
            <Icon name="CircleX" className="size-4 shrink-0 text-destructive" />
          ) : (
            <Icon name="CircleCheck" className="size-4 shrink-0" />
          )}
          <h1 className="text-sm font-semibold">{content.title}</h1>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{content.message}</p>
      </div>
    </div>
  );
}
