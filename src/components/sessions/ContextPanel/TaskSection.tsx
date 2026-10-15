import { CheckIcon, CircleIcon, LoaderIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TodoItem } from "@/types";
import { Box, Empty, Section } from "./primitives";

export function TaskSection({ todos, live }: { todos: TodoItem[]; live: boolean }) {
  const done = todos.filter((t) => t.status.toLowerCase() === "completed").length;
  const active = todos.filter((t) => t.status.toLowerCase() !== "cancelled").length;

  return (
    <Section title="Task list" summary={todos.length > 0 ? `${done}/${active} done` : undefined}>
      {todos.length === 0 ? (
        <Empty>{live ? "The agent hasn't planned any tasks yet" : "Session is not running"}</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Progres: bar tipis — cepat dibaca tanpa menghitung item. */}
          {active > 0 && (
            <div
              role="progressbar"
              aria-label="Task progress"
              aria-valuemin={0}
              aria-valuemax={active}
              aria-valuenow={done}
              className="mx-1 h-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                style={{ width: `${(done / active) * 100}%` }}
              />
            </div>
          )}
          <Box>
            {todos.map((t, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: urutan = urutan task list agent
              <TodoRow key={`${i}-${t.content}`} todo={t} />
            ))}
          </Box>
        </div>
      )}
    </Section>
  );
}

/** Label status task untuk pembaca layar. */
const TODO_STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  in_progress: "In progress",
  pending: "Pending",
  cancelled: "Cancelled",
};

/** Satu item task list: ikon status + teks (selesai dicoret). */
function TodoRow({ todo }: { todo: TodoItem }) {
  const status = todo.status.toLowerCase();
  const done = status === "completed";
  const cancelled = status === "cancelled";
  const running = status === "in_progress";

  return (
    <li className="flex min-w-0 items-start gap-2 px-2.5 py-2 text-[12.5px] leading-snug">
      {/* Ikon status dekoratif; statusnya dibacakan lewat teks sr-only di
          bawah (aria-label pada span/svg biasa tidak dibaca pembaca layar). */}
      <span aria-hidden className="mt-0.5 flex shrink-0 items-center">
        {done ? (
          <span className="flex size-3.5 items-center justify-center rounded-full bg-emerald-500 text-white">
            <CheckIcon className="size-2" strokeWidth={4} />
          </span>
        ) : running ? (
          <LoaderIcon className="size-3.5 animate-spin text-sky-600 motion-reduce:animate-none dark:text-sky-400" />
        ) : (
          <CircleIcon className="size-3.5 text-muted-foreground/60" />
        )}
      </span>
      <span className="sr-only">{TODO_STATUS_LABEL[status] ?? "Pending"}: </span>
      <span
        className={cn(
          "min-w-0 break-words",
          done && "text-muted-foreground line-through decoration-muted-foreground/50",
          cancelled && "text-muted-foreground/60 line-through",
          running && "font-medium",
        )}
      >
        {todo.content}
      </span>
    </li>
  );
}
