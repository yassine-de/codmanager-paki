// A real phone number has at least 7 digits once you strip formatting
// (spaces, dashes, +country code, etc.) — this catches the case where
// someone accidentally types a city/place name into the phone field
// (e.g. "Narowal") instead of a real number, which silently breaks
// WhatsApp for that order later (no valid number to send to).
export function isValidPhoneNumber(phone: string): boolean {
  const digitCount = (phone.match(/\d/g) || []).length;
  return digitCount >= 7;
}
