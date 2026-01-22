import * as XLSX from "xlsx";

type LoadMessage = { type: "load"; data: ArrayBuffer };
type GetCellsMessage = {
  type: "getCells";
  requests: { key: string; sheet?: string; cell?: string }[];
};
type ClearMessage = { type: "clear" };

type WorkerMessage = LoadMessage | GetCellsMessage | ClearMessage;

let workbook: XLSX.WorkBook | null = null;

const ctx = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

ctx.onmessage = (event) => {
  const message = event.data as WorkerMessage;
  if (message.type === "load") {
    try {
      workbook = XLSX.read(message.data, { type: "array", cellDates: true });
      ctx.postMessage({
        type: "loaded",
        sheetNames: workbook?.SheetNames ?? [],
      });
    } catch (error) {
      ctx.postMessage({
        type: "error",
        error: error instanceof Error ? error.message : "Failed to parse workbook.",
      });
    }
    return;
  }

  if (message.type === "getCells") {
    const results = message.requests.map((request) => {
      if (!workbook || !request.sheet || !request.cell) {
        return { key: request.key, value: null };
      }
      const sheet = workbook.Sheets[request.sheet];
      const value = sheet?.[request.cell]?.v ?? null;
      return { key: request.key, value };
    });
    ctx.postMessage({ type: "cells", results });
    return;
  }

  if (message.type === "clear") {
    workbook = null;
    ctx.postMessage({ type: "cleared" });
  }
};

export {};
