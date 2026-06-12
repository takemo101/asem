/**
 * One-line cockpit header (design "Visual structure"): product, scope,
 * workspace id, and refresh state, rendered from the pure {@link HeaderView}.
 */
import type { ReactNode } from "react";
import type { HeaderView } from "../../view.ts";
import { theme } from "../theme.ts";

export function Header(props: { header: HeaderView }): ReactNode {
  const { header } = props;
  return (
    <box height={1} flexDirection="row" backgroundColor={theme.headerBg}>
      <text fg={theme.headerFg}>
        {` ${header.product} — Session cockpit · scope ${header.scopeMode} · ws ${header.workspaceId} · ${header.autoLabel} `}
      </text>
    </box>
  );
}
