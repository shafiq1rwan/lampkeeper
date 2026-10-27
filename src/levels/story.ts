// The six story records and tenant lines. Short, skippable, never required for progress.

export interface StoryRecord {
  id: number;
  title: string;
  text: string;
}

export const RECORDS: StoryRecord[] = [
  { id: 1, title: 'Note on the breaker', text: '“Two circuits at once. Leave yourself a way back.”' },
  { id: 2, title: 'A tenant remembers', text: '“He always checked 104 last. Said it was the one that mattered.”' },
  { id: 3, title: 'Old work order', text: '“104: occupant can’t stand bright ceiling lights. Fit the dim ones.”' },
  { id: 4, title: 'Note under a door', text: '“When the emergency network changes, the shadow loses its way.”' },
  { id: 5, title: 'Margin of a wiring plan', text: '“The network was built to guide me home. The lantern is my marker.”' },
  { id: 6, title: 'Apartment 104', text: '“Thank you for keeping the way home lit.”' },
];

/** Lines a tenant says when helped, keyed by the record they hand over (0 = none left). */
export const TENANT_LINES: Record<number, string> = {
  2: '“You’re the new caretaker? The old one always checked 104 last.”',
  4: '“This was slipped under my door years ago. I think it’s his.”',
  0: '“Thanks for checking in. Mind the dark halls.”',
};

export function getRecord(id: number): StoryRecord | undefined {
  return RECORDS.find((r) => r.id === id);
}
