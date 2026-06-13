/**
 * Centered modal overlay (design "Visual structure"): one frame component in
 * cuekit's `modal-frame.tsx` style, rendering the pure {@link ModalView} for
 * send / confirm / help. The view-model owns all modal state and transitions;
 * this only paints them.
 */
import type { ReactNode } from "react";
import type { ModalView } from "../../view/modal.ts";
import { theme } from "../theme.ts";

function ModalFrame(props: {
  title: string;
  borderColor: string;
  children: ReactNode;
}): ReactNode {
  return (
    <box
      position="absolute"
      left="25%"
      top="30%"
      width="50%"
      borderStyle="double"
      borderColor={props.borderColor}
      padding={1}
      flexDirection="column"
      zIndex={100}
      backgroundColor={theme.panel}
    >
      <text fg={theme.yellow}>{props.title}</text>
      {props.children}
    </box>
  );
}

export function ModalDialog(props: { modal: ModalView }): ReactNode {
  const { modal } = props;
  const borderColor =
    modal.kind === "confirm" || modal.kind === "error" ? theme.red : theme.cyan;
  const body = modal.lines
    .map((line) => (modal.kind === "send" ? `> ${line}` : line))
    .join("\n");
  return (
    <ModalFrame title={modal.title} borderColor={borderColor}>
      <text fg={theme.text}>{body}</text>
      <text fg={theme.muted}>{modal.hint}</text>
    </ModalFrame>
  );
}
