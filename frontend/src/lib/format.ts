const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export const formatInr = (n: number) => `₹${inr.format(n)}`

/** ₹2.5 lakh style, the way families talk about income. */
export function lakh(n: number) {
  if (n >= 100000) return `₹${+(n / 100000).toFixed(1)} lakh`
  return formatInr(n)
}

export function payRange(min: number | null, max: number | null) {
  if (min == null && max == null) return null
  if (min != null && max != null) return `${formatInr(min)} – ${formatInr(max)}`
  return formatInr((min ?? max) as number)
}
