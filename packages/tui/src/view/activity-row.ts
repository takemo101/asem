/**
 * Activity-strip projection: an in-memory {@link ActivityItem} → a themed,
 * renderer-agnostic {@link ActivityRowView}. One of the cockpit's render
 * projections (see `../view.ts`). These rows are ephemeral "what just happened"
 * signals — never durable Messages, Reports, or Events.
 */
import type { ActivityItem } from "../activity.ts";
import { timeLabel } from "../messages.ts";

/**
 * One activity-strip row: a time label, a formatted line, and a tone for
 * themed renderers (`add` for appearances, `warn` for status/delivery changes,
 * `remove` for removals, `info` otherwise).
 */
export interface ActivityRowView {
  timeLabel: string;
  text: string;
  tone: "add" | "remove" | "warn" | "info";
}

/** Format one activity item into a themed activity-strip row. */
export function activityRow(item: ActivityItem): ActivityRowView {
  switch (item.kind) {
    case "session_added":
      return {
        timeLabel: timeLabel(item.at),
        text: `+ ${item.worktreeRoot} new Session ${item.sessionName}`,
        tone: "add",
      };
    case "session_removed":
      return {
        timeLabel: timeLabel(item.at),
        text: `- ${item.worktreeRoot} removed Session ${item.sessionName}`,
        tone: "remove",
      };
    case "status_changed":
      return {
        timeLabel: timeLabel(item.at),
        text: `! ${item.worktreeRoot} ${item.sessionName} ${item.from} → ${item.to}`,
        tone: "warn",
      };
    case "message_added":
      return {
        timeLabel: timeLabel(item.at),
        text: `+ ${item.fromLabel} → ${item.toLabel} [${item.messageKind}]`,
        tone: "add",
      };
    case "delivery_changed":
      return {
        timeLabel: timeLabel(item.at),
        text:
          item.result === "error"
            ? `! delivery to ${item.toLabel} failed: ${item.deliveryError ?? "unknown"}`
            : `· delivery to ${item.toLabel} ${item.result}`,
        tone: item.result === "error" ? "warn" : "info",
      };
    default: {
      const _never: never = item;
      return _never;
    }
  }
}
