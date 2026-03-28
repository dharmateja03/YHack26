/**
 * __mocks__/lib/voyage.ts
 *
 * Jest mock for lib/voyage.ts.
 * Returns a fixed 1536-dimensional vector so tests never hit the Voyage AI API.
 * Used automatically when route files import "@/lib/voyage" (via moduleNameMapper).
 */

const MOCK_VECTOR = new Array(1536).fill(0.1) as number[];

export async function embed(_text: string): Promise<number[]> {
  return MOCK_VECTOR;
}

export async function embedBatch(_texts: string[]): Promise<number[][]> {
  return _texts.map(() => MOCK_VECTOR);
}
