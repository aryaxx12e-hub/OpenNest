import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IsoDate, Note, NoteId } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";

import { NoteLinksDialog } from "../note-links-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AT = "2026-11-13T12:34:56.000Z" as IsoDate;

function note(id: string, title: string, content: string): Note {
  return {
    id: id as NoteId,
    workspaceId: "workspace-1" as Note["workspaceId"],
    folderId: null,
    title,
    content,
    pinned: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

const notes = [
  note("note-1", "Alpha", "first"),
  note("note-2", "Beta", "second"),
  note("note-3", "Gamma", "third"),
];

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;

  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
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
  vi.restoreAllMocks();
});

describe("NoteLinksDialog", () => {
  it("filters out the current note and saves a selected link", async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    act(() => {
      root?.render(
        <LocaleProvider>
          <NoteLinksDialog
            notes={notes}
            notesTotal={notes.length}
            selected={[]}
            currentNoteId={"note-1" as NoteId}
            onSave={onSave}
            onClose={onClose}
          />
        </LocaleProvider>
      );
    });

    expect(container?.textContent).not.toContain("Alpha");

    const search = container?.querySelector("input") as HTMLInputElement | null;

    expect(search).not.toBeNull();
    changeInput(search!, "gamma");

    expect(container?.textContent).toContain("Gamma");
    expect(container?.textContent).not.toContain("Beta");

    const gammaRow = [...(container?.querySelectorAll("label") ?? [])].find((label) =>
      label.textContent?.includes("Gamma")
    );
    const checkbox = gammaRow?.querySelector("input") as HTMLInputElement | null;

    expect(checkbox).not.toBeNull();
    act(() => checkbox?.click());

    const save = container?.querySelector(
      'button[type="submit"]'
    ) as HTMLButtonElement | null;

    expect(save).not.toBeNull();

    await act(async () => {
      save?.click();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith(["note-3"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("discloses when only the most recent notes are loaded", () => {
    act(() => {
      root?.render(
        <LocaleProvider>
          <NoteLinksDialog
            notes={notes}
            notesTotal={700}
            selected={[]}
            currentNoteId={"note-1" as NoteId}
            onSave={async () => undefined}
            onClose={() => undefined}
          />
        </LocaleProvider>
      );
    });

    expect(container?.textContent).toContain(
      "Showing the 500 most recent notes. Type to narrow the list."
    );
  });
});
