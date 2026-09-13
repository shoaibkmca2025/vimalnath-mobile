export const pad2 = (value: number) => String(value).padStart(2, '0');

// Hand-rolled grouping so output is identical on Hermes builds with or without full Intl data.
export const formatNumber = (value: number) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const formatMm = (value: number) => `${formatNumber(value)} mm`;
