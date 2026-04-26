import { create } from "zustand";

export const STATUS = {
  WAITING:   "waiting",
  UPLOADING: "uploading",
  SUCCESS:   "success",
  ERROR:     "error",
};

export const useUploadStore = create((set) => ({
  fileQueue: [],

  setFileQueue: (queue) => set({ fileQueue: queue }),

  updateFile: (name, patch) =>
    set((state) => ({
      fileQueue: state.fileQueue.map((f) =>
        f.name === name ? { ...f, ...patch } : f
      ),
    })),

  clearQueue: () => set({ fileQueue: [] }),
}));
