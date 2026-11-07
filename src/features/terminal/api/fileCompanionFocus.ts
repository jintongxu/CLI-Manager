// Keep logical ownership through resize/native blur, when activeElement may be body.
let fileCompanionFocused = false;

export function setFileCompanionFocused(focused: boolean): void {
  fileCompanionFocused = focused;
}

export function isFileCompanionFocused(): boolean {
  return fileCompanionFocused || (typeof document !== "undefined"
    && !!document.activeElement?.closest("[data-file-companion]"));
}
