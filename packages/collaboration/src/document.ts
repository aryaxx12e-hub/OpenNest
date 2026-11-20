import * as Y from "yjs";

export const MARKDOWN_TEXT_KEY = "markdown";

export function createCollaborationDocument(initialText = ""): Y.Doc {
  const document = new Y.Doc();

  if (initialText.length > 0) {
    document.getText(MARKDOWN_TEXT_KEY).insert(0, initialText);
  }

  return document;
}

export function documentText(document: Y.Doc): Y.Text {
  return document.getText(MARKDOWN_TEXT_KEY);
}

export function readDocumentText(document: Y.Doc): string {
  return documentText(document).toString();
}

export function encodeDocumentState(document: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(document);
}

export function encodeDocumentUpdate(document: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(document);
}

export function applyDocumentState(document: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(document, update);
}

export function applyDocumentUpdate(document: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(document, update);
}
