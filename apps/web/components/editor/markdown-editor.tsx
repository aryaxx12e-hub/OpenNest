"use client";

import { Textarea } from "@opennest/ui";

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  readOnly?: boolean;
  rows?: number;
  className?: string;
  onBlur?: () => void;
}

export function MarkdownEditor({
  value,
  onChange,
  ariaLabel,
  placeholder,
  readOnly = false,
  rows = 20,
  className,
  onBlur,
}: MarkdownEditorProps) {
  return (
    <Textarea
      value={value}
      aria-label={ariaLabel}
      aria-readonly={readOnly}
      readOnly={readOnly}
      rows={rows}
      className={className}
      placeholder={placeholder}
      onBlur={onBlur}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
