export type MergeDto = {
  ids: string[];
};

export type SplitDto = {
  id: string;
  splitDate: string;
};

export type ResolveConflictDto = {
  manualId: string;
  decision: 'keep' | 'remove';
};
