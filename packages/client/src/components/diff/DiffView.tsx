import React from "react";

interface Props {
  content: string;
}

export function DiffView({ content }: Props) {
  const lines = content.split("\n");

  return (
    <div className="font-mono text-xs overflow-x-auto">
      {lines.map((line, i) => {
        let bgColor = "";
        let textColor = "text-[var(--text-secondary)]";

        if (line.startsWith("+") && !line.startsWith("+++")) {
          bgColor = "bg-[color-mix(in_srgb,var(--accent-green)_15%,transparent)]";
          textColor = "text-[var(--accent-green)]";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          bgColor = "bg-[color-mix(in_srgb,var(--accent-red)_15%,transparent)]";
          textColor = "text-[var(--accent-red)]";
        } else if (line.startsWith("@@")) {
          textColor = "text-[var(--accent-blue)]";
        }

        return (
          <div key={i} className={`px-2 ${bgColor} ${textColor}`}>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}
