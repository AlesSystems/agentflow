export function priceUnits(value: string): bigint { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 10n ** 12n + BigInt(fraction.padEnd(12, "0")); }
export function amountText(units: bigint): string { const whole = units / 10n ** 18n, fraction = (units % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, ""); return whole.toString() + (fraction ? "." + fraction : ""); }
export function totalTokens(input: number | null, output: number | null): string | null { return input === null || output === null ? null : (BigInt(input) + BigInt(output)).toString(); }
