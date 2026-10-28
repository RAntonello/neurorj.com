// Loading this module does not load GPT-2. The worker and its assets are created
// only when someone asks for a prediction of their own text.
export function createInferenceClient() {
  let worker = null;
  let nextId = 0;
  let disposed = false;
  const pending = new Map();

  function failPending(message, code) {
    for (const { reject } of pending.values()) {
      const error = new Error(message);
      error.code = code;
      reject(error);
    }
    pending.clear();
  }

  function resetWorker(message) {
    worker?.terminate();
    worker = null;
    failPending(message, "WORKER_FAILED");
  }

  function ensureWorker() {
    if (worker) return worker;
    if (typeof Worker === "undefined") {
      throw new Error("Custom text needs a browser with Web Worker support. Try a current browser; the saved examples still work.");
    }
    // A classic worker can import the existing tokenizer and the pinned runtime.
    worker = new Worker(new URL("./inference-worker.js", import.meta.url));
    worker.onmessage = ({ data }) => {
      const request = pending.get(data.id);
      if (!request) return;
      if (data.type === "progress") {
        // An optional UI callback must not strand a completed prediction.
        try { request.onProgress?.(data.progress); } catch (error) { console.error(error); }
        return;
      }
      pending.delete(data.id);
      if (data.type === "result") {
        request.resolve(data.result);
      } else {
        const error = new Error(data.error?.message || "Prediction failed. Please try again.");
        error.code = data.error?.code || "INFERENCE_FAILED";
        request.reject(error);
      }
    };
    worker.onerror = event => {
      event.preventDefault();
      resetWorker("The prediction worker stopped. Try again, or use a shorter passage if your browser is low on memory. The saved examples still work.");
    };
    worker.onmessageerror = () => resetWorker("The browser could not read the prediction. Please try again.");
    return worker;
  }

  return {
    predict(text, onProgress) {
      if (disposed) return Promise.reject(new Error("This prediction client has been disposed."));
      if (typeof text !== "string" || !text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").trim()) {
        const error = new Error("Enter a passage with English words or numbers to predict its response.");
        error.code = "INPUT_EMPTY";
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        try {
          const activeWorker = ensureWorker();
          pending.set(id, { resolve, reject, onProgress });
          activeWorker.postMessage({ type: "predict", id, text });
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      worker = null;
      failPending("Prediction cancelled.", "CANCELLED");
    },
  };
}
