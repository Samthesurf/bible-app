/**
 * Verse text cleaning.
 *
 * Many translations (NKJV, NIV, ESV, NLT, NASB, ...) embed cross-reference
 * markers in the verse text: superscript letters like "[a]", "[b]" ... "[z]"
 * and beyond ("[aa]", "[ab]") that point to margin/center-column references
 * in the printed Bible. They are editorial apparatus, not part of the text,
 * so they must be stripped before speaking or displaying.
 *
 * Only single/double lowercase-letter markers are stripped. Real bracketed
 * content is preserved, e.g. textual notes such as
 * "[The earliest manuscripts and some other early witnesses do not include
 * verses 9-20.]" or bracketed digits.
 */
export function cleanVerseText(text: string): string {
  return text
    .replace(/\[[a-z]{1,2}\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
