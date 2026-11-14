import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Badge } from "../badge";
import { Button } from "../button";
import { Card } from "../card";
import { ConfirmDialog } from "../confirm-dialog";
import { Input } from "../input";
import { Label } from "../label";
import { Select } from "../select";
import { Skeleton } from "../skeleton";
import { Textarea } from "../textarea";

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("Button", () => {
  it("renders a button with a default type", () => {
    const html = render(<Button>Save</Button>);
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain("Save");
  });

  it("applies primary variant classes by default", () => {
    const html = render(<Button>Save</Button>);
    expect(html).toContain("bg-primary");
    expect(html).toContain("text-primary-foreground");
  });

  it("applies the secondary and ghost variants", () => {
    expect(render(<Button variant="secondary">Save</Button>)).toContain("border-border");
    expect(render(<Button variant="ghost">Save</Button>)).toContain("hover:bg-border/40");
  });

  it("maps sizes to distinct heights", () => {
    expect(render(<Button size="sm">Save</Button>)).toContain("min-h-11 px-3");
    expect(render(<Button size="lg">Save</Button>)).toContain("min-h-12 px-6");
  });

  it("keeps disabled styling and forwards disabled", () => {
    const html = render(<Button disabled>Save</Button>);
    expect(html).toContain("disabled:cursor-not-allowed");
    expect(html).toContain("disabled");
  });

  it("merges a custom className last", () => {
    const html = render(<Button className="px-8">Save</Button>);
    expect(html).toContain("px-8");
    expect(html).not.toContain("px-4");
  });

  it("disables and marks itself busy while loading", () => {
    const html = render(<Button loading>Save</Button>);
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("animate-spin");
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders the danger variant with a high-contrast surface", () => {
    const html = render(<Button variant="danger">Delete</Button>);
    expect(html).toContain("bg-red-700");
    expect(html).toContain("text-white");
  });
});

describe("Card", () => {
  it("renders a bordered surface", () => {
    const html = render(<Card>Body</Card>);
    expect(html).toContain("rounded-2xl");
    expect(html).toContain("border-border");
    expect(html).toContain("Body");
  });
});

describe("Input", () => {
  it("renders a text input by default", () => {
    const html = render(<Input aria-label="Name" />);
    expect(html).toContain('type="text"');
    expect(html).toContain('aria-label="Name"');
  });

  it("keeps the 44px touch target and focus ring", () => {
    const html = render(<Input aria-label="Name" />);
    expect(html).toContain("min-h-11");
    expect(html).toContain("focus-visible:outline-primary");
  });
});

describe("form primitives", () => {
  it("renders a labelled textarea with a comfortable height", () => {
    const html = render(<Textarea aria-label="Notes" rows={8} />);
    expect(html).toContain("<textarea");
    expect(html).toContain('rows="8"');
    expect(html).toContain("min-h-28");
  });

  it("renders a label and select", () => {
    expect(render(<Label htmlFor="name">Name</Label>)).toContain("<label");
    expect(render(<Select aria-label="Folder" />)).toContain("<select");
  });
});

describe("display primitives", () => {
  it("renders badge tones", () => {
    expect(render(<Badge>Draft</Badge>)).toContain("bg-background");
    expect(render(<Badge tone="success">Saved</Badge>)).toContain("text-green-800");
  });

  it("hides skeletons from assistive technology", () => {
    const html = render(<Skeleton className="h-4" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("animate-pulse");
  });
});

describe("ConfirmDialog", () => {
  it("renders both actions and forwards the destructive tone", () => {
    const html = render(
      <ConfirmDialog
        open
        title="Delete file?"
        description="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain("Delete file?");
    expect(html).toContain("This cannot be undone.");
    expect(html).toContain("bg-red-700");
    expect(html).toContain("Cancel");
  });
});
