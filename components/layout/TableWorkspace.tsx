"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

type Workspace = { focused: boolean; open: boolean; target: HTMLDivElement | null };
const WorkspaceContext = createContext<Workspace | null>(null);
export const useTableWorkspace = () => useContext(WorkspaceContext);

// Keep one mounted copy of every control. Controls stay inline during the
// smooth scroll-collapse animation and move into the popup portal when opened,
// preserving typed filters, selection state, focus, and in-flight operations.
export function WorkspaceControls({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const workspace = useTableWorkspace();
  const inline = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const focusedControl = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const enabled = workspace !== null;

  useEffect(() => {
    if (!enabled) return;
    const element = document.createElement("div");
    element.dataset.workspaceControls = label;
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", label);
    element.className = className ?? "";
    const rememberFocus = (event: FocusEvent) => {
      focusedControl.current = event.target instanceof HTMLElement && element.contains(event.target) ? event.target : null;
    };
    document.addEventListener("focusin", rememberFocus, true);
    setHost(element);
    return () => {
      document.removeEventListener("focusin", rememberFocus, true);
      element.remove();
    };
  }, [enabled, label, className]);

  useLayoutEffect(() => {
    if (!host) return;
    const active = focusedControl.current;
    const local = Boolean(slot.current?.closest('[role="dialog"]'));
    slot.current?.toggleAttribute("data-workspace-local", local);
    const parent = workspace?.focused && workspace.open && workspace.target && !local ? workspace.target : inline.current;
    parent?.appendChild(host);
    if (active?.isConnected && host.contains(active)) active.focus({ preventScroll: true });
  }, [host, workspace?.focused, workspace?.open, workspace?.target]);

  if (!workspace) return <div className={className}>{children}</div>;
  return (
    <div ref={slot} className="workspace-control-slot">
      <div ref={inline} className="workspace-collapse-inner">
        {host ? createPortal(children, host) : children}
      </div>
    </div>
  );
}

export function TableWorkspace({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const route = `${pathname}?${params.toString()}`;
  const [seenPath, setSeenPath] = useState(route);
  const [focused, setFocused] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const suppressReflow = useRef(0);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const printing = useRef(false);
  const focusedBeforePrint = useRef(false);
  const beforePrintScroll = useRef<{ element: HTMLElement; top: number; left: number }[]>([]);
  if (seenPath !== route) {
    setSeenPath(route);
    setFocused(false);
    setOpen(false);
  }

  useLayoutEffect(() => {
    suppressReflow.current = performance.now() + 360;
    root.current?.querySelectorAll<HTMLElement>('[data-workspace-main],[data-list="global"]').forEach((element) =>
      element.scrollTo({ top: 0, behavior: "instant" }),
    );
  }, [route]);

  useEffect(() => () => { if (transitionTimer.current) clearTimeout(transitionTimer.current); }, []);

  useEffect(() => {
    const shell = root.current;
    if (!shell) return;
    const areas = () =>
      Array.from(shell.querySelectorAll<HTMLElement>('[data-workspace-main],[data-list="global"]')).filter(
        (element) => !element.closest('[role="dialog"]'),
      );
    const atTop = () => areas().every((element) => element.scrollTop <= 0);
    const update = (next: boolean) => {
      suppressReflow.current = performance.now() + 360;
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
      setTransitioning(true);
      transitionTimer.current = setTimeout(() => setTransitioning(false), 300);
      setFocused(next);
      if (!next) setOpen(false);
    };
    const scroll = (event: Event) => {
      if (printing.current) return;
      const element = event.target;
      if (!(element instanceof HTMLElement) || !areas().includes(element)) return;
      if (element.scrollTop > 0) {
        const lists = areas().filter((area) => area.hasAttribute("data-list"));
        if (!lists.length) return;
        // A page scroll hands its distance to the table, so the expanded table
        // starts at the viewport edge rather than remaining partly off screen.
        if (element.hasAttribute("data-workspace-main")) {
          const list = lists.find((area) => area.getBoundingClientRect().bottom > 0) ?? lists[0];
          list.scrollTop += element.scrollTop;
          element.scrollTop = 0;
        }
        if (!focused) update(true);
      } else if (
        focused &&
        atTop() &&
        (performance.now() >= suppressReflow.current ||
          areas().some((area) => area.hasAttribute("data-list") && area.scrollHeight > area.clientHeight + 1))
      ) {
        update(false);
      }
    };
    // A short list can reach its top when its viewport grows. Restore the
    // controls on an upward gesture instead of oscillating during that reflow.
    const wheel = (event: WheelEvent) => {
      if (focused && event.deltaY < 0 && atTop() && !popup.current?.contains(event.target as Node)) update(false);
    };
    const key = (event: KeyboardEvent) => {
      if (
        focused &&
        (event.key === "Home" || event.key === "ArrowUp" || event.key === "PageUp") &&
        atTop() &&
        !(event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[role="dialog"]'))
      ) {
        update(false);
      }
    };
    let touchY = 0;
    const touchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? 0;
    };
    const touchMove = (event: TouchEvent) => {
      if (focused && (event.touches[0]?.clientY ?? touchY) > touchY + 8 && atTop() && !popup.current?.contains(event.target as Node)) {
        update(false);
      }
    };
    shell.addEventListener("scroll", scroll, true);
    shell.addEventListener("wheel", wheel, { passive: true });
    shell.addEventListener("keydown", key);
    shell.addEventListener("touchstart", touchStart, { passive: true });
    shell.addEventListener("touchmove", touchMove, { passive: true });
    return () => {
      shell.removeEventListener("scroll", scroll, true);
      shell.removeEventListener("wheel", wheel);
      shell.removeEventListener("keydown", key);
      shell.removeEventListener("touchstart", touchStart);
      shell.removeEventListener("touchmove", touchMove);
    };
  }, [focused, route]);

  useEffect(() => {
    const before = () => {
      printing.current = true;
      focusedBeforePrint.current = focused;
      beforePrintScroll.current = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-workspace-main],[data-list="global"]') ?? []).map(
        (element) => ({ element, top: element.scrollTop, left: element.scrollLeft }),
      );
      flushSync(() => {
        setFocused(false);
        setOpen(false);
        setTransitioning(false);
      });
    };
    const after = () => {
      suppressReflow.current = performance.now() + 360;
      flushSync(() => setFocused(focusedBeforePrint.current));
      requestAnimationFrame(() => {
        for (const { element, top, left } of beforePrintScroll.current) {
          if (element.isConnected) element.scrollTo({ top, left, behavior: "instant" });
        }
        printing.current = false;
      });
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [focused]);

  useEffect(() => {
    if (!open || !focused) return;
    const frame = requestAnimationFrame(() => popup.current?.querySelector<HTMLElement>("button,input,select,a[href]")?.focus());
    const outside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!popup.current?.contains(node) && !toggle.current?.contains(node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, focused]);

  return (
    <WorkspaceContext.Provider value={{ focused, open, target }}>
      <div
        ref={root}
        data-table-workspace
        data-workspace-focused={focused || undefined}
        data-workspace-transitioning={transitioning || undefined}
        className="flex h-dvh min-h-0 overflow-hidden print:block print:h-auto print:overflow-visible"
      >
        {children}
        {focused && (
          <button
            ref={toggle}
            type="button"
            aria-label="Table options"
            title="Table options"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls="workspace-options"
            onClick={() => setOpen((value) => !value)}
            className="workspace-options-toggle print:hidden"
          >
            <Icon name="more" />
          </button>
        )}
        <div
          ref={popup}
          id="workspace-options"
          role={focused && open ? "dialog" : undefined}
          aria-label="Table options"
          hidden={!focused || !open}
          className="workspace-options print:hidden"
        >
          <div className="workspace-options-content scroll-thin">
            <h2 className="mb-3 text-center text-lg text-navy-800">Options</h2>
            <div ref={setTarget} className="workspace-options-groups" />
            <button
              type="button"
              onClick={() => {
                root.current?.querySelectorAll<HTMLElement>('[data-workspace-main],[data-list="global"]').forEach((element) =>
                  element.scrollTo({ top: 0, behavior: "smooth" }),
                );
                setFocused(false);
                setOpen(false);
              }}
              className="mt-4 w-full rounded-full border border-sand px-3 py-2 text-sm text-navy-800"
            >
              Back to top
            </button>
            <button
              type="button"
              aria-label="Close table options"
              onClick={() => {
                setOpen(false);
                toggle.current?.focus();
              }}
              className="mx-auto mt-3 flex h-11 w-11 items-center justify-center rounded-full border border-sand text-steel"
            >
              <Icon name="close" />
            </button>
          </div>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
