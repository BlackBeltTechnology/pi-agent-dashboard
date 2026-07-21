import React, { useState, useRef, useEffect } from "react";

interface Props {
  currentName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
  className?: string;
}

export function InlineRenameInput({ currentName, onConfirm, onCancel, className }: Props) {
  const [value, setValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmedRef.current = true;
      onConfirm(value.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  function handleBlur() {
    // If Enter already confirmed, don't also cancel
    if (!confirmedRef.current) {
      onCancel();
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onClick={(e) => e.stopPropagation()}
      className={`bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded px-1 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] ${className ?? ""}`}
    />
  );
}
