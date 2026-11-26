const attributes =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true" focusable="false"';

function svg(body: string): string {
  return `<svg ${attributes}>${body}</svg>`;
}

/** Inline, dependency-free icons. They inherit color and size from CSS. */
export const maryIcons = {
  copy: svg(
    '<rect x="8" y="8" width="12" height="12" rx="2" />' +
      '<path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />',
  ),
  translate: svg(
    '<path d="M4 5h7" /><path d="M9 3v2c0 4.4-2 7.6-6 9" />' +
      '<path d="M5 9c0 2.3 2.4 4.3 6 5" /><path d="m13 21 4-10 4 10" /><path d="M14.5 17h5" />',
  ),
  settings: svg(
    '<circle cx="12" cy="12" r="3" />' +
      '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />',
  ),
  download: svg(
    '<path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />',
  ),
  trash: svg(
    '<path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />' +
      '<path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />' +
      '<path d="M10 11v6" /><path d="M14 11v6" />',
  ),
  close: svg('<path d="m6 6 12 12" /><path d="m18 6-12 12" />'),
  arrowDown: svg('<path d="M12 5v14" /><path d="m19 12-7 7-7-7" />'),
} as const;
