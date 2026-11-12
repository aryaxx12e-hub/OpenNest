import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "../button";
import { Card } from "../card";
import { Input } from "../input";

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
