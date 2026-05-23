export const HIGHLIGHT_COLORS = [
  { id: "yellow", label: "Yellow", value: "#fff3bf" },
  { id: "orange", label: "Orange", value: "#ffd8a8" },
  { id: "green", label: "Green", value: "#d3f9d8" },
  { id: "blue", label: "Blue", value: "#d0ebff" },
  { id: "pink", label: "Pink", value: "#ffe3e3" }
];

export function createAnnotation({ anchor, color = "yellow", note = "", createdAt = new Date().toISOString() }) {
  if (!anchor?.exact) {
    throw new Error("Annotation requires a text anchor.");
  }

  return {
    id: cryptoRandomId(),
    type: note.trim() ? "note" : "highlight",
    color,
    anchor,
    note,
    createdAt,
    updatedAt: createdAt
  };
}

export function upsertAnnotation(annotations, candidate) {
  const duplicate = annotations.find((annotation) => sameAnchor(annotation.anchor, candidate.anchor));
  if (duplicate) {
    return annotations.map((annotation) =>
      annotation.id === duplicate.id
        ? {
            ...annotation,
            color: candidate.color,
            note: candidate.note || annotation.note,
            type: candidate.type === "note" || candidate.note?.trim() || annotation.note?.trim() ? "note" : "highlight",
            updatedAt: candidate.updatedAt || new Date().toISOString()
          }
        : annotation
    );
  }

  return [...annotations, candidate];
}

export function updateAnnotation(annotations, id, patch) {
  return annotations.map((annotation) => {
    if (annotation.id !== id) return annotation;
    const note = patch.note ?? annotation.note;
    return {
      ...annotation,
      ...patch,
      note,
      type: patch.type ?? (note.trim() ? "note" : "highlight"),
      updatedAt: patch.updatedAt || new Date().toISOString()
    };
  });
}

export function deleteAnnotation(annotations, id) {
  return annotations.filter((annotation) => annotation.id !== id);
}

export function filterAnnotations(annotations, filters) {
  return annotations.filter((annotation) => {
    if (filters?.color && filters.color !== "all" && annotation.color !== filters.color) return false;
    if (filters?.type === "notes" && annotation.type !== "note") return false;
    if (filters?.type === "highlights" && annotation.type !== "highlight") return false;
    return true;
  });
}

export function sameAnchor(left, right) {
  return (
    left?.exact === right?.exact &&
    left?.startOffset === right?.startOffset &&
    left?.endOffset === right?.endOffset
  );
}

function cryptoRandomId() {
  const browserCrypto = globalThis.crypto;
  if (browserCrypto?.randomUUID) return browserCrypto.randomUUID();
  return `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
