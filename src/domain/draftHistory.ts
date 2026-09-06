import { draftReducer, type DraftAction, type DraftState } from './draft';

interface HistorySnapshot {
  state: DraftState;
  description: string;
}

export interface DraftHistoryState {
  past: HistorySnapshot[];
  present: DraftState;
  future: HistorySnapshot[];
  lastTransition: null | { kind: 'apply' | 'undo' | 'redo'; description: string };
}

export type DraftHistoryEvent =
  | { type: 'apply'; actions: DraftAction[]; description: string; record: boolean }
  | { type: 'undo' }
  | { type: 'redo' };

export const createDraftHistory = (present: DraftState): DraftHistoryState => ({
  past: [],
  present,
  future: [],
  lastTransition: null,
});

const applyActions = (state: DraftState, actions: DraftAction[]) => (
  actions.reduce(draftReducer, state)
);

// Drafts contain plain data. Skip shared branches, including large image strings,
// while recognizing equivalent patches that allocate fresh objects or arrays.
function sameDraftData(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (!first || !second || typeof first !== 'object' || typeof second !== 'object') return false;
  if (Array.isArray(first) !== Array.isArray(second)) return false;
  const firstRecord = first as Record<string, unknown>;
  const secondRecord = second as Record<string, unknown>;
  const keys = Object.keys(firstRecord);
  return keys.length === Object.keys(secondRecord).length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(secondRecord, key)
      && sameDraftData(firstRecord[key], secondRecord[key]));
}

export function draftHistoryReducer(
  history: DraftHistoryState,
  event: DraftHistoryEvent,
): DraftHistoryState {
  switch (event.type) {
    case 'apply': {
      const present = applyActions(history.present, event.actions);
      if (sameDraftData(present, history.present)) return history;
      if (!event.record) {
        const snapshotActions: DraftAction[] = event.actions.some(({ type }) => (
          type === 'toggle-selected' || type === 'set-selected'
        ))
          ? [
            ...event.actions.filter(({ type }) => type !== 'toggle-selected' && type !== 'set-selected'),
            { type: 'set-selected', ids: present.selectedLabelIds },
          ]
          : event.actions;
        return {
          past: history.past.map((snapshot) => ({
            ...snapshot,
            state: applyActions(snapshot.state, snapshotActions),
          })),
          present,
          future: history.future.map((snapshot) => ({
            ...snapshot,
            state: applyActions(snapshot.state, snapshotActions),
          })),
          lastTransition: { kind: 'apply', description: event.description },
        };
      }
      return {
        past: [...history.past, { state: history.present, description: event.description }].slice(-100),
        present,
        future: [],
        lastTransition: { kind: 'apply', description: event.description },
      };
    }
    case 'undo': {
      const snapshot = history.past.at(-1);
      if (!snapshot) return history;
      return {
        past: history.past.slice(0, -1),
        present: snapshot.state,
        future: [
          ...history.future,
          { state: history.present, description: snapshot.description },
        ],
        lastTransition: { kind: 'undo', description: snapshot.description },
      };
    }
    case 'redo': {
      const snapshot = history.future.at(-1);
      if (!snapshot) return history;
      return {
        past: [
          ...history.past,
          { state: history.present, description: snapshot.description },
        ].slice(-100),
        present: snapshot.state,
        future: history.future.slice(0, -1),
        lastTransition: { kind: 'redo', description: snapshot.description },
      };
    }
  }
}

export const canUndo = (history: DraftHistoryState) => history.past.length > 0;
export const canRedo = (history: DraftHistoryState) => history.future.length > 0;
