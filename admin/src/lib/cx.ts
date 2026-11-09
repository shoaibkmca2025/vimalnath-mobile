/** Joins class names, skipping falsy entries. */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');
