import { Folder } from "../../../shared/ui/icons";
import { NodeAppearanceIcon } from "../api/NodeAppearanceIcon";

/** Folder is the identity; an optional user appearance remains a separate decoration. */
export function ProjectIdentityIcon({ mark, iconKey, size = 14 }: { mark: string; iconKey?: string; size?: number }) {
  return <span className="inline-flex items-center" aria-hidden="true">
    <Folder size={size} strokeWidth={1.5} />
    {(mark || iconKey) && <NodeAppearanceIcon mark={mark} iconKey={iconKey} fallback="folder" size={size} />}
  </span>;
}
