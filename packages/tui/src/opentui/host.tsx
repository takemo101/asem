/**
 * The OpenTUI {@link CockpitHost}: a renderer-only host over the existing
 * cockpit loop.
 *
 * `CockpitApp` keeps driving everything through the same host seam as the ANSI
 * host — draw a frame, read a key (or a 3s auto-refresh tick), occasionally
 * leave to attach. This host renders frames through an OpenTUI/React root and
 * feeds `useKeyboard` input back into the pull-based key queue, so no operation
 * semantics or view-model state ever move into React (ADR 0004 "rejected:
 * React-only state").
 */
import { spawnSync } from "node:child_process";
import { type CliRenderer, createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createElement } from "react";
import type { AttachRequest, CockpitHost } from "../host.ts";
import type { KeyEvent } from "../keymap.ts";
import type { CockpitView } from "../view.ts";
import { CockpitScreen } from "./app.tsx";

type Waiter = (event: KeyEvent | "tick" | null) => void;

export class OpenTuiCockpitHost implements CockpitHost {
  private view: CockpitView | null = null;
  private readonly viewListeners = new Set<() => void>();
  private readonly queue: KeyEvent[] = [];
  private waiter: Waiter | null = null;
  private renderer: CliRenderer | null = null;
  private root: ReturnType<typeof createRoot> | null = null;
  private starting: Promise<void> | null = null;
  private closed = false;

  // --- CockpitViewStore (consumed by the React screen) ----------------------

  subscribe = (listener: () => void): (() => void) => {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  };

  getView = (): CockpitView | null => this.view;

  pushKey = (event: KeyEvent): void => {
    if (this.waiter !== null) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(event);
      return;
    }
    this.queue.push(event);
  };

  // --- CockpitHost -----------------------------------------------------------

  draw(view: CockpitView): void {
    this.view = view;
    if (!this.closed) {
      // Renderer creation is async; the first frame paints once it is up and
      // every later draw just notifies the subscribed screen.
      void this.ensureStarted();
    }
    for (const listener of this.viewListeners) {
      listener();
    }
  }

  nextKey(): Promise<KeyEvent | null> {
    const queued = this.queue.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    if (this.closed) {
      return Promise.resolve(null);
    }
    return new Promise<KeyEvent | null>((resolve) => {
      this.waiter = resolve as Waiter;
    });
  }

  nextKeyOrTick(timeoutMs: number): Promise<KeyEvent | "tick" | null> {
    const queued = this.queue.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    if (this.closed) {
      return Promise.resolve(null);
    }
    return new Promise<KeyEvent | "tick" | null>((resolve) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        resolve("tick");
      }, timeoutMs);
      this.waiter = (event) => {
        clearTimeout(timer);
        resolve(event);
      };
    });
  }

  async attach(request: AttachRequest): Promise<void> {
    // Leave the TUI: tear the renderer down to restore the terminal, run the
    // attach command inline, and let the next draw bring the renderer back up.
    await this.suspend();
    if (
      request.attachCommand !== null &&
      request.attachCommand.argv.length > 0
    ) {
      const [program, ...args] = request.attachCommand.argv;
      if (program !== undefined) {
        process.stdout.write(`attaching to ${request.session.name}...\n`);
        spawnSync(program, args, { stdio: "inherit" });
      }
    } else if (request.attachHint !== null && request.attachHint.length > 0) {
      process.stdout.write(
        `attach command for ${request.session.name}:\n${request.attachHint}\n`,
      );
    } else {
      process.stdout.write(
        `no attach command available for ${request.session.name}\n`,
      );
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    void this.suspend();
    if (this.waiter !== null) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(null);
    }
  }

  // --- renderer lifecycle ----------------------------------------------------

  private ensureStarted(): Promise<void> {
    if (this.starting === null) {
      this.starting = (async () => {
        const renderer = await createCliRenderer({ exitOnCtrlC: true });
        renderer.on("destroy", () => {
          // Ctrl+C (or any external destroy) ends input: the app loop treats
          // the resolved `null` as EOF and quits cleanly.
          if (!this.closed && this.renderer !== null) {
            this.renderer = null;
            this.root = null;
            this.close();
          }
        });
        const root = createRoot(renderer);
        root.render(createElement(CockpitScreen, { store: this }));
        this.renderer = renderer;
        this.root = root;
      })();
    }
    return this.starting;
  }

  private async suspend(): Promise<void> {
    if (this.starting !== null) {
      await this.starting.catch(() => {});
    }
    const renderer = this.renderer;
    const root = this.root;
    this.renderer = null;
    this.root = null;
    this.starting = null;
    root?.unmount();
    if (renderer !== null && !renderer.isDestroyed) {
      renderer.destroy();
    }
  }
}
