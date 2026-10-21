import type { SVGProps } from "react";
import { GitBranch } from "./icons";

export function WorktreeIcon({ strokeWidth = 1.8, ...props }: SVGProps<SVGSVGElement>) {
  return <GitBranch strokeWidth={strokeWidth} {...props} />;
}
