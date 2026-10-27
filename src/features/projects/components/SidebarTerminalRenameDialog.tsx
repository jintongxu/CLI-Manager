import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../../../shared/ui/dialog";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { useI18n } from "../../../shared/i18n/index";

/** A request snapshot prefills the title; the action revalidates identity on confirmation. */
export function SidebarTerminalRenameDialog({ target, onConfirm, onClose }: {
  target: { id: string; title: string };
  onConfirm: (id: string, title: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(target.title);
  const composing = useRef(false);
  const confirm = () => {
    const trimmed = title.trim();
    if (!trimmed || composing.current) return;
    onConfirm(target.id, trimmed);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sidebar-terminal-rename-dialog" showCloseButton={false} onKeyDown={(event) => event.stopPropagation()}>
        <div className="sidebar-terminal-rename-header">
          <DialogTitle>{t("sidebar.terminals.renameTitle")}</DialogTitle>
          <DialogDescription>{t("sidebar.terminals.renameDescription")}</DialogDescription>
        </div>
        <div className="sidebar-terminal-rename-body">
          <Input autoFocus value={title} aria-label={t("sidebar.terminals.renameInput")}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setTitle(event.target.value)}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current) return;
              confirm();
            }} />
        </div>
        <DialogFooter className="sidebar-terminal-rename-footer">
          <Button variant="outline" onClick={onClose}>{t("sidebar.terminals.renameCancel")}</Button>
          <Button variant="default" disabled={!title.trim()} onClick={confirm}>{t("sidebar.terminals.renameConfirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
