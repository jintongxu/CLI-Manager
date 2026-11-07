import { create } from "zustand";
import type { Project } from "../../../shared/types/index";

export type FileCompanionMode = "beside" | "current";
interface FileCompanionState {
  sessionId: string | null;
  project: Project | null;
  open: boolean;
  mode: FileCompanionMode;
  show: (sessionId: string, project: Project, mode?: FileCompanionMode) => void;
  collapse: () => void;
  setMode: (mode: FileCompanionMode) => void;
}

/** Presentation only: buffers and diff tabs remain in their existing authoritative stores. */
export const useFileCompanionStore = create<FileCompanionState>((set) => ({
  sessionId: null, project: null, open: false, mode: "beside",
  show: (sessionId, project, mode = "beside") => set({ sessionId, project, open: true, mode }),
  collapse: () => set({ open: false }),
  setMode: (mode) => set({ mode }),
}));
