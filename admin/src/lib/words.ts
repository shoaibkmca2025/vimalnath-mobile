const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const twoDigits = (value: number) => (value < 20 ? ONES[value]! : `${TENS[Math.floor(value / 10)]}${value % 10 ? ` ${ONES[value % 10]}` : ''}`);
const threeDigits = (value: number) => {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? twoDigits(rest) : ''].filter(Boolean).join(' ');
};

/** Whole rupees in words, the Indian way (lakh, crore): 125430 → "One Lakh Twenty Five Thousand Four Hundred Thirty". */
function integerWords(value: number): string {
  if (value === 0) return 'Zero';
  const crore = Math.floor(value / 10_000_000);
  const lakh = Math.floor((value % 10_000_000) / 100_000);
  const thousand = Math.floor((value % 100_000) / 1000);
  const rest = value % 1000;
  return [crore ? `${integerWords(crore)} Crore` : '', lakh ? `${twoDigits(lakh)} Lakh` : '', thousand ? `${twoDigits(thousand)} Thousand` : '', rest ? threeDigits(rest) : ''].filter(Boolean).join(' ');
}

/** "Rupees One Thousand Two Hundred and Fifty Paise Only", as printed on a tax invoice. */
export function rupeesInWords(amount: number) {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  return `Rupees ${integerWords(rupees)}${paise ? ` and ${twoDigits(paise)} Paise` : ''} Only`;
}
