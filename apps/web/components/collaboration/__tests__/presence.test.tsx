import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "@opennest/localization";

import type { CollaborationParticipant } from "@/lib/collaboration/provider";

import { LiveBadge } from "../live-badge";
import { Presence } from "../presence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ADA: CollaborationParticipant = {
  connectionId: "connection-1",
  userId: "user-1",
  displayName: "Ada",
  color: "#2563eb",
  joinedAt: "2026-11-19T00:00:00.000Z",
  lastSeenAt: "2026-11-19T00:00:00.000Z",
};

const BUDI: CollaborationParticipant = {
  connectionId: "connection-2",
  userId: "user-2",
  displayName: "Budi",
  color: "#0f766e",
  joinedAt: "2026-11-19T00:00:00.000Z",
  lastSeenAt: "2026-11-19T00:00:00.000Z",
};

let container: HTMLDivElement | undefined;
let root: Root | undefined;

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  container = undefined;
  root = undefined;
});

function render(node: React.ReactNode) {
  act(() => {
    root?.render(<LocaleProvider>{node}</LocaleProvider>);
  });
}

describe("Presence", () => {
  it("renders members and removes disconnected members", () => {
    render(<Presence participants={[ADA, BUDI]} />);

    expect(container?.querySelector("ul")?.getAttribute("aria-label")).toBe(
      "People in this note"
    );
    expect(container?.textContent).toContain("Ada");
    expect(container?.textContent).toContain("Budi");

    render(<Presence participants={[ADA]} />);

    expect(container?.textContent).toContain("Ada");
    expect(container?.textContent).not.toContain("Budi");
  });

  it("renders no presence region when nobody is connected", () => {
    render(<Presence participants={[]} />);

    expect(container?.querySelector("ul")).toBeNull();
    expect(container?.textContent).toBe("");
  });
});

describe("LiveBadge", () => {
  it("renders localized connection states", () => {
    render(<LiveBadge status="connected" readOnly={false} />);
    expect(container?.textContent).toContain("Live");

    render(<LiveBadge status="reconnecting" readOnly={false} />);
    expect(container?.textContent).toContain("Reconnecting");

    render(<LiveBadge status="connected" readOnly />);
    expect(container?.textContent).toContain("Read-only");
  });

  it("uses Indonesian copy when the locale is Indonesian", () => {
    window.localStorage.setItem("opennest.locale", "id");
    render(<LiveBadge status="connected" readOnly />);

    expect(container?.textContent).toContain("Langsung");
    expect(container?.textContent).toContain("Hanya baca");
    expect(container?.textContent).not.toContain("collaboration.");
  });
});
