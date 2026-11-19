/**
 * For `autoComplete` on fields the browser's saved details never belong in: searches, and the customer's details on
 * an order request. Edge and Chrome ignore `autocomplete="off"` for saved personal info (name, phone, travel numbers…)
 * and still open their autofill box over the field; a value that isn't an autofill type is one they leave alone.
 */
export const NO_AUTOFILL = 'no-autofill';
