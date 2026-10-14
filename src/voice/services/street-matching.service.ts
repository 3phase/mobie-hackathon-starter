import { Injectable } from '@nestjs/common';
import type { StreetEntry } from '../providers/openplz.types.js';
import { normalizedVariants, normalizeAustrianAddress } from '../utils/austrian-address-normalizer.js';

export interface RankedStreet {
  readonly street: StreetEntry;
  readonly score: number;
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value}  `;
  return new Set(Array.from({ length: Math.max(0, padded.length - 2) }, (_, index) => padded.slice(index, index + 3)));
}

function dice(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (!a.size && !b.size) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

function tokenScore(left: string, right: string): number {
  const a = new Set(left.split(' ').filter(Boolean));
  const b = new Set(right.split(' ').filter(Boolean));
  if (!a.size && !b.size) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(a.size, b.size);
}

export function textSimilarity(leftValue: string, rightValue: string): number {
  let best = 0;
  for (const left of normalizedVariants(leftValue)) {
    for (const right of normalizedVariants(rightValue)) {
      if (left === right) return left === normalizedVariants(leftValue)[0] && right === normalizedVariants(rightValue)[0] ? 1 : 0.97;
      const edit = 1 - levenshtein(left, right) / Math.max(left.length, right.length, 1);
      best = Math.max(best, edit * 0.65 + dice(left, right) * 0.25 + tokenScore(left, right) * 0.1);
    }
  }
  return Math.max(0, Math.min(1, best));
}

@Injectable()
export class StreetMatchingService {
  public rank(query: string, streets: readonly StreetEntry[]): RankedStreet[] {
    const distinct = new Map<string, StreetEntry>();
    for (const street of streets) {
      const identity = [
        street.key, street.postalCode, street.municipality.key, normalizeAustrianAddress(street.locality),
      ].join('\u0000');
      if (!distinct.has(identity)) distinct.set(identity, street);
    }
    return [...distinct.values()]
      .map((street) => ({ street, score: textSimilarity(query, street.name) }))
      .filter(({ score }) => score >= 0.58)
      .sort((left, right) => right.score - left.score
        || left.street.name.localeCompare(right.street.name, 'de-AT')
        || left.street.key.localeCompare(right.street.key))
      .slice(0, 5);
  }
}
