import { getContext, setContext } from "svelte";

export type Toast = { id: number; message: string };
type ToastContext = ReturnType<typeof createToasts>;
const toastContextKey = Symbol("toasts");

function createToasts() {
  let messages = $state<Toast[]>([]);
  let nextId = 0;

  return {
    get messages() {
      return messages;
    },
    show(message: string) {
      messages = [...messages, { id: nextId++, message }];
    },
    dismiss(id: number) {
      messages = messages.filter((toast) => toast.id !== id);
    },
  };
}

export function provideToasts() {
  return setContext(toastContextKey, createToasts());
}

export function getToasts() {
  return getContext<ToastContext>(toastContextKey);
}
