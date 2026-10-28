import { create } from "zustand";
import { persist } from "zustand/middleware";

const API = process.env.REACT_APP_SERVER_URL;

function patchLast(messages, updater) {
  const updated = [...messages];
  updated[updated.length - 1] = updater(updated[updated.length - 1]);
  return updated;
}

function sseToken(token) {
  return token === "\\n" ? "\n" : token;
}


export const useChatStore = create(
  persist(
    (set, get) => ({
      messages: [],

      streaming: false,
      _abortController: null,


      clearChat: () => {
        get()._abortController?.abort();
        set({ messages: [], streaming: false, _abortController: null });
      },

      sendQuestion: async (question) => {
        if (!question.trim() || get().streaming) return;

        const userMsg      = { role: "user", text: question };
        const assistantMsg = {
          role:          "assistant",
          text:          "",
          sources:       null,
          statusSteps:   [],
          currentStatus: null,
        };

        set((state) => ({
          messages:  [...state.messages, userMsg, assistantMsg],
          streaming: true,
        }));

        const abort = new AbortController();
        set({ _abortController: abort });

        try {
          const res = await fetch(
            `${API}/chat?question=${encodeURIComponent(question)}`,
            { signal: abort.signal }
          );

          if (!res.ok || !res.body) throw new Error("Stream failed");

          const reader  = res.body.getReader();
          const decoder = new TextDecoder();
          let   buffer  = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop(); // keep incomplete line

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              // ── status update ──
              if (trimmed.startsWith("status: ")) {
                const statusMsg = trimmed.slice(8);
                set((state) => ({
                  messages: patchLast(state.messages, (msg) => ({
                    ...msg,
                    statusSteps: [
                      ...(msg.statusSteps || []).map((s) =>
                        s.label === msg.currentStatus ? { ...s, done: true } : s
                      ),
                      ...(msg.statusSteps || []).some((s) => s.label === statusMsg)
                        ? []
                        : [{ label: statusMsg, done: false }],
                    ],
                    currentStatus: statusMsg,
                  })),
                }));
                continue;
              }

              // ── sources ──
              if (trimmed.startsWith("sources: ")) {
                try {
                  const sources = JSON.parse(trimmed.slice(9));
                  set((state) => ({
                    messages: patchLast(state.messages, (msg) => ({
                      ...msg,
                      sources,
                    })),
                  }));
                } catch (_) {}
                continue;
              }

              // ── token ──
              if (trimmed.startsWith("data: ")) {
                const token = trimmed.slice(6);

                if (token === "[DONE]") {
                  set((state) => ({
                    messages: patchLast(state.messages, (msg) => ({
                      ...msg,
                      statusSteps:   (msg.statusSteps || []).map((s) => ({ ...s, done: true })),
                      currentStatus: null,
                    })),
                  }));
                  break;
                }

                const actual = sseToken(token);
                set((state) => ({
                  messages: patchLast(state.messages, (msg) => ({
                    ...msg,
                    text: msg.text + actual,
                  })),
                }));
              }
            }
          }
        } catch (err) {
          if (err.name !== "AbortError") {
            set((state) => ({
              messages: patchLast(state.messages, (msg) => ({
                ...msg,
                text:          "Something went wrong. Please try again.",
                error:         true,
                statusSteps:   (msg.statusSteps || []).map((s) => ({ ...s, done: true })),
                currentStatus: null,
              })),
            }));
          }
        } finally {
          set({ streaming: false, _abortController: null });
        }
      },
    }),

    {
      name: "chat-history",
      partialize: (state) => ({ messages: state.messages }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.messages = (state.messages || []).map((msg) => {
          if (msg.role !== "assistant") return msg;
          return {
            ...msg,
            statusSteps:   (msg.statusSteps || []).map((s) => ({ ...s, done: true })),
            currentStatus: null,
            text: msg.text || "_Response was interrupted — please ask again._",
            error: msg.text ? msg.error : true,
          };
        });
      },
    }
  )
);
